import {
  defaultDiningMinsFor,
  partyBucket,
  roundUp,
  type PartyBucket,
  type ReservationPolicy,
} from "./policy";

/**
 * When will an occupied table be free?
 *
 * Not a black box: the restaurant's own closed sessions give, per party size,
 * how long a whole meal takes and how long guests stay after ordering, after
 * asking for the bill, and after paying. A live table is anchored to the
 * latest of those moments it has reached, so the estimate tightens as the
 * meal moves on: a family that has just sat down is a wide guess, one that
 * has paid is a few minutes. Until there are enough meals to learn from, the
 * restaurant's own planning duration stands in, and the estimate says so.
 *
 * An estimate is never availability. A table is only "confirmed" free once
 * staff (or a trusted camera) say the guests left and the table was reset.
 */

export type ClosedSession = {
  partySize: number | null;
  seatedAt: Date;
  firstOrderAt: Date | null;
  billRequestedAt: Date | null;
  paidAt: Date | null;
  leftAt: Date;
};

export type Quantiles = { p25: number; p50: number; p75: number; n: number };

type Stage = "total" | "afterOrder" | "afterBill" | "afterPaid";
export type DiningStats = {
  byBucket: Partial<Record<PartyBucket, Partial<Record<Stage, Quantiles>>>>;
  overall: Partial<Record<Stage, Quantiles>>;
  samples: number;
};

/** Fewer meals than this in a bucket and we fall back to coarser data. */
export const MIN_SAMPLES = 6;
const MIN = 60_000;

function quantiles(values: number[]): Quantiles | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => {
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  };
  return { p25: at(0.25), p50: at(0.5), p75: at(0.75), n: sorted.length };
}

/** Sessions outside 10 min – 6 h are mistakes (forgot to close the table), not meals. */
function plausible(mins: number) {
  return mins >= 10 && mins <= 360;
}

export function buildDiningStats(history: ClosedSession[]): DiningStats {
  const collect = (rows: ClosedSession[]) => {
    const total: number[] = [];
    const afterOrder: number[] = [];
    const afterBill: number[] = [];
    const afterPaid: number[] = [];
    for (const s of rows) {
      const left = s.leftAt.getTime();
      const mins = (left - s.seatedAt.getTime()) / MIN;
      if (!plausible(mins)) continue;
      total.push(mins);
      if (s.firstOrderAt) afterOrder.push(Math.max(0, (left - s.firstOrderAt.getTime()) / MIN));
      if (s.billRequestedAt)
        afterBill.push(Math.max(0, (left - s.billRequestedAt.getTime()) / MIN));
      if (s.paidAt) afterPaid.push(Math.max(0, (left - s.paidAt.getTime()) / MIN));
    }
    const out: Partial<Record<Stage, Quantiles>> = {};
    const put = (k: Stage, v: number[]) => {
      const q = quantiles(v);
      if (q) out[k] = q;
    };
    put("total", total);
    put("afterOrder", afterOrder);
    put("afterBill", afterBill);
    put("afterPaid", afterPaid);
    return { out, n: total.length };
  };

  const overall = collect(history);
  const byBucket: DiningStats["byBucket"] = {};
  for (const bucket of ["S", "M", "L", "XL"] as PartyBucket[]) {
    byBucket[bucket] = collect(history.filter((s) => partyBucket(s.partySize) === bucket)).out;
  }
  return { byBucket, overall: overall.out, samples: overall.n };
}

/** What a stage usually takes before we have the restaurant's own numbers. */
function fallback(stage: Stage, partySize: number, policy: ReservationPolicy): Quantiles {
  const total = defaultDiningMinsFor(partySize, policy);
  const mid =
    stage === "total"
      ? total
      : stage === "afterOrder"
        ? total * 0.75
        : stage === "afterBill"
          ? 15
          : 8;
  return { p25: mid * 0.75, p50: mid, p75: mid * 1.3, n: 0 };
}

export function stageStats(
  stats: DiningStats,
  stage: Stage,
  partySize: number,
  policy: ReservationPolicy,
): { q: Quantiles; learned: boolean } {
  const bucket = stats.byBucket[partyBucket(partySize)]?.[stage];
  if (bucket && bucket.n >= MIN_SAMPLES) return { q: bucket, learned: true };
  const overall = stats.overall[stage];
  if (overall && overall.n >= MIN_SAMPLES) return { q: overall, learned: true };
  return { q: fallback(stage, partySize, policy), learned: false };
}

/** How long to plan a new booking for: the typical meal for that party size. */
export function plannedDiningMins(
  partySize: number,
  stats: DiningStats,
  policy: ReservationPolicy,
): number {
  const { q, learned } = stageStats(stats, "total", partySize, policy);
  if (!learned) return defaultDiningMinsFor(partySize, policy);
  // Median, rounded up to a quarter hour, never shorter than 45 minutes.
  return Math.max(45, Math.min(300, roundUp(q.p50, 15)));
}

export type LiveStage = "SEATED" | "ORDERED" | "EATING" | "BILL" | "PAID";

export type LiveSession = {
  partySize: number | null;
  seatedAt: Date;
  firstOrderAt: Date | null;
  allServed: boolean;
  billRequestedAt: Date | null;
  paidAt: Date | null;
  freeAtOverride: Date | null;
  /** The camera has seen the table empty since this moment. */
  cctvEmptySince: Date | null;
};

export type Estimate = {
  /** Best guess at when guests leave. */
  freeAt: Date;
  low: Date;
  high: Date;
  /** freeAt plus cleaning: when the next party could sit. */
  readyAt: Date;
  /** Conservative ready time (high + cleaning), used before promising a table. */
  readyAtSafe: Date;
  stage: LiveStage;
  basis: "staff" | "camera" | "paid" | "bill" | "order" | "seated";
  confidence: "high" | "medium" | "low";
  /** True while the restaurant has too little history and planning defaults are used. */
  learning: boolean;
  /** Minutes past the estimate the table already is (overstaying), else 0. */
  overdueMins: number;
};

export function liveStage(s: LiveSession): LiveStage {
  if (s.paidAt) return "PAID";
  if (s.billRequestedAt) return "BILL";
  if (s.firstOrderAt) return s.allServed ? "EATING" : "ORDERED";
  return "SEATED";
}

export function estimateFreeAt(
  s: LiveSession,
  stats: DiningStats,
  policy: ReservationPolicy,
  now: Date,
): Estimate {
  const party = s.partySize ?? 3;
  const stage = liveStage(s);
  const cleaning = policy.cleaningMins * MIN;
  const build = (
    at: number,
    low: number,
    high: number,
    basis: Estimate["basis"],
    confidence: Estimate["confidence"],
    learning: boolean,
  ): Estimate => {
    const nowMs = now.getTime();
    // Already past the estimate: they're lingering. Keep the estimate a few
    // minutes ahead rather than in the past, and report by how much.
    const overdueMins = at < nowMs ? Math.round((nowMs - at) / MIN) : 0;
    const spread = Math.max(5 * MIN, high - at);
    if (at < nowMs) {
      at = nowMs + 5 * MIN;
      low = nowMs;
      high = Math.max(high, at + spread);
    }
    low = Math.max(low, nowMs);
    high = Math.max(high, at);
    return {
      freeAt: new Date(at),
      low: new Date(low),
      high: new Date(high),
      readyAt: new Date(at + cleaning),
      readyAtSafe: new Date(high + cleaning),
      stage,
      basis,
      confidence,
      learning,
      overdueMins,
    };
  };

  if (s.freeAtOverride) {
    const t = s.freeAtOverride.getTime();
    return build(t, t, t, "staff", "high", false);
  }
  if (s.cctvEmptySince && now.getTime() - s.cctvEmptySince.getTime() >= 2 * MIN) {
    const t = now.getTime() + 2 * MIN;
    return build(t, now.getTime(), t + 3 * MIN, "camera", "medium", false);
  }

  const anchor: { at: Date; stage: Stage; basis: Estimate["basis"]; conf: Estimate["confidence"] } =
    s.paidAt
      ? { at: s.paidAt, stage: "afterPaid", basis: "paid", conf: "high" }
      : s.billRequestedAt
        ? { at: s.billRequestedAt, stage: "afterBill", basis: "bill", conf: "high" }
        : s.firstOrderAt
          ? { at: s.firstOrderAt, stage: "afterOrder", basis: "order", conf: "medium" }
          : { at: s.seatedAt, stage: "total", basis: "seated", conf: "low" };

  const { q, learned } = stageStats(stats, anchor.stage, party, policy);
  const base = anchor.at.getTime();
  const confidence: Estimate["confidence"] = learned
    ? anchor.conf
    : anchor.conf === "high"
      ? "medium"
      : "low";
  return build(
    base + q.p50 * MIN,
    base + q.p25 * MIN,
    base + q.p75 * MIN,
    anchor.basis,
    confidence,
    !learned,
  );
}
