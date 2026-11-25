/**
 * Wall-clock time in a restaurant's own zone, without a date library.
 *
 * The server runs on UTC; a guest in Islamabad books "7:30 PM" in
 * Asia/Karachi. Everything that turns a local date and time into an instant,
 * or back, goes through here. Handles zones whose offset is not a whole hour
 * (India +5:30, Nepal +5:45) and days on which the clocks change.
 */

/** How far `timeZone` is ahead of UTC at the instant `at`, in ms. */
export function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const read = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asIfUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    // Some locales render midnight as hour 24.
    read("hour") % 24,
    read("minute"),
    read("second"),
  );
  return asIfUtc - Math.floor(at.getTime() / 1000) * 1000;
}

export type ZonedParts = {
  y: number;
  m: number;
  d: number;
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
};

export function zonedParts(at: Date, timeZone: string): ZonedParts {
  const local = new Date(at.getTime() + zoneOffsetMs(at, timeZone));
  return {
    y: local.getUTCFullYear(),
    m: local.getUTCMonth() + 1,
    d: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    weekday: local.getUTCDay(),
  };
}

/** The instant a local wall-clock time happens. Minutes may exceed 24h (next day). */
export function zonedWallToUtc(
  y: number,
  m: number,
  d: number,
  minutesOfDay: number,
  timeZone: string,
): Date {
  const wall = Date.UTC(y, m - 1, d, 0, minutesOfDay, 0, 0);
  // The offset depends on the instant and the instant on the offset: one
  // correction is enough almost everywhere, a second settles DST edges.
  let instant = wall - zoneOffsetMs(new Date(wall), timeZone);
  instant = wall - zoneOffsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of the local calendar day `at` falls on. */
export function zonedDateKey(at: Date, timeZone: string): string {
  const p = zonedParts(at, timeZone);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export function parseDateKey(key: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return { y, m, d };
}

/** Calendar arithmetic on a date key, independent of any zone. */
export function addDaysToKey(key: string, days: number): string {
  const p = parseDateKey(key);
  if (!p) throw new Error(`bad date key ${key}`);
  const next = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** Local "HH:MM" of an instant, 24-hour. */
export function zonedHHMM(at: Date, timeZone: string): string {
  const p = zonedParts(at, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** "HH:MM" to minutes after midnight, or null when it isn't a valid time. */
export function hhmmToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const mins = Number(m[2]);
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}
