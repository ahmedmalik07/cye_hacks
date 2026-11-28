import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStaff, isErrorResponse } from "@/lib/staffApi";
import { bumpRevision } from "@/lib/bus";

type Params = { params: Promise<{ id: string }> };

/** Done: the waiter went over, or the bill was brought. */
export async function DELETE(_req: Request, { params }: Params) {
  const session = await requireStaff();
  if (isErrorResponse(session)) return session;
  const { id } = await params;
  const res = await prisma.serviceRequest.updateMany({
    where: { id, restaurantId: session.restaurant.id, open: true },
    data: { open: false, resolvedAt: new Date() },
  });
  if (res.count === 0) return NextResponse.json({ error: "Request not found." }, { status: 404 });
  bumpRevision(session.restaurant.id);
  return NextResponse.json({ ok: true });
}
