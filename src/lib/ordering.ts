import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { bumpRevision } from "./bus";

/**
 * QR ordering. A guest scans the code on their table, orders from the menu,
 * and asks for the bill or a waiter. Each action moves the table's session
 * along by itself (ordered, bill asked), so the floor and the turn-time
 * estimates stay right without staff typing anything.
 */

export const MAX_QTY = 20;
export const MAX_LINES = 30;

export type OrderLine = { id: string; qty: number };
type MenuRow = { id: string; name: string; priceCents: number; available: boolean };

/** Price an order from the menu on the server, never from what the phone sent. */
export function priceOrder(
  lines: OrderLine[],
  menu: MenuRow[],
): { ok: true; items: { menuItemId: string; name: string; priceCents: number; qty: number }[]; totalCents: number }
  | { ok: false; error: string } {
  if (lines.length === 0) return { ok: false, error: "Your order is empty." };
  if (lines.length > MAX_LINES) return { ok: false, error: "That is a lot of dishes. Order in two rounds." };
  const byId = new Map(menu.map((m) => [m.id, m]));
  const seen = new Set<string>();
  const items = [];
  let totalCents = 0;
  for (const l of lines) {
    if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > MAX_QTY) {
      return { ok: false, error: `Choose 1 to ${MAX_QTY} of each dish.` };
    }
    if (seen.has(l.id)) return { ok: false, error: "A dish appears twice. Change its quantity instead." };
    seen.add(l.id);
    const m = byId.get(l.id);
    if (!m) return { ok: false, error: "A dish on your order is no longer on the menu." };
    if (!m.available) return { ok: false, error: `${m.name} is sold out right now.` };
    items.push({ menuItemId: m.id, name: m.name, priceCents: m.priceCents, qty: l.qty });
    totalCents += m.priceCents * l.qty;
  }
  return { ok: true, items, totalCents };
}

export async function tableByCode(code: string) {
  if (code.length < 8 || code.length > 64) return null;
  return prisma.table.findFirst({
    where: { code, active: true },
    include: { restaurant: { select: { id: true, name: true, slug: true, currency: true, timeZone: true } } },
  });
}

function isOpenSessionClash(err: unknown) {
  return (
    (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") ||
    String((err as Error)?.message ?? err).includes("TableSession_one_open_per_table")
  );
}

/**
 * The party currently at a table. If nobody seated the table on the host
 * screen, the guest's own order is the evidence someone sat down, so the
 * session opens now (and a table waiting to be cleaned is taken over).
 */
async function sessionForGuest(restaurantId: string, tableId: string, now: Date) {
  const open = await prisma.tableSession.findFirst({ where: { tableId, cleanedAt: null } });
  if (open && !open.leftAt) return open;
  if (open) await prisma.tableSession.update({ where: { id: open.id }, data: { cleanedAt: now } });
  try {
    return await prisma.tableSession.create({
      data: { restaurantId, tableId, source: "QR", seatedAt: now },
    });
  } catch (err) {
    if (!isOpenSessionClash(err)) throw err;
    const again = await prisma.tableSession.findFirst({ where: { tableId, cleanedAt: null, leftAt: null } });
    if (!again) throw err;
    return again;
  }
}

export async function placeOrder(input: {
  restaurantId: string;
  tableId: string;
  lines: OrderLine[];
  note?: string;
}) {
  const menu = await prisma.menuItem.findMany({
    where: { restaurantId: input.restaurantId, id: { in: input.lines.map((l) => l.id) } },
    select: { id: true, name: true, priceCents: true, available: true },
  });
  const priced = priceOrder(input.lines, menu);
  if (!priced.ok) return priced;
  const now = new Date();
  const session = await sessionForGuest(input.restaurantId, input.tableId, now);
  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        restaurantId: input.restaurantId,
        tableId: input.tableId,
        sessionId: session.id,
        totalCents: priced.totalCents,
        note: input.note || null,
        items: { create: priced.items },
      },
    });
    if (!session.firstOrderAt) {
      await tx.tableSession.update({ where: { id: session.id }, data: { firstOrderAt: now } });
    }
    return created;
  });
  bumpRevision(input.restaurantId);
  return { ok: true as const, id: order.id, totalCents: priced.totalCents };
}

/** The guest asks for the bill or a waiter. Only while a party is seated. */
export async function requestService(input: {
  restaurantId: string;
  tableId: string;
  type: "BILL" | "WAITER";
}) {
  const session = await prisma.tableSession.findFirst({
    where: { tableId: input.tableId, cleanedAt: null, leftAt: null },
  });
  if (!session) return { ok: false as const, error: "Order something first, then we can bring the bill." };
  const now = new Date();
  if (input.type === "BILL" && !session.billRequestedAt) {
    await prisma.tableSession.update({
      where: { id: session.id },
      data: { billRequestedAt: now, firstOrderAt: session.firstOrderAt ?? now },
    });
  }
  const already = await prisma.serviceRequest.findFirst({
    where: { tableId: input.tableId, type: input.type, open: true },
  });
  if (!already) {
    await prisma.serviceRequest.create({
      data: { restaurantId: input.restaurantId, tableId: input.tableId, type: input.type },
    });
  }
  bumpRevision(input.restaurantId);
  return { ok: true as const };
}

/** What the table's current party has ordered, for the bill total. */
export async function sessionTotalCents(sessionId: string) {
  const agg = await prisma.order.aggregate({
    where: { sessionId, status: { not: "CANCELLED" } },
    _sum: { totalCents: true },
  });
  return agg._sum.totalCents ?? 0;
}
