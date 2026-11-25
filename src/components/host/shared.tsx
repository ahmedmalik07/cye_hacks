"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BookEntry } from "@/lib/reservations/book";
import type { GuestCard } from "@/lib/reservations/guests";
import type { Floor, FloorTable } from "@/components/floor/types";

export type { BookEntry, GuestCard };

export const btn = {
  primary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-9 px-4 text-sm font-bold text-white hover:bg-brand-10 disabled:opacity-50",
  accent:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-tangerine-9 px-4 text-sm font-bold text-on-tangerine hover:bg-tangerine-10 disabled:opacity-50",
  quiet:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-gray-12 ring-1 ring-gray-6 hover:bg-gray-3 disabled:opacity-50",
  danger:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-danger-11 ring-1 ring-danger-6 hover:bg-danger-2 disabled:opacity-50",
  small:
    "inline-flex min-h-9 items-center justify-center gap-1 rounded-lg px-3 text-xs font-bold disabled:opacity-50",
};

export const fieldCls =
  "min-h-11 w-full rounded-xl bg-panel px-3 text-sm text-gray-12 ring-1 ring-gray-6 outline-none placeholder:text-gray-9 focus:ring-2 focus:ring-brand-8";

export function Stepper({
  value,
  onChange,
  min = 1,
  max = 60,
  label = "guests",
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-1 rounded-xl bg-gray-3 p-1">
      <button
        type="button"
        aria-label={`Fewer ${label}`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
        className="flex h-10 w-10 items-center justify-center rounded-lg bg-panel text-gray-12 disabled:opacity-40"
      >
        <Minus className="size-4" />
      </button>
      <span className="w-9 text-center text-lg font-black text-gray-12 tabular-nums">{value}</span>
      <button
        type="button"
        aria-label={`More ${label}`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
        className="flex h-10 w-10 items-center justify-center rounded-lg bg-panel text-gray-12 disabled:opacity-40"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}

export const BOOKING_STATUS: Record<
  BookEntry["status"],
  { label: string; pill: string; bar: string }
> = {
  CONFIRMED: {
    label: "Booked",
    pill: "bg-brand-3 text-brand-11",
    bar: "bg-brand-9 text-white",
  },
  SEATED: {
    label: "Seated",
    pill: "bg-tangerine-3 text-tangerine-12",
    bar: "bg-tangerine-9 text-on-tangerine",
  },
  COMPLETED: { label: "Finished", pill: "bg-gray-4 text-gray-11", bar: "bg-gray-6 text-gray-12" },
  NO_SHOW: {
    label: "No-show",
    pill: "bg-danger-3 text-danger-11",
    bar: "bg-danger-4 text-danger-12",
  },
  CANCELLED: { label: "Cancelled", pill: "bg-gray-3 text-gray-11", bar: "hidden" },
};

export const SOURCE_LABEL: Record<BookEntry["source"], string> = {
  ONLINE: "Online",
  PHONE: "Phone",
  WALK_IN: "Walk-in",
  WAITLIST: "Waiting list",
};

type Tone = "vip" | "warn" | "danger" | "info" | "good";
const TONE: Record<Tone, string> = {
  vip: "bg-tangerine-9 text-on-tangerine",
  warn: "bg-tangerine-3 text-tangerine-12",
  danger: "bg-danger-3 text-danger-11",
  info: "bg-gray-4 text-gray-12",
  good: "bg-success-3 text-success-11",
};

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** Same rules as lib/reservations/guests.guestBadges, kept client-side. */
export function badgesFor(g: GuestCard | null, dateKey?: string, tags: string[] = []) {
  const out: { label: string; tone: Tone }[] = [];
  if (g) {
    if (g.vip) out.push({ label: "VIP", tone: "vip" });
    if (g.allergies) out.push({ label: "Allergy", tone: "danger" });
    if (g.noShows > 0)
      out.push({ label: `${g.noShows} no-show${g.noShows > 1 ? "s" : ""}`, tone: "warn" });
    if (dateKey && g.birthday && dateKey.slice(5) === g.birthday)
      out.push({ label: "Birthday", tone: "good" });
    out.push(
      g.visits === 0
        ? { label: "New", tone: "info" }
        : { label: `${ordinal(g.visits + 1)} visit`, tone: "info" },
    );
    for (const t of g.tags) if (t !== "VIP") out.push({ label: t, tone: "info" });
  }
  for (const t of tags) out.push({ label: t, tone: t === "Birthday" ? "good" : "info" });
  return out;
}

export function Badges({
  guest,
  dateKey,
  tags,
  max = 4,
  className,
}: {
  guest: GuestCard | null;
  dateKey?: string;
  tags?: string[];
  max?: number;
  className?: string;
}) {
  const all = badgesFor(guest, dateKey, tags);
  if (all.length === 0) return null;
  const shown = all.slice(0, max);
  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {shown.map((b) => (
        <span
          key={b.label}
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[10px] leading-none font-bold",
            TONE[b.tone],
          )}
        >
          {b.label}
        </span>
      ))}
      {all.length > max && (
        <span className="rounded-full bg-gray-3 px-1.5 py-0.5 text-[10px] leading-none font-bold text-gray-11">
          +{all.length - max}
        </span>
      )}
    </span>
  );
}

export function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function dayLabel(key: string, today: string) {
  const label = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${key}T00:00:00Z`));
  if (key === today) return `Today · ${label}`;
  if (key === addDays(today, 1)) return `Tomorrow · ${label}`;
  if (key === addDays(today, -1)) return `Yesterday · ${label}`;
  return label;
}

export function addDays(key: string, n: number) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Local "HH:MM" of an instant in the restaurant's zone. */
export function hhmm(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

export function localDateKey(iso: string | number, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** Who the host is placing at a table right now. */
export type Placing =
  | {
      kind: "booking";
      id: string;
      name: string;
      party: number;
      current: string[];
      seatNow: boolean;
    }
  | { kind: "wait"; id: string; name: string; party: number }
  | { kind: "walkin"; party: number };

export type Fit = "fits" | "join" | "soon" | "no";

/**
 * Can this table take the party being placed, right now? `fits` alone,
 * `join` free but too small on its own (pick another to push together),
 * `soon` being cleaned, `no` busy or held for someone else.
 */
export function tableFit(t: FloorTable, p: Placing): Fit {
  const heldForThis = p.kind === "booking" && t.heldBy?.id === p.id;
  const free = t.status === "AVAILABLE" || t.status === "READY" || heldForThis;
  if (t.status === "RESERVED" && !heldForThis) return "no";
  if (t.status === "CLEANING") return t.seats >= p.party ? "soon" : "no";
  if (!free) return "no";
  return t.seats >= p.party ? "fits" : "join";
}

export function seatsOf(floor: Floor, ids: string[]) {
  return ids.reduce((n, id) => n + (floor.tables.find((t) => t.id === id)?.seats ?? 0), 0);
}
