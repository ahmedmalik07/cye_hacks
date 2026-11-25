import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireStaff, isErrorResponse, scopedFindOrNotFound } from "@/lib/staffApi";
import { seatTable, tableAction } from "@/lib/reservations/service";
import { failureResponse, badRequest } from "@/lib/reservations/http";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("SEAT"),
    partySize: z.number().int().min(1).max(60),
    waitlistEntryId: z.string().min(1).optional(),
    force: z.boolean().optional(),
  }),
  z.object({ action: z.literal("ORDERED") }),
  z.object({ action: z.literal("BILL") }),
  // The bill total is optional; it feeds spend-per-cover in insights.
  z.object({
    action: z.literal("PAID"),
    billCents: z.number().int().min(0).max(100_000_000).optional(),
  }),
  z.object({ action: z.literal("LEFT") }),
  z.object({ action: z.literal("CLEANED") }),
  // Staff override of the estimate; null clears it.
  z.object({
    action: z.literal("ESTIMATE"),
    freeAt: z.string().datetime({ offset: true }).nullable(),
  }),
]);

type Params = { params: Promise<{ id: string }> };

/** Move a table along its state machine by hand. Any staff role. */
export async function POST(req: Request, { params }: Params) {
  const session = await requireStaff();
  if (isErrorResponse(session)) return session;
  const { id } = await params;
  const table = await scopedFindOrNotFound(
    prisma.table,
    { where: { id, restaurantId: session.restaurant.id, active: true } },
    "Table not found.",
  );
  if (isErrorResponse(table)) return table;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid table action.");
  const actor = { id: session.user.id, name: session.user.name };
  const body = parsed.data;

  if (body.action === "SEAT") {
    if (body.waitlistEntryId) {
      const entry = await scopedFindOrNotFound(
        prisma.waitlistEntry,
        {
          where: {
            id: body.waitlistEntryId,
            restaurantId: session.restaurant.id,
            status: { in: ["WAITING", "NOTIFIED"] },
          },
        },
        "That party is no longer waiting.",
      );
      if (isErrorResponse(entry)) return entry;
    }
    const res = await seatTable({
      restaurantId: session.restaurant.id,
      tableId: table.id,
      partySize: body.partySize,
      source: body.waitlistEntryId ? "WAITLIST" : "WALK_IN",
      waitlistEntryId: body.waitlistEntryId,
      force: body.force,
      actor,
    });
    return res.ok ? NextResponse.json(res) : failureResponse(res);
  }

  const res = await tableAction({
    restaurantId: session.restaurant.id,
    tableId: table.id,
    action: body.action,
    freeAt: body.action === "ESTIMATE" && body.freeAt ? new Date(body.freeAt) : null,
    billCents: body.action === "PAID" ? body.billCents : undefined,
    actor,
  });
  return res.ok ? NextResponse.json(res) : failureResponse(res);
}
