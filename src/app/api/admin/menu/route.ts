import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ADMIN_ROLES } from "@/lib/auth";
import { requireStaff, isErrorResponse } from "@/lib/staffApi";
import { badRequest } from "@/lib/reservations/http";

const menuSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(200).nullable().optional(),
  price: z.number().min(0).max(1_000_000),
  category: z.string().trim().min(1).max(40).default("Mains"),
  available: z.boolean().default(true),
});

/** Add a dish. Price is in whole currency units; it is stored in cents. */
export async function POST(req: Request) {
  const session = await requireStaff(ADMIN_ROLES);
  if (isErrorResponse(session)) return session;
  const parsed = menuSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Give the dish a name and a price.");
  const d = parsed.data;
  const count = await prisma.menuItem.count({ where: { restaurantId: session.restaurant.id } });
  const item = await prisma.menuItem.create({
    data: {
      restaurantId: session.restaurant.id,
      name: d.name,
      description: d.description || null,
      priceCents: Math.round(d.price * 100),
      category: d.category,
      available: d.available,
      sortOrder: count,
    },
  });
  return NextResponse.json({ ok: true, id: item.id });
}
