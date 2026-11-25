/**
 * On a long-lived Node server (Render, Railway, a VPS), tick the job queue
 * and the no-show sweep in-process every 30 seconds, so the demo works with
 * no outside scheduler. Serverless hosts use /api/cron/tick instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.DISABLE_INPROCESS_TICK === "1") return;
  const { runDueJobs } = await import("./lib/jobs");
  const { sweepAllRestaurants } = await import("./lib/reservations/sweep");
  const { log } = await import("./lib/log");
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await runDueJobs();
      await sweepAllRestaurants();
    } catch (err) {
      log.warn("in-process tick failed", { err: String(err) });
    } finally {
      busy = false;
    }
  }, 30_000).unref?.();
}
