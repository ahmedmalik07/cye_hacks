import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireStaff, isErrorResponse } from "@/lib/staffApi";
import { ADMIN_ROLES } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { bumpRevision } from "@/lib/bus";
import { badRequest } from "@/lib/reservations/http";
import { FIXTURE_KINDS } from "@/lib/reservations/layout";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

const schema = z.object({
  policy: z
    .object({
      reservationsEnabled: z.boolean(),
      bookingOpensAt: hhmm,
      bookingClosesAt: hhmm,
      bookingSlotMins: z.union([z.literal(15), z.literal(30), z.literal(60)]),
      bookingLeadMins: z.number().int().min(0).max(1440),
      bookingMaxDaysAhead: z.number().int().min(1).max(90),
      bookingMaxParty: z.number().int().min(1).max(60),
      onlineTablesPct: z.number().int().min(0).max(100),
      defaultDiningMins: z.number().int().min(30).max(300),
      cleaningMins: z.number().int().min(0).max(60),
      graceMins: z.number().int().min(0).max(60),
      autoReleaseNoShows: z.boolean(),
      reminderMinsBefore: z.number().int().min(0).max(1440),
      holdMinsBefore: z.number().int().min(0).max(180),
      waitlistEnabled: z.boolean(),
      waitlistAutoNotify: z.boolean(),
      waitlistReplyMins: z.number().int().min(3).max(60),
      cctvAutoVacate: z.boolean(),
      bookingMaxCoversPerSlot: z.number().int().min(0).max(1000),
    })
    .partial()
    .optional(),
  tables: z
    .array(
      z.object({
        id: z.string().min(1),
        seats: z.number().int().min(1).max(30),
        minParty: z.number().int().min(1).max(30),
        area: z.string().trim().min(1).max(40),
        joinGroup: z.string().trim().max(20).nullable(),
        reservable: z.boolean(),
        sortOrder: z.number().int().min(0).max(999),
      }),
    )
    .max(200)
    .optional(),
  // Per weekday: open/last seating, or closed. Days left out use the defaults.
  weekHours: z
    .array(
      z.union([
        z.object({ day: z.number().int().min(0).max(6), closed: z.literal(true) }),
        z.object({ day: z.number().int().min(0).max(6), opensAt: hhmm, closesAt: hhmm }),
      ]),
    )
    .max(7)
    .nullable()
    .optional(),
  // Floor plan: where each table stands and its shape.
  plan: z
    .array(
      z.object({
        id: z.string().min(1),
        x: z.number().int().min(0).max(2000),
        y: z.number().int().min(0).max(2000),
        w: z.number().int().min(20).max(400),
        h: z.number().int().min(20).max(400),
        shape: z.enum(["ROUND", "SQUARE", "RECT"]),
      }),
    )
    .max(300)
    .optional(),
  // The room around the tables: walls, doors, counter… Replaces the list.
  fixtures: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        area: z.string().trim().min(1).max(40),
        kind: z.enum(FIXTURE_KINDS),
        x: z.number().int().min(0).max(2000),
        y: z.number().int().min(0).max(2000),
        w: z.number().int().min(6).max(1000),
        h: z.number().int().min(6).max(1000),
      }),
    )
    .max(400)
    .optional(),
});

/** Reservation rules and table seating. Owners and managers only. */
export async function PATCH(req: Request) {
  const session = await requireStaff(ADMIN_ROLES);
  if (isErrorResponse(session)) return session;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Check the settings.");
  }
  const restaurantId = session.restaurant.id;
  const { policy, tables, weekHours, plan, fixtures } = parsed.data;
  if (weekHours && new Set(weekHours.map((d) => d.day)).size !== weekHours.length) {
    return badRequest("Each weekday can only be set once.");
  }

  if (tables?.some((t) => t.minParty > t.seats)) {
    return badRequest("A table's minimum party can't be more than its seats.");
  }

  await prisma.$transaction(async (tx) => {
    if (policy && Object.keys(policy).length) {
      await tx.restaurant.update({ where: { id: restaurantId }, data: policy });
    }
    if (weekHours !== undefined) {
      await tx.restaurant.update({
        where: { id: restaurantId },
        data: { bookingWeekHours: weekHours === null ? Prisma.DbNull : weekHours },
      });
    }
    if (fixtures) {
      await tx.restaurant.update({
        where: { id: restaurantId },
        data: { floorFixtures: fixtures },
      });
    }
    for (const p of plan ?? []) {
      await tx.table.updateMany({
        where: { id: p.id, restaurantId },
        data: { planX: p.x, planY: p.y, planW: p.w, planH: p.h, shape: p.shape },
      });
    }
    for (const t of tables ?? []) {
      await tx.table.updateMany({
        where: { id: t.id, restaurantId },
        data: {
          seats: t.seats,
          minParty: t.minParty,
          area: t.area,
          joinGroup: t.joinGroup || null,
          reservable: t.reservable,
          sortOrder: t.sortOrder,
        },
      });
    }
  });

  await logAudit({
    restaurantId,
    actorId: session.user.id,
    actorName: session.user.name,
    action: "settings.reservations",
    detail: [
      policy ? "rules" : null,
      tables ? `${tables.length} tables` : null,
      weekHours !== undefined ? "weekly hours" : null,
      plan ? "floor plan" : null,
      fixtures ? "room" : null,
    ]
      .filter(Boolean)
      .join(", "),
  });
  bumpRevision(restaurantId);
  return NextResponse.json({ ok: true });
}
