import { prisma } from "../db";
import { bumpRevision } from "../bus";
import { logAudit } from "../audit";
import {
  busyUntilMap,
  getDiningStats,
  loadBlocks,
  loadLive,
  loadRestaurant,
  lockRestaurant,
  TX,
  type Actor,
  type Failure,
  type LiveTable,
} from "./service";
import { plannedDiningMins } from "./predict";
import { waitlistEtas, type EtaTable } from "./waitlistEta";
import { newBookingCode, newManageToken } from "./guest";
import { composeWaitlist, formatTime, queueGuestMessage, waitlistUrl } from "./messages";
import type { ReservationPolicy } from "./policy";
import type { DiningStats } from "./predict";
import { linkGuest } from "./guests";

const MIN = 60_000;
const HOUR = 60 * MIN;

export type QueueEta = {
  id: string;
  position: number;
  etaAt: Date | null;
  tableId: string | null;
};

/** Every waiting party's place and expected seating time, in queue order. */
export async function computeQueue(
  restaurantId: string,
  policy: ReservationPolicy,
  stats: DiningStats,
  live?: LiveTable[],
  extraParty?: { partySize: number },
): Promise<{ etas: Map<string, QueueEta>; extra: QueueEta | null }> {
  const now = Date.now();
  const tablesLive = live ?? (await loadLive(restaurantId, policy, stats));
  const [entries, blocks] = await Promise.all([
    prisma.waitlistEntry.findMany({
      where: { restaurantId, status: { in: ["WAITING", "NOTIFIED"] } },
      orderBy: { createdAt: "asc" },
      select: { id: true, partySize: true, status: true, offeredTableIds: true },
    }),
    loadBlocks(prisma, restaurantId, new Date(now - HOUR), new Date(now + 8 * HOUR)),
  ]);
  const busy = busyUntilMap(tablesLive, policy);
  // Tables already offered to a notified party are theirs until they arrive.
  const offered = new Set(
    entries.filter((e) => e.status === "NOTIFIED").flatMap((e) => e.offeredTableIds),
  );
  const tables: EtaTable[] = tablesLive.map((t) => ({
    id: t.table.id,
    seats: t.table.seats,
    minParty: Math.min(t.table.minParty, 2),
    readyAt: offered.has(t.table.id)
      ? now + (policy.waitlistReplyMins + 60) * MIN
      : (busy.get(t.table.id) ?? now),
    blocks: blocks
      .filter((b) => b.tableId === t.table.id)
      .map((b) => ({ start: b.start, end: b.end })),
  }));
  const queue = entries
    .filter((e) => e.status === "WAITING")
    .map((e) => ({ id: e.id, partySize: e.partySize }));
  if (extraParty) queue.push({ id: "__new__", partySize: extraParty.partySize });
  const result = waitlistEtas(
    tables,
    queue,
    (size) => plannedDiningMins(size, stats, policy) * MIN,
    policy.cleaningMins * MIN,
    now,
  );
  const etas = new Map<string, QueueEta>();
  let position = 0;
  let extra: QueueEta | null = null;
  for (const q of queue) {
    position++;
    const eta = result.get(q.id) ?? null;
    const row = {
      id: q.id,
      position,
      etaAt: eta ? new Date(eta.at) : null,
      tableId: eta?.tableId ?? null,
    };
    if (q.id === "__new__") extra = row;
    else etas.set(q.id, row);
  }
  return { etas, extra };
}

export async function quoteWait(restaurantId: string, partySize: number) {
  const { policy } = await loadRestaurant(restaurantId);
  const stats = await getDiningStats(restaurantId);
  const { extra } = await computeQueue(restaurantId, policy, stats, undefined, { partySize });
  const waitMins = extra?.etaAt
    ? Math.max(0, Math.round((extra.etaAt.getTime() - Date.now()) / MIN))
    : null;
  return { ahead: (extra?.position ?? 1) - 1, waitMins, fits: !!extra?.etaAt };
}

export async function joinWaitlist(input: {
  restaurantId: string;
  customerName: string;
  customerPhone: string | null;
  partySize: number;
  note?: string | null;
  source: "REMOTE" | "DOOR";
  actor?: Actor;
}): Promise<{ ok: true; manageToken: string; code: string; id: string } | Failure> {
  const { restaurant, policy } = await loadRestaurant(input.restaurantId);
  if (!policy.waitlistEnabled && input.source === "REMOTE") {
    return { ok: false, status: 400, code: "OFF", error: "The waiting list is closed right now." };
  }
  if (input.customerPhone) {
    const existing = await prisma.waitlistEntry.findFirst({
      where: {
        restaurantId: restaurant.id,
        customerPhone: input.customerPhone,
        status: { in: ["WAITING", "NOTIFIED"] },
      },
      select: { manageToken: true, code: true, id: true },
    });
    // Joining twice from the same phone returns the place they already have.
    if (existing) return { ok: true, ...existing };
  }
  const quote = await quoteWait(restaurant.id, input.partySize);
  const guestId = await linkGuest(prisma, restaurant.id, input.customerName, input.customerPhone);
  const entry = await prisma.waitlistEntry.create({
    data: {
      restaurantId: restaurant.id,
      guestId,
      code: newBookingCode("WL"),
      manageToken: newManageToken(),
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      partySize: input.partySize,
      note: input.note || null,
      source: input.source,
      quotedMins: quote.waitMins,
    },
  });
  await queueGuestMessage({
    restaurantId: restaurant.id,
    waitlistEntryId: entry.id,
    kind: "WAITLIST_JOINED",
    phone: entry.customerPhone,
    body: composeWaitlist("WAITLIST_JOINED", {
      restaurant: restaurant.name,
      name: entry.customerName,
      link: waitlistUrl(restaurant.slug, entry.manageToken),
    }),
  });
  if (input.actor) {
    await logAudit({
      restaurantId: restaurant.id,
      actorId: input.actor.id,
      actorName: input.actor.name,
      action: "waitlist.added",
      detail: `${entry.customerName} · ${entry.partySize}`,
    });
  }
  bumpRevision(restaurant.id);
  // A table may be free right now.
  if (policy.waitlistAutoNotify) await offerFreeTables(restaurant.id);
  return { ok: true, manageToken: entry.manageToken, code: entry.code, id: entry.id };
}

/** Tell a waiting party their table is ready and hold it for the reply window. */
export async function notifyWaitlistEntry(input: {
  restaurantId: string;
  entryId: string;
  tableIds: string[];
  actor?: Actor;
}): Promise<{ ok: true } | Failure> {
  const { restaurant, policy } = await loadRestaurant(input.restaurantId);
  const entry = await prisma.waitlistEntry.findFirst({
    where: {
      id: input.entryId,
      restaurantId: restaurant.id,
      status: { in: ["WAITING", "NOTIFIED"] },
    },
  });
  if (!entry) return { ok: false, status: 404, code: "NOT_FOUND", error: "No longer waiting." };
  const respondBy = new Date(Date.now() + policy.waitlistReplyMins * MIN);
  const names = await prisma.table.findMany({
    where: { id: { in: input.tableIds }, restaurantId: restaurant.id },
    select: { name: true },
  });
  await prisma.waitlistEntry.update({
    where: { id: entry.id },
    data: {
      status: "NOTIFIED",
      notifiedAt: new Date(),
      respondBy,
      offeredTableIds: input.tableIds,
    },
  });
  await sendTableReady(
    restaurant,
    policy,
    entry,
    names.map((n) => n.name),
    respondBy,
  );
  await logAudit({
    restaurantId: restaurant.id,
    actorId: input.actor?.id ?? null,
    actorName: input.actor?.name ?? "Mezbaan",
    action: "waitlist.notified",
    detail: `${entry.customerName} · ${names.map((n) => n.name).join(" + ")}`,
  });
  bumpRevision(restaurant.id);
  return { ok: true };
}

/**
 * Offer free tables to the waiting list, in queue order: each party gets the
 * smallest free table that fits it and that no booking needs before they'd
 * be finished. Runs under the restaurant's lock, so two screens refreshing
 * at once can never offer one table twice or message one family twice.
 */
export async function offerFreeTables(restaurantId: string, onlyTableId?: string) {
  const { restaurant, policy } = await loadRestaurant(restaurantId);
  if (!policy.waitlistEnabled) return 0;
  const stats = await getDiningStats(restaurantId);
  const live = await loadLive(restaurantId, policy, stats);
  const free = live
    .filter((t) => t.status === "AVAILABLE" || t.status === "READY")
    .filter((t) => !onlyTableId || t.table.id === onlyTableId)
    .map((t) => t.table);
  if (free.length === 0) return 0;

  const now = Date.now();
  const claimed = await prisma.$transaction(async (tx) => {
    await lockRestaurant(tx, restaurantId);
    const [waiting, notified, blocks] = await Promise.all([
      tx.waitlistEntry.findMany({
        where: { restaurantId, status: "WAITING" },
        orderBy: { createdAt: "asc" },
      }),
      tx.waitlistEntry.findMany({
        where: { restaurantId, status: "NOTIFIED" },
        select: { offeredTableIds: true },
      }),
      loadBlocks(tx, restaurantId, new Date(now), new Date(now + 8 * HOUR)),
    ]);
    const taken = new Set(notified.flatMap((n) => n.offeredTableIds));
    const out: {
      entry: (typeof waiting)[number];
      table: (typeof free)[number];
      respondBy: Date;
    }[] = [];
    for (const w of waiting) {
      const needUntil =
        now + (plannedDiningMins(w.partySize, stats, policy) + policy.cleaningMins) * MIN;
      const pick = free
        .filter(
          (t) =>
            !taken.has(t.id) &&
            t.seats >= w.partySize &&
            Math.min(t.minParty, 2) <= w.partySize &&
            !blocks.some((b) => b.tableId === t.id && b.start < needUntil),
        )
        // Smallest table that fits; on a tie, the one whose next booking is
        // furthest away, so a long meal can't run into it.
        .sort((a, b) => a.seats - b.seats || nextBlock(blocks, b.id) - nextBlock(blocks, a.id))[0];
      if (!pick) continue;
      taken.add(pick.id);
      const respondBy = new Date(now + policy.waitlistReplyMins * MIN);
      await tx.waitlistEntry.update({
        where: { id: w.id },
        data: { status: "NOTIFIED", notifiedAt: new Date(), respondBy, offeredTableIds: [pick.id] },
      });
      out.push({ entry: w, table: pick, respondBy });
    }
    return out;
  }, TX);

  for (const c of claimed) {
    await sendTableReady(restaurant, policy, c.entry, [c.table.name], c.respondBy);
    await logAudit({
      restaurantId,
      actorId: null,
      actorName: "Mezbaan",
      action: "waitlist.notified",
      detail: `${c.entry.customerName} · ${c.table.name}`,
    });
  }
  if (claimed.length) bumpRevision(restaurantId);
  return claimed.length;
}

function nextBlock(blocks: { tableId: string; start: number }[], tableId: string) {
  // A safe integer, not Infinity: Infinity − Infinity is NaN, which breaks the sort.
  return blocks
    .filter((b) => b.tableId === tableId)
    .reduce((m, b) => Math.min(m, b.start), Number.MAX_SAFE_INTEGER);
}

/** A table just became ready: offer it to the first waiting party it suits. */
export async function offerTableToWaitlist(restaurantId: string, tableId: string) {
  return (await offerFreeTables(restaurantId, tableId)) > 0;
}

async function sendTableReady(
  restaurant: { id: string; name: string; slug: string },
  policy: ReservationPolicy,
  entry: { id: string; customerName: string; customerPhone: string | null; manageToken: string },
  tableNames: string[],
  respondBy: Date,
) {
  await queueGuestMessage({
    restaurantId: restaurant.id,
    waitlistEntryId: entry.id,
    kind: "TABLE_READY",
    phone: entry.customerPhone,
    body: composeWaitlist("TABLE_READY", {
      restaurant: restaurant.name,
      name: entry.customerName,
      link: waitlistUrl(restaurant.slug, entry.manageToken),
      until: formatTime(respondBy, policy.timeZone),
      tables: tableNames.join(" + "),
    }),
  });
}

export async function cancelWaitlistEntry(input: {
  restaurantId: string;
  entryId: string;
  actor?: Actor;
}): Promise<{ ok: true } | Failure> {
  const entry = await prisma.waitlistEntry.findFirst({
    where: {
      id: input.entryId,
      restaurantId: input.restaurantId,
      status: { in: ["WAITING", "NOTIFIED"] },
    },
  });
  if (!entry) return { ok: false, status: 404, code: "NOT_FOUND", error: "No longer waiting." };
  await prisma.waitlistEntry.update({
    where: { id: entry.id },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  bumpRevision(input.restaurantId);
  // If they had been offered a table, it goes to the next party.
  if (entry.status === "NOTIFIED") {
    for (const tableId of entry.offeredTableIds)
      await offerTableToWaitlist(input.restaurantId, tableId);
  }
  return { ok: true };
}
