"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarOff, Gauge, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { cn } from "@/lib/utils";

type Day = { mode: "default" | "custom" | "closed"; opensAt: string; closesAt: string };
type Closure = { id: string; date: string; reason: string | null; onlineOnly: boolean };

// Monday first, the way a Pakistani restaurant's week is written.
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const field =
  "min-h-10 rounded-lg bg-panel px-2 text-sm text-gray-12 ring-1 ring-gray-6 outline-none focus:ring-2 focus:ring-brand-8";

/**
 * When guests can book: different hours per weekday, days off for Eid or a
 * private event, and how many guests the kitchen can take starting at once.
 */
export default function HoursAndClosures({
  defaults,
  week,
  maxCovers,
  closures: initialClosures,
  today,
}: {
  defaults: { opensAt: string; closesAt: string };
  week: ({ opensAt: string; closesAt: string } | null | undefined)[];
  maxCovers: number;
  closures: Closure[];
  today: string;
}) {
  const router = useRouter();
  const [days, setDays] = useState<Day[]>(() =>
    week.map((d) =>
      d === null
        ? { mode: "closed", ...defaults }
        : d
          ? { mode: "custom", opensAt: d.opensAt, closesAt: d.closesAt }
          : { mode: "default", ...defaults },
    ),
  );
  const [covers, setCovers] = useState(maxCovers);
  const [closures, setClosures] = useState(initialClosures);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [cDate, setCDate] = useState(today);
  const [cUntil, setCUntil] = useState("");
  const [cReason, setCReason] = useState("");
  const [cOnline, setCOnline] = useState(false);

  function setDay(i: number, patch: Partial<Day>) {
    setDays((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  }

  async function saveWeek() {
    setBusy(true);
    setMsg(null);
    const weekHours = days
      .map((d, day) =>
        d.mode === "closed"
          ? { day, closed: true as const }
          : d.mode === "custom"
            ? { day, opensAt: d.opensAt, closesAt: d.closesAt }
            : null,
      )
      .filter(Boolean);
    const res = await apiFetch("/api/admin/reservations/settings", "PATCH", {
      weekHours: weekHours.length ? weekHours : null,
      policy: { bookingMaxCoversPerSlot: covers },
    });
    setBusy(false);
    setMsg(
      res.ok
        ? { ok: true, text: "Saved. Guests see the new times straight away." }
        : { ok: false, text: res.error },
    );
    if (res.ok) router.refresh();
  }

  async function addClosure() {
    setBusy(true);
    setMsg(null);
    const res = await apiFetch<{ days: number; affectedBookings: number }>(
      "/api/admin/reservations/closures",
      "POST",
      {
        date: cDate,
        until: cUntil || undefined,
        reason: cReason.trim() || undefined,
        onlineOnly: cOnline,
      },
    );
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    const list = await fetch("/api/admin/reservations/closures").then((r) => r.json());
    setClosures(list.closures);
    setCReason("");
    setCUntil("");
    setMsg({
      ok: true,
      text:
        res.data.affectedBookings > 0
          ? `Closed. ${res.data.affectedBookings} booking${res.data.affectedBookings > 1 ? "s are" : " is"} already on those days: open them on the host screen and call the guests.`
          : "Closed. No bookings were on those days.",
    });
  }

  async function reopen(id: string) {
    const res = await apiFetch(`/api/admin/reservations/closures/${id}`, "DELETE");
    if (res.ok) setClosures((cs) => cs.filter((c) => c.id !== id));
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-panel p-4 ring-1 ring-gray-5">
        <h2 className="text-sm font-bold text-gray-12">Hours by day</h2>
        <p className="mb-3 text-xs text-gray-11">
          First and last seating guests can book. &ldquo;Usual&rdquo; uses {defaults.opensAt}–
          {defaults.closesAt} from the rules below. Staff can still book any time from the host
          screen.
        </p>
        <ul className="divide-y divide-gray-4">
          {ORDER.map((i) => {
            const d = days[i];
            return (
              <li key={i} className="flex flex-wrap items-center gap-2 py-2">
                <span className="w-24 text-sm font-semibold text-gray-12">{NAMES[i]}</span>
                <div className="flex gap-1 rounded-lg bg-gray-3 p-0.5">
                  {(["default", "custom", "closed"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setDay(i, { mode: m })}
                      aria-pressed={d.mode === m}
                      className={cn(
                        "min-h-9 rounded-md px-2.5 text-xs font-semibold",
                        d.mode === m ? "bg-panel text-gray-12 shadow-sm" : "text-gray-11",
                      )}
                    >
                      {m === "default" ? "Usual" : m === "custom" ? "Different" : "No bookings"}
                    </button>
                  ))}
                </div>
                {d.mode === "custom" && (
                  <span className="flex items-center gap-1.5 text-sm text-gray-11">
                    <input
                      type="time"
                      aria-label={`${NAMES[i]} first seating`}
                      className={field}
                      value={d.opensAt}
                      onChange={(e) => setDay(i, { opensAt: e.target.value })}
                    />
                    to
                    <input
                      type="time"
                      aria-label={`${NAMES[i]} last seating`}
                      className={field}
                      value={d.closesAt}
                      onChange={(e) => setDay(i, { closesAt: e.target.value })}
                    />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-gray-2 p-3 ring-1 ring-gray-5">
          <Gauge className="size-5 text-brand-11" />
          <label className="flex-1 text-sm text-gray-12">
            <span className="font-semibold">Kitchen pacing</span>
            <span className="block text-xs text-gray-11">
              Most guests who can book online to start at the same time. 0 means no limit.
            </span>
          </label>
          <input
            type="number"
            min={0}
            max={1000}
            className={cn(field, "w-24")}
            value={covers}
            onChange={(e) => setCovers(Math.max(0, Number(e.target.value) || 0))}
            aria-label="Most guests per time slot"
          />
        </div>
        <button
          onClick={() => void saveWeek()}
          disabled={busy}
          className="mt-3 min-h-11 rounded-xl bg-brand-9 px-4 text-sm font-bold text-white hover:bg-brand-10 disabled:opacity-50"
        >
          Save hours and pacing
        </button>
      </section>

      <section className="rounded-2xl bg-panel p-4 ring-1 ring-gray-5">
        <h2 className="flex items-center gap-2 text-sm font-bold text-gray-12">
          <CalendarOff className="size-4" /> Closed days
        </h2>
        <p className="mb-3 text-xs text-gray-11">
          Eid, a family wedding, renovation, or a private event. Existing bookings stay; you&apos;ll
          be told how many to call.
        </p>
        <div className="grid gap-2 sm:grid-cols-[auto_auto_1fr]">
          <label className="text-xs font-bold text-gray-11">
            From
            <input
              type="date"
              className={cn(field, "mt-1 block w-full")}
              value={cDate}
              min={today}
              onChange={(e) => setCDate(e.target.value)}
            />
          </label>
          <label className="text-xs font-bold text-gray-11">
            Until (optional)
            <input
              type="date"
              className={cn(field, "mt-1 block w-full")}
              value={cUntil}
              min={cDate}
              onChange={(e) => setCUntil(e.target.value)}
            />
          </label>
          <label className="text-xs font-bold text-gray-11">
            Reason guests see
            <input
              className={cn(field, "mt-1 block w-full")}
              placeholder="e.g. Eid ul Adha"
              value={cReason}
              maxLength={80}
              onChange={(e) => setCReason(e.target.value)}
            />
          </label>
        </div>
        <label className="mt-2 flex min-h-11 items-center gap-2 text-sm text-gray-12">
          <input
            type="checkbox"
            className="size-5"
            checked={cOnline}
            onChange={(e) => setCOnline(e.target.checked)}
          />
          Only stop online booking (staff can still take bookings)
        </label>
        <button
          onClick={() => void addClosure()}
          disabled={busy || !cDate}
          className="min-h-11 rounded-xl bg-tangerine-9 px-4 text-sm font-bold text-on-tangerine hover:bg-tangerine-10 disabled:opacity-50"
        >
          Close {cUntil && cUntil > cDate ? "these days" : "this day"}
        </button>
        {closures.length > 0 && (
          <ul className="mt-3 divide-y divide-gray-4">
            {closures.map((c) => (
              <li key={c.id} className="flex items-center gap-2 py-2 text-sm">
                <span className="w-32 font-semibold text-gray-12">
                  {new Intl.DateTimeFormat("en-GB", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    timeZone: "UTC",
                  }).format(new Date(`${c.date}T00:00:00Z`))}
                </span>
                <span className="flex-1 text-gray-11">
                  {c.onlineOnly ? "Online booking off" : "Closed"}
                  {c.reason ? ` · ${c.reason}` : ""}
                </span>
                <button
                  onClick={() => void reopen(c.id)}
                  aria-label={`Reopen ${c.date}`}
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-danger-11 hover:bg-danger-2"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {msg && (
        <p
          role="status"
          className={cn(
            "rounded-xl p-3 text-sm",
            msg.ok ? "bg-success-3 text-success-12" : "bg-danger-3 text-danger-12",
          )}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
