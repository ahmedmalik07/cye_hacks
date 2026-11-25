import type { FloorData } from "@/lib/reservations/floor";

export type Floor = FloorData;
export type FloorTable = Floor["tables"][number];
export type Arrival = Floor["upcoming"][number];
export type Waiting = Floor["waitlist"][number];
export type Status = FloorTable["status"];

/**
 * Tile colours per status, from the live-dashboard sketch: free is green,
 * occupied tangerine, bill a solid tangerine call to action, reserved navy,
 * cleaning sand-grey, freshly ready bright green.
 */
export const STATUS_STYLE: Record<
  Status,
  { tile: string; icon: string; dot: string; label: string }
> = {
  AVAILABLE: {
    tile: "border-success-7 bg-success-2",
    icon: "text-success-11",
    dot: "bg-success-9",
    label: "Available",
  },
  READY: {
    tile: "border-success-9 bg-success-3 ring-2 ring-success-7",
    icon: "text-success-11",
    dot: "bg-success-9",
    label: "Ready",
  },
  RESERVED: {
    tile: "border-brand-8 bg-brand-3",
    icon: "text-brand-11",
    dot: "bg-brand-9",
    label: "Reserved",
  },
  OCCUPIED: {
    tile: "border-tangerine-8 bg-tangerine-2",
    icon: "text-tangerine-11",
    dot: "bg-tangerine-9",
    label: "Occupied",
  },
  BILL: {
    tile: "border-tangerine-10 bg-tangerine-9 text-on-tangerine",
    icon: "text-on-tangerine",
    dot: "bg-tangerine-10",
    label: "Bill",
  },
  CLEANING: {
    tile: "border-gray-8 bg-gray-4",
    icon: "text-gray-11",
    dot: "bg-gray-9",
    label: "Cleaning",
  },
};

export function clock(iso: string | null | undefined, timeZone: string) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(new Date(iso))
    .replace(" ", "")
    .toLowerCase();
}

export function minsSince(iso: string | null | undefined, now: number) {
  if (!iso) return 0;
  return Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
}

export function minsUntil(iso: string | null | undefined, now: number) {
  if (!iso) return 0;
  return Math.round((new Date(iso).getTime() - now) / 60_000);
}
