import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, clientIp } from "@/lib/security";
import { placeOrder, tableByCode, MAX_QTY } from "@/lib/ordering";
import { badRequest, notFound } from "@/lib/reservations/http";

type Params = { params: Promise<{ code: string }> };

const schema = z.object({
  items: z
    .array(z.object({ id: z.string().min(1).max(40), qty: z.number().int().min(1).max(MAX_QTY) }))
    .min(1)
    .max(30),
  note: z.string().trim().max(200).optional(),
});

export async function POST(req: Request, { params }: Params) {
  if (!(await rateLimit(`qr-order:${clientIp(req)}`, 12, 60_000))) {
    return NextResponse.json({ error: "Too many orders. Wait a minute." }, { status: 429 });
  }
  const { code } = await params;
  if (!(await rateLimit(`qr-order-table:${code.slice(0, 64)}`, 30, 10 * 60_000))) {
    return NextResponse.json({ error: "This table is ordering a lot. Ask a waiter." }, { status: 429 });
  }
  const table = await tableByCode(code);
  if (!table) return notFound("This table code isn't valid.");
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Check your order.");
  const res = await placeOrder({
    restaurantId: table.restaurantId,
    tableId: table.id,
    lines: parsed.data.items,
    note: parsed.data.note,
  });
  if (!res.ok) return badRequest(res.error);
  return NextResponse.json({ ok: true, id: res.id, totalCents: res.totalCents });
}
