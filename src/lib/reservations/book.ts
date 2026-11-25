import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { maskPhone } from "./guest";
import { guestCards, type GuestCard } from "./guests";
import { addDaysToKey, parseDateKey, zonedWallToUtc } from "../zonedTime";

/**
 * The reservation book as staff see it: a day's bookings, or a search across
 * the weeks around today, each with the guest's profile attached.
 */

const INCLUDE = {
  tables: { select: { active: true, table: { select: { id: true, name: true } } } },
} satisfies Prisma.ReservationInclude;

type Row = Prisma.ReservationGetPayload<{ include: typeof INCLUDE }>;

export type BookEntry = {
  id: string;
  code: string | null;
  customerName: string;
  phone: string | null;
  hasPhone: boolean;
  partySize: number;
  childCount: number;
  startAt: string;
  endAt: string;
  durationMins: number;
  status: Row["status"];
  source: Row["source"];
  note: string | null;
  staffNote: string | null;
  tags: string[];
  guestConfirmed: boolean;
  arrivedAt: string | null;
  seatedAt: string | null;
  lateUntil: string | null;
  tables: { id: string; name: string }[];
  guest: GuestCard | null;
};

function toEntry(r: Row, guests: Map<string, GuestCard>): BookEntry {
  return {
    id: r.id,
    code: r.code,
    customerName: r.customerName,
    phone: maskPhone(r.customerPhone),
    hasPhone: !!r.customerPhone,
    partySize: r.partySize,
    childCount: r.childCount,
    startAt: r.startAt.toISOString(),
    endAt: r.endAt.toISOString(),
    durationMins: r.durationMins,
    status: r.status,
    source: r.source,
    note: r.note,
    staffNote: r.staffNote,
    tags: r.tags,
    guestConfirmed: !!r.guestConfirmedAt,
    arrivedAt: r.arrivedAt?.toISOString() ?? null,
    seatedAt: r.seatedAt?.toISOString() ?? null,
    lateUntil: r.lateUntil?.toISOString() ?? null,
    // A live booking shows the tables it holds; a finished one, where it sat.
    tables: r.tables.filter((t) => t.active || r.status !== "CONFIRMED").map((t) => t.table),
    guest: r.guestId ? (guests.get(r.guestId) ?? null) : null,
  };
}

async function withGuests(rows: Row[]) {
  const guests = await guestCards(rows.map((r) => r.guestId));
  return rows.map((r) => toEntry(r, guests));
}

/** One local day, 00:00 to 06:00 the next morning (late seatings belong to the evening). */
export async function bookForDay(restaurantId: string, timeZone: string, dateKey: string) {
  const date = parseDateKey(dateKey);
  if (!date) return null;
  const from = zonedWallToUtc(date.y, date.m, date.d, 0, timeZone);
  const to = zonedWallToUtc(date.y, date.m, date.d, 30 * 60, timeZone);
  const rows = await prisma.reservation.findMany({
    where: { restaurantId, startAt: { gte: from, lt: to } },
    orderBy: { startAt: "asc" },
    include: INCLUDE,
    take: 600,
  });
  return withGuests(rows);
}

/**
 * "Booking for Khan?" Name, code, or the last digits of the number, from
 * a month back to three months ahead, nearest to today first.
 */
export async function searchBook(restaurantId: string, today: string, timeZone: string, q: string) {
  const query = q.trim();
  if (query.length < 2) return [];
  const start = parseDateKey(addDaysToKey(today, -30))!;
  const end = parseDateKey(addDaysToKey(today, 90))!;
  const digits = query.replace(/\D/g, "");
  const or: Prisma.ReservationWhereInput[] = [
    { customerName: { contains: query, mode: "insensitive" } },
    { code: { contains: query.toUpperCase() } },
  ];
  if (digits.length >= 4) or.push({ customerPhone: { endsWith: digits.slice(-7) } });
  const rows = await prisma.reservation.findMany({
    where: {
      restaurantId,
      startAt: {
        gte: zonedWallToUtc(start.y, start.m, start.d, 0, timeZone),
        lt: zonedWallToUtc(end.y, end.m, end.d, 0, timeZone),
      },
      OR: or,
    },
    include: INCLUDE,
    take: 60,
  });
  const now = Date.now();
  rows.sort((a, b) => Math.abs(a.startAt.getTime() - now) - Math.abs(b.startAt.getTime() - now));
  return withGuests(rows.slice(0, 30));
}

export async function bookEntry(restaurantId: string, id: string) {
  const row = await prisma.reservation.findFirst({
    where: { id, restaurantId },
    include: INCLUDE,
  });
  if (!row) return null;
  const [entry] = await withGuests([row]);
  return { entry, phoneFull: row.customerPhone };
}
