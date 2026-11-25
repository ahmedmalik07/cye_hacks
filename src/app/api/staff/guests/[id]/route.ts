import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ADMIN_ROLES } from "@/lib/auth";
import { requireStaff, isErrorResponse } from "@/lib/staffApi";
import { cleanTags, forgetGuest, guestStats } from "@/lib/reservations/guests";
import { badRequest } from "@/lib/reservations/http";
import { logAudit } from "@/lib/audit";
import { bumpRevision } from "@/lib/bus";

type Params = { params: Promise<{ id: string }> };

/** A guest's profile, numbers and last 50 bookings. */
export async function GET(_req: Request, { params }: Params) {
  const session = await requireStaff();
  if (isErrorResponse(session)) return session;
  const { id } = await params;
  const g = await prisma.guest.findFirst({
    where: { id, restaurantId: session.restaurant.id },
  });
  if (!g) return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  const [stats, history] = await Promise.all([
    guestStats([g.id]),
    prisma.reservation.findMany({
      where: { guestId: g.id },
      orderBy: { startAt: "desc" },
      take: 50,
      select: {
        id: true,
        code: true,
        startAt: true,
        partySize: true,
        status: true,
        source: true,
        tags: true,
        note: true,
        staffNote: true,
        tables: { select: { table: { select: { name: true } } } },
        sessions: { select: { revenueCents: true } },
      },
    }),
  ]);
  return NextResponse.json({
    guest: {
      id: g.id,
      name: g.name,
      phone: g.phone,
      email: g.email,
      vip: g.vip,
      tags: g.tags,
      allergies: g.allergies,
      notes: g.notes,
      birthday: g.birthday,
      marketingOptIn: g.marketingOptIn,
      createdAt: g.createdAt.toISOString(),
      lastSeenAt: g.lastSeenAt.toISOString(),
      ...stats.get(g.id),
    },
    history: history.map((h) => ({
      id: h.id,
      code: h.code,
      startAt: h.startAt.toISOString(),
      partySize: h.partySize,
      status: h.status,
      source: h.source,
      tags: h.tags,
      note: h.note,
      staffNote: h.staffNote,
      tables: h.tables.map((t) => t.table.name),
      spendCents: h.sessions.reduce((n, s) => n + (s.revenueCents ?? 0), 0),
    })),
  });
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  email: z.string().trim().email().max(120).nullable().optional().or(z.literal("")),
  vip: z.boolean().optional(),
  tags: z.array(z.string().max(30)).max(12).optional(),
  allergies: z.string().trim().max(300).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  birthday: z
    .string()
    .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Birthday as MM-DD")
    .nullable()
    .optional()
    .or(z.literal("")),
  marketingOptIn: z.boolean().optional(),
});

/** What staff know about a guest. Every staff role: hosts add notes at the door. */
export async function PATCH(req: Request, { params }: Params) {
  const session = await requireStaff();
  if (isErrorResponse(session)) return session;
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Check the details.");
  const g = await prisma.guest.findFirst({
    where: { id, restaurantId: session.restaurant.id },
    select: { id: true, name: true },
  });
  if (!g) return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  const d = parsed.data;
  await prisma.guest.update({
    where: { id: g.id },
    data: {
      ...(d.name ? { name: d.name } : {}),
      ...(d.email !== undefined ? { email: d.email || null } : {}),
      ...(d.vip !== undefined ? { vip: d.vip } : {}),
      ...(d.tags ? { tags: cleanTags(d.tags) } : {}),
      ...(d.allergies !== undefined ? { allergies: d.allergies || null } : {}),
      ...(d.notes !== undefined ? { notes: d.notes || null } : {}),
      ...(d.birthday !== undefined ? { birthday: d.birthday || null } : {}),
      ...(d.marketingOptIn !== undefined ? { marketingOptIn: d.marketingOptIn } : {}),
    },
  });
  await logAudit({
    restaurantId: session.restaurant.id,
    actorId: session.user.id,
    actorName: session.user.name,
    action: "guest.updated",
    detail: `${g.name}: ${Object.keys(d).join(", ")}`,
  });
  bumpRevision(session.restaurant.id);
  return NextResponse.json({ ok: true });
}

/** "Forget me": owners and managers only, because it can't be undone. */
export async function DELETE(_req: Request, { params }: Params) {
  const session = await requireStaff(ADMIN_ROLES);
  if (isErrorResponse(session)) return session;
  const { id } = await params;
  const ok = await forgetGuest(session.restaurant.id, id);
  if (!ok) return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  await logAudit({
    restaurantId: session.restaurant.id,
    actorId: session.user.id,
    actorName: session.user.name,
    action: "guest.forgotten",
    detail: id,
  });
  return NextResponse.json({ ok: true });
}
