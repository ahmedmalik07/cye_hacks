import { hhmmToMinutes } from "../zonedTime";
import { addDaysToKey, parseDateKey, zonedDateKey, zonedWallToUtc } from "../zonedTime";

/**
 * A restaurant's reservation rules, read from its row. Everything that books,
 * releases, estimates or reminds takes one of these, so the rules live in one
 * place and every screen applies the same ones.
 */
export type ReservationPolicy = {
  timeZone: string;
  enabled: boolean;
  opensAt: string; // "HH:MM" first seating
  closesAt: string; // "HH:MM" last seating; earlier than opensAt = past midnight
  slotMins: number;
  leadMins: number;
  maxDaysAhead: number;
  maxParty: number;
  onlineTablesPct: number;
  defaultDiningMins: number;
  cleaningMins: number;
  graceMins: number;
  autoRelease: boolean;
  reminderMinsBefore: number;
  holdMinsBefore: number;
  waitlistEnabled: boolean;
  waitlistAutoNotify: boolean;
  waitlistReplyMins: number;
  cctvAutoVacate: boolean;
  /**
   * Per weekday (Sun = 0) override of first and last seating. undefined =
   * the defaults above, null = closed that weekday.
   */
  weekHours: (DayHours | null | undefined)[];
  /** Most guests that may start in one slot when booking online; 0 = no limit. */
  maxCoversPerSlot: number;
  /** Local dates with no bookings: CLOSED to everyone, ONLINE_OFF to guests only. */
  closures: Record<string, Closure>;
};

export type DayHours = { opensAt: string; closesAt: string };
export type Closure = { kind: "CLOSED" | "ONLINE_OFF"; reason: string | null };

export type PolicyRow = {
  timeZone: string;
  reservationsEnabled: boolean;
  bookingOpensAt: string;
  bookingClosesAt: string;
  bookingSlotMins: number;
  bookingLeadMins: number;
  bookingMaxDaysAhead: number;
  bookingMaxParty: number;
  onlineTablesPct: number;
  defaultDiningMins: number;
  cleaningMins: number;
  graceMins: number;
  autoReleaseNoShows: boolean;
  reminderMinsBefore: number;
  holdMinsBefore: number;
  waitlistEnabled: boolean;
  waitlistAutoNotify: boolean;
  waitlistReplyMins: number;
  cctvAutoVacate: boolean;
  bookingWeekHours?: unknown;
  bookingMaxCoversPerSlot?: number;
};

export const POLICY_SELECT = {
  timeZone: true,
  reservationsEnabled: true,
  bookingOpensAt: true,
  bookingClosesAt: true,
  bookingSlotMins: true,
  bookingLeadMins: true,
  bookingMaxDaysAhead: true,
  bookingMaxParty: true,
  onlineTablesPct: true,
  defaultDiningMins: true,
  cleaningMins: true,
  graceMins: true,
  autoReleaseNoShows: true,
  reminderMinsBefore: true,
  holdMinsBefore: true,
  waitlistEnabled: true,
  waitlistAutoNotify: true,
  waitlistReplyMins: true,
  cctvAutoVacate: true,
  bookingWeekHours: true,
  bookingMaxCoversPerSlot: true,
} as const;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The stored weekly hours, made safe: anything malformed means "use the default". */
export function parseWeekHours(raw: unknown): (DayHours | null | undefined)[] {
  const out: (DayHours | null | undefined)[] = Array(7).fill(undefined);
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const d = item as Record<string, unknown>;
    const day = Number(d.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;
    if (d.closed === true) out[day] = null;
    else if (typeof d.opensAt === "string" && typeof d.closesAt === "string") {
      if (HHMM.test(d.opensAt) && HHMM.test(d.closesAt)) {
        out[day] = { opensAt: d.opensAt, closesAt: d.closesAt };
      }
    }
  }
  return out;
}

export function policyFrom(
  row: PolicyRow,
  closures: { date: string; onlineOnly: boolean; reason: string | null }[] = [],
): ReservationPolicy {
  return {
    timeZone: row.timeZone || "Asia/Karachi",
    enabled: row.reservationsEnabled,
    opensAt: row.bookingOpensAt,
    closesAt: row.bookingClosesAt,
    slotMins: clamp(row.bookingSlotMins, 15, 60),
    leadMins: clamp(row.bookingLeadMins, 0, 24 * 60),
    maxDaysAhead: clamp(row.bookingMaxDaysAhead, 1, 90),
    maxParty: clamp(row.bookingMaxParty, 1, 60),
    onlineTablesPct: clamp(row.onlineTablesPct, 0, 100),
    defaultDiningMins: clamp(row.defaultDiningMins, 30, 300),
    cleaningMins: clamp(row.cleaningMins, 0, 60),
    graceMins: clamp(row.graceMins, 0, 60),
    autoRelease: row.autoReleaseNoShows,
    reminderMinsBefore: clamp(row.reminderMinsBefore, 0, 24 * 60),
    holdMinsBefore: clamp(row.holdMinsBefore, 0, 180),
    waitlistEnabled: row.waitlistEnabled,
    waitlistAutoNotify: row.waitlistAutoNotify,
    waitlistReplyMins: clamp(row.waitlistReplyMins, 3, 60),
    cctvAutoVacate: row.cctvAutoVacate,
    weekHours: parseWeekHours(row.bookingWeekHours),
    maxCoversPerSlot: clamp(row.bookingMaxCoversPerSlot ?? 0, 0, 1000),
    closures: Object.fromEntries(
      closures.map((c) => [
        c.date,
        { kind: c.onlineOnly ? "ONLINE_OFF" : "CLOSED", reason: c.reason } as Closure,
      ]),
    ),
  };
}

/** Sunday = 0, for a local YYYY-MM-DD. */
export function weekdayOf(dateKey: string): number {
  const d = parseDateKey(dateKey);
  if (!d) return 0;
  return new Date(Date.UTC(d.y, d.m - 1, d.d)).getUTCDay();
}

/**
 * First and last seating on one local day, or null if no bookings are taken
 * that day (closed weekday, closure, or an online-only closure for guests).
 */
export function hoursForDay(
  dateKey: string,
  policy: ReservationPolicy,
  opts: { staff?: boolean } = {},
): DayHours | null {
  const closure = policy.closures[dateKey];
  if (closure && (closure.kind === "CLOSED" || !opts.staff)) return null;
  const week = policy.weekHours?.[weekdayOf(dateKey)];
  if (week === null)
    return opts.staff ? { opensAt: policy.opensAt, closesAt: policy.closesAt } : null;
  return week ?? { opensAt: policy.opensAt, closesAt: policy.closesAt };
}

/** Why a day takes no bookings, in words for the guest or host; null if it does. */
export function dayClosedReason(
  dateKey: string,
  policy: ReservationPolicy,
  opts: { staff?: boolean } = {},
): string | null {
  const closure = policy.closures[dateKey];
  if (closure?.kind === "CLOSED") {
    return closure.reason
      ? `Closed that day: ${closure.reason}.`
      : "The restaurant is closed that day.";
  }
  if (opts.staff) return null;
  if (closure?.kind === "ONLINE_OFF") {
    return "Online booking is closed for that day. Please call the restaurant.";
  }
  if (policy.weekHours?.[weekdayOf(dateKey)] === null)
    return "The restaurant doesn't take bookings on that day.";
  return null;
}

/** Pacing: would this party push the slot past its online cover limit? */
export function overPacing(coversInSlot: number, party: number, policy: ReservationPolicy) {
  return policy.maxCoversPerSlot > 0 && coversInSlot + party > policy.maxCoversPerSlot;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/** Size buckets dining time is learned and planned in. */
export type PartyBucket = "S" | "M" | "L" | "XL";
export function partyBucket(size: number | null | undefined): PartyBucket {
  const n = size ?? 3;
  if (n <= 2) return "S";
  if (n <= 4) return "M";
  if (n <= 6) return "L";
  return "XL";
}

/** Before a restaurant has history: bigger families linger longer. */
const BUCKET_FACTOR: Record<PartyBucket, number> = { S: 0.85, M: 1, L: 1.15, XL: 1.3 };

export function defaultDiningMinsFor(partySize: number, policy: ReservationPolicy): number {
  return roundUp(policy.defaultDiningMins * BUCKET_FACTOR[partyBucket(partySize)], 15);
}

export function roundUp(n: number, step: number) {
  return Math.ceil(n / step) * step;
}

export type Slot = { key: string; label: string; at: Date };

/**
 * Bookable seatings for one local day: every `slotMins` from opening to last
 * seating. A day whose last seating is after midnight (12:00 → 01:00) keeps
 * those late slots under the day the evening started on, the way guests and
 * staff think about it.
 */
export function slotsForDay(
  dateKey: string,
  policy: ReservationPolicy,
  opts: { staff?: boolean } = {},
): Slot[] {
  const date = parseDateKey(dateKey);
  const hours = hoursForDay(dateKey, policy, opts);
  if (!hours) return [];
  const open = hhmmToMinutes(hours.opensAt);
  let close = hhmmToMinutes(hours.closesAt);
  if (!date || open == null || close == null) return [];
  if (close <= open) close += 24 * 60;
  const slots: Slot[] = [];
  for (let mins = open; mins <= close; mins += policy.slotMins) {
    const hh = Math.floor((mins % (24 * 60)) / 60);
    const mm = mins % 60;
    const key = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    slots.push({
      key,
      label: key,
      at: zonedWallToUtc(date.y, date.m, date.d, mins, policy.timeZone),
    });
  }
  return slots;
}

/** The dates a guest may pick from, today first. */
export function bookableDates(now: Date, policy: ReservationPolicy): string[] {
  const today = zonedDateKey(now, policy.timeZone);
  return Array.from({ length: policy.maxDaysAhead }, (_, i) => addDaysToKey(today, i));
}

/** Why a start time can't be booked online, or null if it can. */
export function bookingWindowError(
  startAt: Date,
  now: Date,
  policy: ReservationPolicy,
  opts: { staff?: boolean } = {},
): string | null {
  if (!opts.staff && !policy.enabled) return "Online booking is switched off. Please call instead.";
  const lead = opts.staff ? -15 : policy.leadMins;
  if (startAt.getTime() < now.getTime() + lead * 60_000) {
    return opts.staff
      ? "That time has already passed."
      : `Please book at least ${policy.leadMins} minutes ahead, or join the waiting list.`;
  }
  if (startAt.getTime() > now.getTime() + policy.maxDaysAhead * 86_400_000 + 86_400_000) {
    if (!opts.staff) return `Bookings open ${policy.maxDaysAhead} days ahead.`;
    if (startAt.getTime() > now.getTime() + 366 * 86_400_000)
      return "That's more than a year ahead.";
  }
  const key = zonedDateKey(startAt, policy.timeZone);
  const closed = dayClosedReason(key, policy, opts);
  // A seating after midnight belongs to the evening before; only refuse when
  // neither that evening nor this day has the slot.
  if (
    closed &&
    slotsForDay(addDaysToKey(key, -1), policy, opts).every(
      (s) => s.at.getTime() !== startAt.getTime(),
    )
  ) {
    return closed;
  }
  if (!opts.staff) {
    const onGrid = [
      ...slotsForDay(key, policy),
      ...slotsForDay(addDaysToKey(key, -1), policy),
    ].some((s) => s.at.getTime() === startAt.getTime());
    if (!onGrid) return "Pick one of the listed times.";
  }
  return null;
}
