import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireStaff, isErrorResponse, scopedFindOrNotFound } from "@/lib/staffApi";
import {
  cancelReservation,
  markArrived,
  markNoShow,
  reallocateReservation,
  seatReservation,
  updateReservationDetails,
} from "@/lib/reservations/service";
import { bookEntry } from "@/lib/reservations/book";
import { normalisePhone } from "@/lib/reservations/guest";
import { badRequest, failureResponse } from "@/lib/reservations/http";
import { logAudit } from "@/lib/audit";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("seat"), tableIds: z.array(z.string().min(1)).max(4).optional() }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("no_show") }),
  z.object({ action: z.literal("arrived"), arrived: z.boolean() }),
  z.object({
    action: z.literal("details"),
    customerName: z.string().trim().min(1).max(80).optional(),
    // "" removes the number.
    customerPhone: z.string().trim().max(30).optional(),
    childCount: z.number().int().min(0).max(30).optional(),
    note: z.string().trim().max(300).nullable().optional(),
    staffNote: z.string().trim().max(500).nullable().optional(),
    tags: z.array(z.string().trim().max(30)).max(12).optional(),
  }),
  // Move: new tables, time or party size. Omitted fields stay as they are;
  // with nothing given, the engine finds the best other table.
  z.object({
    action: z.literal("move"),
    tableIds: z.array(z.string().min(1)).max(4).optional(),
    startAt: z.string().datetime({ offset: true }).optional(),
    partySize: z.number().int().min(1).max(60).optional(),
    durationMins: z.number().int().min(15).max(480).optional(),
    avoidCurrent: z.boolean().optional(),
    // Keep the current tables if they're still free at the new time.
    keepTables: z.boolean().optional(),
  }),
]);

type Params = { params: Promise<{ id: string }> };

/**
 * One booking with its guest profile. The full number is only here (not in
 * lists), so the host can call or WhatsApp the guest from the booking.
 */
export async function GET(_req: Request, { params }: Params) {
  const session = await requireStaff();
  if (isErrorResponse(session)) return session;
  const { id } = await params;
  const found = await bookEntry(session.restaurant.id, id);
  if (!found) return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  return NextResponse.json({ reservation: found.entry, phone: found.phoneFull });
}

export async function PATCH(req: Request, { params }: Params) {
  const session = await requireStaff();
  if (isErrorResponse(session)) return session;
  const { id } = await params;
  const reservation = await scopedFindOrNotFound(
    prisma.reservation,
    {
      where: { id, restaurantId: session.restaurant.id },
      include: { tables: { where: { active: true }, select: { tableId: true } } },
    },
    "Booking not found.",
  );
  if (isErrorResponse(reservation)) return reservation;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid update.");
  const actor = { id: session.user.id, name: session.user.name };
  const restaurantId = session.restaurant.id;
  const body = parsed.data;

  if (body.action === "seat") {
    const res = await seatReservation({
      restaurantId,
      reservationId: id,
      tableIds: body.tableIds,
      actor,
    });
    return res.ok ? NextResponse.json(res) : failureResponse(res);
  }
  if (body.action === "cancel") {
    const res = await cancelReservation({ restaurantId, reservationId: id, by: "STAFF", actor });
    return res.ok ? NextResponse.json(res) : failureResponse(res);
  }
  if (body.action === "arrived") {
    const res = await markArrived({ restaurantId, reservationId: id, arrived: body.arrived });
    return res.ok ? NextResponse.json(res) : failureResponse(res);
  }
  if (body.action === "details") {
    const { customerPhone, ...withAction } = body;
    const { action, ...rest } = withAction;
    void action;
    let phone: string | null | undefined = undefined;
    if (customerPhone !== undefined) {
      phone = customerPhone === "" ? null : normalisePhone(customerPhone);
      if (phone === null && customerPhone !== "") {
        return badRequest("That phone number doesn't look right.");
      }
    }
    const res = await updateReservationDetails({
      restaurantId,
      reservationId: id,
      details: { ...rest, ...(phone !== undefined ? { customerPhone: phone } : {}) },
      actor,
    });
    return res.ok ? NextResponse.json(res) : failureResponse(res);
  }
  if (body.action === "no_show") {
    const res = await markNoShow({ restaurantId, reservationId: id, actor });
    return res.ok ? NextResponse.json(res) : failureResponse(res);
  }
  const res = await reallocateReservation({
    restaurantId,
    reservationId: id,
    tableIds: body.tableIds,
    startAt: body.startAt ? new Date(body.startAt) : undefined,
    partySize: body.partySize,
    durationMins: body.durationMins,
    keepTables: body.keepTables,
    excludeTableIds: body.avoidCurrent
      ? (reservation as unknown as { tables: { tableId: string }[] }).tables.map((t) => t.tableId)
      : undefined,
    staff: true,
  });
  if (!res.ok) return failureResponse(res);
  await logAudit({
    restaurantId,
    actorId: actor.id,
    actorName: actor.name,
    action: "reservation.moved",
    detail: `${reservation.customerName} → ${res.tableNames.join(" + ")}`,
  });
  return NextResponse.json(res);
}
