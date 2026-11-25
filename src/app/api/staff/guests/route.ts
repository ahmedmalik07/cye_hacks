import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireStaff, isErrorResponse } from "@/lib/staffApi";
import { maskPhone, normalisePhone } from "@/lib/reservations/guest";
import { cleanTags, guestStats } from "@/lib/reservations/guests";
import { badRequest } from "@/lib/reservations/http";
import { logAudit } from "@/lib/audit";

/**
 * Guest book. ?q= searches name and phone digits; ?filter=vip|lapsed|noshow
 * narrows it. Newest-seen first, 50 at a time (?cursor= for more).
 */
export async function GET(req: Request) {
  const session = await requireStaff();
  if (isErrorResponse(session)) return session;
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const filter = url.searchParams.get("filter");
  const cursor = url.searchParams.get("cursor");
  const digits = q.replace(/\D/g, "");
  const where: Prisma.GuestWhereInput = { restaurantId: session.restaurant.id };
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      ...(digits.length >= 4 ? [{ phone: { endsWith: digits.slice(-7) } }] : []),
    ];
  }
  if (filter === "vip") where.vip = true;
  if (filter === "lapsed") where.lastSeenAt = { lt: new Date(Date.now() - 60 * 86_400_000) };
  if (filter === "noshow") where.reservations = { some: { status: "NO_SHOW" } };
  if (filter === "allergy") where.allergies = { not: null };
  const rows = await prisma.guest.findMany({
    where,
    orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }],
    take: 51,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, 50);
  const stats = await guestStats(page.map((g) => g.id));
  return NextResponse.json({
    guests: page.map((g) => ({
      id: g.id,
      name: g.name,
      phone: maskPhone(g.phone),
      vip: g.vip,
      tags: g.tags,
      allergies: g.allergies,
      lastSeenAt: g.lastSeenAt.toISOString(),
      ...stats.get(g.id),
    })),
    next: rows.length > 50 ? page.at(-1)!.id : null,
  });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(30),
  vip: z.boolean().optional(),
  tags: z.array(z.string().max(30)).max(12).optional(),
  allergies: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(1000).optional(),
});

/** Add a guest by hand (a regular who never booked online). */
export async function POST(req: Request) {
  const session = await requireStaff();
  if (isErrorResponse(session)) return session;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Check the guest's details.");
  const phone = normalisePhone(parsed.data.phone);
  if (!phone) return badRequest("That phone number doesn't look right.");
  const restaurantId = session.restaurant.id;
  const existing = await prisma.guest.findUnique({
    where: { restaurantId_phone: { restaurantId, phone } },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: "A guest with that number already exists.", id: existing.id },
      { status: 409 },
    );
  }
  const g = await prisma.guest.create({
    data: {
      restaurantId,
      phone,
      name: parsed.data.name,
      vip: parsed.data.vip ?? false,
      tags: cleanTags(parsed.data.tags),
      allergies: parsed.data.allergies || null,
      notes: parsed.data.notes || null,
    },
  });
  await logAudit({
    restaurantId,
    actorId: session.user.id,
    actorName: session.user.name,
    action: "guest.created",
    detail: g.name,
  });
  return NextResponse.json({ ok: true, id: g.id });
}
