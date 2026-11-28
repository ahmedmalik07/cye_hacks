import { Prisma, type ReservationSource, type TableSessionSource } from "@prisma/client";
import { prisma } from "../db";
import { bumpRevision } from "../bus";
import { enqueue } from "../jobs";
import { logAudit } from "../audit";
import { sessionTotalCents } from "../ordering";
import { allocate, onlineCapFor, type AllocTable, type Block } from "./allocate";
import {
  POLICY_SELECT,
  bookingWindowError,
  overPacing,
  policyFrom,
  slotsForDay,
  type ReservationPolicy,
} from "./policy";
import {
  buildDiningStats,
  estimateFreeAt,
  plannedDiningMins,
  type DiningStats,
  type Estimate,
  type LiveStage,
  liveStage,
} from "./predict";
import { deriveTableStatus, isHeld, READY_FLASH_MS, type TableStatus } from "./floorState";
import { newBookingCode, newManageToken } from "./guest";
import { cleanTags, linkGuest } from "./guests";
import { composeBooking, formatTime, formatWhen, manageUrl, queueGuestMessage } from "./messages";
import { addDaysToKey, zonedDateKey } from "../zonedTime";

/**
 * Reservations against the database. The rules themselves are pure functions
 * next door (allocate, predict, floorState); this module loads what they
 * need, applies them inside a transaction, and does the bookkeeping after:
 * messages, reminders, audit, the live-board signal.
 *
 * Every write that can change who sits where takes the restaurant's advisory
 * lock first, so bookings, seatings and moves for one restaurant happen one
 * at a time. The exclusion constraint on ReservationTable is the backstop if
 * anything ever writes without it.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
type Db = Prisma.TransactionClient | typeof prisma;

export type Actor = { id: string; name: string } | null;

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export async function loadRestaurant(restaurantId: string) {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { id: true, name: true, slug: true, currency: true, ...POLICY_SELECT },
  });
  if (!restaurant) throw new Error("restaurant not found");
  const today = zonedDateKey(new Date(), restaurant.timeZone || "Asia/Karachi");
  const closures = await prisma.bookingClosure.findMany({
    where: { restaurantId, date: { gte: addDaysToKey(today, -2) } },
    select: { date: true, onlineOnly: true, reason: true },
    orderBy: { date: "asc" },
    take: 400,
  });
  return { restaurant, policy: policyFrom(restaurant, closures) };
}

const statsCache = new Map<string, { stats: DiningStats; expires: number }>();

/** The restaurant's last 60 days of meals, cached for five minutes. */
export async function getDiningStats(restaurantId: string): Promise<DiningStats> {
  const hit = statsCache.get(restaurantId);
  if (hit && hit.expires > Date.now()) return hit.stats;
  const history = await prisma.tableSession.findMany({
    where: {
      restaurantId,
      leftAt: { not: null },
      seatedAt: { gte: new Date(Date.now() - 60 * 24 * HOUR) },
    },
    select: {
      partySize: true,
      seatedAt: true,
      firstOrderAt: true,
      billRequestedAt: true,
      paidAt: true,
      leftAt: true,
    },
    orderBy: { seatedAt: "desc" },
    take: 4000,
  });
  const stats = buildDiningStats(history.map((h) => ({ ...h, leftAt: h.leftAt! })));
  statsCache.set(restaurantId, { stats, expires: Date.now() + 5 * MIN });
  return stats;
}

export function forgetDiningStats(restaurantId: string) {
  statsCache.delete(restaurantId);
}

const TABLE_SELECT = {
  id: true,
  name: true,
  seats: true,
  minParty: true,
  area: true,
  joinGroup: true,
  reservable: true,
  sortOrder: true,
  cctvOccupied: true,
  cctvPeople: true,
  cctvConfidence: true,
  cctvSince: true,
  cctvSeenAt: true,
  planX: true,
  planY: true,
  planW: true,
  planH: true,
  shape: true,
} as const satisfies Prisma.TableSelect;

export type TableRow = Prisma.TableGetPayload<{ select: typeof TABLE_SELECT }>;

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export async function loadTables(db: Db, restaurantId: string): Promise<TableRow[]> {
  const tables = await db.table.findMany({
    where: { restaurantId, active: true },
    select: TABLE_SELECT,
  });
  return tables.sort(
    (a, b) =>
      byName.compare(a.area, b.area) || a.sortOrder - b.sortOrder || byName.compare(a.name, b.name),
  );
}

export function toAllocTables(tables: TableRow[]): AllocTable[] {
  return tables.map((t, i) => ({
    id: t.id,
    name: t.name,
    seats: t.seats,
    minParty: t.minParty,
    area: t.area,
    joinGroup: t.joinGroup,
    reservable: t.reservable,
    sortOrder: i,
  }));
}

export async function loadBlocks(db: Db, restaurantId: string, from: Date, to: Date) {
  const rows = await db.reservationTable.findMany({
    where: { restaurantId, active: true, blockStart: { lt: to }, blockEnd: { gt: from } },
    select: {
      tableId: true,
      blockStart: true,
      blockEnd: true,
      reservationId: true,
      reservation: { select: { source: true } },
    },
  });
  return rows.map((r): Block => ({
    tableId: r.tableId,
    start: r.blockStart.getTime(),
    end: r.blockEnd.getTime(),
    reservationId: r.reservationId,
    online: r.reservation.source === "ONLINE",
  }));
}

/**
 * Bookings for one restaurant queue behind its lock, so a transaction's
 * clock includes time spent waiting its turn. A Friday rush of guests
 * confirming at once must queue, not time out.
 */
export const TX = { maxWait: 10_000, timeout: 20_000 } as const;

export async function lockRestaurant(tx: Prisma.TransactionClient, restaurantId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`resv:${restaurantId}`}, 0))::text`;
}

function isOverlapError(err: unknown) {
  const text = String((err as Error)?.message ?? err);
  return text.includes("ReservationTable_no_overlap") || text.includes("23P01");
}

function isOpenSessionError(err: unknown) {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return true;
  return String((err as Error)?.message ?? err).includes("TableSession_one_open_per_table");
}

// ---------------------------------------------------------------------------
// Live floor: what is happening at every table right now
// ---------------------------------------------------------------------------

type SessionRow = Prisma.TableSessionGetPayload<object>;

export type HeldBy = {
  id: string;
  code: string | null;
  customerName: string;
  partySize: number;
  startAt: Date;
  lateUntil: Date | null;
};

export type LiveTable = {
  table: TableRow;
  status: TableStatus;
  session: SessionRow | null;
  stage: LiveStage | null;
  estimate: Estimate | null;
  firstOrderAt: Date | null;
  paidAt: Date | null;
  billRequestedAt: Date | null;
  /** The bill total staff entered when marking the table paid. */
  billCents: number | null;
  lastCleanedAt: Date | null;
  heldBy: HeldBy | null;
  /** The camera has seen this table empty since then (fresh, confident reading). */
  cctvEmptySince: Date | null;
  /** The camera sees people at a table nobody has seated. */
  cctvUnseated: boolean;
};

/** A camera reading older than this is ignored. */
const CCTV_STALE_MS = 2 * MIN;
/** Without a kitchen feed, an order counts as served this long after it was placed. */
const SERVED_AFTER_MS = 20 * MIN;

export async function loadLive(
  restaurantId: string,
  policy: ReservationPolicy,
  stats: DiningStats,
  now = new Date(),
): Promise<LiveTable[]> {
  const nowMs = now.getTime();
  const [tables, openSessions, recentlyCleaned, held] = await Promise.all([
    loadTables(prisma, restaurantId),
    prisma.tableSession.findMany({ where: { restaurantId, cleanedAt: null } }),
    prisma.tableSession.groupBy({
      by: ["tableId"],
      where: { restaurantId, cleanedAt: { gte: new Date(nowMs - READY_FLASH_MS) } },
      _max: { cleanedAt: true },
    }),
    prisma.reservation.findMany({
      where: {
        restaurantId,
        status: "CONFIRMED",
        startAt: {
          gte: new Date(nowMs - (policy.graceMins + 4 * 60) * MIN),
          lte: new Date(nowMs + policy.holdMinsBefore * MIN),
        },
      },
      select: {
        id: true,
        code: true,
        customerName: true,
        partySize: true,
        startAt: true,
        lateUntil: true,
        status: true,
        tables: { where: { active: true }, select: { tableId: true } },
      },
    }),
  ]);

  const sessionByTable = new Map(openSessions.map((s) => [s.tableId, s]));
  const orderRows = openSessions.length
    ? await prisma.order.findMany({
        where: { sessionId: { in: openSessions.map((s) => s.id) }, status: { not: "CANCELLED" } },
        select: { sessionId: true, status: true },
      })
    : [];
  const servedBySession = new Map<string, boolean>();
  for (const o of orderRows) {
    servedBySession.set(o.sessionId!, (servedBySession.get(o.sessionId!) ?? true) && o.status === "SERVED");
  }
  const cleanedByTable = new Map(recentlyCleaned.map((g) => [g.tableId, g._max.cleanedAt]));
  const heldByTable = new Map<string, HeldBy>();
  for (const r of held) {
    if (!isHeld(r, now, policy.holdMinsBefore, policy.graceMins)) continue;
    for (const { tableId } of r.tables) {
      const prev = heldByTable.get(tableId);
      if (!prev || r.startAt < prev.startAt) heldByTable.set(tableId, r);
    }
  }

  return tables.map((table) => {
    const session = sessionByTable.get(table.id) ?? null;
    const open = session && !session.leftAt ? session : null;
    // Staff mark each step by hand on the host screen: ordered, bill, paid.
    const firstOrderAt = open?.firstOrderAt ?? null;
    const paidAt = open?.paidAt ?? null;
    const billRequestedAt = open?.billRequestedAt ?? null;
    const fresh =
      table.cctvSeenAt != null &&
      nowMs - table.cctvSeenAt.getTime() < CCTV_STALE_MS &&
      (table.cctvConfidence ?? 0) >= 0.6;
    const cctvEmptySince = fresh && table.cctvOccupied === false ? table.cctvSince : null;
    const cctvUnseated =
      fresh &&
      table.cctvOccupied === true &&
      !session &&
      table.cctvSince != null &&
      nowMs - table.cctvSince.getTime() >= 3 * MIN;

    const liveInput = open
      ? {
          partySize: open.partySize,
          seatedAt: open.seatedAt,
          firstOrderAt,
          // Orders marked served on the orders board say so; with none on the
          // board, food is taken as served 20 minutes after ordering.
          allServed: servedBySession.has(open.id)
            ? servedBySession.get(open.id)!
            : firstOrderAt != null && nowMs - firstOrderAt.getTime() >= SERVED_AFTER_MS,
          billRequestedAt,
          paidAt,
          freeAtOverride: open.freeAtOverride,
          cctvEmptySince,
        }
      : null;

    return {
      table,
      session,
      status: deriveTableStatus({
        session,
        openBillRequest: false,
        held: heldByTable.has(table.id),
        lastCleanedAt: cleanedByTable.get(table.id) ?? null,
        now,
      }),
      stage: liveInput ? liveStage(liveInput) : null,
      estimate: liveInput ? estimateFreeAt(liveInput, stats, policy, now) : null,
      firstOrderAt,
      paidAt,
      billRequestedAt,
      billCents: open?.revenueCents ?? null,
      lastCleanedAt: cleanedByTable.get(table.id) ?? null,
      heldBy: heldByTable.get(table.id) ?? null,
      cctvEmptySince,
      cctvUnseated,
    };
  });
}

/** When each table that isn't free now is expected to be ready (conservative). */
export function busyUntilMap(live: LiveTable[], policy: ReservationPolicy, now = new Date()) {
  const map = new Map<string, number>();
  for (const t of live) {
    if ((t.status === "OCCUPIED" || t.status === "BILL") && t.estimate) {
      map.set(t.table.id, t.estimate.readyAtSafe.getTime());
    } else if (t.status === "CLEANING") {
      map.set(t.table.id, now.getTime() + policy.cleaningMins * MIN);
    }
  }
  return map;
}

/** Live occupancy only matters for times close to now. */
const LIVE_HORIZON_MS = 4 * HOUR;

async function liveBusyFor(restaurantId: string, policy: ReservationPolicy, startMs: number) {
  if (startMs - Date.now() > LIVE_HORIZON_MS) return undefined;
  const live = await loadLive(restaurantId, policy, await getDiningStats(restaurantId));
  return busyUntilMap(live, policy);
}

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

export type BookInput = {
  restaurantId: string;
  customerName: string;
  customerPhone: string | null;
  partySize: number;
  childCount?: number;
  startAt: Date;
  durationMins?: number;
  note?: string | null;
  areaPreference?: string | null;
  preferTableIds?: string[];
  source: ReservationSource;
  tags?: string[];
  staffNote?: string | null;
  actor?: Actor;
  /** Staff bookings: any table that physically fits, no lead time or online cap. */
  staff?: boolean;
};

export type BookingSummary = {
  id: string;
  code: string;
  manageToken: string;
  startAt: Date;
  endAt: Date;
  partySize: number;
  tableNames: string[];
};

export type Failure = {
  ok: false;
  status: number;
  code: string;
  error: string;
  alternatives?: { at: string; label: string }[];
};

function fail(status: number, code: string, error: string): Failure {
  return { ok: false, status, code, error };
}

const REASON_TEXT: Record<string, string> = {
  NO_FIT: "No table for that party at that time.",
  TAKEN: "That table was just booked by someone else.",
  ONLINE_CAP:
    "Online bookings are full for that time; the rest of the tables are kept for walk-ins.",
  TOO_LARGE:
    "That party is larger than any table, even pushed together. Please call the restaurant.",
  PACING:
    "The kitchen is fully booked for that time. A slot a little earlier or later may still be open.",
};

/** Guests already due to start at each booked start time, for pacing. */
export async function coversByStart(db: Db, restaurantId: string, from: Date, to: Date) {
  const rows = await db.reservation.groupBy({
    by: ["startAt"],
    where: {
      restaurantId,
      startAt: { gte: from, lte: to },
      status: { in: ["CONFIRMED", "SEATED", "COMPLETED"] },
    },
    _sum: { partySize: true },
  });
  return new Map(rows.map((r) => [r.startAt.getTime(), r._sum.partySize ?? 0]));
}

export async function bookReservation(
  input: BookInput,
): Promise<{ ok: true; reservation: BookingSummary } | Failure> {
  const now = new Date();
  const { restaurant, policy } = await loadRestaurant(input.restaurantId);
  const windowError = bookingWindowError(input.startAt, now, policy, { staff: input.staff });
  if (windowError) return fail(400, "WINDOW", windowError);
  if (!input.staff && input.partySize > policy.maxParty) {
    return fail(
      400,
      "TOO_LARGE",
      `For more than ${policy.maxParty} guests, please call the restaurant.`,
    );
  }
  if (!input.staff && input.customerPhone) {
    const upcoming = await prisma.reservation.count({
      where: {
        restaurantId: restaurant.id,
        customerPhone: input.customerPhone,
        status: "CONFIRMED",
        startAt: { gte: now },
      },
    });
    if (upcoming >= 3) {
      return fail(
        429,
        "LIMIT",
        "This number already has 3 upcoming bookings here. Change one from its WhatsApp link, or call the restaurant.",
      );
    }
  }

  const stats = await getDiningStats(restaurant.id);
  const durationMins = input.durationMins ?? plannedDiningMins(input.partySize, stats, policy);
  const start = input.startAt.getTime();
  const endAt = new Date(start + durationMins * MIN);
  const blockEnd = endAt.getTime() + policy.cleaningMins * MIN;
  const busyUntil = await liveBusyFor(restaurant.id, policy, start);

  // Tables change rarely and never mid-booking; only the blocks need the lock.
  const tables = toAllocTables(await loadTables(prisma, restaurant.id));
  let created: { id: string; code: string; manageToken: string; tableIds: string[] } | Failure;
  try {
    created = await prisma.$transaction(async (tx) => {
      await lockRestaurant(tx, restaurant.id);
      if (!input.staff && policy.maxCoversPerSlot > 0) {
        const covers = await coversByStart(tx, restaurant.id, input.startAt, input.startAt);
        if (overPacing(covers.get(start) ?? 0, input.partySize, policy)) {
          return fail(409, "PACING", REASON_TEXT.PACING);
        }
      }
      const blocks = await loadBlocks(
        tx,
        restaurant.id,
        new Date(start - 12 * HOUR),
        new Date(blockEnd + 12 * HOUR),
      );
      const result = allocate({
        tables,
        blocks,
        busyUntil,
        party: input.partySize,
        start,
        end: blockEnd,
        preferArea: input.areaPreference,
        preferTableIds: input.preferTableIds,
        onlineCap:
          input.source === "ONLINE" && !input.staff
            ? onlineCapFor(tables, policy.onlineTablesPct)
            : undefined,
        staff: input.staff,
      });
      if (!result.ok) {
        return fail(
          result.reason === "TOO_LARGE" ? 400 : 409,
          result.reason,
          REASON_TEXT[result.reason],
        );
      }
      const tableIds = result.allocation.tableIds;
      const code = newBookingCode();
      const manageToken = newManageToken();
      const guestId = await linkGuest(tx, restaurant.id, input.customerName, input.customerPhone);
      const reservation = await tx.reservation.create({
        data: {
          guestId,
          tags: cleanTags(input.tags),
          staffNote: input.staffNote?.trim() || null,
          restaurantId: restaurant.id,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          partySize: input.partySize,
          childCount: input.childCount ?? 0,
          startAt: input.startAt,
          endAt,
          durationMins,
          source: input.source,
          note: input.note || null,
          areaPreference: input.areaPreference || null,
          code,
          manageToken,
          tableId: tableIds[0],
          createdById: input.actor?.id ?? null,
          tables: {
            create: tableIds.map((tableId) => ({
              tableId,
              restaurantId: restaurant.id,
              blockStart: input.startAt,
              blockEnd: new Date(blockEnd),
            })),
          },
        },
      });
      return { id: reservation.id, code, manageToken, tableIds };
    }, TX);
  } catch (err) {
    if (isOverlapError(err)) created = fail(409, "TAKEN", REASON_TEXT.TAKEN);
    else throw err;
  }

  if ("ok" in created) {
    if (created.status === 409 || created.code === "NO_FIT" || created.code === "PACING") {
      created.alternatives = await alternativeTimes(restaurant.id, input, policy, durationMins);
    }
    return created;
  }

  const tableRows = await prisma.table.findMany({
    where: { id: { in: created.tableIds } },
    select: { id: true, name: true },
  });
  const tableNames = created.tableIds.map((id) => tableRows.find((t) => t.id === id)?.name ?? "");

  await afterBooked(restaurant, policy, {
    id: created.id,
    code: created.code,
    manageToken: created.manageToken,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    partySize: input.partySize,
    startAt: input.startAt,
    tableNames,
  });
  if (input.actor) {
    await logAudit({
      restaurantId: restaurant.id,
      actorId: input.actor.id,
      actorName: input.actor.name,
      action: "reservation.created",
      detail: `${input.customerName} · ${input.partySize} · ${formatWhen(input.startAt, policy.timeZone)} · ${tableNames.join(" + ")}`,
    });
  }

  return {
    ok: true,
    reservation: {
      id: created.id,
      code: created.code,
      manageToken: created.manageToken,
      startAt: input.startAt,
      endAt,
      partySize: input.partySize,
      tableNames,
    },
  };
}

async function afterBooked(
  restaurant: { id: string; name: string; slug: string },
  policy: ReservationPolicy,
  r: {
    id: string;
    code: string;
    manageToken: string;
    customerName: string;
    customerPhone: string | null;
    partySize: number;
    startAt: Date;
    tableNames: string[];
  },
) {
  await queueGuestMessage({
    restaurantId: restaurant.id,
    reservationId: r.id,
    kind: "BOOKING_CONFIRMED",
    phone: r.customerPhone,
    body: composeBooking("BOOKING_CONFIRMED", {
      restaurant: restaurant.name,
      name: r.customerName,
      code: r.code,
      partySize: r.partySize,
      when: formatWhen(r.startAt, policy.timeZone),
      tables: r.tableNames.join(" + "),
      link: manageUrl(restaurant.slug, r.manageToken),
    }),
  });
  await scheduleFollowUps(restaurant.id, policy, r.id, r.startAt);
  bumpRevision(restaurant.id);
}

async function scheduleFollowUps(
  restaurantId: string,
  policy: ReservationPolicy,
  reservationId: string,
  startAt: Date,
  lateUntil?: Date | null,
) {
  const remindAt = startAt.getTime() - policy.reminderMinsBefore * MIN;
  if (policy.reminderMinsBefore > 0 && remindAt > Date.now() + 10 * MIN) {
    await enqueue(
      "reservation-reminder",
      { reservationId },
      { runAt: new Date(remindAt), dedupeKey: `remind:${reservationId}:${startAt.getTime()}` },
    );
  }
  // The moment the grace period ends: release the table if they never came.
  const arrive = Math.max(startAt.getTime(), lateUntil?.getTime() ?? 0);
  await enqueue(
    "reservation-sweep",
    { restaurantId },
    {
      runAt: new Date(arrive + (policy.graceMins + 1) * MIN),
      dedupeKey: `release:${reservationId}:${arrive}`,
    },
  );
}

/** Nearby times on the same evening that would work, nearest first. */
async function alternativeTimes(
  restaurantId: string,
  input: BookInput,
  policy: ReservationPolicy,
  durationMins: number,
) {
  const day = zonedDateKey(input.startAt, policy.timeZone);
  const target = input.startAt.getTime();
  const now = new Date();
  const candidates = slotsForDay(day, policy)
    .filter((s) => Math.abs(s.at.getTime() - target) <= 2 * HOUR && s.at.getTime() !== target)
    .filter((s) => !bookingWindowError(s.at, now, policy, { staff: input.staff }))
    .sort((a, b) => Math.abs(a.at.getTime() - target) - Math.abs(b.at.getTime() - target));
  if (candidates.length === 0) return [];
  const tables = toAllocTables(await loadTables(prisma, restaurantId));
  const blocks = await loadBlocks(
    prisma,
    restaurantId,
    new Date(target - 4 * HOUR),
    new Date(target + 8 * HOUR),
  );
  const busyUntil = await liveBusyFor(restaurantId, policy, target - 2 * HOUR);
  const covers =
    !input.staff && policy.maxCoversPerSlot > 0
      ? await coversByStart(
          prisma,
          restaurantId,
          new Date(target - 3 * HOUR),
          new Date(target + 3 * HOUR),
        )
      : null;
  const out: { at: string; label: string }[] = [];
  for (const slot of candidates) {
    const start = slot.at.getTime();
    if (covers && overPacing(covers.get(start) ?? 0, input.partySize, policy)) continue;
    const r = allocate({
      tables,
      blocks,
      busyUntil,
      party: input.partySize,
      start,
      end: start + (durationMins + policy.cleaningMins) * MIN,
      onlineCap:
        input.source === "ONLINE" && !input.staff
          ? onlineCapFor(tables, policy.onlineTablesPct)
          : undefined,
      staff: input.staff,
    });
    if (r.ok) out.push({ at: slot.at.toISOString(), label: slot.label });
    if (out.length === 4) break;
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

export async function sendReminder(reservationId: string) {
  const r = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      restaurant: { select: { id: true, name: true, slug: true, timeZone: true, graceMins: true } },
    },
  });
  if (!r || r.status !== "CONFIRMED" || r.startAt.getTime() < Date.now()) return;
  if (!r.customerPhone || !r.manageToken || !r.code) return;
  const already = await prisma.guestMessage.findFirst({
    where: { reservationId: r.id, kind: "REMINDER" },
    select: { id: true },
  });
  if (already) return;
  await queueGuestMessage({
    restaurantId: r.restaurantId,
    reservationId: r.id,
    kind: "REMINDER",
    phone: r.customerPhone,
    body: composeBooking("REMINDER", {
      restaurant: r.restaurant.name,
      name: r.customerName,
      code: r.code,
      partySize: r.partySize,
      when: formatTime(r.startAt, r.restaurant.timeZone),
      link: manageUrl(r.restaurant.slug, r.manageToken),
      graceMins: r.restaurant.graceMins,
    }),
  });
  bumpRevision(r.restaurantId);
}

// ---------------------------------------------------------------------------
// Changing a booking
// ---------------------------------------------------------------------------

/**
 * Move a confirmed booking: new time, party size, length or tables. The old
 * tables are only given up if the new allocation succeeds, all in one
 * transaction, so a failed move leaves the booking exactly as it was.
 */
export async function reallocateReservation(input: {
  restaurantId: string;
  reservationId: string;
  startAt?: Date;
  partySize?: number;
  durationMins?: number;
  /** Extra minutes the block runs on past the planned end (a late arrival). */
  extendMins?: number;
  tableIds?: string[];
  /** Try the current tables first (a late arrival keeps their table if possible). */
  keepTables?: boolean;
  excludeTableIds?: string[];
  staff: boolean;
}): Promise<{ ok: true; tableNames: string[] } | Failure> {
  const { policy } = await loadRestaurant(input.restaurantId);
  const current = await prisma.reservation.findFirst({
    where: { id: input.reservationId, restaurantId: input.restaurantId },
    include: { tables: { where: { active: true }, select: { tableId: true } } },
  });
  if (!current) return fail(404, "NOT_FOUND", "Booking not found.");
  if (current.status !== "CONFIRMED")
    return fail(409, "STATE", "Only upcoming bookings can be moved.");

  const startAt = input.startAt ?? current.startAt;
  const partySize = input.partySize ?? current.partySize;
  const durationMins = input.durationMins ?? current.durationMins;
  const start = startAt.getTime();
  const endAt = new Date(start + durationMins * MIN);
  const blockEnd = endAt.getTime() + ((input.extendMins ?? 0) + policy.cleaningMins) * MIN;
  const busy = await liveBusyFor(input.restaurantId, policy, start);
  for (const id of input.excludeTableIds ?? []) busy?.set(id, Number.MAX_SAFE_INTEGER);
  const busyUntil =
    busy ?? new Map((input.excludeTableIds ?? []).map((id) => [id, Number.MAX_SAFE_INTEGER]));

  try {
    const tables = toAllocTables(await loadTables(prisma, input.restaurantId));
    const result = await prisma.$transaction(async (tx) => {
      await lockRestaurant(tx, input.restaurantId);
      const blocks = await loadBlocks(
        tx,
        input.restaurantId,
        new Date(start - 12 * HOUR),
        new Date(blockEnd + 12 * HOUR),
      );
      const base = {
        tables,
        blocks,
        busyUntil,
        party: partySize,
        start,
        end: blockEnd,
        ignoreReservationId: current.id,
        staff: input.staff,
        preferArea: current.areaPreference,
      };
      let alloc = input.tableIds?.length
        ? allocate({ ...base, preferTableIds: input.tableIds })
        : input.keepTables && current.tables.length
          ? allocate({ ...base, preferTableIds: current.tables.map((t) => t.tableId) })
          : allocate(base);
      if (!alloc.ok && input.keepTables && !input.tableIds?.length) alloc = allocate(base);
      if (!alloc.ok) return fail(409, alloc.reason, REASON_TEXT[alloc.reason]);

      await tx.reservationTable.deleteMany({ where: { reservationId: current.id } });
      await tx.reservationTable.createMany({
        data: alloc.allocation.tableIds.map((tableId) => ({
          reservationId: current.id,
          tableId,
          restaurantId: input.restaurantId,
          blockStart: startAt,
          blockEnd: new Date(blockEnd),
        })),
      });
      await tx.reservation.update({
        where: { id: current.id },
        data: {
          startAt,
          endAt,
          partySize,
          durationMins,
          tableId: alloc.allocation.tableIds[0],
        },
      });
      return { ok: true as const, tableIds: alloc.allocation.tableIds };
    }, TX);
    if (!result.ok) return result;
    const names = await prisma.table.findMany({
      where: { id: { in: result.tableIds } },
      select: { id: true, name: true },
    });
    if (startAt.getTime() !== current.startAt.getTime()) {
      await scheduleFollowUps(input.restaurantId, policy, current.id, startAt, current.lateUntil);
    }
    bumpRevision(input.restaurantId);
    return {
      ok: true,
      tableNames: result.tableIds.map((id) => names.find((n) => n.id === id)?.name ?? ""),
    };
  } catch (err) {
    if (isOverlapError(err)) return fail(409, "TAKEN", REASON_TEXT.TAKEN);
    throw err;
  }
}

/** Free a booking's tables (cancelled, no-show, finished). */
async function releaseBlocks(db: Db, reservationId: string) {
  await db.reservationTable.updateMany({
    where: { reservationId, active: true },
    data: { active: false },
  });
}

export async function cancelReservation(input: {
  restaurantId: string;
  reservationId: string;
  by: "GUEST" | "STAFF";
  actor?: Actor;
}): Promise<{ ok: true } | Failure> {
  const r = await prisma.reservation.findFirst({
    where: { id: input.reservationId, restaurantId: input.restaurantId },
    include: { restaurant: { select: { name: true, slug: true, timeZone: true } } },
  });
  if (!r) return fail(404, "NOT_FOUND", "Booking not found.");
  if (r.status !== "CONFIRMED")
    return fail(409, "STATE", "This booking can no longer be cancelled.");
  await prisma.$transaction(async (tx) => {
    await tx.reservation.update({
      where: { id: r.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: input.by },
    });
    await releaseBlocks(tx, r.id);
  });
  if (r.code && r.manageToken) {
    await queueGuestMessage({
      restaurantId: r.restaurantId,
      reservationId: r.id,
      kind: "CANCELLED",
      phone: r.customerPhone,
      body: composeBooking("CANCELLED", {
        restaurant: r.restaurant.name,
        name: r.customerName,
        code: r.code,
        partySize: r.partySize,
        when: formatWhen(r.startAt, r.restaurant.timeZone),
        link: `${manageUrl(r.restaurant.slug, r.manageToken).replace(/\/booking\/.*/, "/reserve")}`,
      }),
    });
  }
  await logAudit({
    restaurantId: r.restaurantId,
    actorId: input.actor?.id ?? null,
    actorName: input.actor?.name ?? (input.by === "GUEST" ? "Guest" : "Staff"),
    action: "reservation.cancelled",
    detail: `${r.customerName} · ${r.code} · by ${input.by.toLowerCase()}`,
  });
  bumpRevision(r.restaurantId);
  return { ok: true };
}

export async function markNoShow(input: {
  restaurantId: string;
  reservationId: string;
  actor: Actor;
  system?: boolean;
}): Promise<{ ok: true } | Failure> {
  const r = await prisma.reservation.findFirst({
    where: { id: input.reservationId, restaurantId: input.restaurantId, status: "CONFIRMED" },
    include: {
      restaurant: { select: { name: true, slug: true, timeZone: true, graceMins: true } },
    },
  });
  if (!r) return fail(404, "NOT_FOUND", "Booking not found or already handled.");
  await prisma.$transaction(async (tx) => {
    await tx.reservation.update({
      where: { id: r.id },
      data: {
        status: "NO_SHOW",
        releasedAt: new Date(),
        cancelledBy: input.system ? "SYSTEM" : "STAFF",
      },
    });
    await releaseBlocks(tx, r.id);
  });
  if (r.code && r.manageToken) {
    await queueGuestMessage({
      restaurantId: r.restaurantId,
      reservationId: r.id,
      kind: "RELEASED",
      phone: r.customerPhone,
      body: composeBooking("RELEASED", {
        restaurant: r.restaurant.name,
        name: r.customerName,
        code: r.code,
        partySize: r.partySize,
        when: formatTime(r.startAt, r.restaurant.timeZone),
        link: manageUrl(r.restaurant.slug, r.manageToken).replace(/\/booking\/.*/, "/waitlist"),
        graceMins: r.restaurant.graceMins,
      }),
    });
  }
  await logAudit({
    restaurantId: r.restaurantId,
    actorId: input.actor?.id ?? null,
    actorName: input.actor?.name ?? "Mezbaan",
    action: input.system ? "reservation.released" : "reservation.no_show",
    detail: `${r.customerName} · ${r.code} · ${formatTime(r.startAt, r.restaurant.timeZone)}`,
  });
  bumpRevision(r.restaurantId);
  return { ok: true };
}

/** A guest says they're running late. Within grace it's just noted; beyond, the table is extended if it can be. */
export async function guestRunningLate(input: {
  restaurantId: string;
  reservationId: string;
  minutes: number;
}): Promise<{ ok: true; accepted: boolean; until: Date } | Failure> {
  const { restaurant, policy } = await loadRestaurant(input.restaurantId);
  const r = await prisma.reservation.findFirst({
    where: { id: input.reservationId, restaurantId: restaurant.id },
  });
  if (!r || r.status !== "CONFIRMED")
    return fail(409, "STATE", "This booking can no longer be changed.");
  const until = new Date(r.startAt.getTime() + input.minutes * MIN);
  if (until.getTime() < Date.now()) return fail(400, "PAST", "That time has already passed.");

  let accepted = input.minutes <= policy.graceMins;
  if (!accepted) {
    const moved = await reallocateReservation({
      restaurantId: restaurant.id,
      reservationId: r.id,
      extendMins: input.minutes,
      keepTables: true,
      staff: false,
    });
    accepted = moved.ok;
  }
  if (accepted) {
    await prisma.reservation.update({
      where: { id: r.id },
      data: { lateUntil: until, guestConfirmedAt: r.guestConfirmedAt ?? new Date() },
    });
    await scheduleFollowUps(restaurant.id, policy, r.id, r.startAt, until);
  }
  if (r.code && r.manageToken) {
    await queueGuestMessage({
      restaurantId: restaurant.id,
      reservationId: r.id,
      kind: accepted ? "LATE_ACCEPTED" : "LATE_DECLINED",
      phone: r.customerPhone,
      body: composeBooking(accepted ? "LATE_ACCEPTED" : "LATE_DECLINED", {
        restaurant: restaurant.name,
        name: r.customerName,
        code: r.code,
        partySize: r.partySize,
        when: formatTime(accepted ? until : r.startAt, policy.timeZone),
        link: manageUrl(restaurant.slug, r.manageToken),
        graceMins: policy.graceMins,
      }),
    });
  }
  bumpRevision(restaurant.id);
  return { ok: true, accepted, until: accepted ? until : r.startAt };
}

// ---------------------------------------------------------------------------
// Seating and turnover
// ---------------------------------------------------------------------------

/** Seat parties at tables: a walk-in, a booking arriving, or the waiting list. */
async function openSessions(
  tx: Prisma.TransactionClient,
  restaurantId: string,
  tableIds: string[],
  data: {
    source: TableSessionSource;
    partySize: number;
    reservationId?: string;
    waitlistEntryId?: string;
  },
): Promise<Failure | null> {
  const now = new Date();
  const tables = await tx.table.findMany({
    where: { id: { in: tableIds }, restaurantId, active: true },
    select: { id: true, name: true },
  });
  if (tables.length !== tableIds.length) return fail(404, "NOT_FOUND", "Table not found.");
  for (const t of tables) {
    const current = await tx.tableSession.findFirst({ where: { tableId: t.id, cleanedAt: null } });
    if (current && !current.leftAt) {
      return fail(409, "OCCUPIED", `${t.name} is still occupied. Mark the guests as left first.`);
    }
    // Seating straight onto a table being cleaned: staff are saying it's done.
    if (current)
      await tx.tableSession.update({ where: { id: current.id }, data: { cleanedAt: now } });
  }
  for (const t of tables) {
    await tx.tableSession.create({
      data: {
        restaurantId,
        tableId: t.id,
        source: data.source,
        // Pushed-together tables share one party; count it once.
        partySize: t.id === tableIds[0] ? data.partySize : null,
        reservationId: data.reservationId,
        waitlistEntryId: data.waitlistEntryId,
        seatedAt: now,
      },
    });
  }
  return null;
}

export async function seatReservation(input: {
  restaurantId: string;
  reservationId: string;
  tableIds?: string[];
  actor: Actor;
}): Promise<{ ok: true } | Failure> {
  const { policy } = await loadRestaurant(input.restaurantId);
  const r = await prisma.reservation.findFirst({
    where: { id: input.reservationId, restaurantId: input.restaurantId },
    include: { tables: { where: { active: true }, select: { tableId: true } } },
  });
  if (!r) return fail(404, "NOT_FOUND", "Booking not found.");
  if (r.status !== "CONFIRMED")
    return fail(409, "STATE", "This booking isn't waiting to be seated.");
  const planned = r.tables.map((t) => t.tableId);
  const tableIds = input.tableIds?.length ? input.tableIds : planned;
  if (tableIds.length === 0) return fail(409, "NEEDS_TABLE", "Pick a table to seat them at.");

  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockRestaurant(tx, input.restaurantId);
      const changed = tableIds.join() !== planned.join();
      if (changed) {
        const now = Date.now();
        await tx.reservationTable.deleteMany({ where: { reservationId: r.id } });
        await tx.reservationTable.createMany({
          data: tableIds.map((tableId) => ({
            reservationId: r.id,
            tableId,
            restaurantId: input.restaurantId,
            blockStart: new Date(Math.min(now, r.startAt.getTime())),
            blockEnd: new Date(
              Math.max(r.endAt.getTime(), now + r.durationMins * MIN) + policy.cleaningMins * MIN,
            ),
          })),
        });
      }
      const failure = await openSessions(tx, input.restaurantId, tableIds, {
        source: "RESERVATION",
        partySize: r.partySize,
        reservationId: r.id,
      });
      if (failure) throw failure;
      await tx.reservation.update({
        where: { id: r.id },
        data: { status: "SEATED", seatedAt: new Date(), tableId: tableIds[0] },
      });
      return null;
    }, TX);
    if (result) return result;
  } catch (err) {
    if (err && typeof err === "object" && "ok" in err) return err as Failure;
    if (isOverlapError(err)) {
      return fail(
        409,
        "TAKEN",
        "That table has another booking during this meal. Pick a different one.",
      );
    }
    if (isOpenSessionError(err)) return fail(409, "OCCUPIED", "Someone just seated that table.");
    throw err;
  }
  await logAudit({
    restaurantId: input.restaurantId,
    actorId: input.actor?.id ?? null,
    actorName: input.actor?.name ?? "Staff",
    action: "reservation.seated",
    detail: `${r.customerName} · ${r.code ?? ""}`,
  });
  bumpRevision(input.restaurantId);
  return { ok: true };
}

/**
 * Seat a walk-in (or a waiting-list party) at a table. If a booking is due
 * on that table, staff must say so (`force`), and the booking is moved to
 * another table that fits, or flagged for them if none does.
 */
export async function seatTable(input: {
  restaurantId: string;
  tableId: string;
  partySize: number;
  source: TableSessionSource;
  waitlistEntryId?: string;
  force?: boolean;
  actor: Actor;
}): Promise<{ ok: true; moved: string[]; unplaced: string[] } | Failure> {
  const { policy } = await loadRestaurant(input.restaurantId);
  const stats = await getDiningStats(input.restaurantId);
  const now = Date.now();
  // Bookings on this table that would start before this party is likely gone.
  const until =
    now + (plannedDiningMins(input.partySize, stats, policy) + policy.cleaningMins) * MIN;
  const clashing = await prisma.reservation.findMany({
    where: {
      restaurantId: input.restaurantId,
      status: "CONFIRMED",
      tables: {
        some: { tableId: input.tableId, active: true, blockStart: { lt: new Date(until) } },
      },
      endAt: { gt: new Date(now) },
    },
    select: { id: true, customerName: true, startAt: true, partySize: true, code: true },
    orderBy: { startAt: "asc" },
  });
  if (clashing.length && !input.force) {
    const first = clashing[0];
    return {
      ...fail(
        409,
        "HELD",
        `${first.customerName} (${first.partySize}) is booked here at ${formatTime(first.startAt, policy.timeZone)}. Seat anyway and move their booking?`,
      ),
    };
  }

  try {
    const failure = await prisma.$transaction(async (tx) => {
      await lockRestaurant(tx, input.restaurantId);
      const f = await openSessions(tx, input.restaurantId, [input.tableId], {
        source: input.source,
        partySize: input.partySize,
        waitlistEntryId: input.waitlistEntryId,
      });
      if (f) return f;
      if (input.waitlistEntryId) {
        await tx.waitlistEntry.update({
          where: { id: input.waitlistEntryId },
          data: { status: "SEATED", seatedAt: new Date() },
        });
      }
      return null;
    }, TX);
    if (failure) return failure;
  } catch (err) {
    if (isOpenSessionError(err)) return fail(409, "OCCUPIED", "Someone just seated that table.");
    throw err;
  }

  const moved: string[] = [];
  const unplaced: string[] = [];
  for (const r of clashing) {
    const res = await reallocateReservation({
      restaurantId: input.restaurantId,
      reservationId: r.id,
      excludeTableIds: [input.tableId],
      staff: true,
    });
    if (res.ok) moved.push(`${r.customerName} → ${res.tableNames.join(" + ")}`);
    else {
      // No other table fits: the booking keeps its time but loses this
      // table, and shows on the board as needing one.
      await prisma.reservationTable.updateMany({
        where: { reservationId: r.id, tableId: input.tableId },
        data: { active: false },
      });
      unplaced.push(r.customerName);
    }
  }

  await logAudit({
    restaurantId: input.restaurantId,
    actorId: input.actor?.id ?? null,
    actorName: input.actor?.name ?? "Staff",
    action: "table.seated",
    detail: `${input.partySize} guests · ${input.source.toLowerCase()}${moved.length ? ` · moved ${moved.join(", ")}` : ""}${unplaced.length ? ` · unplaced ${unplaced.join(", ")}` : ""}`,
  });
  bumpRevision(input.restaurantId);
  return { ok: true, moved, unplaced };
}

export type TableActionKind = "ORDERED" | "BILL" | "PAID" | "LEFT" | "CLEANED" | "ESTIMATE";

export async function tableAction(input: {
  restaurantId: string;
  tableId: string;
  action: TableActionKind;
  freeAt?: Date | null;
  /** With PAID: the bill total, for insights. */
  billCents?: number | null;
  via?: "STAFF" | "CCTV";
  actor: Actor;
}): Promise<{ ok: true } | Failure> {
  const { policy } = await loadRestaurant(input.restaurantId);
  const session = await prisma.tableSession.findFirst({
    where: { tableId: input.tableId, restaurantId: input.restaurantId, cleanedAt: null },
    include: { table: { select: { name: true } } },
  });
  const now = new Date();

  if (input.action === "CLEANED") {
    if (!session || !session.leftAt)
      return fail(409, "STATE", "This table isn't waiting to be cleaned.");
    await prisma.tableSession.update({ where: { id: session.id }, data: { cleanedAt: now } });
    bumpRevision(input.restaurantId);
    if (policy.waitlistEnabled && policy.waitlistAutoNotify) {
      const { offerTableToWaitlist } = await import("./waitlist");
      await offerTableToWaitlist(input.restaurantId, input.tableId);
    }
    return { ok: true };
  }

  if (!session || session.leftAt) return fail(409, "STATE", "No one is seated at this table.");

  if (input.action === "ORDERED") {
    if (!session.firstOrderAt) {
      await prisma.tableSession.update({ where: { id: session.id }, data: { firstOrderAt: now } });
    }
  } else if (input.action === "BILL") {
    if (!session.billRequestedAt) {
      await prisma.tableSession.update({
        where: { id: session.id },
        data: { billRequestedAt: now, firstOrderAt: session.firstOrderAt ?? now },
      });
    }
  } else if (input.action === "PAID") {
    await prisma.tableSession.update({
      where: { id: session.id },
      data: {
        paidAt: session.paidAt ?? now,
        billRequestedAt: session.billRequestedAt ?? now,
        firstOrderAt: session.firstOrderAt ?? now,
        revenueCents: input.billCents ?? session.revenueCents ?? ((await sessionTotalCents(session.id)) || null),
      },
    });
  } else if (input.action === "ESTIMATE") {
    await prisma.tableSession.update({
      where: { id: session.id },
      data: { freeAtOverride: input.freeAt ?? null },
    });
    await logAudit({
      restaurantId: input.restaurantId,
      actorId: input.actor?.id ?? null,
      actorName: input.actor?.name ?? "Staff",
      action: "table.estimate_override",
      detail: `${session.table.name} · ${input.freeAt ? formatTime(input.freeAt, policy.timeZone) : "cleared"}`,
    });
  } else if (input.action === "LEFT") {
    await closeSession(input.restaurantId, session.id, input.via ?? "STAFF", policy);
    forgetDiningStats(input.restaurantId);
  }
  bumpRevision(input.restaurantId);
  return { ok: true };
}

/** Guests have gone: snapshot the meal for the history, finish their booking. */
export async function closeSession(
  restaurantId: string,
  sessionId: string,
  via: "STAFF" | "CCTV",
  policy: ReservationPolicy,
) {
  const now = new Date();
  const s = await prisma.tableSession.findUnique({ where: { id: sessionId } });
  if (!s || s.leftAt) return;
  await prisma.$transaction(async (tx) => {
    await tx.tableSession.update({
      where: { id: s.id },
      data: {
        leftAt: now,
        leftVia: via,
        cleanedAt: policy.cleaningMins === 0 ? now : null,
        revenueCents: s.revenueCents ?? ((await sessionTotalCents(s.id)) || null),
      },
    });
    // Waiter calls and bill requests from a table that has emptied are moot.
    await tx.serviceRequest.updateMany({
      where: { tableId: s.tableId, open: true },
      data: { open: false, resolvedAt: now },
    });
    if (s.reservationId) {
      const stillSeated = await tx.tableSession.count({
        where: { reservationId: s.reservationId, leftAt: null, id: { not: s.id } },
      });
      if (stillSeated === 0) {
        await tx.reservation.updateMany({
          where: { id: s.reservationId, status: "SEATED" },
          data: { status: "COMPLETED" },
        });
        await releaseBlocks(tx, s.reservationId);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Details staff can change without touching tables or time
// ---------------------------------------------------------------------------

export type DetailsInput = {
  customerName?: string;
  /** Normalised number, null to remove it. */
  customerPhone?: string | null;
  childCount?: number;
  note?: string | null;
  staffNote?: string | null;
  tags?: string[];
};

/**
 * Name, number, notes and tags. A changed number moves the booking to that
 * number's guest profile (creating one if needed), so history follows the
 * person, not the typo.
 */
export async function updateReservationDetails(input: {
  restaurantId: string;
  reservationId: string;
  details: DetailsInput;
  actor: Actor;
}): Promise<{ ok: true } | Failure> {
  const r = await prisma.reservation.findFirst({
    where: { id: input.reservationId, restaurantId: input.restaurantId },
    select: { id: true, customerName: true, customerPhone: true, partySize: true },
  });
  if (!r) return fail(404, "NOT_FOUND", "Booking not found.");
  const d = input.details;
  if (d.childCount != null && d.childCount > r.partySize) {
    return fail(400, "CHILDREN", "There can't be more children than guests.");
  }
  const data: Prisma.ReservationUpdateInput = {};
  if (d.customerName != null) data.customerName = d.customerName.trim().slice(0, 80);
  if (d.childCount != null) data.childCount = d.childCount;
  if (d.note !== undefined) data.note = d.note?.trim() || null;
  if (d.staffNote !== undefined) data.staffNote = d.staffNote?.trim() || null;
  if (d.tags) data.tags = cleanTags(d.tags);
  if (d.customerPhone !== undefined && d.customerPhone !== r.customerPhone) {
    data.customerPhone = d.customerPhone;
    const guestId = await linkGuest(
      prisma,
      input.restaurantId,
      d.customerName ?? r.customerName,
      d.customerPhone,
    );
    data.guest = guestId ? { connect: { id: guestId } } : { disconnect: true };
  }
  await prisma.reservation.update({ where: { id: r.id }, data });
  await logAudit({
    restaurantId: input.restaurantId,
    actorId: input.actor?.id ?? null,
    actorName: input.actor?.name ?? "Staff",
    action: "reservation.edited",
    detail: `${d.customerName ?? r.customerName}: ${Object.keys(data)
      .filter((k) => k !== "guest")
      .join(", ")}`,
  });
  bumpRevision(input.restaurantId);
  return { ok: true };
}

/** The party is at the door but their table isn't ready: they're checked in. */
export async function markArrived(input: {
  restaurantId: string;
  reservationId: string;
  arrived: boolean;
}): Promise<{ ok: true } | Failure> {
  const r = await prisma.reservation.findFirst({
    where: { id: input.reservationId, restaurantId: input.restaurantId },
    select: { id: true, status: true },
  });
  if (!r) return fail(404, "NOT_FOUND", "Booking not found.");
  if (r.status !== "CONFIRMED")
    return fail(409, "STATE", "This booking isn't waiting to be seated.");
  await prisma.reservation.update({
    where: { id: r.id },
    data: { arrivedAt: input.arrived ? new Date() : null },
  });
  bumpRevision(input.restaurantId);
  return { ok: true };
}
