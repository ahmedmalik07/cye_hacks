/**
 * Table allocation: given the tables, what is already booked, and what is
 * physically occupied right now, which table(s) should this party get?
 *
 * Pure and synchronous, so the booking route, the availability grid, the
 * waiting list and the tests all run the same rules. The database adds the
 * one thing this can't: an exclusion constraint that makes the final insert
 * atomic (see the smart_reservations migration).
 *
 * Scoring, lowest wins:
 *   - empty seats ×10            a 2 at a 2-top beats a 2 at a 6-top
 *   - joined tables +30 each     pushing tables together is work for staff
 *   - wrong area +25             the guest asked for the family hall
 *   - joinable table alone +3    keep tables that push together for big parties
 *   - stranded gap +gap/6        a 40-minute hole nobody can book is lost money
 *   - snug fit −5                starting right after the last party leaves
 */

export type AllocTable = {
  id: string;
  name: string;
  seats: number;
  minParty: number;
  area: string;
  joinGroup: string | null;
  reservable: boolean;
  sortOrder?: number;
};

/** A table held over [start, end) in epoch ms. `online` marks guest bookings. */
export type Block = {
  tableId: string;
  start: number;
  end: number;
  reservationId?: string;
  online?: boolean;
};

export type AllocationRequest = {
  tables: AllocTable[];
  blocks: Block[];
  /** Earliest moment each currently occupied/cleaning table is expected ready. */
  busyUntil?: Map<string, number>;
  party: number;
  start: number;
  /** Departure plus cleaning. */
  end: number;
  preferArea?: string | null;
  /** The guest (or staff) picked these exact tables. */
  preferTableIds?: string[];
  /** Ignore this booking's own blocks (when moving or extending it). */
  ignoreReservationId?: string;
  /** Online bookings may hold at most this many tables at once. */
  onlineCap?: number;
  /** Staff may seat anywhere it physically fits, including walk-in-only tables. */
  staff?: boolean;
};

export type Allocation = { tableIds: string[]; seats: number; score: number };

export type AllocationResult =
  | { ok: true; allocation: Allocation }
  | { ok: false; reason: "NO_FIT" | "TAKEN" | "ONLINE_CAP" | "TOO_LARGE" };

/** A gap shorter than this between two parties can't be sold to anyone. */
const USEFUL_GAP_MS = 60 * 60_000;

/** A booking's own blocks don't count against it when it is being moved. */
function ignored(b: Block, reservationId: string | undefined) {
  return reservationId != null && b.reservationId === reservationId;
}

export function isTableFree(
  tableId: string,
  start: number,
  end: number,
  blocks: Block[],
  busyUntil?: Map<string, number>,
  ignoreReservationId?: string,
): boolean {
  const busy = busyUntil?.get(tableId);
  if (busy != null && busy > start) return false;
  return !blocks.some(
    (b) =>
      b.tableId === tableId && !ignored(b, ignoreReservationId) && b.start < end && start < b.end,
  );
}

function gapPenalty(tableId: string, start: number, end: number, blocks: Block[], ignore?: string) {
  let before = Infinity;
  let after = Infinity;
  for (const b of blocks) {
    if (b.tableId !== tableId || ignored(b, ignore)) continue;
    if (b.end <= start) before = Math.min(before, start - b.end);
    if (b.start >= end) after = Math.min(after, b.start - end);
  }
  let penalty = 0;
  for (const gap of [before, after]) {
    if (gap === Infinity) continue;
    if (gap <= 15 * 60_000) penalty -= 5;
    else if (gap < USEFUL_GAP_MS) penalty += gap / 60_000 / 6;
  }
  return penalty;
}

export function allocate(req: AllocationRequest): AllocationResult {
  const { tables, blocks, busyUntil, party, start, end } = req;
  const usable = tables.filter((t) => req.staff || t.reservable);
  const free = (t: AllocTable) =>
    isTableFree(t.id, start, end, blocks, busyUntil, req.ignoreReservationId);

  if (req.onlineCap != null) {
    const heldOnline = new Set(
      blocks
        .filter(
          (b) => b.online && !ignored(b, req.ignoreReservationId) && b.start < end && start < b.end,
        )
        .map((b) => b.tableId),
    );
    if (heldOnline.size >= req.onlineCap) return { ok: false, reason: "ONLINE_CAP" };
  }

  // The guest chose specific tables: give them exactly those, or say so.
  if (req.preferTableIds?.length) {
    const chosen = req.preferTableIds
      .map((id) => usable.find((t) => t.id === id))
      .filter((t): t is AllocTable => !!t);
    if (chosen.length !== req.preferTableIds.length) return { ok: false, reason: "TAKEN" };
    if (!chosen.every(free)) return { ok: false, reason: "TAKEN" };
    const seats = chosen.reduce((s, t) => s + t.seats, 0);
    if (seats < party) return { ok: false, reason: "NO_FIT" };
    return { ok: true, allocation: { tableIds: chosen.map((t) => t.id), seats, score: 0 } };
  }

  const areaCost = (t: AllocTable) => (req.preferArea && t.area !== req.preferArea ? 25 : 0);
  let best: Allocation | null = null;
  const consider = (picked: AllocTable[]) => {
    const seats = picked.reduce((s, t) => s + t.seats, 0);
    const score =
      (seats - party) * 10 +
      (picked.length - 1) * 30 +
      // Joinable tables are the only way to seat a big family; spend them last.
      (picked.length === 1 && picked[0].joinGroup ? 3 : 0) +
      Math.max(...picked.map(areaCost)) +
      picked.reduce(
        (s, t) => s + gapPenalty(t.id, start, end, blocks, req.ignoreReservationId),
        0,
      ) +
      // Stable tie-break: the table staff list first.
      picked.reduce((s, t) => s + (t.sortOrder ?? 0) * 0.001, 0);
    if (!best || score < best.score) {
      best = { tableIds: picked.map((t) => t.id), seats, score };
    }
  };

  const freeTables = usable.filter(free);
  for (const t of freeTables) {
    if (t.seats >= party && (req.staff || t.minParty <= party)) consider([t]);
  }

  // Nothing single fits: push together up to three tables of one group.
  if (!best) {
    const groups = new Map<string, AllocTable[]>();
    for (const t of freeTables) {
      if (!t.joinGroup) continue;
      groups.set(t.joinGroup, [...(groups.get(t.joinGroup) ?? []), t]);
    }
    for (const members of groups.values()) {
      const n = members.length;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const pair = [members[i], members[j]];
          if (pair[0].seats + pair[1].seats >= party) consider(pair);
          for (let k = j + 1; k < n; k++) {
            const trio = [members[i], members[j], members[k]];
            if (trio.reduce((s, t) => s + t.seats, 0) >= party) consider(trio);
          }
        }
      }
    }
  }

  if (best) return { ok: true, allocation: best };
  const largest = usable.reduce((m, t) => Math.max(m, t.seats), 0);
  const groupMax = Math.max(
    0,
    ...[...new Set(usable.map((t) => t.joinGroup).filter(Boolean))].map((g) =>
      usable
        .filter((t) => t.joinGroup === g)
        .map((t) => t.seats)
        .sort((a, b) => b - a)
        .slice(0, 3)
        .reduce((s, x) => s + x, 0),
    ),
  );
  return { ok: false, reason: party > Math.max(largest, groupMax) ? "TOO_LARGE" : "NO_FIT" };
}

/** Most online bookings may hold at once, from the restaurant's walk-in share. */
export function onlineCapFor(tables: AllocTable[], pct: number): number {
  const reservable = tables.filter((t) => t.reservable).length;
  if (reservable === 0) return 0;
  return Math.max(1, Math.floor((reservable * pct) / 100));
}

export type GuestTableState = "free" | "booked" | "occupied" | "unsuitable";

/**
 * How each table looks to a guest choosing a seat for one time: free and
 * right for their party, booked by someone else, still occupied (only for
 * times in the next few hours), or free but the wrong size.
 */
export function guestTableStates(
  req: Omit<AllocationRequest, "preferTableIds" | "preferArea">,
): Map<string, GuestTableState> {
  const states = new Map<string, GuestTableState>();
  for (const t of req.tables) {
    if (!t.reservable) continue;
    const blocked = req.blocks.some(
      (b) => b.tableId === t.id && b.start < req.end && req.start < b.end,
    );
    const busy = req.busyUntil?.get(t.id);
    if (blocked) states.set(t.id, "booked");
    else if (busy != null && busy > req.start) states.set(t.id, "occupied");
    else if (t.seats < req.party || t.minParty > req.party) states.set(t.id, "unsuitable");
    else states.set(t.id, "free");
  }
  return states;
}
