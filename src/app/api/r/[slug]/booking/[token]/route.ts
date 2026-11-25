import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { rateLimit, clientIp } from "@/lib/security";
import { bumpRevision } from "@/lib/bus";
import { cancelReservation, guestRunningLate } from "@/lib/reservations/service";
import { badRequest, failureResponse, notFound } from "@/lib/reservations/http";

type Params = { params: Promise<{ slug: string; token: string }> };

async function load(slug: string, token: string) {
  if (token.length < 20) return null;
  const r = await prisma.reservation.findUnique({
    where: { manageToken: token },
    include: {
      restaurant: { select: { id: true, slug: true, name: true, timeZone: true, graceMins: true } },
      tables: { where: { active: true }, select: { table: { select: { name: true } } } },
    },
  });
  if (!r || r.restaurant.slug !== slug) return null;
  return r;
}

/** The guest's own booking, reached only through the link we sent them. */
export async function GET(req: Request, { params }: Params) {
  if (!(await rateLimit(`booking-view:${clientIp(req)}`, 60, 60_000))) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const { slug, token } = await params;
  const r = await load(slug, token);
  if (!r) return notFound("Booking not found.");
  return NextResponse.json({
    code: r.code,
    status: r.status,
    customerName: r.customerName,
    partySize: r.partySize,
    childCount: r.childCount,
    startAt: r.startAt.toISOString(),
    lateUntil: r.lateUntil?.toISOString() ?? null,
    guestConfirmed: !!r.guestConfirmedAt,
    tables: r.tables.map((t) => t.table.name),
    graceMins: r.restaurant.graceMins,
  });
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm") }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("late"), minutes: z.number().int().min(5).max(90) }),
]);

export async function PATCH(req: Request, { params }: Params) {
  if (!(await rateLimit(`booking-edit:${clientIp(req)}`, 10, 60_000))) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const { slug, token } = await params;
  const r = await load(slug, token);
  if (!r) return notFound("Booking not found.");
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest();

  if (parsed.data.action === "confirm") {
    if (r.status !== "CONFIRMED") return badRequest("This booking can no longer be changed.");
    await prisma.reservation.update({
      where: { id: r.id },
      data: { guestConfirmedAt: r.guestConfirmedAt ?? new Date() },
    });
    bumpRevision(r.restaurantId);
    return NextResponse.json({ ok: true });
  }
  if (parsed.data.action === "cancel") {
    const res = await cancelReservation({
      restaurantId: r.restaurantId,
      reservationId: r.id,
      by: "GUEST",
    });
    return res.ok ? NextResponse.json({ ok: true }) : failureResponse(res);
  }
  const res = await guestRunningLate({
    restaurantId: r.restaurantId,
    reservationId: r.id,
    minutes: parsed.data.minutes,
  });
  if (!res.ok) return failureResponse(res);
  return NextResponse.json({ ok: true, accepted: res.accepted, until: res.until.toISOString() });
}
