import Link from "next/link";
import ReservationTabs from "@/components/admin/reservations/ReservationTabs";

/**
 * Reservations in the admin panel: the day's bookings, how they turned out,
 * and the rules. Drawn in the reservation system's own Navy / Sand /
 * Tangerine palette.
 */
export default function ReservationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="-m-4 min-h-full bg-background p-4 md:-m-8 md:p-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-[0.18em] text-tangerine-11 uppercase">
            Reservations
          </p>
          <h1 className="text-3xl font-black tracking-tight text-gray-12 uppercase">
            Tables & bookings
          </h1>
        </div>
        <Link
          href="/floor"
          className="flex min-h-10 items-center rounded-xl bg-tangerine-9 px-4 text-sm font-bold text-on-tangerine hover:bg-tangerine-10"
        >
          Open the host screen →
        </Link>
      </div>
      <ReservationTabs />
      <div className="mt-5">{children}</div>
    </div>
  );
}
