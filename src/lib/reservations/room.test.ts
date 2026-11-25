import { describe, it, expect } from "vitest";
import { chairsFor, parseFixtures, roomSize, layoutArea } from "./layout";
import {
  projectFloor,
  projectTable,
  type ProjectionBooking,
  type ProjectionTable,
} from "./project";

describe("chairs around a table", () => {
  it("seats a four-top one per side and a two-top face to face", () => {
    const four = chairsFor("SQUARE", 90, 90, 4);
    expect(four).toHaveLength(4);
    expect(new Set(four.map((c) => c.angle))).toEqual(new Set([0, 90, 180, 270]));
    const two = chairsFor("SQUARE", 70, 70, 2);
    expect(two.map((c) => c.angle).sort()).toEqual([0, 180]);
  });

  it("puts most chairs along the long sides of a long table", () => {
    const eight = chairsFor("RECT", 180, 90, 8);
    expect(eight).toHaveLength(8);
    const top = eight.filter((c) => c.angle === 180).length;
    const ends = eight.filter((c) => c.angle === 90 || c.angle === 270).length;
    expect(top).toBe(3);
    expect(ends).toBe(2);
    const ten = chairsFor("RECT", 220, 100, 10);
    expect(ten).toHaveLength(10);
  });

  it("spaces chairs evenly around a round table, all facing in", () => {
    const six = chairsFor("ROUND", 100, 100, 6);
    expect(six).toHaveLength(6);
    for (const c of six) {
      const d = Math.hypot(c.x - 50, c.y - 50);
      expect(d).toBeCloseTo(61, 0);
    }
  });

  it("keeps chairs outside the table top and never more than 30", () => {
    for (const c of chairsFor("RECT", 140, 90, 6)) {
      const inside = c.x > 0 && c.x < 140 && c.y > 0 && c.y < 90;
      expect(inside).toBe(false);
    }
    expect(chairsFor("SQUARE", 90, 90, 99)).toHaveLength(30);
    expect(chairsFor("SQUARE", 90, 90, 0)).toEqual([]);
  });
});

describe("room fixtures", () => {
  it("drops malformed fixtures and clamps sizes", () => {
    const f = parseFixtures([
      { id: "a", area: "Main hall", kind: "DOOR", x: 10, y: -5, w: 70, h: 12 },
      { id: "b", area: "Main hall", kind: "SOFA", x: 0, y: 0, w: 1, h: 1 },
      { id: "c", area: "Main hall", kind: "WALL", x: "x", y: 0, w: 1, h: 1 },
      { id: "d", area: "Main hall", kind: "PLANT", x: 5000, y: 0, w: 2, h: 34 },
      null,
    ]);
    expect(f.map((x) => x.id)).toEqual(["a", "d"]);
    expect(f[0].y).toBe(0);
    expect(f[1]).toMatchObject({ x: 2000, w: 6 });
    expect(parseFixtures("nope")).toEqual([]);
  });

  it("sizes the room to hold every table, chair and fixture", () => {
    const { placed } = layoutArea([{ id: "t", seats: 4, plan: { x: 100, y: 100, w: 90, h: 90 } }]);
    const size = roomSize(placed, [
      { id: "k", area: "A", kind: "KITCHEN", x: 600, y: 400, w: 200, h: 110 },
    ]);
    expect(size.width).toBeGreaterThanOrEqual(800);
    expect(size.height).toBeGreaterThanOrEqual(510);
  });
});

describe("the floor played forward", () => {
  const now = Date.parse("2026-12-04T15:00:00Z");
  const m = (mins: number) => new Date(now + mins * 60_000).toISOString();
  const opts = { holdMins: 30, cleaningMins: 10 };
  const table = (id: string, extra: Partial<ProjectionTable> = {}): ProjectionTable => ({
    id,
    seats: 4,
    status: "AVAILABLE",
    partySize: null,
    leftAt: null,
    estimate: null,
    ...extra,
  });
  const booking = (
    id: string,
    tableIds: string[],
    start: number,
    extra: Partial<ProjectionBooking> = {},
  ) =>
    ({
      id,
      status: "CONFIRMED",
      customerName: `Guest ${id}`,
      partySize: 4,
      startAt: m(start),
      endAt: m(start + 90),
      tables: tableIds.map((t) => ({ id: t })),
      ...extra,
    }) as ProjectionBooking;

  it("keeps a sitting party until their estimate, then cleans, then frees", () => {
    const t = table("T1", {
      status: "OCCUPIED",
      partySize: 3,
      estimate: { freeAt: m(40), readyAt: m(50) },
    });
    expect(projectTable(t, [], now + 30 * 60_000, opts)).toMatchObject({
      kind: "STILL_SEATED",
      party: 3,
    });
    expect(projectTable(t, [], now + 45 * 60_000, opts).kind).toBe("CLEANING");
    expect(projectTable(t, [], now + 55 * 60_000, opts).kind).toBe("FREE");
  });

  it("holds a table before a booking and seats it during", () => {
    const b = booking("A", ["T2"], 120);
    const t = table("T2");
    expect(projectTable(t, [b], now + 60 * 60_000, opts)).toMatchObject({
      kind: "FREE",
      nextName: "Guest A",
    });
    expect(projectTable(t, [b], now + 100 * 60_000, opts).kind).toBe("HELD");
    expect(projectTable(t, [b], now + 150 * 60_000, opts)).toMatchObject({
      kind: "BOOKED",
      party: 4,
    });
    expect(projectTable(t, [b], now + 211 * 60_000, opts).kind).toBe("FREE");
  });

  it("ignores cancelled and no-show bookings", () => {
    const t = table("T3");
    for (const status of ["CANCELLED", "NO_SHOW"] as const) {
      expect(
        projectTable(t, [booking("X", ["T3"], 0, { status })], now + 10 * 60_000, opts).kind,
      ).toBe("FREE");
    }
  });

  it("a party still eating wins over a booking that's due (the clash the host must see)", () => {
    const t = table("T4", {
      status: "OCCUPIED",
      partySize: 2,
      estimate: { freeAt: m(70), readyAt: m(80) },
    });
    expect(projectTable(t, [booking("B", ["T4"], 60)], now + 65 * 60_000, opts).kind).toBe(
      "STILL_SEATED",
    );
  });

  it("counts guests once for pushed-together tables", () => {
    const tables = [
      table("F4"),
      table("F5"),
      table("T1", {
        status: "OCCUPIED",
        partySize: 2,
        estimate: { freeAt: m(200), readyAt: m(210) },
      }),
      table("T9"),
    ];
    const res = projectFloor(
      tables,
      [booking("U", ["F4", "F5"], 30, { partySize: 8 })],
      now + 60 * 60_000,
      opts,
    );
    expect(res.guests).toBe(10);
    expect(res.free).toBe(1);
  });
});
