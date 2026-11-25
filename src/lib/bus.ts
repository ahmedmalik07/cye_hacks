import { prisma } from "./db";
import { log } from "./log";

/**
 * Every change to a restaurant's floor bumps its revision. Screens watch the
 * number (server-sent events, or polling) and refetch when it moves. Kept in
 * Postgres so it works across several server instances.
 */
export function bumpRevision(restaurantId: string) {
  void prisma.floorRevision
    .upsert({
      where: { restaurantId },
      create: { restaurantId, rev: 1 },
      update: { rev: { increment: 1 } },
    })
    .catch((err) => log.warn("revision bump failed", { restaurantId, err: String(err) }));
}

export async function currentRevision(restaurantId: string) {
  const row = await prisma.floorRevision.findUnique({ where: { restaurantId } });
  return row?.rev ?? 0;
}
