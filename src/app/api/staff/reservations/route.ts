import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff, isErrorResponse } from "@/lib/staffApi";
import { bookReservation } from "@/lib/reservations/service";
import { normalisePhone } from "@/lib/reservations/guest";
import { bookForDay, searchBook } from "@/lib/reservations/book";
import { badRequest, failureResponse } from "@/lib/reservations/http";
import { parseDateKey, zonedDateKey } from "@/lib/zonedTime";
import { localToInstant } from "@/lib/reservations/guestAvailability";

/**
 * ?date=YYYY-MM-DD → that local day's bookings, every status, by time, each
 * with the guest's profile. ?q=… → search by name, code or phone digits.
 */
export async function GET(req: Request) {
  const session = await requireStaff();
  if (isErrorResponse(session)) return session;
  const url = new URL(req.url);
  const tz = session.restaurant.timeZone;
  const q = url.searchParams.get("q");
  if (q != null) {
    const today = zonedDateKey(new Date(), tz);
    return NextResponse.json({
      reservations: await searchBook(session.restaurant.id, today, tz, q),
    });
  }
  const date = parseDateKey(url.searchParams.get("date") ?? "");
  if (!date) return badRequest("Pick a date.");
  const rows = await bookForDay(session.restaurant.id, tz, url.searchParams.get("date")!);
  return NextResponse.json({ reservations: rows ?? [] });
}

const bodySchema = z.object({
  customerName: z.string().trim().min(1).max(80),
  customerPhone: z.string().trim().max(30).optional(),
  partySize: z.number().int().min(1).max(60),
  childCount: z.number().int().min(0).max(30).optional(),
  // Either an instant, or the restaurant's local date and time (what the host typed).
  startAt: z.string().datetime({ offset: true }).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  durationMins: z.number().int().min(15).max(480).optional(),
  tableIds: z.array(z.string().min(1)).max(4).optional(),
  area: z.string().trim().max(60).optional(),
  note: z.string().trim().max(300).optional(),
  staffNote: z.string().trim().max(500).optional(),
  tags: z.array(z.string().trim().max(30)).max(12).optional(),
  source: z.enum(["PHONE", "WALK_IN"]).default("PHONE"),
});

/**
 * Staff booking, e.g. a phone call. Same allocation and the same no-overlap
 * guarantee as online; staff may pick the tables, book walk-in-only tables
 * and ignore the online share, but never double-book.
 */
export async function POST(req: Request) {
  const session = await requireStaff();
  if (isErrorResponse(session)) return session;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Check the booking details.");
  const b = parsed.data;
  const startAt = b.startAt
    ? new Date(b.startAt)
    : b.date && b.time
      ? localToInstant(b.date, b.time, session.restaurant.timeZone)
      : null;
  if (!startAt) return badRequest("Pick a date and time.");
  let phone: string | null = null;
  if (b.customerPhone) {
    phone = normalisePhone(b.customerPhone);
    if (!phone) return badRequest("That phone number doesn't look right.");
  }
  const result = await bookReservation({
    restaurantId: session.restaurant.id,
    customerName: b.customerName,
    customerPhone: phone,
    partySize: b.partySize,
    childCount: b.childCount,
    startAt,
    durationMins: b.durationMins,
    note: b.note,
    staffNote: b.staffNote,
    tags: b.tags,
    areaPreference: b.area,
    preferTableIds: b.tableIds,
    source: b.source,
    staff: true,
    actor: { id: session.user.id, name: session.user.name },
  });
  if (!result.ok) return failureResponse(result);
  return NextResponse.json({
    ok: true,
    id: result.reservation.id,
    code: result.reservation.code,
    tables: result.reservation.tableNames,
  });
}
