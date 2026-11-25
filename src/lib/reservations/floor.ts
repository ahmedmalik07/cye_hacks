import { prisma } from "../db";
import { getDiningStats, loadLive, loadRestaurant } from "./service";
import { computeQueue } from "./waitlist";
import { sweepRestaurant } from "./sweep";
import { lateMins, TABLE_STATUS_LABEL, type TableStatus } from "./floorState";
import { MIN_SAMPLES } from "./predict";
import { maskPhone, whatsappLink } from "./guest";
import { whatsappApiConfigured } from "./messages";
import { guestCards } from "./guests";
import { parseFixtures } from "./layout";
import { zonedDateKey } from "../zonedTime";

const MIN = 60_000;
const HOUR = 60 * MIN;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * Everything the floor board shows, in one read: each table's status and
 * estimate, who is arriving, who is waiting, and messages waiting to go out.
 * Dates are ISO strings so this goes straight to the client.
 */
export async function getFloor(restaurantId: string) {
  await sweepRestaurant(restaurantId).catch(() => {});
  const now = new Date();
  const nowMs = now.getTime();
  const { restaurant, policy } = await loadRestaurant(restaurantId);
  const stats = await getDiningStats(restaurantId);
  const live = await loadLive(restaurantId, policy, stats, now);

  const [upcomingRows, needsTable, messages, room] = await Promise.all([
    prisma.reservation.findMany({
      where: {
        restaurantId,
        status: "CONFIRMED",
        startAt: { gte: new Date(nowMs - 4 * HOUR), lte: new Date(nowMs + 8 * HOUR) },
      },
      orderBy: { startAt: "asc" },
      include: {
        tables: {
          where: { active: true },
          select: { tableId: true, table: { select: { name: true } } },
        },
      },
    }),
    prisma.reservation.findMany({
      where: {
        restaurantId,
        status: "CONFIRMED",
        startAt: { gte: new Date(nowMs - HOUR), lte: new Date(nowMs + 7 * 24 * HOUR) },
        tables: { none: { active: true } },
      },
      select: { id: true, customerName: true, partySize: true, startAt: true, code: true },
      orderBy: { startAt: "asc" },
    }),
    prisma.guestMessage.findMany({
      where: {
        restaurantId,
        createdAt: { gte: new Date(nowMs - 24 * HOUR) },
        OR: [
          { status: "MANUAL" },
          { status: "QUEUED", createdAt: { lt: new Date(nowMs - 5 * MIN) } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: {
        id: true,
        kind: true,
        toPhone: true,
        body: true,
        createdAt: true,
        reservationId: true,
      },
    }),
    prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { floorFixtures: true } }),
  ]);

  const liveById = new Map(live.map((t) => [t.table.id, t]));
  const waitRows = await prisma.waitlistEntry.findMany({
    where: { restaurantId, status: { in: ["WAITING", "NOTIFIED"] } },
    orderBy: { createdAt: "asc" },
  });
  const guests = await guestCards([
    ...upcomingRows.map((r) => r.guestId),
    ...waitRows.map((w) => w.guestId),
  ]);
  const upcoming = upcomingRows.map((r) => {
    // A booking is at risk when a table it needs is not expected free in time.
    const risks = r.tables
      .map((rt) => liveById.get(rt.tableId))
      .filter(
        (t) => t && (t.status === "OCCUPIED" || t.status === "BILL" || t.status === "CLEANING"),
      )
      .map((t) => ({
        tableName: t!.table.name,
        readyAt: t!.estimate?.readyAt ?? new Date(nowMs + policy.cleaningMins * MIN),
      }))
      .filter((x) => x.readyAt.getTime() > r.startAt.getTime());
    return {
      id: r.id,
      code: r.code,
      customerName: r.customerName,
      phone: maskPhone(r.customerPhone),
      partySize: r.partySize,
      childCount: r.childCount,
      startAt: iso(r.startAt)!,
      endAt: iso(r.endAt)!,
      lateUntil: iso(r.lateUntil),
      lateMins: lateMins(r, now),
      guestConfirmed: !!r.guestConfirmedAt,
      source: r.source,
      note: r.note,
      tables: r.tables.map((t) => ({ id: t.tableId, name: t.table.name })),
      tags: r.tags,
      staffNote: r.staffNote,
      arrivedAt: iso(r.arrivedAt),
      guest: r.guestId ? (guests.get(r.guestId) ?? null) : null,
      risk: risks.length
        ? { tableName: risks[0].tableName, readyAt: iso(risks[0].readyAt)! }
        : null,
    };
  });

  const nextByTable = new Map<string, (typeof upcoming)[number]>();
  for (const r of upcoming) {
    if (new Date(r.startAt).getTime() < nowMs - policy.graceMins * MIN && r.lateMins > 0) continue;
    for (const t of r.tables) if (!nextByTable.has(t.id)) nextByTable.set(t.id, r);
  }

  const { etas } = await computeQueue(restaurantId, policy, stats, live);
  const tableName = new Map(live.map((t) => [t.table.id, t.table.name]));

  const tables = live.map((t) => {
    const next = nextByTable.get(t.table.id);
    return {
      id: t.table.id,
      name: t.table.name,
      seats: t.table.seats,
      minParty: t.table.minParty,
      area: t.table.area,
      joinGroup: t.table.joinGroup,
      reservable: t.table.reservable,
      plan:
        t.table.planX != null && t.table.planY != null
          ? {
              x: t.table.planX,
              y: t.table.planY,
              w: t.table.planW ?? 80,
              h: t.table.planH ?? 80,
            }
          : null,
      shape: t.table.shape,
      status: t.status,
      label: TABLE_STATUS_LABEL[t.status],
      stage: t.stage,
      partySize: t.session?.partySize ?? null,
      seatedAt: iso(t.session && !t.session.leftAt ? t.session.seatedAt : null),
      leftAt: iso(t.session?.leftAt),
      sessionSource: t.session?.source ?? null,
      billCents: t.billCents,
      orderedAt: iso(t.firstOrderAt),
      paidAt: iso(t.paidAt),
      estimate: t.estimate
        ? {
            freeAt: iso(t.estimate.freeAt)!,
            low: iso(t.estimate.low)!,
            high: iso(t.estimate.high)!,
            readyAt: iso(t.estimate.readyAt)!,
            basis: t.estimate.basis,
            confidence: t.estimate.confidence,
            learning: t.estimate.learning,
            overdueMins: t.estimate.overdueMins,
          }
        : null,
      heldBy: t.heldBy
        ? {
            id: t.heldBy.id,
            customerName: t.heldBy.customerName,
            partySize: t.heldBy.partySize,
            startAt: iso(t.heldBy.startAt)!,
            lateMins: lateMins(t.heldBy, now),
          }
        : null,
      next: next
        ? {
            id: next.id,
            customerName: next.customerName,
            partySize: next.partySize,
            startAt: next.startAt,
          }
        : null,
      cctv:
        t.cctvEmptySince || t.cctvUnseated
          ? { empty: !!t.cctvEmptySince, since: iso(t.cctvEmptySince), unseated: t.cctvUnseated }
          : null,
      offeredTo: null as string | null,
    };
  });

  const waitlist = waitRows.map((w) => {
    const eta = etas.get(w.id);
    for (const id of w.offeredTableIds) {
      const tile = tables.find((t) => t.id === id);
      if (tile && w.status === "NOTIFIED") tile.offeredTo = w.customerName;
    }
    return {
      id: w.id,
      code: w.code,
      customerName: w.customerName,
      phone: maskPhone(w.customerPhone),
      partySize: w.partySize,
      status: w.status,
      source: w.source,
      joinedAt: iso(w.createdAt)!,
      waitedMins: Math.round((nowMs - w.createdAt.getTime()) / MIN),
      quotedMins: w.quotedMins,
      position: eta?.position ?? null,
      etaAt: iso(eta?.etaAt),
      suggestedTable: eta?.tableId
        ? { id: eta.tableId, name: tableName.get(eta.tableId) ?? "" }
        : null,
      respondBy: iso(w.respondBy),
      offeredTables: w.offeredTableIds.map((id) => tableName.get(id) ?? "").filter(Boolean),
      offeredTableIds: w.offeredTableIds,
      note: w.note,
      guest: w.guestId ? (guests.get(w.guestId) ?? null) : null,
    };
  });

  const counts = Object.fromEntries(
    (["AVAILABLE", "READY", "RESERVED", "OCCUPIED", "BILL", "CLEANING"] as TableStatus[]).map(
      (s) => [s, tables.filter((t) => t.status === s).length],
    ),
  ) as Record<TableStatus, number>;

  return {
    now: iso(now)!,
    today: zonedDateKey(now, policy.timeZone),
    restaurant: {
      name: restaurant.name,
      slug: restaurant.slug,
      timeZone: policy.timeZone,
      currency: restaurant.currency,
    },
    policy: {
      graceMins: policy.graceMins,
      cleaningMins: policy.cleaningMins,
      autoRelease: policy.autoRelease,
      waitlistAutoNotify: policy.waitlistAutoNotify,
      cctvAutoVacate: policy.cctvAutoVacate,
      slotMins: policy.slotMins,
      opensAt: policy.opensAt,
      closesAt: policy.closesAt,
      holdMinsBefore: policy.holdMinsBefore,
    },
    learning: stats.samples < MIN_SAMPLES,
    mealsLearned: stats.samples,
    areas: [...new Set(tables.map((t) => t.area))],
    fixtures: parseFixtures(room?.floorFixtures),
    tables,
    counts,
    covers: live.reduce(
      (s, t) => s + (t.session && !t.session.leftAt ? (t.session.partySize ?? 0) : 0),
      0,
    ),
    upcoming,
    needsTable: needsTable.map((r) => ({ ...r, startAt: iso(r.startAt)! })),
    waitlist,
    messages: messages.map((m) => ({
      id: m.id,
      kind: m.kind,
      phone: maskPhone(m.toPhone),
      body: m.body,
      createdAt: iso(m.createdAt)!,
      link: whatsappLink(m.toPhone, m.body),
    })),
    whatsappApi: whatsappApiConfigured(),
  };
}

export type FloorData = Awaited<ReturnType<typeof getFloor>>;
