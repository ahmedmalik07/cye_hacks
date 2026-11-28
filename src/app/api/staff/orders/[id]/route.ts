import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireStaff, isErrorResponse, scopedFindOrNotFound } from "@/lib/staffApi";
import { badRequest } from "@/lib/reservations/http";
import { bumpRevision } from "@/lib/bus";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({ status: z.enum(["PREPARING", "SERVED", "CANCELLED"]) });

/** Move an order along: preparing, served, or cancelled. */
export async function PATCH(req: Request, { params }: Params) {
  const session = await requireStaff();
  if (isErrorResponse(session)) return session;
  const { id } = await params;
  const order = await scopedFindOrNotFound(
    prisma.order,
    { where: { id, restaurantId: session.restaurant.id } },
    "Order not found.",
  );
  if (isErrorResponse(order)) return order;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest();
  await prisma.order.update({ where: { id }, data: { status: parsed.data.status } });
  bumpRevision(session.restaurant.id);
  return NextResponse.json({ ok: true });
}
