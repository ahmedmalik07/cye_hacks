import { describe, it, expect } from "vitest";
import {
  bookingWindowError,
  dayClosedReason,
  hoursForDay,
  overPacing,
  parseWeekHours,
  policyFrom,
  slotsForDay,
  weekdayOf,
  type PolicyRow,
} from "./policy";
import { defaultBox, layoutArea, snap } from "./layout";
import { cleanTags, guestBadges, ordinal } from "./guests";
import { zonedWallToUtc } from "../zonedTime";

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

// 2026-12-04 is a Friday, 2026-12-06 a Sunday.
const FRIDAY = "2026-12-04";
const SATURDAY = "2026-12-05";
const SUNDAY = "2026-12-06";
const at = (key: string, hh: number, mm = 0) => {
  const [y, m, d] = key.split("-").map(Number);
  return zonedWallToUtc(y, m, d, hh * 60 + mm, "Asia/Karachi");
};
const NOW = at("2026-12-01", 10);

describe("weekly hours", () => {
  it("reads only well-formed days and ignores the rest", () => {
    const w = parseWeekHours([
      { day: 5, opensAt: "18:00", closesAt: "01:00" },
      { day: 1, closed: true },
      { day: 9, closed: true },
      { day: 2, opensAt: "25:00", closesAt: "23:00" },
      "junk",
    ]);
    expect(w[5]).toEqual({ opensAt: "18:00", closesAt: "01:00" });
    expect(w[1]).toBeNull();
    expect(w[2]).toBeUndefined();
    expect(w.filter((d) => d !== undefined)).toHaveLength(2);
    expect(parseWeekHours(null)).toEqual(Array(7).fill(undefined));
  });

  it("knows the weekday of a local date", () => {
    expect(weekdayOf(FRIDAY)).toBe(5);
    expect(weekdayOf(SUNDAY)).toBe(0);
  });

  it("uses a weekday's own hours, including past midnight", () => {
    const policy = policyFrom({
      ...row,
      bookingWeekHours: [{ day: 5, opensAt: "18:00", closesAt: "01:00" }],
    });
    const fri = slotsForDay(FRIDAY, policy);
    expect(fri[0].key).toBe("18:00");
    expect(fri.at(-1)!.key).toBe("01:00");
    // The 01:00 seating is on Saturday's calendar date but Friday's evening.
    expect(fri.at(-1)!.at.getTime()).toBe(at(SATURDAY, 1).getTime());
    expect(slotsForDay(SATURDAY, policy)[0].key).toBe("12:00");
    // Friday 00:30 after midnight is bookable online.
    expect(bookingWindowError(at(SATURDAY, 0, 30), NOW, policy)).toBeNull();
  });

  it("closes a weekday to guests but not to staff", () => {
    const policy = policyFrom({ ...row, bookingWeekHours: [{ day: 0, closed: true }] });
    expect(slotsForDay(SUNDAY, policy)).toEqual([]);
    expect(dayClosedReason(SUNDAY, policy)).toMatch(/doesn't take bookings/);
    expect(bookingWindowError(at(SUNDAY, 20), NOW, policy)).toMatch(/doesn't take bookings/);
    expect(hoursForDay(SUNDAY, policy, { staff: true })).toEqual({
      opensAt: "12:00",
      closesAt: "23:00",
    });
    expect(bookingWindowError(at(SUNDAY, 20), NOW, policy, { staff: true })).toBeNull();
  });
});

describe("closures", () => {
  it("a closed day takes no bookings from anyone, and says why", () => {
    const policy = policyFrom(row, [{ date: FRIDAY, onlineOnly: false, reason: "Eid ul Adha" }]);
    expect(slotsForDay(FRIDAY, policy)).toEqual([]);
    expect(slotsForDay(FRIDAY, policy, { staff: true })).toEqual([]);
    expect(bookingWindowError(at(FRIDAY, 20), NOW, policy)).toBe("Closed that day: Eid ul Adha.");
    expect(bookingWindowError(at(FRIDAY, 20), NOW, policy, { staff: true })).toBe(
      "Closed that day: Eid ul Adha.",
    );
    expect(bookingWindowError(at(SATURDAY, 20), NOW, policy)).toBeNull();
  });

  it("an online-only closure still lets staff book (a private event)", () => {
    const policy = policyFrom(row, [{ date: FRIDAY, onlineOnly: true, reason: null }]);
    expect(slotsForDay(FRIDAY, policy)).toEqual([]);
    expect(bookingWindowError(at(FRIDAY, 20), NOW, policy)).toMatch(/Online booking is closed/);
    expect(slotsForDay(FRIDAY, policy, { staff: true }).length).toBeGreaterThan(0);
    expect(bookingWindowError(at(FRIDAY, 20), NOW, policy, { staff: true })).toBeNull();
  });

  it("a late seating of the evening before is not caught by the next day's closure", () => {
    const policy = policyFrom({ ...row, bookingClosesAt: "01:00" }, [
      { date: SATURDAY, onlineOnly: false, reason: null },
    ]);
    expect(bookingWindowError(at(SATURDAY, 0, 30), NOW, policy)).toBeNull();
    expect(bookingWindowError(at(SATURDAY, 13), NOW, policy)).toMatch(/closed/);
  });

  it("staff may book months ahead, guests only within the window", () => {
    const policy = policyFrom(row);
    const far = new Date(NOW.getTime() + 120 * 86_400_000);
    expect(bookingWindowError(far, NOW, policy)).toMatch(/30 days ahead/);
    expect(bookingWindowError(far, NOW, policy, { staff: true })).toBeNull();
    const tooFar = new Date(NOW.getTime() + 400 * 86_400_000);
    expect(bookingWindowError(tooFar, NOW, policy, { staff: true })).toMatch(/more than a year/);
  });
});

describe("pacing", () => {
  it("is off at 0 and caps guests starting together otherwise", () => {
    expect(overPacing(100, 8, policyFrom(row))).toBe(false);
    const paced = policyFrom({ ...row, bookingMaxCoversPerSlot: 20 });
    expect(overPacing(12, 8, paced)).toBe(false);
    expect(overPacing(13, 8, paced)).toBe(true);
    expect(overPacing(0, 21, paced)).toBe(true);
  });
});

describe("floor plan layout", () => {
  it("keeps drawn tables where they are and flows the rest below", () => {
    const { placed, width, height } = layoutArea([
      { id: "a", seats: 4, shape: "ROUND", plan: { x: 300, y: 40, w: 90, h: 90 } },
      { id: "b", seats: 2, plan: null },
      { id: "c", seats: 8, plan: null },
    ]);
    const a = placed.find((p) => p.id === "a")!;
    expect(a).toMatchObject({ shape: "ROUND", auto: false, box: { x: 300, y: 40 } });
    const b = placed.find((p) => p.id === "b")!;
    const c = placed.find((p) => p.id === "c")!;
    expect(b.auto && c.auto).toBe(true);
    expect(b.box.y).toBeGreaterThanOrEqual(130);
    expect(c.shape).toBe("RECT");
    expect(width).toBeGreaterThan(a.box.x + a.box.w);
    expect(height).toBeGreaterThan(c.box.y + c.box.h);
  });

  it("never overlaps automatic tables, wrapping into rows", () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      id: `t${i}`,
      seats: (i % 4) * 2 + 2,
      plan: null,
    }));
    const { placed } = layoutArea(many);
    for (const p of placed) {
      for (const q of placed) {
        if (p === q) continue;
        const overlap =
          p.box.x < q.box.x + q.box.w &&
          q.box.x < p.box.x + p.box.w &&
          p.box.y < q.box.y + q.box.h &&
          q.box.y < p.box.y + p.box.h;
        expect(overlap, `${p.id} overlaps ${q.id}`).toBe(false);
      }
    }
    expect(new Set(placed.map((p) => p.box.y)).size).toBeGreaterThan(1);
  });

  it("sizes tables by seats and snaps to the grid", () => {
    expect(defaultBox(2).w).toBeLessThan(defaultBox(4).w);
    expect(defaultBox(10).shape).toBe("RECT");
    expect(snap(47)).toBe(50);
    expect(snap(44)).toBe(40);
  });
});

describe("guest profiles", () => {
  const base = {
    vip: false,
    tags: [] as string[],
    allergies: null as string | null,
    birthday: null as string | null,
    visits: 0,
    noShows: 0,
    cancellations: 0,
  };

  it("labels a first visit and counts later ones", () => {
    expect(guestBadges(base).map((b) => b.label)).toEqual(["First visit"]);
    expect(guestBadges({ ...base, visits: 3 }).map((b) => b.label)).toEqual(["4th visit"]);
  });

  it("puts what matters first: VIP, allergy, no-shows, birthday", () => {
    const labels = guestBadges(
      {
        ...base,
        vip: true,
        allergies: "peanuts",
        noShows: 2,
        birthday: "12-04",
        visits: 10,
        tags: ["VIP", "Corporate"],
      },
      FRIDAY,
    ).map((b) => b.label);
    expect(labels).toEqual([
      "VIP",
      "Allergy",
      "2 no-shows",
      "Birthday today",
      "11th visit",
      "Corporate",
    ]);
  });

  it("cleans tags: trims, dedupes case-insensitively, caps length and count", () => {
    expect(cleanTags(["  Birthday ", "birthday", "", "High   chair", "x".repeat(40)])).toEqual([
      "Birthday",
      "High chair",
      "x".repeat(30),
    ]);
    expect(cleanTags(Array.from({ length: 20 }, (_, i) => `t${i}`))).toHaveLength(12);
  });

  it("writes ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "101st",
      "111th",
    ]);
  });
});
