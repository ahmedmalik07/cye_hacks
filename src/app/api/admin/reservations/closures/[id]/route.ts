import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ADMIN_ROLES } from "@/lib/auth";
import { requireStaff, isErrorResponse } from "@/lib/staffApi";
import { logAudit } from "@/lib/audit";
import { bumpRevision } from "@/lib/bus";

type Params = { params: Promise<{ id: string }> };

/** Reopen a closed day. */
export async function DELETE(_req: Request, { params }: Params) {
  const session = await requireStaff(ADMIN_ROLES);
  if (isErrorResponse(session)) return session;
  const { id } = await params;
  const res = await prisma.bookingClosure.deleteMany({
    where: { id, restaurantId: session.restaurant.id },
  });
  if (res.count === 0) return NextResponse.json({ error: "Not found." }, { status: 404 });
  await logAudit({
    restaurantId: session.restaurant.id,
    actorId: session.user.id,
    actorName: session.user.name,
    action: "reservations.reopened",
    detail: id,
  });
  bumpRevision(session.restaurant.id);
  return NextResponse.json({ ok: true });
}
