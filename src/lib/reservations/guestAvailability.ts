import { allocate, guestTableStates, onlineCapFor, type GuestTableState } from "./allocate";
import { bookableDates, bookingWindowError, overPacing, slotsForDay } from "./policy";
import { plannedDiningMins } from "./predict";
import {
  busyUntilMap,
  coversByStart,
  getDiningStats,
  loadBlocks,
  loadLive,
  loadRestaurant,
  loadTables,
  toAllocTables,
} from "./service";
import { prisma } from "../db";
import { addDaysToKey, parseDateKey, zonedWallToUtc } from "../zonedTime";

const MIN = 60_000;
const HOUR = 60 * MIN;

/**
 * What a guest sees while booking. Only availability, never who booked:
 * a table is "booked" or "occupied", nothing more.
 */

export type SlotView = { key: string; at: string; available: boolean };

export async function dayAvailability(restaurantId: string, dateKey: string, party: number) {
  const { policy } = await loadRestaurant(restaurantId);
  const now = new Date();
  const dates = bookableDates(now, policy);
  const date = parseDateKey(dateKey);
  if (!date || !dates.includes(dateKey))
    return { dates, slots: [] as SlotView[], enabled: policy.enabled };

  const slots = slotsForDay(dateKey, policy);
  if (slots.length === 0) return { dates, slots: [] as SlotView[], enabled: policy.enabled };
  const stats = await getDiningStats(restaurantId);
  const durationMs = (plannedDiningMins(party, stats, policy) + policy.cleaningMins) * MIN;
  const from = slots[0].at.getTime();
  const to = slots.at(-1)!.at.getTime() + durationMs;
  const [tableRows, blocks] = await Promise.all([
    loadTables(prisma, restaurantId),
    loadBlocks(prisma, restaurantId, new Date(from), new Date(to)),
  ]);
  const tables = toAllocTables(tableRows);
  const busyUntil =
    from - now.getTime() < 4 * HOUR
      ? busyUntilMap(await loadLive(restaurantId, policy, stats), policy)
      : undefined;
  const cap = onlineCapFor(tables, policy.onlineTablesPct);
  const covers =
    policy.maxCoversPerSlot > 0
      ? await coversByStart(prisma, restaurantId, new Date(from), slots.at(-1)!.at)
      : null;

  return {
    dates,
    enabled: policy.enabled,
    slots: slots.map((s) => {
      const start = s.at.getTime();
      const ok =
        !bookingWindowError(s.at, now, policy) &&
        !(covers && overPacing(covers.get(start) ?? 0, party, policy)) &&
        allocate({
          tables,
          blocks,
          busyUntil,
          party,
          start,
          end: start + durationMs,
          onlineCap: cap,
        }).ok;
      return { key: s.key, at: s.at.toISOString(), available: ok };
    }),
  };
}

export type GuestTableView = {
  id: string;
  name: string;
  seats: number;
  area: string;
  state: GuestTableState;
};

/** The floor map for one chosen time: what's free, and the table we'd pick. */
export async function tablesAt(restaurantId: string, startAt: Date, party: number) {
  const { policy } = await loadRestaurant(restaurantId);
  const stats = await getDiningStats(restaurantId);
  const durationMins = plannedDiningMins(party, stats, policy);
  const start = startAt.getTime();
  const end = start + (durationMins + policy.cleaningMins) * MIN;
  const [tableRows, blocks] = await Promise.all([
    loadTables(prisma, restaurantId),
    loadBlocks(prisma, restaurantId, new Date(start - 12 * HOUR), new Date(end + 12 * HOUR)),
  ]);
  const tables = toAllocTables(tableRows);
  const busyUntil =
    start - Date.now() < 4 * HOUR
      ? busyUntilMap(await loadLive(restaurantId, policy, stats), policy)
      : undefined;
  const states = guestTableStates({ tables, blocks, busyUntil, party, start, end });
  const best = allocate({
    tables,
    blocks,
    busyUntil,
    party,
    start,
    end,
    onlineCap: onlineCapFor(tables, policy.onlineTablesPct),
  });
  const view: GuestTableView[] = tables
    .filter((t) => t.reservable)
    .map((t) => ({
      id: t.id,
      name: t.name,
      seats: t.seats,
      area: t.area,
      state: states.get(t.id)!,
    }));
  return {
    durationMins,
    areas: [...new Set(view.map((t) => t.area))],
    tables: view,
    recommended: best.ok ? best.allocation.tableIds : null,
    reason: best.ok ? null : best.reason,
  };
}

/** Today + tomorrow at a glance, for the waiting-list page's "or book later" hint. */
export async function nextOpenSlot(restaurantId: string, party: number) {
  const { policy } = await loadRestaurant(restaurantId);
  const today = bookableDates(new Date(), policy)[0];
  for (const key of [today, addDaysToKey(today, 1)]) {
    const { slots } = await dayAvailability(restaurantId, key, party);
    const slot = slots.find((s) => s.available);
    if (slot) return slot;
  }
  return null;
}

/** Resolve a guest's "YYYY-MM-DD" + "HH:MM" to an instant in the restaurant's zone. */
export function localToInstant(dateKey: string, hhmm: string, timeZone: string) {
  const d = parseDateKey(dateKey);
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!d || !m) return null;
  return zonedWallToUtc(d.y, d.m, d.d, Number(m[1]) * 60 + Number(m[2]), timeZone);
}
