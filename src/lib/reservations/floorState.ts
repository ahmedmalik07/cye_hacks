/**
 * The table status state machine.
 *
 *            seat (walk-in, reservation or waiting list)
 *   AVAILABLE ───────────────────────────────────────────────► OCCUPIED
 *   READY  ──┘                                                   │ bill asked / paid
 *     ▲                                                          ▼
 *     │ cleaning done (staff)                              BILL_REQUESTED
 *     │                                                          │ guests left (staff,
 *   CLEANING ◄───────────────────────────────────────────────────┘  or camera when allowed)
 *
 *   RESERVED overlays a free table from `holdMinsBefore` before a booking
 *   until the guest is seated or the grace period releases it.
 *
 * The table's latest session stores when each step happened (seated,
 * ordered, bill, paid, left, cleaned); the status is derived from those and
 * the bookings, never stored, so it can't drift. Staff move a table along
 * each edge by hand on the host screen.
 */

export type TableStatus = "AVAILABLE" | "READY" | "RESERVED" | "OCCUPIED" | "BILL" | "CLEANING";

export const TABLE_STATUS_LABEL: Record<TableStatus, string> = {
  AVAILABLE: "Available",
  READY: "Ready",
  RESERVED: "Reserved",
  OCCUPIED: "Occupied",
  BILL: "Bill",
  CLEANING: "Cleaning",
};

/** How long a freshly reset table shows as Ready before it reads as Available. */
export const READY_FLASH_MS = 15 * 60_000;

export type StatusInput = {
  session: {
    leftAt: Date | null;
    cleanedAt: Date | null;
    billRequestedAt: Date | null;
    paidAt: Date | null;
  } | null;
  openBillRequest: boolean;
  /** A booking holds this table now (inside its hold → grace window, not seated). */
  held: boolean;
  lastCleanedAt: Date | null;
  now: Date;
};

export function deriveTableStatus(input: StatusInput): TableStatus {
  const { session, now } = input;
  if (session && !session.cleanedAt) {
    if (!session.leftAt) {
      return session.billRequestedAt || session.paidAt || input.openBillRequest
        ? "BILL"
        : "OCCUPIED";
    }
    return "CLEANING";
  }
  if (input.held) return "RESERVED";
  if (input.lastCleanedAt && now.getTime() - input.lastCleanedAt.getTime() < READY_FLASH_MS) {
    return "READY";
  }
  return "AVAILABLE";
}

/** A booking holds its table from `holdMins` before arrival until grace (or late ETA) runs out. */
export function isHeld(
  r: { startAt: Date; lateUntil: Date | null; status: string },
  now: Date,
  holdMins: number,
  graceMins: number,
): boolean {
  if (r.status !== "CONFIRMED") return false;
  const from = r.startAt.getTime() - holdMins * 60_000;
  const arrive = Math.max(r.startAt.getTime(), r.lateUntil?.getTime() ?? 0);
  const until = arrive + graceMins * 60_000;
  return now.getTime() >= from && now.getTime() <= until;
}

/** Minutes a confirmed guest is past their time (or late ETA), else 0. */
export function lateMins(r: { startAt: Date; lateUntil: Date | null }, now: Date): number {
  const arrive = Math.max(r.startAt.getTime(), r.lateUntil?.getTime() ?? 0);
  return Math.max(0, Math.floor((now.getTime() - arrive) / 60_000));
}

export type Transition = "SEAT" | "BILL" | "LEFT" | "CLEANED";

/** Which staff actions make sense from a status. The API enforces the same list. */
export function allowedTransitions(status: TableStatus): Transition[] {
  switch (status) {
    case "AVAILABLE":
    case "READY":
    case "RESERVED":
      return ["SEAT"];
    case "OCCUPIED":
      return ["BILL", "LEFT"];
    case "BILL":
      return ["LEFT"];
    case "CLEANING":
      // Seating straight from cleaning is a staff override: it marks the reset done.
      return ["CLEANED", "SEAT"];
  }
}
