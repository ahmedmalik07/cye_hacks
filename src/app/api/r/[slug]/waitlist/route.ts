import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, clientIp } from "@/lib/security";
import { joinWaitlist, quoteWait } from "@/lib/reservations/waitlist";
import { normalisePhone } from "@/lib/reservations/guest";
import { badRequest, failureResponse, notFound, publicRestaurant } from "@/lib/reservations/http";

type Params = { params: Promise<{ slug: string }> };

/** ?party=4 → how many are ahead and roughly how long, before joining. */
export async function GET(req: Request, { params }: Params) {
  if (!(await rateLimit(`wait-quote:${clientIp(req)}`, 30, 60_000))) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const { slug } = await params;
  const found = await publicRestaurant(slug);
  if (!found) return notFound();
  const party = Number(new URL(req.url).searchParams.get("party") ?? "2");
  if (!Number.isInteger(party) || party < 1 || party > 60) return badRequest();
  const quote = await quoteWait(found.restaurant.id, party);
  return NextResponse.json({ ...quote, open: found.restaurant.waitlistEnabled && found.trading });
}

const bodySchema = z.object({
  customerName: z.string().trim().min(2).max(80),
  customerPhone: z.string().trim().min(7).max(30),
  partySize: z.number().int().min(1).max(60),
  note: z.string().trim().max(200).optional(),
});

export async function POST(req: Request, { params }: Params) {
  if (!(await rateLimit(`wait-join:${clientIp(req)}`, 5, 60_000))) {
    return NextResponse.json({ error: "Too many attempts, wait a minute." }, { status: 429 });
  }
  const { slug } = await params;
  const found = await publicRestaurant(slug);
  if (!found) return notFound();
  if (!found.trading) {
    return NextResponse.json(
      { error: "The waiting list is unavailable right now." },
      { status: 403 },
    );
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Check your name, number and party size.");
  const phone = normalisePhone(parsed.data.customerPhone);
  if (!phone) return badRequest("Enter a WhatsApp number we can reach, e.g. 0300 1234567.");

  const result = await joinWaitlist({
    restaurantId: found.restaurant.id,
    customerName: parsed.data.customerName,
    customerPhone: phone,
    partySize: parsed.data.partySize,
    note: parsed.data.note,
    source: "REMOTE",
  });
  if (!result.ok) return failureResponse(result);
  return NextResponse.json({ ok: true, manageToken: result.manageToken, code: result.code });
}
