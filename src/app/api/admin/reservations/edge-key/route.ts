import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { requireStaff, isErrorResponse } from "@/lib/staffApi";
import { logAudit } from "@/lib/audit";

/**
 * Issue (or rotate) the key the on-site edge box uses to report table
 * occupancy. Owner only. Only its hash is stored; the key is shown once.
 */
export async function POST() {
  const session = await requireStaff(["OWNER"]);
  if (isErrorResponse(session)) return session;
  const key = `dle_${randomBytes(24).toString("base64url")}`;
  await prisma.restaurant.update({
    where: { id: session.restaurant.id },
    data: { edgeKeyHash: createHash("sha256").update(key).digest("hex") },
  });
  await logAudit({
    restaurantId: session.restaurant.id,
    actorId: session.user.id,
    actorName: session.user.name,
    action: "settings.edge_key_rotated",
  });
  return NextResponse.json({ ok: true, key, restaurantId: session.restaurant.id });
}

export async function DELETE() {
  const session = await requireStaff(["OWNER"]);
  if (isErrorResponse(session)) return session;
  await prisma.restaurant.update({
    where: { id: session.restaurant.id },
    data: { edgeKeyHash: null },
  });
  await logAudit({
    restaurantId: session.restaurant.id,
    actorId: session.user.id,
    actorName: session.user.name,
    action: "settings.edge_key_revoked",
  });
  return NextResponse.json({ ok: true });
}
