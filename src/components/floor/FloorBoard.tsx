"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
  AlertTriangle,
  BellRing,
  CalendarPlus,
  Camera,
  CheckCircle2,
  Clock,
  ListPlus,
  MessageCircle,
  UserRound,
  Users,
  UtensilsCrossed,
} from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { useLiveRevision } from "@/lib/useLiveRevision";
import { cn } from "@/lib/utils";
import {
  clock,
  minsSince,
  minsUntil,
  STATUS_STYLE,
  type Arrival,
  type Floor,
  type FloorTable,
  type Status,
  type Waiting,
} from "./types";
import { NewBookingDialog, QueueDialog, SeatArrivalDialog, TableSheet } from "./FloorDialogs";

const fetcher = (url: string) =>
  fetch(url, { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });

/**
 * The live floor: every table's state at a glance (the tile grid), who is
 * arriving, who is waiting, and anything that needs a decision. Updates
 * itself over the same live stream as the kitchen and order boards, and
 * re-reads every 30 seconds so estimates and late timers keep moving.
 */
export default function FloorBoard({ initial }: { initial: Floor }) {
  const { data, mutate } = useSWR<Floor>("/api/staff/floor", fetcher, {
    fallbackData: initial,
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  });
  const floor = data ?? initial;
  useLiveRevision(useCallback(() => void mutate(), [mutate]));

  // A ticking clock so "12 min" and "late 4 min" move between refreshes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);

  const [area, setArea] = useState<string>("All");
  const [openTable, setOpenTable] = useState<string | null>(null);
  const [seating, setSeating] = useState<Arrival | null>(null);
  const [dialog, setDialog] = useState<"booking" | "queue" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  const say = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const tz = floor.restaurant.timeZone;
  const tables = useMemo(
    () => floor.tables.filter((t) => area === "All" || t.area === area),
    [floor.tables, area],
  );
  const selected = floor.tables.find((t) => t.id === openTable) ?? null;
  const late = floor.upcoming.filter((r) => r.lateMins > 0);
  const atRisk = floor.upcoming.filter((r) => r.risk);
  const cctv = floor.tables.filter((t) => t.cctv);

  async function patch(url: string, body: unknown, done?: string) {
    setError(null);
    const res = await apiFetch(url, "PATCH", body);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    if (done) say(done);
    await refresh();
    return true;
  }

  const stats: { key: Status | "COVERS"; label: string; value: number; tone: string }[] = [
    {
      key: "AVAILABLE",
      label: "Available",
      value: floor.counts.AVAILABLE + floor.counts.READY,
      tone: "text-success-11",
    },
    { key: "RESERVED", label: "Reserved", value: floor.counts.RESERVED, tone: "text-brand-11" },
    { key: "OCCUPIED", label: "Occupied", value: floor.counts.OCCUPIED, tone: "text-tangerine-11" },
    { key: "BILL", label: "Bill", value: floor.counts.BILL, tone: "text-tangerine-11" },
    { key: "CLEANING", label: "Cleaning", value: floor.counts.CLEANING, tone: "text-gray-11" },
    { key: "COVERS", label: "Guests in", value: floor.covers, tone: "text-gray-12" },
  ];

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-5 lg:grid-cols-[1fr_22rem]">
      <section aria-label="Tables" className="min-w-0 space-y-4">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {stats.map((s) => (
            <div key={s.key} className="rounded-xl bg-panel px-3 py-2.5 ring-1 ring-gray-5">
              <p className={cn("text-2xl font-black tabular-nums", s.tone)}>{s.value}</p>
              <p className="text-xs font-medium text-gray-11">{s.label}</p>
            </div>
          ))}
        </div>

        {floor.learning && (
          <p className="flex items-start gap-2 rounded-xl bg-brand-3 px-3 py-2 text-sm text-brand-12">
            <Clock className="mt-0.5 size-4 shrink-0" />
            <span>
              Free-up times are estimates from your planning time ({floor.policy.cleaningMins} min
              cleaning included) until Mezbaan has learned from your own meals: {floor.mealsLearned}{" "}
              recorded so far. Tap &ldquo;Guests left&rdquo; when tables empty to teach it.
            </span>
          </p>
        )}

        {floor.areas.length > 1 && (
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Area">
            {["All", ...floor.areas].map((a) => (
              <button
                key={a}
                role="tab"
                aria-selected={area === a}
                onClick={() => setArea(a)}
                className={cn(
                  "min-h-9 rounded-full px-4 text-sm font-semibold transition",
                  area === a
                    ? "bg-brand-9 text-white"
                    : "bg-panel text-gray-11 ring-1 ring-gray-5 hover:text-gray-12",
                )}
              >
                {a}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 xl:grid-cols-5">
          {tables.map((t) => (
            <TableTile key={t.id} t={t} now={now} tz={tz} onOpen={() => setOpenTable(t.id)} />
          ))}
        </div>
        <Legend />
      </section>

      <aside className="space-y-4" aria-label="Arrivals and waiting list">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setDialog("queue")}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-tangerine-9 px-3 text-sm font-bold text-on-tangerine hover:bg-tangerine-10"
          >
            <ListPlus className="size-4" /> Add to queue
          </button>
          <button
            onClick={() => setDialog("booking")}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-9 px-3 text-sm font-bold text-white hover:bg-brand-10"
          >
            <CalendarPlus className="size-4" /> Phone booking
          </button>
        </div>

        {error && (
          <p role="alert" className="rounded-xl bg-danger-3 p-3 text-sm text-danger-12">
            {error}
          </p>
        )}

        {(floor.needsTable.length > 0 ||
          late.length > 0 ||
          atRisk.length > 0 ||
          cctv.length > 0) && (
          <Rail
            title="Needs attention"
            icon={<AlertTriangle className="size-4 text-tangerine-11" />}
          >
            {floor.needsTable.map((r) => (
              <Alert key={r.id} tone="danger">
                <strong>{r.customerName}</strong> ({r.partySize}) at {clock(r.startAt, tz)} has no
                table. Move a booking or seat them by hand.
              </Alert>
            ))}
            {atRisk.map((r) => (
              <Alert key={`risk-${r.id}`} tone="warning">
                <strong>{r.customerName}</strong> due {clock(r.startAt, tz)}, but{" "}
                {r.risk!.tableName} is likely busy until {clock(r.risk!.readyAt, tz)} (est.).{" "}
                <button
                  className="font-bold underline"
                  onClick={() =>
                    patch(
                      `/api/staff/reservations/${r.id}`,
                      { action: "move", avoidCurrent: true },
                      `Moved ${r.customerName}`,
                    )
                  }
                >
                  Move to a free table
                </button>
              </Alert>
            ))}
            {late.map((r) => (
              <Alert key={`late-${r.id}`} tone="warning">
                <strong>{r.customerName}</strong> is {r.lateMins} min late.{" "}
                {floor.policy.autoRelease
                  ? `Table releases at ${floor.policy.graceMins} min.`
                  : "Release it when you decide."}{" "}
                <button
                  className="font-bold underline"
                  onClick={() =>
                    patch(`/api/staff/reservations/${r.id}`, { action: "no_show" }, "Released")
                  }
                >
                  Release now
                </button>
              </Alert>
            ))}
            {cctv.map((t) => (
              <Alert key={`cctv-${t.id}`} tone="info">
                <Camera className="mr-1 inline size-3.5" />
                Camera: {t.name}{" "}
                {t.cctv!.empty ? "looks empty." : "has people but nobody seated it."}{" "}
                <button className="font-bold underline" onClick={() => setOpenTable(t.id)}>
                  Check
                </button>
              </Alert>
            ))}
          </Rail>
        )}

        <Rail
          title="Arriving"
          icon={<Clock className="size-4 text-brand-11" />}
          count={floor.upcoming.length}
          empty="No bookings in the next few hours."
        >
          {floor.upcoming.map((r) => (
            <ArrivalRow
              key={r.id}
              r={r}
              tz={tz}
              now={now}
              onSeat={() => setSeating(r)}
              onNoShow={() =>
                patch(`/api/staff/reservations/${r.id}`, { action: "no_show" }, "Marked as no-show")
              }
              onCancel={() =>
                patch(`/api/staff/reservations/${r.id}`, { action: "cancel" }, "Booking cancelled")
              }
            />
          ))}
        </Rail>

        <Rail
          title="Waiting list"
          icon={<Users className="size-4 text-tangerine-11" />}
          count={floor.waitlist.length}
          empty="Nobody waiting."
        >
          {floor.waitlist.map((w) => (
            <WaitRow
              key={w.id}
              w={w}
              tz={tz}
              now={now}
              onNotify={(tableId) =>
                patch(
                  `/api/staff/waitlist/${w.id}`,
                  { action: "notify", tableIds: [tableId] },
                  `${w.customerName} notified`,
                )
              }
              onSeat={(tableId) => setOpenTable(tableId)}
              onRemove={() =>
                patch(`/api/staff/waitlist/${w.id}`, { action: "cancel" }, "Removed from queue")
              }
            />
          ))}
        </Rail>

        {floor.messages.length > 0 && (
          <Rail
            title="WhatsApp to send"
            icon={<MessageCircle className="size-4 text-success-11" />}
            count={floor.messages.length}
          >
            <p className="text-xs text-gray-11">
              {floor.whatsappApi
                ? "These couldn't go out automatically. Send them from your phone."
                : "No WhatsApp API connected: tap to open WhatsApp with the message ready, send it, then tick it off."}
            </p>
            {floor.messages.map((m) => (
              <div key={m.id} className="rounded-xl bg-gray-2 p-2.5 ring-1 ring-gray-5">
                <p className="text-xs font-semibold text-gray-11">
                  {m.kind.replaceAll("_", " ").toLowerCase()} · {m.phone}
                </p>
                <p className="mt-1 line-clamp-2 text-sm text-gray-12">{m.body}</p>
                <div className="mt-2 flex gap-2">
                  <a
                    href={m.link}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex min-h-9 flex-1 items-center justify-center gap-1 rounded-lg bg-success-9 text-xs font-bold text-white hover:bg-success-10"
                  >
                    <MessageCircle className="size-3.5" /> Open WhatsApp
                  </a>
                  <button
                    onClick={() => patch(`/api/staff/messages/${m.id}`, {})}
                    className="min-h-9 rounded-lg px-3 text-xs font-semibold text-gray-12 ring-1 ring-gray-6 hover:bg-gray-3"
                  >
                    Sent
                  </button>
                </div>
              </div>
            ))}
          </Rail>
        )}
      </aside>

      {selected && (
        <TableSheet
          table={selected}
          floor={floor}
          now={now}
          onClose={() => setOpenTable(null)}
          onDone={async (msg) => {
            if (msg) say(msg);
            await refresh();
          }}
        />
      )}
      {seating && (
        <SeatArrivalDialog
          arrival={seating}
          floor={floor}
          onClose={() => setSeating(null)}
          onDone={async (msg) => {
            setSeating(null);
            say(msg);
            await refresh();
          }}
        />
      )}
      {dialog === "booking" && (
        <NewBookingDialog
          timeZone={tz}
          tables={floor.tables}
          onClose={() => setDialog(null)}
          onDone={async (msg) => {
            setDialog(null);
            say(msg);
            await refresh();
          }}
        />
      )}
      {dialog === "queue" && (
        <QueueDialog
          onClose={() => setDialog(null)}
          onDone={async (msg) => {
            setDialog(null);
            say(msg);
            await refresh();
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          className="animate-toast-pop fixed bottom-6 left-1/2 z-50 flex items-center gap-2 rounded-full bg-brand-9 px-4 py-2.5 text-sm font-semibold text-white shadow-lg"
        >
          <CheckCircle2 className="size-4 text-tangerine-8" /> {toast}
        </div>
      )}
    </div>
  );
}

function TableTile({
  t,
  now,
  tz,
  onOpen,
}: {
  t: FloorTable;
  now: number;
  tz: string;
  onOpen: () => void;
}) {
  const style = STATUS_STYLE[t.status];
  const onBill = t.status === "BILL";
  let line1 = `${t.seats} seats`;
  let line2: string | null = null;
  if (t.status === "OCCUPIED" || t.status === "BILL") {
    line1 = `${t.partySize ?? "?"} · ${minsSince(t.seatedAt, now)} min`;
    if (t.estimate) {
      const m = minsUntil(t.estimate.freeAt, now);
      line2 =
        t.estimate.overdueMins > 10
          ? `over by ${t.estimate.overdueMins}m`
          : m <= 2
            ? "free any min"
            : `free ~${clock(t.estimate.freeAt, tz)}`;
    }
  } else if (t.status === "RESERVED" && t.heldBy) {
    line1 = `${t.heldBy.customerName.split(" ")[0]} ×${t.heldBy.partySize}`;
    line2 = t.heldBy.lateMins > 0 ? `late ${t.heldBy.lateMins}m` : clock(t.heldBy.startAt, tz);
  } else if (t.status === "CLEANING") {
    line1 = `${minsSince(t.leftAt, now)} min`;
  } else if (t.offeredTo) {
    line2 = `offered: ${t.offeredTo.split(" ")[0]}`;
  } else if (t.next) {
    line2 = `next ${clock(t.next.startAt, tz)}`;
  }
  return (
    <button
      onClick={onOpen}
      className={cn(
        "relative flex aspect-[4/3] flex-col items-center justify-center rounded-2xl border-2 p-2 text-center transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tangerine-8 motion-reduce:hover:translate-y-0",
        style.tile,
      )}
      aria-label={`${t.name}, ${style.label}${line2 ? `, ${line2}` : ""}`}
    >
      {t.cctv && (
        <Camera
          className={cn(
            "absolute top-2 right-2 size-3.5",
            onBill ? "text-on-tangerine" : "text-info-11",
          )}
        />
      )}
      {t.estimate?.overdueMins ? (
        <span
          className="absolute top-2 left-2 h-2 w-2 rounded-full bg-danger-9"
          aria-hidden="true"
        />
      ) : null}
      <UtensilsCrossed className={cn("size-5", style.icon)} />
      <span
        className={cn(
          "mt-1 text-lg leading-tight font-black",
          onBill ? "text-on-tangerine" : "text-gray-12",
        )}
      >
        {t.name.replace(/^Table\s+/i, "")}
      </span>
      <span className={cn("text-xs font-bold", onBill ? "text-on-tangerine" : "text-gray-12")}>
        {style.label}
      </span>
      <span
        className={cn("text-[11px] tabular-nums", onBill ? "text-on-tangerine/80" : "text-gray-11")}
      >
        {line1}
      </span>
      {line2 && (
        <span
          className={cn(
            "text-[11px] font-semibold tabular-nums",
            onBill ? "text-on-tangerine" : "text-gray-12",
          )}
        >
          {line2}
        </span>
      )}
    </button>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-11">
      {(Object.keys(STATUS_STYLE) as Status[]).map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <span className={cn("h-2.5 w-2.5 rounded-full", STATUS_STYLE[s].dot)} />{" "}
          {STATUS_STYLE[s].label}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-danger-9" /> Over its estimate
      </li>
      <li>&ldquo;~&rdquo; times are estimates; only a cleaned table is confirmed free.</li>
    </ul>
  );
}

function Rail({
  title,
  icon,
  count,
  empty,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count?: number;
  empty?: string;
  children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children)
    ? children.flat().filter(Boolean).length > 0
    : !!children;
  return (
    <section className="rounded-2xl bg-panel p-3 ring-1 ring-gray-5">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-gray-12">
        {icon} {title}
        {count != null && count > 0 && (
          <span className="ml-auto rounded-full bg-gray-4 px-2 text-xs text-gray-11">{count}</span>
        )}
      </h2>
      <div className="space-y-2">
        {hasChildren ? children : <p className="text-sm text-gray-11">{empty}</p>}
      </div>
    </section>
  );
}

function Alert({
  tone,
  children,
}: {
  tone: "danger" | "warning" | "info";
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "rounded-lg p-2.5 text-sm",
        tone === "danger" && "bg-danger-3 text-danger-12",
        tone === "warning" && "bg-tangerine-3 text-tangerine-12",
        tone === "info" && "bg-info-3 text-info-12",
      )}
    >
      {children}
    </p>
  );
}

function ArrivalRow({
  r,
  tz,
  now,
  onSeat,
  onNoShow,
  onCancel,
}: {
  r: Arrival;
  tz: string;
  now: number;
  onSeat: () => void;
  onNoShow: () => void;
  onCancel: () => void;
}) {
  const [more, setMore] = useState(false);
  const inMins = minsUntil(r.startAt, now);
  return (
    <div className="rounded-xl bg-gray-2 p-2.5 ring-1 ring-gray-5">
      <div className="flex items-start gap-2">
        <div className="w-14 shrink-0 text-center">
          <p className="text-sm font-black text-gray-12 tabular-nums">{clock(r.startAt, tz)}</p>
          <p
            className={cn(
              "text-[11px] font-semibold",
              r.lateMins > 0 ? "text-danger-11" : "text-gray-11",
            )}
          >
            {r.lateMins > 0 ? `late ${r.lateMins}m` : inMins <= 0 ? "now" : `in ${inMins}m`}
          </p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-gray-12">
            {r.customerName} <span className="font-semibold text-gray-11">×{r.partySize}</span>
          </p>
          <p className="truncate text-xs text-gray-11">
            {r.tables.length ? r.tables.map((t) => t.name).join(" + ") : "No table"} · {r.code}
            {r.guestConfirmed && (
              <span className="ml-1 font-semibold text-success-11">✓ coming</span>
            )}
            {r.lateUntil && (
              <span className="ml-1 font-semibold text-tangerine-11">
                late ETA {clock(r.lateUntil, tz)}
              </span>
            )}
          </p>
          {r.note && <p className="mt-0.5 truncate text-xs text-gray-12 italic">“{r.note}”</p>}
        </div>
        <button
          onClick={onSeat}
          className="min-h-9 shrink-0 rounded-lg bg-brand-9 px-3 text-xs font-bold text-white hover:bg-brand-10"
        >
          Seat
        </button>
      </div>
      <button
        onClick={() => setMore(!more)}
        className="mt-1 text-[11px] font-semibold text-gray-11 underline"
      >
        {more ? "Less" : "More"}
      </button>
      {more && (
        <div className="mt-2 flex gap-2">
          <button
            onClick={onNoShow}
            className="min-h-9 flex-1 rounded-lg text-xs font-semibold text-gray-12 ring-1 ring-gray-6 hover:bg-gray-3"
          >
            No-show
          </button>
          <button
            onClick={onCancel}
            className="min-h-9 flex-1 rounded-lg text-xs font-semibold text-danger-11 ring-1 ring-danger-6 hover:bg-danger-2"
          >
            Cancel booking
          </button>
        </div>
      )}
    </div>
  );
}

function WaitRow({
  w,
  tz,
  now,
  onNotify,
  onSeat,
  onRemove,
}: {
  w: Waiting;
  tz: string;
  now: number;
  onNotify: (tableId: string) => void;
  onSeat: (tableId: string) => void;
  onRemove: () => void;
}) {
  const notified = w.status === "NOTIFIED";
  const eta = w.etaAt ? minsUntil(w.etaAt, now) : null;
  return (
    <div
      className={cn(
        "rounded-xl p-2.5 ring-1",
        notified ? "bg-tangerine-2 ring-tangerine-7" : "bg-gray-2 ring-gray-5",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-4 text-sm font-black text-gray-12">
          {notified ? <BellRing className="size-4 text-tangerine-11" /> : (w.position ?? "–")}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-gray-12">
            {w.customerName} <span className="font-semibold text-gray-11">×{w.partySize}</span>
          </p>
          <p className="text-xs text-gray-11">
            <UserRound className="mr-0.5 inline size-3" />
            {w.source === "DOOR" ? "at the door" : "remote"} · waited {minsSince(w.joinedAt, now)}m
            {notified
              ? ` · offered ${w.offeredTables.join(" + ")}, reply by ${clock(w.respondBy, tz)}`
              : eta != null
                ? ` · ~${Math.max(0, eta)}m${w.suggestedTable ? ` (${w.suggestedTable.name})` : ""}`
                : " · no table fits"}
          </p>
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        {w.suggestedTable && !notified && (
          <button
            onClick={() => onNotify(w.suggestedTable!.id)}
            className="min-h-9 flex-1 rounded-lg bg-tangerine-9 text-xs font-bold text-on-tangerine hover:bg-tangerine-10"
          >
            Offer {w.suggestedTable.name}
          </button>
        )}
        {w.suggestedTable && (
          <button
            onClick={() => onSeat(w.suggestedTable!.id)}
            className="min-h-9 flex-1 rounded-lg bg-brand-9 text-xs font-bold text-white hover:bg-brand-10"
          >
            Seat
          </button>
        )}
        <button
          onClick={onRemove}
          className="min-h-9 rounded-lg px-3 text-xs font-semibold text-gray-11 ring-1 ring-gray-6 hover:bg-gray-3"
        >
          Remove
        </button>
      </div>
    </div>
  );
}
