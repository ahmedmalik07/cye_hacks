import { Prisma } from "@prisma/client";
import { prisma } from "../db";

/**
 * Guest profiles: who is walking in, and what the host should know.
 *
 * A profile is keyed by the guest's WhatsApp number within one restaurant.
 * Visits, no-shows, cancellations and spend are counted from bookings,
 * waiting-list seatings and table sessions every time they're read, so they
 * always agree with what actually happened.
 */

type Db = Prisma.TransactionClient | typeof prisma;

/** Profiles nobody has booked under for this long are deleted. */
export const GUEST_PROFILE_RETENTION_DAYS = 365;

export { GUEST_TAGS, BOOKING_TAGS } from "./tags";

export function cleanTags(tags: string[] | undefined | null, max = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags ?? []) {
    const t = raw.trim().replace(/\s+/g, " ").slice(0, 30);
    const key = t.toLowerCase();
    if (!t || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The profile for this number, created on first contact. A name the staff
 * corrected is kept; the guest's own spelling only fills in a blank.
 */
export async function linkGuest(
  db: Db,
  restaurantId: string,
  name: string,
  phone: string | null | undefined,
): Promise<string | null> {
  if (!phone) return null;
  const now = new Date();
  const guest = await db.guest.upsert({
    where: { restaurantId_phone: { restaurantId, phone } },
    create: { restaurantId, phone, name: name.trim().slice(0, 80) || "Guest", lastSeenAt: now },
    update: { lastSeenAt: now },
    select: { id: true },
  });
  return guest.id;
}

export type GuestStats = {
  visits: number;
  noShows: number;
  cancellations: number;
  upcoming: number;
  lastVisitAt: string | null;
  spendCents: number;
};

const EMPTY: GuestStats = {
  visits: 0,
  noShows: 0,
  cancellations: 0,
  upcoming: 0,
  lastVisitAt: null,
  spendCents: 0,
};

/** Visit history for many guests in two queries. */
export async function guestStats(guestIds: string[]): Promise<Map<string, GuestStats>> {
  const ids = [...new Set(guestIds.filter(Boolean))];
  const out = new Map<string, GuestStats>();
  if (ids.length === 0) return out;
  const now = new Date();
  const [bookings, waits, spend] = await Promise.all([
    prisma.$queryRaw<
      {
        guestId: string;
        visits: bigint;
        noShows: bigint;
        cancellations: bigint;
        upcoming: bigint;
        lastVisit: Date | null;
      }[]
    >`
      SELECT "guestId",
        count(*) FILTER (WHERE status IN ('SEATED', 'COMPLETED')) AS "visits",
        count(*) FILTER (WHERE status = 'NO_SHOW') AS "noShows",
        count(*) FILTER (WHERE status = 'CANCELLED' AND "cancelledBy" = 'GUEST') AS "cancellations",
        count(*) FILTER (WHERE status = 'CONFIRMED' AND "startAt" >= ${now}) AS "upcoming",
        max("seatedAt") AS "lastVisit"
      FROM "Reservation"
      WHERE "guestId" = ANY(${ids})
      GROUP BY "guestId"`,
    prisma.$queryRaw<{ guestId: string; visits: bigint; lastVisit: Date | null }[]>`
      SELECT "guestId", count(*) AS "visits", max("seatedAt") AS "lastVisit"
      FROM "WaitlistEntry"
      WHERE "guestId" = ANY(${ids}) AND status = 'SEATED'
      GROUP BY "guestId"`,
    prisma.$queryRaw<{ guestId: string; cents: bigint | null }[]>`
      SELECT g."guestId", sum(s."revenueCents") AS "cents"
      FROM "TableSession" s
      JOIN (
        SELECT id AS "rid", NULL::text AS "wid", "guestId" FROM "Reservation" WHERE "guestId" = ANY(${ids})
        UNION ALL
        SELECT NULL::text, id, "guestId" FROM "WaitlistEntry" WHERE "guestId" = ANY(${ids})
      ) g ON (s."reservationId" = g."rid" OR s."waitlistEntryId" = g."wid")
      GROUP BY g."guestId"`,
  ]);
  const get = (id: string) => {
    let s = out.get(id);
    if (!s) out.set(id, (s = { ...EMPTY }));
    return s;
  };
  const later = (a: string | null, b: Date | null) =>
    b && (!a || b.toISOString() > a) ? b.toISOString() : a;
  for (const b of bookings) {
    const s = get(b.guestId);
    s.visits += Number(b.visits);
    s.noShows = Number(b.noShows);
    s.cancellations = Number(b.cancellations);
    s.upcoming = Number(b.upcoming);
    s.lastVisitAt = later(s.lastVisitAt, b.lastVisit);
  }
  for (const w of waits) {
    const s = get(w.guestId);
    s.visits += Number(w.visits);
    s.lastVisitAt = later(s.lastVisitAt, w.lastVisit);
  }
  for (const m of spend) get(m.guestId).spendCents = Number(m.cents ?? 0);
  return out;
}

/** What a host sees next to a name: the profile's essentials plus history. */
export type GuestCard = {
  id: string;
  name: string;
  vip: boolean;
  tags: string[];
  allergies: string | null;
  notes: string | null;
  birthday: string | null;
} & GuestStats;

export async function guestCards(guestIds: (string | null | undefined)[]) {
  const ids = [...new Set(guestIds.filter((x): x is string => !!x))];
  const map = new Map<string, GuestCard>();
  if (ids.length === 0) return map;
  const [rows, stats] = await Promise.all([
    prisma.guest.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        vip: true,
        tags: true,
        allergies: true,
        notes: true,
        birthday: true,
      },
    }),
    guestStats(ids),
  ]);
  for (const g of rows) map.set(g.id, { ...g, ...(stats.get(g.id) ?? EMPTY) });
  return map;
}

/**
 * Short badges for a guest on a given day, most important first. Shared by
 * the host screen and tests so the rules live in one place.
 */
export function guestBadges(
  g: Pick<
    GuestCard,
    "vip" | "tags" | "allergies" | "birthday" | "visits" | "noShows" | "cancellations"
  >,
  dateKey?: string,
): { label: string; tone: "vip" | "warn" | "danger" | "info" | "good" }[] {
  const out: { label: string; tone: "vip" | "warn" | "danger" | "info" | "good" }[] = [];
  if (g.vip) out.push({ label: "VIP", tone: "vip" });
  if (g.allergies) out.push({ label: "Allergy", tone: "danger" });
  if (g.noShows > 0)
    out.push({ label: `${g.noShows} no-show${g.noShows > 1 ? "s" : ""}`, tone: "warn" });
  if (dateKey && g.birthday && dateKey.slice(5) === g.birthday) {
    out.push({ label: "Birthday today", tone: "good" });
  }
  if (g.visits === 0) out.push({ label: "First visit", tone: "info" });
  else out.push({ label: `${ordinal(g.visits + 1)} visit`, tone: "info" });
  for (const t of g.tags) if (t !== "VIP") out.push({ label: t, tone: "info" });
  return out;
}

export function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/**
 * Erase a guest on request: the profile goes, and their number comes off
 * every booking and waiting-list entry. Counts in Insights are unaffected.
 */
export async function forgetGuest(restaurantId: string, guestId: string) {
  const guest = await prisma.guest.findFirst({
    where: { id: guestId, restaurantId },
    select: { id: true, phone: true },
  });
  if (!guest) return false;
  await prisma.$transaction([
    prisma.reservation.updateMany({
      where: {
        restaurantId,
        OR: [{ guestId }, ...(guest.phone ? [{ customerPhone: guest.phone }] : [])],
      },
      data: { customerPhone: null, guestId: null },
    }),
    prisma.waitlistEntry.updateMany({
      where: {
        restaurantId,
        OR: [{ guestId }, ...(guest.phone ? [{ customerPhone: guest.phone }] : [])],
      },
      data: { customerPhone: null, guestId: null },
    }),
    ...(guest.phone
      ? [prisma.guestMessage.deleteMany({ where: { restaurantId, toPhone: guest.phone } })]
      : []),
    prisma.guest.delete({ where: { id: guest.id } }),
  ]);
  return true;
}
