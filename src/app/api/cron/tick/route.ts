import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runDueJobs } from "@/lib/jobs";
import { sweepAllRestaurants } from "@/lib/reservations/sweep";

export const dynamic = "force-dynamic";

function authorised(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

/**
 * Called every minute by an outside scheduler: runs due jobs (reminders,
 * messages) and sweeps every restaurant (release no-shows, expire waiting
 * list offers). Safe to call twice; everything it does is idempotent.
 */
export async function POST(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  const jobs = await runDueJobs();
  const swept = await sweepAllRestaurants();
  return NextResponse.json({ ok: true, jobs, swept });
}

export const GET = POST;
