import { describe, it, expect } from "vitest";
import { allocate, guestTableStates, onlineCapFor, type AllocTable, type Block } from "./allocate";
import { bookingWindowError, policyFrom, slotsForDay, type PolicyRow } from "./policy";
import { buildDiningStats, estimateFreeAt, plannedDiningMins, type ClosedSession } from "./predict";
import { allowedTransitions, deriveTableStatus, isHeld } from "./floorState";
import { waitlistEtas } from "./waitlistEta";
import { maskPhone, normalisePhone } from "./guest";
import { zonedDateKey, zonedHHMM } from "../zonedTime";

const MIN = 60_000;
const row: PolicyRow = {
  timeZone: "Asia/Karachi",
  reservationsEnabled: true,
  bookingOpensAt: "12:00",
  bookingClosesAt: "23:00",
  bookingSlotMins: 30,
  bookingLeadMins: 60,
  bookingMaxDaysAhead: 30,
  bookingMaxParty: 20,
  onlineTablesPct: 80,
  defaultDiningMins: 90,
  cleaningMins: 10,
  graceMins: 15,
  autoReleaseNoShows: true,
  reminderMinsBefore: 120,
  holdMinsBefore: 30,
  waitlistEnabled: true,
  waitlistAutoNotify: true,
  waitlistReplyMins: 10,
  cctvAutoVacate: false,
};
const policy = policyFrom(row);

// A typical Islamabad family restaurant: twos by the window, fours in the
// main hall, sixes and an eight in the family hall, two fours that join.
const t = (
  id: string,
  seats: number,
  area = "Main hall",
  extra: Partial<AllocTable> = {},
): AllocTable => ({
  id,
  name: id,
  seats,
  minParty: seats >= 6 ? 3 : 1,
  area,
  joinGroup: null,
  reservable: true,
  ...extra,
});
const tables: AllocTable[] = [
  t("T1", 2),
  t("T2", 2),
  t("T3", 4, "Main hall", { joinGroup: "A" }),
  t("T4", 4, "Main hall", { joinGroup: "A" }),
  t("T5", 4),
  t("F1", 6, "Family hall"),
  t("F2", 8, "Family hall"),
];

const at = (h: number, m = 0) => Date.UTC(2026, 10, 27, h - 5, m); // Karachi wall time
const block = (
  tableId: string,
  startH: number,
  endH: number,
  extra: Partial<Block> = {},
): Block => ({
  tableId,
  start: at(startH),
  end: at(endH),
  ...extra,
});

describe("allocation", () => {
  it("gives a couple a two-top, not a family table", () => {
    const r = allocate({ tables, blocks: [], party: 2, start: at(20), end: at(21, 30) });
    expect(r.ok && r.allocation.tableIds[0]).toMatch(/^T[12]$/);
  });

  it("never overlaps an existing block, including its cleaning time", () => {
    const blocks = [block("T1", 19, 20, { reservationId: "r1" }), block("T2", 19, 21)];
    const r = allocate({ tables, blocks, party: 2, start: at(19, 30), end: at(21) });
    // Both twos are taken, so the couple goes to a four rather than overlapping.
    expect(r.ok && r.allocation.tableIds).toEqual(["T5"]);
    const snug = allocate({ tables, blocks, party: 2, start: at(20), end: at(21, 30) });
    expect(snug.ok && snug.allocation.tableIds).toEqual(["T1"]);
  });

  it("respects the minimum party on family tables", () => {
    const busy = tables.filter((x) => x.id !== "F1").map((x) => block(x.id, 18, 23));
    const r = allocate({ tables, blocks: busy, party: 2, start: at(20), end: at(21, 30) });
    expect(r.ok).toBe(false);
    const staff = allocate({
      tables,
      blocks: busy,
      party: 2,
      start: at(20),
      end: at(21, 30),
      staff: true,
    });
    expect(staff.ok && staff.allocation.tableIds).toEqual(["F1"]);
  });

  it("joins tables of one group when no single table is big enough", () => {
    const blocks = [block("F1", 18, 23), block("F2", 18, 23)];
    const r = allocate({ tables, blocks, party: 7, start: at(20), end: at(21, 30) });
    expect(r.ok && [...r.allocation.tableIds].sort()).toEqual(["T3", "T4"]);
  });

  it("says a party is too large rather than unavailable", () => {
    const r = allocate({ tables, blocks: [], party: 30, start: at(20), end: at(21) });
    expect(r).toEqual({ ok: false, reason: "TOO_LARGE" });
  });

  it("prefers the requested area", () => {
    const r = allocate({
      tables,
      blocks: [],
      party: 4,
      start: at(20),
      end: at(21, 30),
      preferArea: "Family hall",
    });
    expect(r.ok && r.allocation.tableIds).toEqual(["F1"]);
  });

  it("refuses a table the guest picked if someone else just took it", () => {
    const r = allocate({
      tables,
      blocks: [block("T5", 20, 22)],
      party: 4,
      start: at(20),
      end: at(21, 30),
      preferTableIds: ["T5"],
    });
    expect(r).toEqual({ ok: false, reason: "TAKEN" });
  });

  it("treats a table still occupied past the start as unavailable", () => {
    const busyUntil = new Map([
      ["T1", at(20, 15)],
      ["T2", at(19, 40)],
    ]);
    const r = allocate({ tables, blocks: [], busyUntil, party: 2, start: at(20), end: at(21, 30) });
    expect(r.ok && r.allocation.tableIds).toEqual(["T2"]);
  });

  it("keeps a share of tables free for walk-ins", () => {
    const cap = onlineCapFor(tables, 80); // 7 tables → 5 online
    expect(cap).toBe(5);
    const blocks = ["T1", "T2", "T3", "T4", "T5"].map((id) => block(id, 19, 22, { online: true }));
    const r = allocate({ tables, blocks, party: 4, start: at(20), end: at(21), onlineCap: cap });
    expect(r).toEqual({ ok: false, reason: "ONLINE_CAP" });
  });

  it("shows guests which tables are free, booked or the wrong size", () => {
    const states = guestTableStates({
      tables,
      blocks: [block("T3", 19, 22)],
      party: 4,
      start: at(20),
      end: at(21, 30),
    });
    expect(states.get("T3")).toBe("booked");
    expect(states.get("T1")).toBe("unsuitable");
    expect(states.get("T5")).toBe("free");
  });
});

describe("policy", () => {
  it("lays out half-hour slots in the restaurant's own time", () => {
    const slots = slotsForDay("2026-11-27", policy);
    expect(slots[0].key).toBe("12:00");
    expect(slots.at(-1)!.key).toBe("23:00");
    expect(zonedHHMM(slots[0].at, "Asia/Karachi")).toBe("12:00");
    expect(slots[0].at.toISOString()).toBe("2026-11-27T07:00:00.000Z");
  });

  it("keeps late slots under the evening they belong to", () => {
    const late = slotsForDay("2026-11-27", { ...policy, opensAt: "18:00", closesAt: "01:00" });
    expect(late.at(-1)!.key).toBe("01:00");
    expect(zonedDateKey(late.at(-1)!.at, "Asia/Karachi")).toBe("2026-11-28");
  });

  it("rejects off-grid, too-soon and disabled bookings", () => {
    const now = new Date(at(17));
    expect(bookingWindowError(new Date(at(20)), now, policy)).toBeNull();
    expect(bookingWindowError(new Date(at(20, 10)), now, policy)).toMatch(/listed times/);
    expect(bookingWindowError(new Date(at(17, 30)), now, policy)).toMatch(/minutes ahead/);
    expect(bookingWindowError(new Date(at(20)), now, { ...policy, enabled: false })).toMatch(/off/);
    expect(bookingWindowError(new Date(at(17, 30)), now, policy, { staff: true })).toBeNull();
  });
});

describe("availability estimate", () => {
  // Meals vary a lot in length (75–105 min), but families leave a steady
  // 18–20 minutes after asking for the bill.
  const meal = (party: number, mins: number, i: number): ClosedSession => {
    const seated = new Date(at(13) + i * 3 * 60 * MIN);
    const left = seated.getTime() + mins * MIN;
    const bill = left - (18 + (i % 2) * 2) * MIN;
    return {
      partySize: party,
      seatedAt: seated,
      firstOrderAt: new Date(seated.getTime() + 8 * MIN),
      billRequestedAt: new Date(bill),
      paidAt: new Date(bill + 6 * MIN),
      leftAt: new Date(left),
    };
  };
  const history = Array.from({ length: 12 }, (_, i) => meal(4, 75 + (i % 3) * 15, i));
  const stats = buildDiningStats(history);

  it("learns the restaurant's own meal length", () => {
    expect(stats.samples).toBe(12);
    expect(plannedDiningMins(4, stats, policy)).toBe(90); // median 90
    // No history for big parties yet: falls back to everyone's median.
    expect(plannedDiningMins(8, stats, policy)).toBe(90);
    expect(plannedDiningMins(4, buildDiningStats([]), policy)).toBe(90);
  });

  it("tightens as the meal moves from seated to bill", () => {
    const now = new Date(at(20, 30));
    const base = {
      partySize: 4,
      seatedAt: new Date(at(20)),
      firstOrderAt: null,
      allServed: false,
      billRequestedAt: null,
      paidAt: null,
      freeAtOverride: null,
      cctvEmptySince: null,
    };
    const seated = estimateFreeAt(base, stats, policy, now);
    const bill = estimateFreeAt(
      { ...base, firstOrderAt: new Date(at(20, 8)), billRequestedAt: new Date(at(20, 25)) },
      stats,
      policy,
      now,
    );
    expect(seated.basis).toBe("seated");
    expect(bill.basis).toBe("bill");
    expect(bill.confidence).toBe("high");
    expect(bill.high.getTime() - bill.low.getTime()).toBeLessThan(
      seated.high.getTime() - seated.low.getTime(),
    );
    expect(bill.readyAt.getTime() - bill.freeAt.getTime()).toBe(10 * MIN);
  });

  it("lets staff override the estimate", () => {
    const e = estimateFreeAt(
      {
        partySize: 2,
        seatedAt: new Date(at(20)),
        firstOrderAt: null,
        allServed: false,
        billRequestedAt: null,
        paidAt: null,
        freeAtOverride: new Date(at(21, 15)),
        cctvEmptySince: null,
      },
      stats,
      policy,
      new Date(at(20, 30)),
    );
    expect(e.basis).toBe("staff");
    expect(e.freeAt.getTime()).toBe(at(21, 15));
  });

  it("flags tables that overstay instead of predicting the past", () => {
    const now = new Date(at(23));
    const e = estimateFreeAt(
      {
        partySize: 4,
        seatedAt: new Date(at(20)),
        firstOrderAt: new Date(at(20, 10)),
        allServed: true,
        billRequestedAt: null,
        paidAt: null,
        freeAtOverride: null,
        cctvEmptySince: null,
      },
      stats,
      policy,
      now,
    );
    expect(e.overdueMins).toBeGreaterThan(60);
    expect(e.freeAt.getTime()).toBeGreaterThan(now.getTime());
  });
});

describe("table state machine", () => {
  const now = new Date(at(20));
  it("derives each status from the stored facts", () => {
    const base = { openBillRequest: false, held: false, lastCleanedAt: null, now };
    const open = { leftAt: null, cleanedAt: null, billRequestedAt: null, paidAt: null };
    expect(deriveTableStatus({ ...base, session: null })).toBe("AVAILABLE");
    expect(deriveTableStatus({ ...base, session: open })).toBe("OCCUPIED");
    expect(deriveTableStatus({ ...base, session: open, openBillRequest: true })).toBe("BILL");
    expect(deriveTableStatus({ ...base, session: { ...open, leftAt: now } })).toBe("CLEANING");
    expect(deriveTableStatus({ ...base, session: null, held: true })).toBe("RESERVED");
    expect(deriveTableStatus({ ...base, session: null, lastCleanedAt: new Date(at(19, 55)) })).toBe(
      "READY",
    );
  });

  it("holds a booking from the hold window until grace or the late time", () => {
    const r = { startAt: new Date(at(20, 30)), lateUntil: null, status: "CONFIRMED" };
    expect(isHeld(r, new Date(at(19, 55)), 30, 15)).toBe(false);
    expect(isHeld(r, new Date(at(20, 0)), 30, 15)).toBe(true);
    expect(isHeld(r, new Date(at(20, 46)), 30, 15)).toBe(false);
    expect(isHeld({ ...r, lateUntil: new Date(at(21)) }, new Date(at(21, 10)), 30, 15)).toBe(true);
  });

  it("only offers moves that make sense", () => {
    expect(allowedTransitions("AVAILABLE")).toEqual(["SEAT"]);
    expect(allowedTransitions("BILL")).toEqual(["LEFT"]);
    expect(allowedTransitions("CLEANING")).toContain("CLEANED");
  });
});

describe("waiting list", () => {
  it("serves the queue in order on the earliest table that fits", () => {
    const now = at(20);
    const etas = waitlistEtas(
      [
        { id: "T1", seats: 2, minParty: 1, readyAt: at(20, 20), blocks: [] },
        { id: "T5", seats: 4, minParty: 1, readyAt: at(20, 40), blocks: [] },
      ],
      [
        { id: "a", partySize: 2 },
        { id: "b", partySize: 2 },
        { id: "c", partySize: 4 },
        { id: "d", partySize: 9 },
      ],
      () => 60 * MIN,
      10 * MIN,
      now,
    );
    expect(etas.get("a")).toEqual({ at: at(20, 20), tableId: "T1" });
    expect(etas.get("b")).toEqual({ at: at(20, 40), tableId: "T5" });
    // c waits for T5 to come round again after b's meal and cleaning.
    expect(etas.get("c")).toEqual({ at: at(21, 50), tableId: "T5" });
    expect(etas.get("d")).toBeNull();
  });

  it("won't seat a walk-in where a booking is about to arrive", () => {
    const etas = waitlistEtas(
      [
        {
          id: "T1",
          seats: 2,
          minParty: 1,
          readyAt: at(20),
          blocks: [{ start: at(20, 30), end: at(22) }],
        },
      ],
      [{ id: "a", partySize: 2 }],
      () => 60 * MIN,
      10 * MIN,
      at(20),
    );
    expect(etas.get("a")).toEqual({ at: at(22), tableId: "T1" });
  });
});

describe("guest phone numbers", () => {
  it.each([
    ["0300 1234567", "+923001234567"],
    ["300-1234567", "+923001234567"],
    ["+92 300 1234567", "+923001234567"],
    ["0092 300 1234567", "+923001234567"],
    ["923001234567", "+923001234567"],
    ["+44 7700 900123", "+447700900123"],
  ])("normalises %s", (input, out) => {
    expect(normalisePhone(input)).toBe(out);
  });

  it("rejects landlines and junk", () => {
    expect(normalisePhone("051 1234567")).toBeNull();
    expect(normalisePhone("hello")).toBeNull();
  });

  it("masks numbers for screens that don't need them", () => {
    expect(maskPhone("+923001234567")).toBe("+92 300 ••• 4567");
  });
});
