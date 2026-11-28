import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStaff, isErrorResponse } from "@/lib/staffApi";

/** Orders still in flight, oldest first, and the open bill and waiter requests. */
export async function GET() {
  const session = await requireStaff();
  if (isErrorResponse(session)) return session;
  const restaurantId = session.restaurant.id;
  const [orders, requests] = await Promise.all([
    prisma.order.findMany({
      where: { restaurantId, status: { in: ["NEW", "PREPARING"] } },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: {
        id: true,
        status: true,
        totalCents: true,
        note: true,
        createdAt: true,
        table: { select: { name: true } },
        items: { select: { name: true, qty: true } },
      },
    }),
    prisma.serviceRequest.findMany({
      where: { restaurantId, open: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, type: true, createdAt: true, table: { select: { name: true } } },
    }),
  ]);
  return NextResponse.json({ orders, requests, currency: session.restaurant.currency });
}
