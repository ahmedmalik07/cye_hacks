import { prisma } from "./db";

/**
 * The caller's address behind the hosting proxy. The proxy appends the
 * address it saw, so the last entry is the trustworthy one; earlier entries
 * are whatever the client chose to send.
 */
export function clientIp(req: Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",").at(-1)?.trim() || req.headers.get("x-real-ip") || "unknown";
}

/**
 * Fixed-window limit kept in Postgres, so it holds across server instances.
 * True when the call is allowed.
 */
export async function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const windowEnd = new Date(Math.ceil(now / windowMs) * windowMs);
  const row = await prisma.rateLimitHit.upsert({
    where: { key_windowEnd: { key, windowEnd } },
    create: { key, windowEnd },
    update: { count: { increment: 1 } },
  });
  // Old windows are dead weight; trim now and then.
  if (Math.random() < 0.01) {
    await prisma.rateLimitHit.deleteMany({ where: { windowEnd: { lt: new Date(now - 86_400_000) } } });
  }
  return row.count <= max;
}
