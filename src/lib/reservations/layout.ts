/**
 * Where tables stand on the floor plan. Plan units are abstract (a grid of
 * 10); the screen scales the whole room to fit. Tables the manager hasn't
 * placed yet get a tidy automatic spot after the placed ones, so a new
 * restaurant sees a usable plan on day one.
 */

export type Shape = "ROUND" | "SQUARE" | "RECT";
export type PlanBox = { x: number; y: number; w: number; h: number };
export type LayoutInput = {
  id: string;
  seats: number;
  shape?: string | null;
  plan: PlanBox | null;
};
export type Placed = { id: string; shape: Shape; box: PlanBox; auto: boolean };

export const GRID = 10;
const GAP = 50;
const ROW_H = 150;
const MAX_ROW_W = 760;

/** A sensible footprint for a table that hasn't been drawn. */
export function defaultBox(seats: number): { w: number; h: number; shape: Shape } {
  if (seats <= 2) return { w: 70, h: 70, shape: "SQUARE" };
  if (seats <= 4) return { w: 90, h: 90, shape: "SQUARE" };
  if (seats <= 6) return { w: 140, h: 90, shape: "RECT" };
  if (seats <= 8) return { w: 180, h: 90, shape: "RECT" };
  return { w: 220, h: 100, shape: "RECT" };
}

export function asShape(s: string | null | undefined, seats: number): Shape {
  return s === "ROUND" || s === "RECT" || s === "SQUARE" ? s : defaultBox(seats).shape;
}

export function snap(n: number) {
  return Math.round(n / GRID) * GRID;
}

/** Placed tables keep their spot; the rest flow in rows below them. */
export function layoutArea(tables: LayoutInput[]): {
  placed: Placed[];
  width: number;
  height: number;
} {
  const placed: Placed[] = [];
  let bottom = 0;
  for (const t of tables) {
    if (!t.plan) continue;
    const box = { x: t.plan.x, y: t.plan.y, w: t.plan.w, h: t.plan.h };
    placed.push({ id: t.id, shape: asShape(t.shape, t.seats), box, auto: false });
    bottom = Math.max(bottom, box.y + box.h);
  }
  let x = GAP;
  let y = placed.length ? bottom + GAP : GAP;
  let rowH = 0;
  for (const t of tables) {
    if (t.plan) continue;
    const d = defaultBox(t.seats);
    // A drawn shape without a size still uses the default footprint.
    const shape = t.shape && t.shape !== "SQUARE" ? asShape(t.shape, t.seats) : d.shape;
    if (x + d.w > MAX_ROW_W && x > GAP) {
      x = GAP;
      y += Math.max(rowH, ROW_H - GAP) + GAP;
      rowH = 0;
    }
    placed.push({
      id: t.id,
      shape,
      box: { x, y: y + Math.round((ROW_H - GAP - d.h) / 2), w: d.w, h: d.h },
      auto: true,
    });
    x += d.w + GAP;
    rowH = Math.max(rowH, ROW_H - GAP);
  }
  const width = Math.max(...placed.map((p) => p.box.x + p.box.w), 200) + GAP;
  const height = Math.max(...placed.map((p) => p.box.y + p.box.h), 100) + GAP;
  return { placed, width, height };
}

// ---------------------------------------------------------------------------
// Chairs around a table, for drawing the room
// ---------------------------------------------------------------------------

export type Chair = { x: number; y: number; angle: number };

/** Gap between a table's edge and the middle of its chairs. */
const CHAIR_OFFSET = 11;

/**
 * Where each chair sits around a table, relative to the table's top-left.
 * Round tables share the circle evenly; square and long tables give each
 * side chairs in proportion to its length, so a long table seats along its
 * sides with one at each end, the way restaurants set them. `angle` is the
 * direction the chair faces (towards the table), in degrees.
 */
export function chairsFor(shape: Shape, w: number, h: number, seats: number): Chair[] {
  const n = Math.max(0, Math.min(seats, 30));
  if (n === 0) return [];
  if (shape === "ROUND") {
    const rx = w / 2 + CHAIR_OFFSET;
    const ry = h / 2 + CHAIR_OFFSET;
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      return {
        x: w / 2 + Math.cos(a) * rx,
        y: h / 2 + Math.sin(a) * ry,
        angle: (a * 180) / Math.PI + 90,
      };
    });
  }
  // Sides in order: top, right, bottom, left.
  const lengths = [w, h, w, h];
  let counts: number[];
  if (n === 1) counts = [0, 0, 1, 0];
  else if (n === 2) counts = w >= h ? [1, 0, 1, 0] : [0, 1, 0, 1];
  else {
    const total = lengths.reduce((a, b) => a + b, 0);
    const exact = lengths.map((l) => (l / total) * n);
    counts = exact.map(Math.floor);
    let left = n - counts.reduce((a, b) => a + b, 0);
    const order = exact
      .map((e, i) => ({ i, r: e - Math.floor(e) }))
      .sort((a, b) => b.r - a.r || a.i - b.i);
    for (const { i } of order) {
      if (left <= 0) break;
      counts[i]++;
      left--;
    }
  }
  const out: Chair[] = [];
  for (const f of spread(counts[0])) out.push({ x: f * w, y: -CHAIR_OFFSET, angle: 180 });
  for (const f of spread(counts[1])) out.push({ x: w + CHAIR_OFFSET, y: f * h, angle: 270 });
  for (const f of spread(counts[2])) out.push({ x: (1 - f) * w, y: h + CHAIR_OFFSET, angle: 0 });
  for (const f of spread(counts[3])) out.push({ x: -CHAIR_OFFSET, y: (1 - f) * h, angle: 90 });
  return out;
}

function spread(k: number) {
  return Array.from({ length: k }, (_, i) => (i + 0.5) / k);
}

// ---------------------------------------------------------------------------
// The room around the tables
// ---------------------------------------------------------------------------

export const FIXTURE_KINDS = [
  "WALL",
  "DOOR",
  "WINDOW",
  "COUNTER",
  "KITCHEN",
  "PLANT",
  "PILLAR",
  "WASHROOM",
] as const;
export type FixtureKind = (typeof FIXTURE_KINDS)[number];
export type Fixture = {
  id: string;
  area: string;
  kind: FixtureKind;
  x: number;
  y: number;
  w: number;
  h: number;
};

/** A new fixture's size, the way it usually looks in a room. */
export const FIXTURE_SIZE: Record<FixtureKind, { w: number; h: number }> = {
  WALL: { w: 200, h: 12 },
  DOOR: { w: 70, h: 12 },
  WINDOW: { w: 120, h: 10 },
  COUNTER: { w: 180, h: 50 },
  KITCHEN: { w: 200, h: 110 },
  PLANT: { w: 34, h: 34 },
  PILLAR: { w: 30, h: 30 },
  WASHROOM: { w: 90, h: 80 },
};

/** Stored fixtures, made safe: anything malformed is dropped. */
export function parseFixtures(raw: unknown): Fixture[] {
  if (!Array.isArray(raw)) return [];
  const out: Fixture[] = [];
  for (const item of raw.slice(0, 400)) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    const kind = f.kind as FixtureKind;
    if (!FIXTURE_KINDS.includes(kind)) continue;
    if (typeof f.id !== "string" || typeof f.area !== "string") continue;
    const nums = [f.x, f.y, f.w, f.h].map(Number);
    if (nums.some((v) => !Number.isFinite(v))) continue;
    const [x, y, w, h] = nums;
    out.push({
      id: f.id.slice(0, 40),
      area: f.area.slice(0, 40),
      kind,
      x: clampN(x, 0, 2000),
      y: clampN(y, 0, 2000),
      w: clampN(w, 6, 1000),
      h: clampN(h, 6, 1000),
    });
  }
  return out;
}

function clampN(n: number, lo: number, hi: number) {
  return Math.round(Math.min(hi, Math.max(lo, n)));
}

/** The room's drawing size: every table with its chairs, and every fixture. */
export function roomSize(placed: Placed[], fixtures: Fixture[]) {
  const right = [
    ...placed.map((p) => p.box.x + p.box.w + CHAIR_OFFSET + 10),
    ...fixtures.map((f) => f.x + f.w),
  ];
  const bottom = [
    ...placed.map((p) => p.box.y + p.box.h + CHAIR_OFFSET + 10),
    ...fixtures.map((f) => f.y + f.h),
  ];
  return {
    width: Math.max(320, ...right) + 30,
    height: Math.max(200, ...bottom) + 30,
  };
}
