import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ADMIN_ROLES } from "@/lib/auth";
import { requireStaff, isErrorResponse } from "@/lib/staffApi";
import { badRequest } from "@/lib/reservations/http";
import { logAudit } from "@/lib/audit";
import { bumpRevision } from "@/lib/bus";
import { addDaysToKey, parseDateKey, zonedDateKey, zonedWallToUtc } from "@/lib/zonedTime";

/** Upcoming closed days. */
export async function GET() {
  const session = await requireStaff(ADMIN_ROLES);
  if (isErrorResponse(session)) return session;
  const today = zonedDateKey(new Date(), session.restaurant.timeZone);
  const rows = await prisma.bookingClosure.findMany({
    where: { restaurantId: session.restaurant.id, date: { gte: today } },
    orderBy: { date: "asc" },
  });
  return NextResponse.json({
    closures: rows.map((c) => ({
      id: c.id,
      date: c.date,
      reason: c.reason,
      onlineOnly: c.onlineOnly,
    })),
  });
}

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Optional end date for a run of days (Eid, renovation), inclusive.
  until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  reason: z.string().trim().max(80).optional(),
  onlineOnly: z.boolean().default(false),
});

/**
 * Close one day or a run of days. Bookings already on those days stay: the
 * response says how many, so the manager can call those guests.
 */
export async function POST(req: Request) {
  const session = await requireStaff(ADMIN_ROLES);
  if (isErrorResponse(session)) return session;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !parseDateKey(parsed.data.date)) return badRequest("Pick a date.");
  const { date, until, reason, onlineOnly } = parsed.data;
  const end = until && until >= date ? until : date;
  const days: string[] = [];
  for (let d = date; d <= end && days.length < 60; d = addDaysToKey(d, 1)) days.push(d);
  if (until && days.at(-1) !== end) return badRequest("Close at most 60 days at once.");
  const restaurantId = session.restaurant.id;
  for (const d of days) {
    await prisma.bookingClosure.upsert({
      where: { restaurantId_date: { restaurantId, date: d } },
      create: { restaurantId, date: d, reason: reason || null, onlineOnly },
      update: { reason: reason || null, onlineOnly },
    });
  }
  const tz = session.restaurant.timeZone;
  const first = parseDateKey(days[0])!;
  const last = parseDateKey(addDaysToKey(days.at(-1)!, 1))!;
  const affected = await prisma.reservation.count({
    where: {
      restaurantId,
      status: "CONFIRMED",
      startAt: {
        gte: zonedWallToUtc(first.y, first.m, first.d, 0, tz),
        lt: zonedWallToUtc(last.y, last.m, last.d, 0, tz),
      },
    },
  });
  await logAudit({
    restaurantId,
    actorId: session.user.id,
    actorName: session.user.name,
    action: "reservations.closed",
    detail: `${days[0]}${days.length > 1 ? `…${days.at(-1)}` : ""}${onlineOnly ? " (online only)" : ""}${reason ? ` · ${reason}` : ""}`,
  });
  bumpRevision(restaurantId);
  return NextResponse.json({ ok: true, days: days.length, affectedBookings: affected });
}
