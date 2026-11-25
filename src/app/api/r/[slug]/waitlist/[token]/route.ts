import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit, clientIp } from "@/lib/security";
import { cancelWaitlistEntry, computeQueue } from "@/lib/reservations/waitlist";
import { getDiningStats, loadRestaurant } from "@/lib/reservations/service";
import { sweepRestaurant } from "@/lib/reservations/sweep";
import { failureResponse, notFound } from "@/lib/reservations/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; token: string }> };

async function load(slug: string, token: string) {
  if (token.length < 20) return null;
  const entry = await prisma.waitlistEntry.findUnique({
    where: { manageToken: token },
    include: { restaurant: { select: { slug: true, name: true } } },
  });
  if (!entry || entry.restaurant.slug !== slug) return null;
  return entry;
}

/** A waiting party's live place in the queue. Polled by their phone. */
export async function GET(req: Request, { params }: Params) {
  if (!(await rateLimit(`wait-view:${clientIp(req)}`, 60, 60_000))) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const { slug, token } = await params;
  let entry = await load(slug, token);
  if (!entry) return notFound("Not on the waiting list.");
  await sweepRestaurant(entry.restaurantId).catch(() => {});
  entry = (await load(slug, token))!;

  let position: number | null = null;
  let etaAt: string | null = null;
  if (entry.status === "WAITING") {
    const { policy } = await loadRestaurant(entry.restaurantId);
    const { etas } = await computeQueue(
      entry.restaurantId,
      policy,
      await getDiningStats(entry.restaurantId),
    );
    const mine = etas.get(entry.id);
    position = mine?.position ?? null;
    etaAt = mine?.etaAt?.toISOString() ?? null;
  }
  const offered = entry.offeredTableIds.length
    ? await prisma.table.findMany({
        where: { id: { in: entry.offeredTableIds } },
        select: { name: true },
      })
    : [];
  return NextResponse.json({
    code: entry.code,
    status: entry.status,
    customerName: entry.customerName,
    partySize: entry.partySize,
    joinedAt: entry.createdAt.toISOString(),
    position,
    etaAt,
    respondBy: entry.respondBy?.toISOString() ?? null,
    tables: offered.map((t) => t.name),
  });
}

export async function DELETE(req: Request, { params }: Params) {
  if (!(await rateLimit(`wait-leave:${clientIp(req)}`, 10, 60_000))) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const { slug, token } = await params;
  const entry = await load(slug, token);
  if (!entry) return notFound("Not on the waiting list.");
  const res = await cancelWaitlistEntry({ restaurantId: entry.restaurantId, entryId: entry.id });
  return res.ok ? NextResponse.json({ ok: true }) : failureResponse(res);
}
