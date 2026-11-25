import { prisma } from "./db";
import { log } from "./log";

/** Who did what, for the owner. Never blocks the action it records. */
export async function logAudit(entry: {
  restaurantId: string;
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  detail?: string | null;
}) {
  try {
    await prisma.auditLog.create({ data: entry });
  } catch (err) {
    log.warn("audit write failed", { action: entry.action, err: String(err) });
  }
}
