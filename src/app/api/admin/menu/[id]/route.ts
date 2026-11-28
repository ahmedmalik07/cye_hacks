import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ADMIN_ROLES } from "@/lib/auth";
import { requireStaff, isErrorResponse } from "@/lib/staffApi";
import { badRequest } from "@/lib/reservations/http";

type Params = { params: Promise<{ id: string }> };

const patch = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(200).nullable().optional(),
  price: z.number().min(0).max(1_000_000).optional(),
  category: z.string().trim().min(1).max(40).optional(),
  available: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: Params) {
  const session = await requireStaff(ADMIN_ROLES);
  if (isErrorResponse(session)) return session;
  const { id } = await params;
  const parsed = patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest();
  const { price, ...rest } = parsed.data;
  const res = await prisma.menuItem.updateMany({
    where: { id, restaurantId: session.restaurant.id },
    data: { ...rest, ...(price != null ? { priceCents: Math.round(price * 100) } : {}) },
  });
  if (res.count === 0) return NextResponse.json({ error: "Dish not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** Past orders keep the name and price they were placed at. */
export async function DELETE(_req: Request, { params }: Params) {
  const session = await requireStaff(ADMIN_ROLES);
  if (isErrorResponse(session)) return session;
  const { id } = await params;
  const res = await prisma.menuItem.deleteMany({ where: { id, restaurantId: session.restaurant.id } });
  if (res.count === 0) return NextResponse.json({ error: "Dish not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
