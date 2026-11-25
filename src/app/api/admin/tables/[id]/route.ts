import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ADMIN_ROLES } from "@/lib/auth";
import { requireStaff, isErrorResponse } from "@/lib/staffApi";
import { logAudit } from "@/lib/audit";
import { bumpRevision } from "@/lib/bus";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({ name: z.string().trim().min(1).max(20) });

/** Rename a table. */
export async function PATCH(req: Request, { params }: Params) {
  const session = await requireStaff(ADMIN_ROLES);
  if (isErrorResponse(session)) return session;
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Give the table a name." }, { status: 400 });
  const restaurantId = session.restaurant.id;
  const table = await prisma.table.findFirst({ where: { id, restaurantId, active: true } });
  if (!table) return NextResponse.json({ error: "Table not found." }, { status: 404 });
  const clash = await prisma.table.findFirst({
    where: {
      restaurantId,
      active: true,
      id: { not: id },
      name: { equals: parsed.data.name, mode: "insensitive" },
    },
  });
  if (clash) return NextResponse.json({ error: "A table already has that name." }, { status: 409 });
  await prisma.table.update({ where: { id }, data: { name: parsed.data.name } });
  await logAudit({
    restaurantId,
    actorId: session.user.id,
    actorName: session.user.name,
    action: "table.renamed",
    detail: `${table.name} → ${parsed.data.name}`,
  });
  bumpRevision(restaurantId);
  return NextResponse.json({ ok: true });
}

/**
 * Retire a table. Refused while it has guests or future bookings, so nobody
 * loses their table; its history stays for the estimates.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const session = await requireStaff(ADMIN_ROLES);
  if (isErrorResponse(session)) return session;
  const { id } = await params;
  const restaurantId = session.restaurant.id;
  const table = await prisma.table.findFirst({ where: { id, restaurantId, active: true } });
  if (!table) return NextResponse.json({ error: "Table not found." }, { status: 404 });
  const [seated, booked] = await Promise.all([
    prisma.tableSession.count({ where: { tableId: id, cleanedAt: null } }),
    prisma.reservationTable.count({
      where: { tableId: id, active: true, blockEnd: { gt: new Date() } },
    }),
  ]);
  if (seated || booked) {
    return NextResponse.json(
      { error: "This table has guests or upcoming bookings. Move them first." },
      { status: 409 },
    );
  }
  await prisma.table.update({ where: { id }, data: { active: false } });
  await logAudit({
    restaurantId,
    actorId: session.user.id,
    actorName: session.user.name,
    action: "table.removed",
    detail: table.name,
  });
  bumpRevision(restaurantId);
  return NextResponse.json({ ok: true });
}
