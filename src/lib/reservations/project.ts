/**
 * The floor played forward: what each table will most likely be doing at a
 * chosen time later tonight. It combines the live floor (who is sitting
 * where, and when they're estimated to leave) with the night's bookings, so
 * the host can slide to 8:30 and see which tables are taken, held or free
 * before promising one to a walk-in. Pure, so it's tested without a database.
 *
 * It is an estimate, never a promise: occupied tables use the turn-time
 * estimate, and bookings are assumed to arrive on time and stay their
 * planned length.
 */

export type ProjectionTable = {
  id: string;
  seats: number;
  status: "AVAILABLE" | "READY" | "RESERVED" | "OCCUPIED" | "BILL" | "CLEANING";
  partySize: number | null;
  leftAt: string | null;
  estimate: { freeAt: string; readyAt: string } | null;
};

export type ProjectionBooking = {
  id: string;
  status: "CONFIRMED" | "SEATED" | "CANCELLED" | "NO_SHOW" | "COMPLETED";
  customerName: string;
  partySize: number;
  startAt: string;
  endAt: string;
  tables: { id: string }[];
};

export type Projected =
  /** The party sitting now is probably still there. */
  | { kind: "STILL_SEATED"; party: number | null; until: number }
  /** They've probably left; the table is being reset. */
  | { kind: "CLEANING"; until: number }
  /** A booking should be at the table by then. */
  | { kind: "BOOKED"; bookingId: string; name: string; party: number; from: number; until: number }
  /** Held for a booking about to arrive. */
  | { kind: "HELD"; bookingId: string; name: string; party: number; at: number }
  | { kind: "FREE"; nextAt: number | null; nextName: string | null };

const MIN = 60_000;

export function projectTable(
  t: ProjectionTable,
  bookings: ProjectionBooking[],
  at: number,
  opts: { holdMins: number; cleaningMins: number },
): Projected {
  const mine = bookings
    .filter(
      (b) =>
        (b.status === "CONFIRMED" || b.status === "SEATED") && b.tables.some((x) => x.id === t.id),
    )
    .map((b) => ({ b, start: Date.parse(b.startAt), end: Date.parse(b.endAt) }))
    .sort((a, b) => a.start - b.start);

  // 1. Whoever is at the table now, if they're expected to still be there.
  if ((t.status === "OCCUPIED" || t.status === "BILL") && t.estimate) {
    const freeAt = Date.parse(t.estimate.freeAt);
    const readyAt = Date.parse(t.estimate.readyAt);
    if (at < freeAt) return { kind: "STILL_SEATED", party: t.partySize, until: freeAt };
    if (at < readyAt) return { kind: "CLEANING", until: readyAt };
  }
  if (t.status === "CLEANING" && t.leftAt) {
    const done = Date.parse(t.leftAt) + opts.cleaningMins * MIN;
    if (at < done) return { kind: "CLEANING", until: done };
  }

  // 2. A booking that will be eating or arriving then. A booking already
  //    seated is the live party above, so only upcoming ones count here.
  for (const { b, start, end } of mine) {
    if (b.status !== "CONFIRMED") continue;
    if (at >= start && at < end) {
      return {
        kind: "BOOKED",
        bookingId: b.id,
        name: b.customerName,
        party: b.partySize,
        from: start,
        until: end,
      };
    }
    if (at < start && at >= start - opts.holdMins * MIN) {
      return { kind: "HELD", bookingId: b.id, name: b.customerName, party: b.partySize, at: start };
    }
  }

  const next = mine.find(({ b, start }) => b.status === "CONFIRMED" && start > at);
  return {
    kind: "FREE",
    nextAt: next ? next.start : null,
    nextName: next ? next.b.customerName : null,
  };
}

/** The whole floor at one moment, with the totals the host cares about. */
export function projectFloor(
  tables: ProjectionTable[],
  bookings: ProjectionBooking[],
  at: number,
  opts: { holdMins: number; cleaningMins: number },
) {
  const byTable = new Map<string, Projected>();
  for (const t of tables) byTable.set(t.id, projectTable(t, bookings, at, opts));
  let guests = 0;
  let free = 0;
  const counted = new Set<string>();
  for (const p of byTable.values()) {
    if (p.kind === "STILL_SEATED") guests += p.party ?? 0;
    if (p.kind === "BOOKED" && !counted.has(p.bookingId)) {
      // Pushed-together tables share one booking: count its guests once.
      counted.add(p.bookingId);
      guests += p.party;
    }
    if (p.kind === "FREE") free++;
  }
  return { byTable, guests, free };
}
