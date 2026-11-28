import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, clientIp } from "@/lib/security";
import { requestService, tableByCode } from "@/lib/ordering";
import { badRequest, notFound } from "@/lib/reservations/http";

type Params = { params: Promise<{ code: string }> };

const schema = z.object({ type: z.enum(["BILL", "WAITER"]) });

export async function POST(req: Request, { params }: Params) {
  if (!(await rateLimit(`qr-service:${clientIp(req)}`, 10, 60_000))) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const table = await tableByCode((await params).code);
  if (!table) return notFound("This table code isn't valid.");
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest();
  const res = await requestService({
    restaurantId: table.restaurantId,
    tableId: table.id,
    type: parsed.data.type,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 409 });
  return NextResponse.json({ ok: true });
}
