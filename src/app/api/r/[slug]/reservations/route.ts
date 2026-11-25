import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, clientIp } from "@/lib/security";
import { bookReservation } from "@/lib/reservations/service";
import { normalisePhone } from "@/lib/reservations/guest";
import { badRequest, failureResponse, notFound, publicRestaurant } from "@/lib/reservations/http";

const bodySchema = z.object({
  customerName: z.string().trim().min(2).max(80),
  customerPhone: z.string().trim().min(7).max(30),
  adults: z.number().int().min(1).max(60),
  children: z.number().int().min(0).max(30).default(0),
  startAt: z.string().datetime({ offset: true }),
  // Empty = "pick the best table for us".
  tableIds: z.array(z.string().min(1)).max(3).optional(),
  area: z.string().trim().max(60).optional(),
  note: z.string().trim().max(300).optional(),
});

type Params = { params: Promise<{ slug: string }> };

/**
 * Book a table, no account. A booking is only ever confirmed with tables
 * actually allocated to it; if none fit, the guest gets nearby times that do,
 * or the waiting list, never an unconfirmed "request".
 */
export async function POST(req: Request, { params }: Params) {
  if (!(await rateLimit(`reserve:${clientIp(req)}`, 6, 60_000))) {
    return NextResponse.json(
      { error: "Too many attempts, please wait a minute and try again." },
      { status: 429 },
    );
  }
  const { slug } = await params;
  const found = await publicRestaurant(slug);
  if (!found) return notFound();
  if (!found.trading) {
    return NextResponse.json(
      { error: "Online booking is unavailable right now. Please call the restaurant." },
      { status: 403 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Check your name, number and party size.");
  const body = parsed.data;
  const phone = normalisePhone(body.customerPhone);
  if (!phone) return badRequest("Enter a WhatsApp number we can reach, e.g. 0300 1234567.");
  if (!(await rateLimit(`reserve-phone:${phone}`, 5, 60 * 60_000))) {
    return NextResponse.json({ error: "Too many bookings from this number." }, { status: 429 });
  }

  const result = await bookReservation({
    restaurantId: found.restaurant.id,
    customerName: body.customerName,
    customerPhone: phone,
    partySize: body.adults + body.children,
    childCount: body.children,
    startAt: new Date(body.startAt),
    note: body.note,
    areaPreference: body.area,
    preferTableIds: body.tableIds,
    source: "ONLINE",
  });
  if (!result.ok) return failureResponse(result);
  const r = result.reservation;
  return NextResponse.json({
    ok: true,
    code: r.code,
    manageToken: r.manageToken,
    startAt: r.startAt.toISOString(),
    tables: r.tableNames,
  });
}
