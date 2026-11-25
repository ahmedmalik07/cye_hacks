import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireStaff, isErrorResponse } from "@/lib/staffApi";
import { cancelWaitlistEntry, notifyWaitlistEntry } from "@/lib/reservations/waitlist";
import { badRequest, failureResponse } from "@/lib/reservations/http";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("notify"), tableIds: z.array(z.string().min(1)).min(1).max(3) }),
  z.object({ action: z.literal("cancel") }),
]);

type Params = { params: Promise<{ id: string }> };

/** Offer a table to a waiting party, or take them off the list. Seating goes through the table. */
export async function PATCH(req: Request, { params }: Params) {
  const session = await requireStaff();
  if (isErrorResponse(session)) return session;
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid update.");
  const actor = { id: session.user.id, name: session.user.name };
  if (parsed.data.action === "cancel") {
    const res = await cancelWaitlistEntry({
      restaurantId: session.restaurant.id,
      entryId: id,
      actor,
    });
    return res.ok ? NextResponse.json(res) : failureResponse(res);
  }
  const owned = await prisma.table.count({
    where: { id: { in: parsed.data.tableIds }, restaurantId: session.restaurant.id, active: true },
  });
  if (owned !== parsed.data.tableIds.length) return badRequest("Table not found.");
  const res = await notifyWaitlistEntry({
    restaurantId: session.restaurant.id,
    entryId: id,
    tableIds: parsed.data.tableIds,
    actor,
  });
  return res.ok ? NextResponse.json(res) : failureResponse(res);
}
