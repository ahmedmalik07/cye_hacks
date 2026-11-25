import Link from "next/link";
import { getStaffSession } from "@/lib/auth";
import { getInsights } from "@/lib/reservations/insights";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ days?: string }> };

const pct = (n: number | null) => (n == null ? "–" : `${Math.round(n * 100)}%`);
const mins = (n: number | null) => (n == null ? "–" : `${Math.round(n)} min`);
const BUCKET: Record<string, string> = {
  S: "1–2 guests",
  M: "3–4 guests",
  L: "5–6 guests",
  XL: "7+ guests",
};

export default async function InsightsPage({ searchParams }: Props) {
  const session = (await getStaffSession())!;
  const days = (await searchParams).days === "7" ? 7 : 30;
  const d = await getInsights(session.restaurant.id, days);
  const money = (c: number) => formatMoney(c, d.restaurant.currency);
  const peak = Math.max(0.0001, ...d.tables.busyHours.map((h) => h.avgTables));
  const hours = d.tables.busyHours.filter((h) => h.avgTables > 0 || (h.hour >= 11 && h.hour <= 23));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {[7, 30].map((n) => (
          <Link
            key={n}
            href={`?days=${n}`}
            aria-current={days === n ? "page" : undefined}
            className={cn(
              "min-h-9 rounded-full px-4 py-2 text-sm font-semibold",
              days === n ? "bg-brand-9 text-white" : "bg-panel text-gray-11 ring-1 ring-gray-5",
            )}
          >
            Last {n} days
          </Link>
        ))}
        <span className="text-xs text-gray-11">
          {d.range.from} to {d.range.to}
        </span>
      </div>

      {/* The headline: money the system can trace back to itself. */}
      <section className="rounded-2xl bg-brand-9 p-5 text-white">
        <p className="text-xs font-bold tracking-[0.18em] text-tangerine-8 uppercase">
          Revenue recovered
        </p>
        <p className="mt-1 text-4xl font-black tabular-nums">{money(d.recovered.totalCents)}</p>
        <p className="mt-2 max-w-2xl text-sm text-white/80">
          {money(d.recovered.waitlistRevenueCents)} from {d.waitlist.seated} waiting-list{" "}
          {d.waitlist.seated === 1 ? "party" : "parties"} who would otherwise have been turned away,
          and {money(d.recovered.releasedResoldCents)} from {d.recovered.releasedResold} no-show{" "}
          {d.recovered.releasedResold === 1 ? "table" : "tables"} released on time and sold again.
          Counted only where the bill is traceable to that seating.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-bold text-gray-12">Tables</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile
            label="Utilisation"
            value={pct(d.tables.utilisation)}
            hint={`of seat-hours, ${d.tables.tradingHours}`}
          />
          <Tile
            label="Turns per table"
            value={d.tables.turnsPerTablePerDay.toFixed(1)}
            hint="per day"
          />
          <Tile
            label="Typical meal"
            value={mins(d.tables.medianDiningMins)}
            hint="median, sit to leave"
          />
          <Tile
            label="Spend per guest"
            value={d.tables.spendPerCoverCents == null ? "–" : money(d.tables.spendPerCoverCents)}
            hint={`${d.tables.covers} guests, ${d.tables.seatings} seatings`}
          />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-2xl bg-panel p-4 ring-1 ring-gray-5">
          <h2 className="text-sm font-bold text-gray-12">Tables in use, by hour</h2>
          <p className="text-xs text-gray-11">
            Average over the period · hover a bar for the value
          </p>
          {d.tables.seatings === 0 ? (
            <p className="mt-6 text-sm text-gray-11">
              No seatings recorded yet. They appear as staff seat tables on the floor board.
            </p>
          ) : (
            <>
              <div
                className="mt-4 flex h-40 items-end gap-0.5"
                role="img"
                aria-label="Average tables in use by hour of day"
              >
                {hours.map((h) => (
                  <div
                    key={h.hour}
                    className="group relative flex h-full flex-1 flex-col justify-end"
                  >
                    <div
                      className="rounded-t-[4px] bg-brand-9 transition-colors group-hover:bg-tangerine-9"
                      style={{ height: `${Math.max(1, (h.avgTables / peak) * 100)}%` }}
                    />
                    <span className="pointer-events-none absolute -top-7 left-1/2 z-10 hidden -translate-x-1/2 rounded-md bg-gray-12 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-gray-1 group-hover:block">
                      {String(h.hour).padStart(2, "0")}:00 · {h.avgTables.toFixed(1)} of{" "}
                      {d.tables.count}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-1 flex gap-0.5 text-[10px] text-gray-11 tabular-nums">
                {hours.map((h) => (
                  <span key={h.hour} className="flex-1 text-center">
                    {h.hour % 3 === 0 ? String(h.hour).padStart(2, "0") : ""}
                  </span>
                ))}
              </div>
              <details className="mt-3 text-xs text-gray-11">
                <summary className="cursor-pointer font-semibold">Show as a table</summary>
                <table className="mt-2 w-full">
                  <thead>
                    <tr className="text-left">
                      <th className="py-1">Hour</th>
                      <th className="py-1 text-right">Tables in use (avg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hours.map((h) => (
                      <tr key={h.hour} className="border-t border-gray-4">
                        <td className="py-1">{String(h.hour).padStart(2, "0")}:00</td>
                        <td className="py-1 text-right text-gray-12">{h.avgTables.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          )}
        </div>

        <div className="rounded-2xl bg-panel p-4 ring-1 ring-gray-5">
          <h2 className="text-sm font-bold text-gray-12">How long families stay</h2>
          <p className="text-xs text-gray-11">
            Median from sitting down to leaving. New bookings are planned with these.
          </p>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {d.tables.byBucket.map((b) => (
                <tr key={b.bucket} className="border-t border-gray-4 first:border-0">
                  <td className="py-2 text-gray-12">{BUCKET[b.bucket]}</td>
                  <td className="py-2 text-right font-bold text-gray-12 tabular-nums">
                    {mins(b.medianMins)}
                  </td>
                  <td className="py-2 text-right text-xs text-gray-11">{b.meals} meals</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-bold text-gray-12">Bookings</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile
            label="Bookings"
            value={String(d.bookings.total)}
            hint={`${d.bookings.upcoming} still to come`}
          />
          <Tile
            label="Turned up"
            value={pct(d.bookings.honouredRate)}
            hint={`${d.bookings.honoured} seated`}
          />
          <Tile
            label="No-show rate"
            value={pct(d.bookings.noShowRate)}
            hint={`${d.bookings.noShows} released after grace`}
            tone={d.bookings.noShowRate != null && d.bookings.noShowRate > 0.1 ? "warn" : undefined}
          />
          <Tile
            label="Cancelled"
            value={String(d.bookings.cancelled)}
            hint={`${d.bookings.cancelledByGuest} by the guest's own link`}
          />
        </div>
        <p className="mt-2 text-xs text-gray-11">
          {pct(d.bookings.guestConfirmedRate)} of guests confirmed from their WhatsApp link ·{" "}
          {d.bookings.bySource
            .filter((s) => s.count)
            .map((s) => `${s.count} ${s.source.toLowerCase().replace("_", "-")}`)
            .join(" · ") || "no bookings yet"}
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-bold text-gray-12">Waiting list</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Joined" value={String(d.waitlist.joined)} />
          <Tile
            label="Seated"
            value={String(d.waitlist.seated)}
            hint={`${d.waitlist.lost} left or expired`}
          />
          <Tile
            label="Typical wait"
            value={mins(d.waitlist.medianWaitMins)}
            hint="joined to seated"
          />
          <Tile
            label="Quote accuracy"
            value={
              d.waitlist.medianQuoteErrorMins == null
                ? "–"
                : `±${Math.round(d.waitlist.medianQuoteErrorMins)} min`
            }
            hint="quoted vs actual wait"
          />
        </div>
      </section>
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "warn";
}) {
  return (
    <div className="rounded-2xl bg-panel p-4 ring-1 ring-gray-5">
      <p className="text-xs font-semibold tracking-wide text-gray-11 uppercase">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-black tabular-nums",
          tone === "warn" ? "text-tangerine-11" : "text-gray-12",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-gray-11">{hint}</p>}
    </div>
  );
}
