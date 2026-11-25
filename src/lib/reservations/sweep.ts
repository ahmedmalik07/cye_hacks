import { prisma } from "../db";
import { bumpRevision } from "../bus";
import { log } from "../log";
import { closeSession, getDiningStats, loadLive, loadRestaurant, markNoShow } from "./service";
import { offerFreeTables, offerTableToWaitlist } from "./waitlist";
import { composeWaitlist, queueGuestMessage, waitlistUrl } from "./messages";
import { GUEST_PROFILE_RETENTION_DAYS } from "./guests";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** Guest phone numbers and message text are kept this long, then erased. */
export const GUEST_DATA_RETENTION_DAYS = 90;

/**
 * Time-driven housekeeping for one restaurant. Runs:
 *   - as a job at the exact moment each booking's grace period ends,
 *   - from the five-minute cron backstop for every restaurant,
 *   - lazily when a board or the booking page loads (throttled).
 *
 * Each step is idempotent, so overlapping runs are harmless.
 */
const lastRun = new Map<string, number>();
const lastRetention = new Map<string, number>();

export async function sweepRestaurant(restaurantId: string, opts: { force?: boolean } = {}) {
  const now = Date.now();
  if (!opts.force && now - (lastRun.get(restaurantId) ?? 0) < 20_000) return;
  lastRun.set(restaurantId, now);

  const { restaurant, policy } = await loadRestaurant(restaurantId);
  let changed = false;

  // 1. No-shows: confirmed, never seated, grace (or their late time) is over.
  if (policy.autoRelease) {
    const overdue = await prisma.reservation.findMany({
      where: {
        restaurantId,
        status: "CONFIRMED",
        // A party checked in at the door is here, just waiting for the table.
        arrivedAt: null,
        startAt: { lt: new Date(now - policy.graceMins * MIN) },
      },
      select: { id: true, startAt: true, lateUntil: true },
    });
    for (const r of overdue) {
      const arrive = Math.max(r.startAt.getTime(), r.lateUntil?.getTime() ?? 0);
      if (now < arrive + policy.graceMins * MIN) continue;
      await markNoShow({ restaurantId, reservationId: r.id, actor: null, system: true });
      changed = true;
    }
  }

  // 2. Waiting-list offers nobody took up within the reply window.
  const expired = await prisma.waitlistEntry.findMany({
    where: { restaurantId, status: "NOTIFIED", respondBy: { lt: new Date(now) } },
  });
  for (const e of expired) {
    await prisma.waitlistEntry.update({ where: { id: e.id }, data: { status: "EXPIRED" } });
    await queueGuestMessage({
      restaurantId,
      waitlistEntryId: e.id,
      kind: "WAITLIST_EXPIRED",
      phone: e.customerPhone,
      body: composeWaitlist("WAITLIST_EXPIRED", {
        restaurant: restaurant.name,
        name: e.customerName,
        link: waitlistUrl(restaurant.slug, "").replace(/\/$/, ""),
      }),
    });
    if (policy.waitlistAutoNotify) {
      for (const tableId of e.offeredTableIds) await offerTableToWaitlist(restaurantId, tableId);
    }
    changed = true;
  }

  // 3. Camera says a paid table has emptied: close it, but only where the
  //    owner has allowed the camera to decide. Otherwise it is a suggestion
  //    on the board and staff confirm.
  if (policy.cctvAutoVacate) {
    const live = await loadLive(restaurantId, policy, await getDiningStats(restaurantId));
    for (const t of live) {
      if (
        t.session &&
        !t.session.leftAt &&
        (t.paidAt || t.billRequestedAt) &&
        t.cctvEmptySince &&
        now - t.cctvEmptySince.getTime() >= 3 * MIN
      ) {
        await closeSession(restaurantId, t.session.id, "CCTV", policy);
        changed = true;
      }
    }
  }

  // 4. A free table and a family waiting for one should never sit side by
  //    side: offer every free table that fits, whether it just freed up or
  //    has been free a while (and won't be needed for a booking first).
  if (policy.waitlistEnabled && policy.waitlistAutoNotify) {
    const waiting = await prisma.waitlistEntry.count({
      where: { restaurantId, status: "WAITING" },
    });
    if (waiting > 0) await offerFreeTables(restaurantId);
  }

  // 5. Privacy, hourly: old guest contact details are erased, the counts kept.
  if (now - (lastRetention.get(restaurantId) ?? 0) > 60 * MIN) {
    lastRetention.set(restaurantId, now);
    const cutoff = new Date(now - GUEST_DATA_RETENTION_DAYS * DAY);
    await prisma.reservation.updateMany({
      where: { restaurantId, startAt: { lt: cutoff }, customerPhone: { not: null } },
      data: { customerPhone: null },
    });
    await prisma.waitlistEntry.updateMany({
      where: { restaurantId, createdAt: { lt: cutoff }, customerPhone: { not: null } },
      data: { customerPhone: null },
    });
    await prisma.guestMessage.deleteMany({ where: { restaurantId, createdAt: { lt: cutoff } } });
    // Profiles of guests who haven't booked or visited in a year.
    await prisma.guest.deleteMany({
      where: {
        restaurantId,
        lastSeenAt: { lt: new Date(now - GUEST_PROFILE_RETENTION_DAYS * DAY) },
      },
    });
  }

  if (changed) bumpRevision(restaurantId);
}

/** Cron backstop: every restaurant with something time-sensitive going on. */
export async function sweepAllRestaurants() {
  const now = Date.now();
  const [res, wait] = await Promise.all([
    prisma.reservation.findMany({
      where: { status: "CONFIRMED", startAt: { lt: new Date(now), gt: new Date(now - DAY) } },
      select: { restaurantId: true },
      distinct: ["restaurantId"],
    }),
    prisma.waitlistEntry.findMany({
      where: { status: "NOTIFIED" },
      select: { restaurantId: true },
      distinct: ["restaurantId"],
    }),
  ]);
  const ids = [...new Set([...res, ...wait].map((r) => r.restaurantId))];
  let swept = 0;
  for (const id of ids) {
    try {
      await sweepRestaurant(id, { force: true });
      swept++;
    } catch (err) {
      log.error("reservation sweep failed", { restaurantId: id, error: (err as Error).message });
    }
  }
  return swept;
}
