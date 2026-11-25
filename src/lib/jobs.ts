import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { log } from "./log";

/**
 * A small job queue on Postgres for the work that must happen later:
 * reminders before a booking, the no-show sweep after the grace period, and
 * guest messages.
 *
 * - `enqueue` writes a row, deduplicated by key, and nudges this process to
 *   run anything already due.
 * - `/api/cron/tick` runs due jobs and sweeps every restaurant. An external
 *   scheduler (Render cron, GitHub Actions, cron-job.org) calls it every
 *   minute; `instrumentation.ts` also ticks in-process on a long-lived server.
 * - Claims use FOR UPDATE SKIP LOCKED, so two instances never run one job.
 *
 * Handlers are idempotent: a job may run twice if a process dies mid-way.
 */
export type JobPayloads = {
  "guest-message": { messageId: string };
  "reservation-reminder": { reservationId: string };
  "reservation-sweep": { restaurantId: string };
};
export type JobKind = keyof JobPayloads;

const MAX_ATTEMPTS = 5;
const STALE_LOCK_MS = 10 * 60_000;

// Imported lazily: the reservation modules enqueue jobs themselves.
const handlers: { [K in JobKind]: (p: JobPayloads[K]) => Promise<void> } = {
  async "guest-message"(p) {
    const { deliverGuestMessage } = await import("./reservations/messages");
    await deliverGuestMessage(p.messageId);
  },
  async "reservation-reminder"(p) {
    const { sendReminder } = await import("./reservations/service");
    await sendReminder(p.reservationId);
  },
  async "reservation-sweep"(p) {
    const { sweepRestaurant } = await import("./reservations/sweep");
    await sweepRestaurant(p.restaurantId, { force: true });
  },
};

export async function enqueue<K extends JobKind>(
  name: K,
  payload: JobPayloads[K],
  opts: { runAt?: Date; dedupeKey?: string } = {},
): Promise<void> {
  const runAt = opts.runAt ?? new Date();
  const data = { name, payload: payload as Prisma.InputJsonValue, runAt, dedupeKey: opts.dedupeKey };
  if (opts.dedupeKey) {
    // Same key: keep one job, moved to the latest time asked for.
    await prisma.job.upsert({
      where: { dedupeKey: opts.dedupeKey },
      create: data,
      update: { runAt, payload: data.payload, status: "PENDING", attempts: 0, lastError: null },
    });
  } else {
    await prisma.job.create({ data });
  }
  if (runAt.getTime() <= Date.now() + 1000) {
    setTimeout(() => void runDueJobs().catch(() => {}), 50);
  }
}

/** Claim and run every job that is due. Returns how many ran. */
export async function runDueJobs(limit = 50): Promise<number> {
  const staleBefore = new Date(Date.now() - STALE_LOCK_MS);
  const claimed = await prisma.$queryRaw<{ id: string; name: string; payload: unknown; attempts: number }[]>`
    UPDATE "Job" SET "status" = 'RUNNING', "lockedAt" = now(), "attempts" = "attempts" + 1, "updatedAt" = now()
    WHERE "id" IN (
      SELECT "id" FROM "Job"
      WHERE ("status" = 'PENDING' AND "runAt" <= now())
         OR ("status" = 'RUNNING' AND "lockedAt" < ${staleBefore})
      ORDER BY "runAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "name", "payload", "attempts"`;
  for (const job of claimed) {
    const handler = handlers[job.name as JobKind] as ((p: unknown) => Promise<void>) | undefined;
    try {
      if (!handler) throw new Error(`no handler for ${job.name}`);
      await handler(job.payload);
      await prisma.job.update({ where: { id: job.id }, data: { status: "DONE", lockedAt: null } });
    } catch (err) {
      const failed = job.attempts >= MAX_ATTEMPTS;
      log.warn("job failed", { id: job.id, name: job.name, attempt: job.attempts, err: String(err) });
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: failed ? "FAILED" : "PENDING",
          lockedAt: null,
          lastError: String(err).slice(0, 500),
          // Back off 30 s, 1 min, 2 min...
          runAt: new Date(Date.now() + 30_000 * 2 ** (job.attempts - 1)),
        },
      });
    }
  }
  return claimed.length;
}
