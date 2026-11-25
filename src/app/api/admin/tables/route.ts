import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ADMIN_ROLES } from "@/lib/auth";
import { requireStaff, isErrorResponse } from "@/lib/staffApi";
import { logAudit } from "@/lib/audit";
import { bumpRevision } from "@/lib/bus";

const schema = z.object({
  name: z.string().trim().min(1).max(20),
  seats: z.number().int().min(1).max(30),
  area: z.string().trim().min(1).max(40).default("Main hall"),
});

/** Add a table. Seating rules and its place on the plan are set on the other tabs. */
export async function POST(req: Request) {
  const session = await requireStaff(ADMIN_ROLES);
  if (isErrorResponse(session)) return session;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Give the table a name and seats." }, { status: 400 });
  const restaurantId = session.restaurant.id;
  const clash = await prisma.table.findFirst({
    where: { restaurantId, active: true, name: { equals: parsed.data.name, mode: "insensitive" } },
  });
  if (clash) return NextResponse.json({ error: "A table already has that name." }, { status: 409 });
  const count = await prisma.table.count({ where: { restaurantId } });
  const table = await prisma.table.create({
    data: { ...parsed.data, restaurantId, sortOrder: count },
  });
  await logAudit({
    restaurantId,
    actorId: session.user.id,
    actorName: session.user.name,
    action: "table.added",
    detail: `${table.name} · ${table.seats} seats`,
  });
  bumpRevision(restaurantId);
  return NextResponse.json({ ok: true, id: table.id });
}
