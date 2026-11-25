"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { CalendarDays, Check, Clock, Users, X } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { cn } from "@/lib/utils";
import { CoastalShell, Panel, WaveHeader } from "./Coastal";

type Booking = {
  code: string;
  status: "CONFIRMED" | "SEATED" | "CANCELLED" | "NO_SHOW" | "COMPLETED";
  customerName: string;
  partySize: number;
  childCount: number;
  startAt: string;
  lateUntil: string | null;
  guestConfirmed: boolean;
  tables: string[];
  graceMins: number;
};

const fmt = (iso: string, timeZone: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone, hour12: true, ...opts }).format(new Date(iso));

export default function ManageBooking({
  restaurant,
  token,
}: {
  restaurant: { name: string; slug: string; logoUrl: string | null; timeZone: string };
  token: string;
}) {
  const url = `/api/r/${restaurant.slug}/booking/${token}`;
  const {
    data: booking,
    error: loadError,
    mutate,
  } = useSWR<Booking>(url, async (u: string) => {
    const res = await fetch(u, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  });
  const missing = !!loadError;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  async function act(
    body: Record<string, unknown>,
    success: (data: Record<string, unknown>) => string,
  ) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await apiFetch(url, "PATCH", body);
    setBusy(false);
    setConfirmCancel(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setNotice(success(res.data));
    await mutate();
  }

  const tz = restaurant.timeZone;
  const open = booking?.status === "CONFIRMED";

  return (
    <CoastalShell>
      <WaveHeader
        eyebrow="Your booking"
        title={restaurant.name}
        logoUrl={restaurant.logoUrl}
        compact
      />
      <div className="relative z-10 mx-auto -mt-12 w-full max-w-md space-y-4 px-4 pb-12">
        {missing ? (
          <Panel>
            <p className="font-semibold text-gray-12">We couldn&apos;t find this booking.</p>
            <p className="mt-1 text-sm text-gray-11">
              The link may be incomplete. Check your WhatsApp message.
            </p>
          </Panel>
        ) : !booking ? (
          <Panel>
            <div className="h-24 animate-pulse rounded-xl bg-gray-3" />
          </Panel>
        ) : (
          <>
            <Panel>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold tracking-widest text-gray-11 uppercase">
                    Booking
                  </p>
                  <p className="font-mono text-2xl font-black tracking-[0.15em] text-gray-12">
                    {booking.code}
                  </p>
                </div>
                <StatusPill status={booking.status} confirmed={booking.guestConfirmed} />
              </div>
              <ul className="mt-4 space-y-2 text-sm text-gray-12">
                <li className="flex items-center gap-2">
                  <CalendarDays className="size-4 text-tangerine-11" />
                  {fmt(booking.startAt, tz, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </li>
                <li className="flex items-center gap-2">
                  <Users className="size-4 text-tangerine-11" />
                  {booking.partySize} guest{booking.partySize === 1 ? "" : "s"}
                  {booking.childCount
                    ? ` (${booking.childCount} child${booking.childCount === 1 ? "" : "ren"})`
                    : ""}
                  {booking.tables.length ? ` · ${booking.tables.join(" + ")}` : ""}
                </li>
                {booking.lateUntil && open && (
                  <li className="flex items-center gap-2">
                    <Clock className="size-4 text-tangerine-11" />
                    Held for you until{" "}
                    {fmt(booking.lateUntil, tz, { hour: "numeric", minute: "2-digit" })}
                  </li>
                )}
              </ul>
            </Panel>

            {notice && (
              <p role="status" className="rounded-xl bg-success-3 p-3 text-sm text-success-12">
                {notice}
              </p>
            )}
            {error && (
              <p role="alert" className="rounded-xl bg-danger-3 p-3 text-sm text-danger-12">
                {error}
              </p>
            )}

            {open && (
              <>
                <Panel title="Are you coming?">
                  <button
                    type="button"
                    disabled={busy || booking.guestConfirmed}
                    onClick={() =>
                      act({ action: "confirm" }, () => "Thanks! Your table is waiting for you.")
                    }
                    className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-9 font-bold text-white hover:bg-brand-10 disabled:opacity-60"
                  >
                    <Check className="size-4" />
                    {booking.guestConfirmed ? "You've confirmed" : "Yes, we're coming"}
                  </button>
                  <p className="mt-4 mb-2 text-sm font-semibold text-gray-12">Running late?</p>
                  <div className="grid grid-cols-3 gap-2">
                    {[15, 30, 45].map((m) => (
                      <button
                        key={m}
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          act({ action: "late", minutes: m }, (d) =>
                            d.accepted
                              ? `Done. We'll hold your table until ${fmt(String(d.until), tz, { hour: "numeric", minute: "2-digit" })}.`
                              : `Sorry, the table is booked after you, so we can't hold it ${m} minutes. It's held ${booking.graceMins} minutes past your time.`,
                          )
                        }
                        className="min-h-11 rounded-xl bg-tangerine-3 font-semibold text-tangerine-12 ring-1 ring-tangerine-6 hover:bg-tangerine-4 disabled:opacity-60"
                      >
                        +{m} min
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-gray-11">
                    We hold every table {booking.graceMins} minutes past its time, then it goes to
                    families on the waiting list.
                  </p>
                </Panel>

                <Panel>
                  {confirmCancel ? (
                    <div>
                      <p className="text-sm font-semibold text-gray-12">Cancel this booking?</p>
                      <p className="mt-1 text-sm text-gray-11">
                        Your table goes to someone else straight away.
                      </p>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmCancel(false)}
                          className="min-h-11 flex-1 rounded-full border border-gray-6 font-semibold text-gray-12"
                        >
                          Keep it
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            act({ action: "cancel" }, () => "Your booking is cancelled.")
                          }
                          className="min-h-11 flex-1 rounded-full bg-danger-9 font-semibold text-white hover:bg-danger-10"
                        >
                          Yes, cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmCancel(true)}
                      className="flex min-h-11 w-full items-center justify-center gap-2 font-semibold text-danger-11"
                    >
                      <X className="size-4" /> Cancel booking
                    </button>
                  )}
                </Panel>
              </>
            )}

            {(booking.status === "CANCELLED" || booking.status === "NO_SHOW") && (
              <Panel>
                <p className="text-sm text-gray-12">
                  {booking.status === "NO_SHOW"
                    ? `This table was released ${booking.graceMins} minutes after its time.`
                    : "This booking is cancelled."}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Link
                    href={`/r/${restaurant.slug}/reserve`}
                    className="flex min-h-11 items-center justify-center rounded-full bg-brand-9 text-sm font-bold text-white"
                  >
                    Book again
                  </Link>
                  <Link
                    href={`/r/${restaurant.slug}/waitlist`}
                    className="flex min-h-11 items-center justify-center rounded-full border border-gray-6 text-sm font-semibold text-gray-12"
                  >
                    Waiting list
                  </Link>
                </div>
              </Panel>
            )}
          </>
        )}
      </div>
    </CoastalShell>
  );
}

function StatusPill({ status, confirmed }: { status: Booking["status"]; confirmed: boolean }) {
  const map: Record<Booking["status"], [string, string]> = {
    CONFIRMED: [confirmed ? "Confirmed by you" : "Confirmed", "bg-success-3 text-success-12"],
    SEATED: ["Enjoy your meal", "bg-tangerine-3 text-tangerine-12"],
    COMPLETED: ["Completed", "bg-gray-4 text-gray-11"],
    CANCELLED: ["Cancelled", "bg-gray-4 text-gray-11"],
    NO_SHOW: ["Released", "bg-danger-3 text-danger-12"],
  };
  const [label, cls] = map[status];
  return <span className={cn("rounded-full px-3 py-1 text-xs font-bold", cls)}>{label}</span>;
}
