import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff, isErrorResponse } from "@/lib/staffApi";
import { joinWaitlist } from "@/lib/reservations/waitlist";
import { normalisePhone } from "@/lib/reservations/guest";
import { badRequest, failureResponse } from "@/lib/reservations/http";

const bodySchema = z.object({
  customerName: z.string().trim().min(1).max(80),
  customerPhone: z.string().trim().max(30).optional(),
  partySize: z.number().int().min(1).max(60),
  note: z.string().trim().max(200).optional(),
});

/** A family at the door with no table free: the host adds them to the queue. */
export async function POST(req: Request) {
  const session = await requireStaff();
  if (isErrorResponse(session)) return session;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Name and party size are needed.");
  let phone: string | null = null;
  if (parsed.data.customerPhone) {
    phone = normalisePhone(parsed.data.customerPhone);
    if (!phone) return badRequest("That phone number doesn't look right.");
  }
  const res = await joinWaitlist({
    restaurantId: session.restaurant.id,
    customerName: parsed.data.customerName,
    customerPhone: phone,
    partySize: parsed.data.partySize,
    note: parsed.data.note,
    source: "DOOR",
    actor: { id: session.user.id, name: session.user.name },
  });
  return res.ok ? NextResponse.json(res) : failureResponse(res);
}
