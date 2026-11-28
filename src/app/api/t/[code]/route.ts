import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit, clientIp } from "@/lib/security";
import { tableByCode } from "@/lib/ordering";
import { notFound } from "@/lib/reservations/http";

type Params = { params: Promise<{ code: string }> };

/** The menu, and what this table has ordered so far. No sign-in: the code on the table is the key. */
export async function GET(req: Request, { params }: Params) {
  if (!(await rateLimit(`qr-view:${clientIp(req)}`, 90, 60_000))) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const table = await tableByCode((await params).code);
  if (!table) return notFound("This table code isn't valid.");
  const [menu, session, requests] = await Promise.all([
    prisma.menuItem.findMany({
      where: { restaurantId: table.restaurantId },
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, description: true, priceCents: true, category: true, available: true },
    }),
    prisma.tableSession.findFirst({
      where: { tableId: table.id, cleanedAt: null, leftAt: null },
      include: {
        orders: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            status: true,
            totalCents: true,
            createdAt: true,
            items: { select: { name: true, qty: true } },
          },
        },
      },
    }),
    prisma.serviceRequest.findMany({
      where: { tableId: table.id, open: true },
      select: { type: true },
    }),
  ]);
  const orders = (session?.orders ?? []).filter((o) => o.status !== "CANCELLED");
  return NextResponse.json({
    restaurant: { name: table.restaurant.name, currency: table.restaurant.currency },
    table: { name: table.name },
    menu,
    orders,
    totalCents: orders.reduce((n, o) => n + o.totalCents, 0),
    billRequested: !!session?.billRequestedAt,
    waiterCalled: requests.some((r) => r.type === "WAITER"),
  });
}
