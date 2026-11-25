import { prisma } from "../db";
import { hhmmToMinutes } from "../zonedTime";
import { loadRestaurant } from "./service";
import { addDaysToKey, parseDateKey, zonedDateKey, zonedParts, zonedWallToUtc } from "../zonedTime";
import { partyBucket } from "./policy";

const MIN = 60_000;

function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * The owner's numbers for the last N days of service: how hard the tables
 * worked, how long families stay, how bookings turned out, how the waiting
 * list did, and the revenue the system can honestly claim it recovered.
 * Every figure says what it's computed from; estimates are labelled.
 */
export async function getInsights(restaurantId: string, days: number) {
  const { restaurant, policy } = await loadRestaurant(restaurantId);
  const tz = policy.timeZone;
  const todayKey = zonedDateKey(new Date(), tz);
  const fromKey = addDaysToKey(todayKey, -(days - 1));
  const f = parseDateKey(fromKey)!;
  const t = parseDateKey(addDaysToKey(todayKey, 1))!;
  const from = zonedWallToUtc(f.y, f.m, f.d, 0, tz);
  const to = zonedWallToUtc(t.y, t.m, t.d, 0, tz);

  const [tables, sessions, reservations, waitlist] = await Promise.all([
    prisma.table.count({ where: { restaurantId, active: true } }),
    prisma.tableSession.findMany({
      where: { restaurantId, seatedAt: { gte: from, lt: to } },
      select: {
        id: true,
        tableId: true,
        partySize: true,
        seatedAt: true,
        leftAt: true,
        revenueCents: true,
        waitlistEntryId: true,
        source: true,
      },
    }),
    prisma.reservation.findMany({
      where: { restaurantId, startAt: { gte: from, lt: to } },
      select: {
        id: true,
        status: true,
        source: true,
        partySize: true,
        startAt: true,
        endAt: true,
        releasedAt: true,
        cancelledBy: true,
        cancelledAt: true,
        guestConfirmedAt: true,
        tables: { select: { tableId: true } },
      },
    }),
    prisma.waitlistEntry.findMany({
      where: { restaurantId, createdAt: { gte: from, lt: to } },
      select: { status: true, createdAt: true, seatedAt: true, quotedMins: true },
    }),
  ]);

  // ---- Tables ----
  const closed = sessions.filter((s) => s.leftAt);
  const durations = closed
    .map((s) => (s.leftAt!.getTime() - s.seatedAt.getTime()) / MIN)
    .filter((m) => m >= 10 && m <= 360);
  const covers = sessions.reduce((n, s) => n + (s.partySize ?? 0), 0);
  const revenueCents = closed.reduce((n, s) => n + (s.revenueCents ?? 0), 0);

  // Trading window per day: first seating to last seating plus a meal.
  const open = hhmmToMinutes(policy.opensAt) ?? 12 * 60;
  let close = (hhmmToMinutes(policy.closesAt) ?? 23 * 60) + policy.defaultDiningMins;
  if (close <= open) close += 24 * 60;
  const tradingMinsPerDay = close - open;
  const occupiedMins = sessions.reduce((n, s) => {
    const end = Math.min((s.leftAt ?? new Date()).getTime(), to.getTime());
    return n + Math.max(0, (end - s.seatedAt.getTime()) / MIN);
  }, 0);
  const utilisation =
    tables > 0 ? Math.min(1, occupiedMins / (tables * tradingMinsPerDay * days)) : 0;

  const byBucket = (["S", "M", "L", "XL"] as const).map((b) => {
    const mins = closed
      .filter((s) => partyBucket(s.partySize) === b)
      .map((s) => (s.leftAt!.getTime() - s.seatedAt.getTime()) / MIN)
      .filter((m) => m >= 10 && m <= 360);
    return { bucket: b, meals: mins.length, medianMins: median(mins) };
  });

  // Average tables in use per local hour of day, over the period.
  const hourly = Array.from({ length: 24 }, () => 0);
  for (const s of sessions) {
    let at = s.seatedAt.getTime();
    const end = Math.min((s.leftAt ?? new Date()).getTime(), to.getTime());
    while (at < end) {
      const next = Math.min(end, Math.floor(at / (60 * MIN)) * 60 * MIN + 60 * MIN);
      hourly[zonedParts(new Date(at), tz).hour] += (next - at) / (60 * MIN);
      at = next;
    }
  }
  const busyHours = hourly.map((v, hour) => ({ hour, avgTables: v / days }));

  // ---- Bookings ----
  const count = (pred: (r: (typeof reservations)[number]) => boolean) =>
    reservations.filter(pred).length;
  const honoured = count((r) => r.status === "COMPLETED" || r.status === "SEATED");
  const noShows = count((r) => r.status === "NO_SHOW");
  const cancelled = count((r) => r.status === "CANCELLED");
  const cancelledByGuest = count((r) => r.status === "CANCELLED" && r.cancelledBy === "GUEST");
  const upcoming = count((r) => r.status === "CONFIRMED");
  const decided = honoured + noShows;
  const reminded = count((r) => !!r.guestConfirmedAt);

  // ---- Waiting list ----
  const seatedFromList = waitlist.filter((w) => w.status === "SEATED" && w.seatedAt);
  const waits = seatedFromList.map((w) => (w.seatedAt!.getTime() - w.createdAt.getTime()) / MIN);
  const quoteErrors = seatedFromList
    .filter((w) => w.quotedMins != null)
    .map((w) => Math.abs((w.seatedAt!.getTime() - w.createdAt.getTime()) / MIN - w.quotedMins!));

  // ---- Recovered revenue (only what we can trace) ----
  // 1. Parties seated from the waiting list: without it they'd likely have left.
  const waitlistRevenue = closed
    .filter((s) => s.waitlistEntryId)
    .reduce((n, s) => n + (s.revenueCents ?? 0), 0);
  // 2. Released no-show tables that someone else then sat at, inside the
  //    released booking's window.
  let releasedResoldCents = 0;
  let releasedResold = 0;
  for (const r of reservations.filter((x) => x.status === "NO_SHOW" && x.releasedAt)) {
    const tableIds = new Set(r.tables.map((x) => x.tableId));
    const resold = closed.filter(
      (s) =>
        tableIds.has(s.tableId) &&
        s.seatedAt >= r.releasedAt! &&
        s.seatedAt.getTime() <= r.endAt.getTime(),
    );
    if (resold.length) releasedResold++;
    releasedResoldCents += resold.reduce((n, s) => n + (s.revenueCents ?? 0), 0);
  }

  const bySource = (["ONLINE", "PHONE", "WALK_IN", "WAITLIST"] as const).map((s) => ({
    source: s,
    count: count((r) => r.source === s),
  }));

  return {
    restaurant: { name: restaurant.name, currency: restaurant.currency, timeZone: tz },
    range: { days, from: fromKey, to: todayKey },
    tables: {
      count: tables,
      seatings: sessions.length,
      covers,
      utilisation,
      tradingHours: `${policy.opensAt}–${String(Math.floor((close % 1440) / 60)).padStart(2, "0")}:${String(close % 60).padStart(2, "0")}`,
      turnsPerTablePerDay: tables > 0 ? sessions.length / tables / days : 0,
      medianDiningMins: median(durations),
      byBucket,
      revenueCents,
      spendPerCoverCents: covers > 0 ? Math.round(revenueCents / covers) : null,
      busyHours,
    },
    bookings: {
      total: reservations.length,
      honoured,
      noShows,
      cancelled,
      cancelledByGuest,
      upcoming,
      noShowRate: decided > 0 ? noShows / decided : null,
      honouredRate:
        reservations.length - upcoming > 0 ? honoured / (reservations.length - upcoming) : null,
      guestConfirmedRate: reservations.length > 0 ? reminded / reservations.length : null,
      bySource,
    },
    waitlist: {
      joined: waitlist.length,
      seated: seatedFromList.length,
      lost: waitlist.filter((w) => w.status === "EXPIRED" || w.status === "CANCELLED").length,
      medianWaitMins: median(waits),
      medianQuoteErrorMins: median(quoteErrors),
    },
    recovered: {
      waitlistRevenueCents: waitlistRevenue,
      releasedResold,
      releasedResoldCents,
      totalCents: waitlistRevenue + releasedResoldCents,
    },
  };
}

export type Insights = Awaited<ReturnType<typeof getInsights>>;
