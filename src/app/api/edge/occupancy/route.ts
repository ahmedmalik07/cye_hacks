import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { bumpRevision } from "@/lib/bus";
import { rateLimit } from "@/lib/security";

/**
 * Table occupancy from the restaurant's on-site edge box (CCTV + a person
 * detector running locally). Privacy by design: video never leaves the
 * restaurant; the box sends only "table T-4: occupied, 3 people, 0.91".
 *
 *   POST /api/edge/occupancy
 *   Authorization: Bearer <edge key from Reservations → Settings>
 *   X-Restaurant-Id: <restaurant id shown with the key>
 *   { "readings": [{ "table": "<table id or name>", "occupied": true, "people": 3, "confidence": 0.91 }] }
 *
 * A reading only ever suggests: it can close a paid table by itself only if
 * the owner switched that on, and it never seats anyone.
 */
const schema = z.object({
  readings: z
    .array(
      z.object({
        table: z.string().min(1).max(64),
        occupied: z.boolean(),
        people: z.number().int().min(0).max(50).optional(),
        confidence: z.number().min(0).max(1),
      }),
    )
    .min(1)
    .max(200),
});

export async function POST(req: Request) {
  const restaurantId = req.headers.get("x-restaurant-id") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!restaurantId || !key) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await rateLimit(`edge:${restaurantId}`, 120, 60_000))) {
    return NextResponse.json({ error: "Too many readings" }, { status: 429 });
  }
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { id: true, edgeKeyHash: true },
  });
  const given = createHash("sha256").update(key).digest();
  const stored = restaurant?.edgeKeyHash ? Buffer.from(restaurant.edgeKeyHash, "hex") : null;
  if (!restaurant || !stored || stored.length !== given.length || !timingSafeEqual(stored, given)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad readings" }, { status: 400 });

  const now = new Date();
  const tables = await prisma.table.findMany({
    where: { restaurantId, active: true },
    select: { id: true, name: true, cctvOccupied: true },
  });
  let updated = 0;
  let flipped = false;
  for (const r of parsed.data.readings) {
    const table = tables.find((t) => t.id === r.table || t.name === r.table);
    if (!table) continue;
    const changed = table.cctvOccupied !== r.occupied;
    flipped ||= changed;
    await prisma.table.update({
      where: { id: table.id },
      data: {
        cctvOccupied: r.occupied,
        cctvPeople: r.people ?? null,
        cctvConfidence: r.confidence,
        cctvSeenAt: now,
        ...(changed ? { cctvSince: now } : {}),
      },
    });
    updated++;
  }
  if (flipped) bumpRevision(restaurantId);
  return NextResponse.json({ ok: true, updated });
}
