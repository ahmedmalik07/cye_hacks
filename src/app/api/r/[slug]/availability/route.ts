import { NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/security";
import { dayAvailability, tablesAt } from "@/lib/reservations/guestAvailability";
import { badRequest, notFound, publicRestaurant } from "@/lib/reservations/http";
import { sweepRestaurant } from "@/lib/reservations/sweep";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * Guest-facing availability, no login.
 *   ?date=YYYY-MM-DD&party=4   → which times that day have a table for 4
 *   ?at=<ISO>&party=4          → the floor map for that time, and our pick
 * Shows only free / booked / occupied, never who booked.
 */
export async function GET(req: Request, { params }: Params) {
  if (!(await rateLimit(`avail:${clientIp(req)}`, 60, 60_000))) {
    return NextResponse.json({ error: "Slow down a little and try again." }, { status: 429 });
  }
  const { slug } = await params;
  const found = await publicRestaurant(slug);
  if (!found) return notFound();
  const { restaurant } = found;
  await sweepRestaurant(restaurant.id).catch(() => {});

  const url = new URL(req.url);
  const party = Number(url.searchParams.get("party") ?? "2");
  if (!Number.isInteger(party) || party < 1 || party > 60)
    return badRequest("Party size is invalid.");

  const at = url.searchParams.get("at");
  if (at) {
    const when = new Date(at);
    if (Number.isNaN(when.getTime())) return badRequest("Pick a time.");
    return NextResponse.json(await tablesAt(restaurant.id, when, party));
  }
  const date = url.searchParams.get("date");
  if (!date) return badRequest("Pick a date.");
  return NextResponse.json(await dayAvailability(restaurant.id, date, party));
}
