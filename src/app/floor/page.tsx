import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, LogOut, Settings2 } from "lucide-react";
import { getStaffSession, ADMIN_ROLES } from "@/lib/auth";
import { getFloor } from "@/lib/reservations/floor";
import { bookForDay } from "@/lib/reservations/book";
import HostWorkspace from "@/components/host/HostWorkspace";
import { LogoMark } from "@/components/Brand";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Host · Mezbaan" };

/**
 * The host stand: the live room, the night's bookings and the waiting list
 * on one screen. Every staff role, because the person at the door is
 * usually a waiter.
 */
export default async function FloorPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  const floor = await getFloor(session.restaurant.id);
  const asked = (await searchParams).date;
  const date = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : floor.today;
  const book = await bookForDay(session.restaurant.id, floor.restaurant.timeZone, date);
  const isAdmin = ADMIN_ROLES.includes(session.user.role);

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-background">
      <header className="border-b border-gray-5 bg-panel">
        <div className="mx-auto flex w-full max-w-[96rem] items-center gap-3 px-3 py-2">
          <Link
            href="/"
            aria-label="Home"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-3 text-gray-12 hover:bg-gray-4"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <LogoMark className="h-8 w-8" />
          <div className="min-w-0 flex-1">
            <p className="text-base leading-tight font-black tracking-tight text-gray-12 uppercase">
              Host
            </p>
            <p className="truncate text-xs text-gray-11">
              {session.restaurant.name} · {session.user.name}
            </p>
          </div>
          <span className="hidden items-center gap-1.5 text-xs font-semibold text-success-11 sm:flex">
            <span className="h-2 w-2 animate-pulse rounded-full bg-success-9 motion-reduce:animate-none" />
            Live
          </span>
          {isAdmin && (
            <Link
              href="/admin/reservations"
              className="flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-gray-12 ring-1 ring-gray-6 hover:bg-gray-3"
            >
              <Settings2 className="size-3.5" />{" "}
              <span className="hidden sm:inline">Set-up &amp; guests</span>
            </Link>
          )}
          <form action="/api/auth/logout" method="post">
            <button
              aria-label="Sign out"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-11 ring-1 ring-gray-6 hover:bg-gray-3"
            >
              <LogOut className="size-3.5" />
            </button>
          </form>
        </div>
      </header>
      <HostWorkspace
        initial={floor}
        initialBook={book ?? []}
        initialDate={date}
        isAdmin={isAdmin}
        bookingPath={`/r/${session.restaurant.slug}/reserve`}
      />
    </div>
  );
}
