import Link from "next/link";
import { CalendarDays, Lock, Users } from "lucide-react";
import { requireStaffPage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadRestaurant } from "@/lib/reservations/service";
import { dayClosedReason, hoursForDay } from "@/lib/reservations/policy";
import { addDaysToKey, parseDateKey, zonedDateKey, zonedWallToUtc } from "@/lib/zonedTime";
import { cn } from "@/lib/utils";
import CopyLinks from "@/components/admin/reservations/CopyLinks";

export const dynamic = "force-dynamic";

/**
 * The manager's view of what's coming: the next two weeks day by day, so
 * a heavy Friday or a forgotten closure is visible before it happens. The
 * night itself is run from the host screen.
 */
export default async function ReservationsOverviewPage() {
  const session = await requireStaffPage({ admin: true });
  const restaurantId = session.restaurant.id;
  const { restaurant, policy } = await loadRestaurant(restaurantId);
  const tz = policy.timeZone;
  const today = zonedDateKey(new Date(), tz);
  const days = Array.from({ length: 14 }, (_, i) => addDaysToKey(today, i));
  const first = parseDateKey(today)!;
  const last = parseDateKey(addDaysToKey(today, 14))!;
  const [rows, guests, seats] = await Promise.all([
    prisma.reservation.findMany({
      where: {
        restaurantId,
        status: { in: ["CONFIRMED", "SEATED", "COMPLETED"] },
        startAt: {
          gte: zonedWallToUtc(first.y, first.m, first.d, 0, tz),
          lt: zonedWallToUtc(last.y, last.m, last.d, 6 * 60, tz),
        },
      },
      select: { startAt: true, partySize: true, tags: true, guest: { select: { vip: true } } },
    }),
    prisma.guest.count({ where: { restaurantId } }),
    prisma.table.aggregate({ where: { restaurantId, active: true }, _sum: { seats: true } }),
  ]);
  const byDay = new Map<
    string,
    { bookings: number; covers: number; vip: number; occasions: number }
  >();
  for (const r of rows) {
    // Seatings after midnight belong to the evening before.
    const local = new Date(r.startAt.getTime() - 6 * 3600_000);
    const key = zonedDateKey(local, tz);
    const d = byDay.get(key) ?? { bookings: 0, covers: 0, vip: 0, occasions: 0 };
    d.bookings++;
    d.covers += r.partySize;
    if (r.guest?.vip) d.vip++;
    if (r.tags.some((t) => t === "Birthday" || t === "Anniversary")) d.occasions++;
    byDay.set(key, d);
  }
  const capacity = seats._sum.seats ?? 0;
  const peak = Math.max(1, ...[...byDay.values()].map((d) => d.covers));

  return (
    <div className="space-y-5">
      <CopyLinks
        bookingPath={`/r/${restaurant.slug}/reserve`}
        waitlistPath={`/r/${restaurant.slug}/waitlist`}
      />

      <section className="rounded-2xl bg-panel p-4 ring-1 ring-gray-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold text-gray-12">
            <CalendarDays className="size-4" /> Next 14 days
          </h2>
          <p className="text-xs text-gray-11">
            {capacity} seats · {guests} guest profiles ·{" "}
            <Link
              href="/admin/reservations/guests"
              className="font-semibold text-brand-11 underline"
            >
              guest book
            </Link>
          </p>
        </div>
        <ul className="divide-y divide-gray-4">
          {days.map((key) => {
            const d = byDay.get(key);
            const closed = dayClosedReason(key, policy, { staff: true });
            const onlineOff = !closed && dayClosedReason(key, policy);
            const hours = hoursForDay(key, policy, { staff: true });
            const label = new Intl.DateTimeFormat("en-GB", {
              weekday: "short",
              day: "numeric",
              month: "short",
              timeZone: "UTC",
            }).format(new Date(`${key}T00:00:00Z`));
            return (
              <li key={key}>
                <Link
                  href={`/floor?date=${key}`}
                  className="flex flex-wrap items-center gap-3 py-2.5 hover:bg-gray-2"
                >
                  <span className="w-28 shrink-0 text-sm font-bold text-gray-12">
                    {key === today ? "Today" : label}
                  </span>
                  {closed ? (
                    <span className="flex items-center gap-1 text-sm font-semibold text-danger-11">
                      <Lock className="size-3.5" /> {closed}
                    </span>
                  ) : (
                    <>
                      <span className="flex w-40 items-center gap-2">
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-gray-4">
                          <span
                            className={cn(
                              "block h-full rounded-full",
                              (d?.covers ?? 0) > capacity ? "bg-tangerine-9" : "bg-brand-9",
                            )}
                            style={{ width: `${Math.min(100, ((d?.covers ?? 0) / peak) * 100)}%` }}
                          />
                        </span>
                      </span>
                      <span className="flex items-center gap-1 text-sm text-gray-12 tabular-nums">
                        <Users className="size-3.5 text-gray-11" /> {d?.covers ?? 0} guests ·{" "}
                        {d?.bookings ?? 0} bookings
                      </span>
                      {d?.vip ? (
                        <span className="rounded-full bg-tangerine-9 px-2 text-[11px] font-bold text-on-tangerine">
                          {d.vip} VIP
                        </span>
                      ) : null}
                      {d?.occasions ? (
                        <span className="rounded-full bg-success-3 px-2 text-[11px] font-bold text-success-11">
                          {d.occasions} occasion{d.occasions > 1 ? "s" : ""}
                        </span>
                      ) : null}
                      {onlineOff && (
                        <span className="rounded-full bg-gray-4 px-2 text-[11px] font-bold text-gray-11">
                          online off
                        </span>
                      )}
                      <span className="ml-auto text-xs text-gray-11">
                        {hours ? `${hours.opensAt}–${hours.closesAt}` : ""}
                      </span>
                    </>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
