"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import {
  AlertTriangle,
  CalendarPlus,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  GanttChart,
  LayoutGrid,
  List,
  ListPlus,
  Map as MapIcon,
  MessageCircle,
  Search,
  UserPlus,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { useLiveRevision } from "@/lib/useLiveRevision";
import { cn } from "@/lib/utils";
import { clock, type Floor, type FloorTable, type Waiting } from "@/components/floor/types";
import { QueueDialog, TableSheet } from "@/components/floor/FloorDialogs";
import { FloorLegend, FloorView } from "./FloorView";
import { projectFloor } from "@/lib/reservations/project";
import { Timeline } from "./Timeline";
import { BookList, segmentOf, type Segment } from "./BookList";
import { ReservationPanel } from "./ReservationPanel";
import { BookingForm } from "./BookingForm";
import { WalkInDialog } from "./WalkIn";
import {
  addDays,
  Badges,
  btn,
  dayLabel,
  localDateKey,
  seatsOf,
  tableFit,
  type BookEntry,
  type Placing,
} from "./shared";

const fetcher = (url: string) =>
  fetch(url, { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });

type View = "floor" | "timeline" | "list";

/**
 * The host stand. One screen for the door, for every role: the room, the
 * night's timeline and the guest list are three views of the same thing.
 * Pick a guest, tap a table. Everything else is one level down.
 */
export default function HostWorkspace({
  initial,
  initialBook,
  initialDate,
  isAdmin,
  bookingPath,
}: {
  initial: Floor;
  initialBook: BookEntry[];
  initialDate?: string;
  isAdmin: boolean;
  bookingPath: string;
}) {
  const { data: floorData, mutate: mutateFloor } = useSWR<Floor>("/api/staff/floor", fetcher, {
    fallbackData: initial,
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  });
  const floor = floorData ?? initial;
  const tz = floor.restaurant.timeZone;
  const today = floor.today;

  const [date, setDate] = useState(initialDate ?? today);
  const isToday = date === today;
  const { data: bookData, mutate: mutateBook } = useSWR<{ reservations: BookEntry[] }>(
    `/api/staff/reservations?date=${date}`,
    fetcher,
    {
      refreshInterval: 30_000,
      keepPreviousData: true,
      fallbackData:
        date === (initialDate ?? initial.today) ? { reservations: initialBook } : undefined,
    },
  );
  const bookings = bookData?.reservations ?? null;

  const [revision, setRevision] = useState(0);
  const refresh = useCallback(async () => {
    setRevision((r) => r + 1);
    await Promise.all([mutateFloor(), mutateBook()]);
  }, [mutateFloor, mutateBook]);
  useLiveRevision(useCallback(() => void refresh(), [refresh]));

  // Start from the server's clock so the first render matches the HTML.
  const [now, setNow] = useState(() => new Date(initial.now).getTime());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);

  const [view, setViewState] = useState<View>(
    initialDate && initialDate !== initial.today ? "timeline" : "floor",
  );
  // What the big pane shows when the guest list has the phone screen.
  const [mainView, setMainView] = useState<"floor" | "timeline">(
    initialDate && initialDate !== initial.today ? "timeline" : "floor",
  );
  const setView = useCallback((v: View) => {
    setViewState(v);
    if (v !== "list") setMainView(v);
  }, []);
  // The drawn room by default; cards for anyone who prefers a list of tiles.
  const [floorMode, setFloorMode] = useState<"room" | "cards">("room");
  const [zoom, setZoom] = useState(1);
  // Minutes ahead of now the room is played forward to (0 = live).
  const [ahead, setAhead] = useState(0);

  const [area, setArea] = useState("All");
  const [segment, setSegment] = useState<Segment>("upcoming");
  const [openId, setOpenId] = useState<string | null>(null);
  const [tableId, setTableId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: "walkin" }
    | { kind: "book"; time?: string; tableId?: string }
    | { kind: "queue" }
    | null
  >(null);
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [held, setHeld] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const say = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  // ---- Search ----
  const [q, setQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const { data: hits } = useSWR<{ reservations: BookEntry[] }>(
    q.trim().length >= 2 ? `/api/staff/reservations?q=${encodeURIComponent(q.trim())}` : null,
    fetcher,
    { keepPreviousData: true },
  );
  const searchRef = useRef<HTMLInputElement>(null);

  function openBooking(b: BookEntry) {
    const d = localDateKey(b.startAt, tz);
    if (d !== date) setDate(d);
    setSegment(segmentOf(b));
    setOpenId(b.id);
    setSearchOpen(false);
  }

  // ---- Placing a party at tables ----
  function startPlacing(p: Placing) {
    setPlacing(p);
    setPicked([]);
    setHeld(null);
    setError(null);
    setOpenId(null);
    setDialog(null);
    if (p.kind === "booking" && !p.seatNow && date !== today) setView("timeline");
    else if (view === "list") setView(mainView);
  }

  function seatBooking(b: BookEntry) {
    startPlacing({
      kind: "booking",
      id: b.id,
      name: b.customerName,
      party: b.partySize,
      current: b.tables.map((t) => t.id),
      seatNow: true,
    });
    // The planned tables are pre-picked when they're free: one more tap seats.
    const planned = b.tables
      .map((t) => floor.tables.find((x) => x.id === t.id))
      .filter(Boolean) as FloorTable[];
    const p = {
      kind: "booking" as const,
      id: b.id,
      name: b.customerName,
      party: b.partySize,
      current: [],
      seatNow: true,
    };
    if (planned.length && planned.every((t) => tableFit(t, p) !== "no"))
      setPicked(planned.map((t) => t.id));
  }

  function cancelPlacing() {
    setPlacing(null);
    setPicked([]);
    setHeld(null);
  }

  function onTable(t: FloorTable) {
    if (!placing) {
      setTableId(t.id);
      return;
    }
    const fit = isToday ? tableFit(t, placing) : "fits";
    const moving = placing.kind === "booking" && !placing.seatNow;
    if (fit === "no" && !moving) {
      setError(`${t.name} isn't free. Pick a green table.`);
      return;
    }
    setError(null);
    setHeld(null);
    setPicked((cur) => (cur.includes(t.id) ? cur.filter((x) => x !== t.id) : [...cur, t.id]));
  }

  const pickedSeats = seatsOf(floor, picked);
  const enough = placing
    ? pickedSeats >= placing.party ||
      (placing.kind === "booking" && !placing.seatNow && picked.length > 0)
    : false;

  async function confirmPlacing(force = false) {
    if (!placing || picked.length === 0) return;
    await placeAt(placing, picked, force);
  }

  async function placeAt(placing: Placing, picked: string[], force = false) {
    setBusy(true);
    setError(null);
    let res: Awaited<ReturnType<typeof apiFetch<Record<string, unknown>>>>;
    let msg = "";
    const names = picked.map((id) => floor.tables.find((t) => t.id === id)?.name).join(" + ");
    if (placing.kind === "booking") {
      res = await apiFetch(
        `/api/staff/reservations/${placing.id}`,
        "PATCH",
        placing.seatNow
          ? { action: "seat", tableIds: picked }
          : { action: "move", tableIds: picked },
      );
      msg = placing.seatNow
        ? `${placing.name} seated at ${names}`
        : `${placing.name} moved to ${names}`;
    } else if (picked.length === 1) {
      res = await apiFetch(`/api/staff/floor/tables/${picked[0]}`, "POST", {
        action: "SEAT",
        partySize: placing.party,
        ...(placing.kind === "wait" ? { waitlistEntryId: placing.id } : {}),
        ...(force ? { force: true } : {}),
      });
      msg =
        placing.kind === "wait"
          ? `${placing.name} seated at ${names}`
          : `Seated ${placing.party} at ${names}`;
    } else if (placing.kind === "walkin") {
      // Tables pushed together: a walk-in booking for now, then seat it.
      const made = await apiFetch<{ id: string }>("/api/staff/reservations", "POST", {
        customerName: "Walk-in",
        partySize: placing.party,
        startAt: new Date().toISOString(),
        tableIds: picked,
        source: "WALK_IN",
      });
      res = made.ok
        ? await apiFetch(`/api/staff/reservations/${made.data.id}`, "PATCH", {
            action: "seat",
            tableIds: picked,
          })
        : made;
      msg = `Seated ${placing.party} at ${names}`;
    } else {
      res = {
        ok: false,
        error: "Seat a waiting party at one table, or book them in for now and seat the booking.",
      };
    }
    setBusy(false);
    if (!res.ok) {
      if (res.body?.code === "HELD") setHeld(res.error);
      else setError(res.error);
      return;
    }
    cancelPlacing();
    say(msg);
    await refresh();
  }

  // ---- Drag a guest from the list onto a table ----
  const [drag, setDrag] = useState<{
    p: Placing;
    label: string;
    x: number;
    y: number;
    over: string | null;
  } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  const startDrag = useCallback((e: React.PointerEvent, p: Placing, label: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setAhead(0);
    setDrag({ p, label, x: e.clientX, y: e.clientY, over: null });
  }, []);

  const dragging = drag != null;
  useEffect(() => {
    if (!dragging) return;
    const tableAt = (x: number, y: number) =>
      (document.elementFromPoint(x, y)?.closest("[data-table-id]") as HTMLElement | null)?.dataset
        .tableId ?? null;
    const move = (e: PointerEvent) =>
      setDrag((d) =>
        d ? { ...d, x: e.clientX, y: e.clientY, over: tableAt(e.clientX, e.clientY) } : d,
      );
    const up = (e: PointerEvent) => {
      const d = dragRef.current;
      setDrag(null);
      const id = tableAt(e.clientX, e.clientY);
      if (d && id) dropOn(d.p, id);
    };
    const cancel = () => setDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
    // dropOn reads the latest floor through state at drop time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  function dropOn(p: Placing, id: string) {
    const t = floor.tables.find((x) => x.id === id);
    if (!t) return;
    const fit = tableFit(t, p);
    if (fit === "no") {
      setError(
        `${t.name} isn't free. Drop ${p.kind === "walkin" ? "them" : p.name} on a green table.`,
      );
      return;
    }
    setPlacing(p);
    setPicked([id]);
    setHeld(null);
    setError(null);
    setOpenId(null);
    // One table big enough: seat straight away. Otherwise the bar asks for
    // a second table to push together.
    if (t.seats >= p.party) void placeAt(p, [id]);
  }

  // ---- The room played forward ----
  const projection = useMemo(() => {
    if (!isToday || ahead === 0) return null;
    return projectFloor(
      floor.tables.map((t) => ({
        id: t.id,
        seats: t.seats,
        status: t.status,
        partySize: t.partySize,
        leftAt: t.leftAt,
        estimate: t.estimate ? { freeAt: t.estimate.freeAt, readyAt: t.estimate.readyAt } : null,
      })),
      bookings ?? [],
      now + ahead * 60_000,
      { holdMins: floor.policy.holdMinsBefore, cleaningMins: floor.policy.cleaningMins },
    );
  }, [isToday, ahead, floor, bookings, now]);

  // ---- Attention ----
  const late = floor.upcoming.filter((r) => r.lateMins > 0 && !r.arrivedAt);
  const atRisk = floor.upcoming.filter((r) => r.risk);
  const cctv = floor.tables.filter((t) => t.cctv);
  const attention = floor.needsTable.length + late.length + atRisk.length + cctv.length;

  async function quick(url: string, body: unknown, done: string) {
    setError(null);
    const res = await apiFetch(url, "PATCH", body);
    if (!res.ok) return setError(res.error);
    say(done);
    await refresh();
  }

  const freeNow = floor.counts.AVAILABLE + floor.counts.READY;
  const arrivingSoon = floor.upcoming.filter(
    (r) => new Date(r.startAt).getTime() - now < 2 * 3600_000,
  ).length;
  const selectedTable = floor.tables.find((t) => t.id === tableId) ?? null;
  const showMain = view !== "list";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="sticky top-0 z-20 border-b border-gray-5 bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[96rem] flex-wrap items-center gap-2 px-3 py-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setDate(addDays(date, -1))}
              aria-label="Previous day"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-panel ring-1 ring-gray-5 hover:bg-gray-3"
            >
              <ChevronLeft className="size-4" />
            </button>
            <label className="relative">
              <span className="sr-only">Date</span>
              <span
                className={cn(
                  "flex min-h-10 min-w-36 items-center justify-center rounded-full px-3 text-sm font-bold ring-1",
                  isToday
                    ? "bg-brand-9 text-white ring-brand-9"
                    : "bg-panel text-gray-12 ring-gray-5",
                )}
              >
                {dayLabel(date, today)}
              </span>
              <input
                type="date"
                value={date}
                onChange={(e) => e.target.value && setDate(e.target.value)}
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label="Pick a date"
              />
            </label>
            <button
              onClick={() => setDate(addDays(date, 1))}
              aria-label="Next day"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-panel ring-1 ring-gray-5 hover:bg-gray-3"
            >
              <ChevronRight className="size-4" />
            </button>
            {!isToday && (
              <button
                onClick={() => setDate(today)}
                className="min-h-10 px-2 text-sm font-semibold text-brand-11 underline"
              >
                Today
              </button>
            )}
          </div>

          <div className="relative order-last w-full sm:order-none sm:w-auto sm:min-w-64 sm:flex-1 lg:max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-gray-11" />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Find a booking: name, phone, code"
              aria-label="Find a booking"
              className="min-h-10 w-full rounded-full bg-panel pr-9 pl-9 text-sm text-gray-12 ring-1 ring-gray-5 outline-none focus:ring-2 focus:ring-brand-8"
            />
            {q && (
              <button
                onClick={() => {
                  setQ("");
                  setSearchOpen(false);
                }}
                aria-label="Clear search"
                className="absolute top-1/2 right-2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-gray-11 hover:bg-gray-3"
              >
                <X className="size-4" />
              </button>
            )}
            {searchOpen && q.trim().length >= 2 && (
              <div className="absolute top-12 right-0 left-0 z-30 max-h-96 overflow-y-auto rounded-2xl bg-panel p-1 shadow-xl ring-1 ring-gray-5">
                {!hits ? (
                  <p className="p-3 text-sm text-gray-11">Searching…</p>
                ) : hits.reservations.length === 0 ? (
                  <p className="p-3 text-sm text-gray-11">No booking matches &ldquo;{q}&rdquo;.</p>
                ) : (
                  hits.reservations.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => openBooking(b)}
                      className="flex w-full items-start gap-3 rounded-xl p-2 text-left hover:bg-gray-3"
                    >
                      <span className="w-24 shrink-0 text-xs text-gray-11">
                        <span className="block font-bold text-gray-12">
                          {dayLabel(localDateKey(b.startAt, tz), today)}
                        </span>
                        {clock(b.startAt, tz)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-gray-12">
                          {b.customerName} ×{b.partySize}
                        </span>
                        <span className="block truncate text-xs text-gray-11">
                          {b.code} · {b.phone ?? "no number"} ·{" "}
                          {b.status.toLowerCase().replace("_", "-")}
                        </span>
                        <Badges guest={b.guest} tags={b.tags} max={3} className="mt-0.5" />
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setDialog({ kind: "walkin" })}
              disabled={!isToday}
              className={cn(btn.accent, "min-h-10 px-3")}
              title={isToday ? "" : "Walk-ins are for today"}
            >
              <UserPlus className="size-4" /> <span>Walk-in</span>
            </button>
            <button
              onClick={() => setDialog({ kind: "book" })}
              className={cn(btn.primary, "min-h-10 px-3")}
            >
              <CalendarPlus className="size-4" /> <span className="hidden sm:inline">Booking</span>
            </button>
            <button
              onClick={() => setDialog({ kind: "queue" })}
              disabled={!isToday}
              aria-label="Add to waiting list"
              className={cn(btn.quiet, "min-h-10 px-3")}
            >
              <ListPlus className="size-4" /> <span className="hidden xl:inline">Waitlist</span>
            </button>
          </div>
        </div>

        {/* View switch + quick numbers */}
        <div className="mx-auto flex w-full max-w-[96rem] items-center gap-2 overflow-x-auto px-3 pb-2">
          <div
            role="tablist"
            aria-label="View"
            className="flex shrink-0 gap-1 rounded-xl bg-gray-3 p-1"
          >
            {(
              [
                ["floor", "Floor", MapIcon],
                ["timeline", "Timeline", GanttChart],
                ["list", "Guests", List],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                role="tab"
                aria-selected={view === key}
                onClick={() => setView(key)}
                className={cn(
                  "flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-bold",
                  key === "list" && "lg:hidden",
                  view === key || (view === "list" && mainView === key)
                    ? cn(
                        "bg-panel text-gray-12 shadow-sm",
                        view === "list" &&
                          key !== "list" &&
                          "max-lg:bg-transparent max-lg:text-gray-11 max-lg:shadow-none",
                      )
                    : "text-gray-11 hover:text-gray-12",
                )}
              >
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>
          {isToday && (
            <div className="flex shrink-0 items-center gap-3 text-xs text-gray-11">
              <span>
                <strong className="text-base font-black text-success-11 tabular-nums">
                  {freeNow}
                </strong>{" "}
                free
              </span>
              <span>
                <strong className="text-base font-black text-tangerine-11 tabular-nums">
                  {floor.covers}
                </strong>{" "}
                guests in
              </span>
              <span>
                <strong className="text-base font-black text-brand-11 tabular-nums">
                  {arrivingSoon}
                </strong>{" "}
                due in 2h
              </span>
              <span>
                <strong className="text-base font-black text-gray-12 tabular-nums">
                  {floor.waitlist.length}
                </strong>{" "}
                waiting
              </span>
            </div>
          )}
          {floor.areas.length > 1 && showMain && (
            <div className="ml-auto flex shrink-0 gap-1">
              {["All", ...floor.areas].map((a) => (
                <button
                  key={a}
                  onClick={() => setArea(a)}
                  aria-pressed={area === a}
                  className={cn(
                    "min-h-9 rounded-full px-3 text-xs font-semibold",
                    area === a
                      ? "bg-brand-9 text-white"
                      : "bg-panel text-gray-11 ring-1 ring-gray-5",
                  )}
                >
                  {a}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto grid min-h-0 w-full max-w-[96rem] flex-1 gap-4 px-3 py-3 lg:grid-cols-[23rem_1fr]">
        {/* Guest list column */}
        <aside
          className={cn("min-w-0 flex-col gap-3", view === "list" ? "flex" : "hidden lg:flex")}
          aria-label="Guests"
        >
          {isToday && attention > 0 && (
            <section className="space-y-1.5 rounded-2xl bg-panel p-2.5 ring-1 ring-tangerine-6">
              <h2 className="flex items-center gap-1.5 text-xs font-bold text-tangerine-11 uppercase">
                <AlertTriangle className="size-3.5" /> Needs attention
              </h2>
              {floor.needsTable.map((r) => (
                <p key={r.id} className="rounded-lg bg-danger-3 p-2 text-xs text-danger-12">
                  <strong>{r.customerName}</strong> ×{r.partySize} at {clock(r.startAt, tz)} has no
                  table.{" "}
                  <button
                    className="font-bold underline"
                    onClick={() => {
                      setDate(localDateKey(r.startAt, tz));
                      setOpenId(r.id);
                    }}
                  >
                    Open
                  </button>
                </p>
              ))}
              {atRisk.map((r) => (
                <p
                  key={`risk${r.id}`}
                  className="rounded-lg bg-tangerine-3 p-2 text-xs text-tangerine-12"
                >
                  <strong>{r.customerName}</strong> due {clock(r.startAt, tz)}, {r.risk!.tableName}{" "}
                  likely busy until {clock(r.risk!.readyAt, tz)}.{" "}
                  <button
                    className="font-bold underline"
                    onClick={() =>
                      quick(
                        `/api/staff/reservations/${r.id}`,
                        { action: "move", avoidCurrent: true },
                        `Moved ${r.customerName}`,
                      )
                    }
                  >
                    Move to a free table
                  </button>
                </p>
              ))}
              {late.map((r) => (
                <p
                  key={`late${r.id}`}
                  className="rounded-lg bg-tangerine-3 p-2 text-xs text-tangerine-12"
                >
                  <strong>{r.customerName}</strong> is {r.lateMins} min late.{" "}
                  {floor.policy.autoRelease ? `Table frees at ${floor.policy.graceMins} min. ` : ""}
                  <button
                    className="font-bold underline"
                    onClick={() =>
                      quick(`/api/staff/reservations/${r.id}`, { action: "no_show" }, "Released")
                    }
                  >
                    Release now
                  </button>
                </p>
              ))}
              {cctv.map((t) => (
                <p key={`cctv${t.id}`} className="rounded-lg bg-info-3 p-2 text-xs text-info-12">
                  <Camera className="mr-1 inline size-3" /> Camera: {t.name}{" "}
                  {t.cctv!.empty ? "looks empty." : "has people but nobody seated it."}{" "}
                  <button className="font-bold underline" onClick={() => setTableId(t.id)}>
                    Check
                  </button>
                </p>
              ))}
            </section>
          )}

          <BookList
            floor={floor}
            bookings={bookings}
            date={date}
            now={now}
            segment={!isToday && segment === "waiting" ? "upcoming" : segment}
            onSegment={setSegment}
            selectedId={openId}
            onOpen={(b) => setOpenId(b.id)}
            onSeat={seatBooking}
            onWaitSeat={(w: Waiting) =>
              startPlacing({ kind: "wait", id: w.id, name: w.customerName, party: w.partySize })
            }
            onDrag={isToday ? startDrag : undefined}
            onWaitOffer={async (w: Waiting) => {
              if (w.suggestedTable && w.status !== "NOTIFIED") {
                await quick(
                  `/api/staff/waitlist/${w.id}`,
                  { action: "notify", tableIds: [w.suggestedTable.id] },
                  `${w.customerName} told their table is ready`,
                );
              } else if (confirm(`Remove ${w.customerName} from the waiting list?`)) {
                await quick(
                  `/api/staff/waitlist/${w.id}`,
                  { action: "cancel" },
                  "Removed from the waiting list",
                );
              }
            }}
          />

          {isToday && floor.messages.length > 0 && (
            <section className="space-y-2 rounded-2xl bg-panel p-2.5 ring-1 ring-gray-5">
              <h2 className="flex items-center gap-1.5 text-xs font-bold text-success-11 uppercase">
                <MessageCircle className="size-3.5" /> WhatsApp to send ({floor.messages.length})
              </h2>
              <p className="text-xs text-gray-11">
                {floor.whatsappApi
                  ? "These couldn't go out automatically."
                  : "Tap to open WhatsApp with the message ready, send it, then tick it off."}
              </p>
              {floor.messages.map((m) => (
                <div key={m.id} className="rounded-xl bg-gray-2 p-2 ring-1 ring-gray-5">
                  <p className="text-[11px] font-semibold text-gray-11">
                    {m.kind.replaceAll("_", " ").toLowerCase()} · {m.phone}
                  </p>
                  <p className="line-clamp-2 text-xs text-gray-12">{m.body}</p>
                  <div className="mt-1.5 flex gap-2">
                    <a
                      href={m.link}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="flex min-h-9 flex-1 items-center justify-center gap-1 rounded-lg bg-success-9 text-xs font-bold text-white hover:bg-success-10"
                    >
                      <MessageCircle className="size-3.5" /> Open WhatsApp
                    </a>
                    <button
                      onClick={() => quick(`/api/staff/messages/${m.id}`, {}, "Marked as sent")}
                      className="min-h-9 rounded-lg px-3 text-xs font-semibold text-gray-12 ring-1 ring-gray-6 hover:bg-gray-3"
                    >
                      Sent
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}
          <a
            href={bookingPath}
            target="_blank"
            rel="noreferrer"
            className="text-center text-xs font-semibold text-gray-11 underline"
          >
            Open the guest booking page
          </a>
        </aside>

        {/* Floor or timeline */}
        <section
          className={cn("min-w-0 space-y-3", !showMain && "hidden lg:block")}
          aria-label={mainView === "floor" ? "Floor" : "Timeline"}
        >
          {error && !placing && (
            <p
              role="alert"
              className="flex items-start justify-between gap-2 rounded-xl bg-danger-3 p-3 text-sm text-danger-12"
            >
              {error}
              <button onClick={() => setError(null)} aria-label="Dismiss">
                <X className="size-4" />
              </button>
            </p>
          )}
          {mainView === "floor" ? (
            isToday ? (
              <>
                <RoomControls
                  ahead={ahead}
                  setAhead={(m) => {
                    setAhead(m);
                    if (m > 0) cancelPlacing();
                  }}
                  now={now}
                  tz={tz}
                  projection={projection}
                  floorMode={floorMode}
                  setFloorMode={setFloorMode}
                  zoom={zoom}
                  setZoom={setZoom}
                />
                {floor.learning && ahead === 0 && (
                  <p className="text-xs text-gray-11">
                    Free-up times are rough until Mezbaan has learned from your own meals (
                    {floor.mealsLearned} so far). Tap &ldquo;Guests left&rdquo; when tables empty.
                  </p>
                )}
                <FloorView
                  floor={floor}
                  now={now}
                  area={area}
                  mode={floorMode}
                  placing={placing}
                  picked={picked}
                  projection={projection?.byTable ?? null}
                  dropTarget={drag?.over ?? null}
                  zoom={zoom}
                  onTable={onTable}
                />
                <FloorLegend />
              </>
            ) : (
              <div className="rounded-2xl bg-panel p-6 text-center ring-1 ring-gray-5">
                <p className="font-bold text-gray-12">The live floor shows today.</p>
                <p className="mt-1 text-sm text-gray-11">
                  For {dayLabel(date, today)}, use the timeline to see and change who sits where.
                </p>
                <button onClick={() => setView("timeline")} className={cn(btn.primary, "mt-3")}>
                  <GanttChart className="size-4" /> Open the timeline
                </button>
              </div>
            )
          ) : (
            <Timeline
              floor={floor}
              bookings={bookings ?? []}
              date={date}
              now={now}
              area={area}
              placing={placing}
              picked={picked}
              onBooking={(id) => {
                if (!placing) setOpenId(id);
              }}
              onEmpty={(tid, time) => {
                if (placing) onTable(floor.tables.find((t) => t.id === tid)!);
                else setDialog({ kind: "book", time, tableId: tid });
              }}
              onRow={onTable}
            />
          )}
        </section>
      </div>

      {/* Placing bar */}
      {placing && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-5 bg-panel/95 p-3 shadow-2xl backdrop-blur"
          role="region"
          aria-label="Choose a table"
        >
          <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-gray-12">
                {placing.kind === "walkin"
                  ? `Walk-in ×${placing.party}`
                  : `${placing.name} ×${placing.party}`}
                {picked.length > 0 &&
                  ` → ${picked.map((id) => floor.tables.find((t) => t.id === id)?.name).join(" + ")}`}
              </p>
              <p className="text-xs text-gray-11">
                {picked.length === 0
                  ? isToday && !(placing.kind === "booking" && !placing.seatNow)
                    ? "Tap a green table. Dashed ones can be pushed together."
                    : "Tap a table row to move the booking there."
                  : enough
                    ? `${pickedSeats} seats picked.`
                    : `${pickedSeats} of ${placing.party} seats: pick another table to push together.`}
              </p>
              {(error || held) && (
                <p role="alert" className="mt-1 text-xs font-semibold text-danger-11">
                  {held ?? error}
                </p>
              )}
            </div>
            <button onClick={cancelPlacing} className={btn.quiet}>
              Cancel
            </button>
            {held ? (
              <button
                onClick={() => void confirmPlacing(true)}
                disabled={busy}
                className={btn.accent}
              >
                Seat anyway
              </button>
            ) : (
              <button
                onClick={() => void confirmPlacing()}
                disabled={!enough || busy}
                className={cn(btn.primary, "min-w-32")}
              >
                <CheckCircle2 className="size-4" />
                {placing.kind === "booking" && !placing.seatNow ? "Move here" : "Seat"}
              </button>
            )}
          </div>
        </div>
      )}

      {openId && !placing && (
        <ReservationPanel
          id={openId}
          floor={floor}
          isAdmin={isAdmin}
          now={now}
          revision={revision}
          onClose={() => setOpenId(null)}
          onChanged={async (msg) => {
            if (msg) say(msg);
            await refresh();
          }}
          onSeat={seatBooking}
          onChangeTable={(b) =>
            startPlacing({
              kind: "booking",
              id: b.id,
              name: b.customerName,
              party: b.partySize,
              current: b.tables.map((t) => t.id),
              seatNow: false,
            })
          }
        />
      )}
      {selectedTable && !placing && (
        <TableSheet
          table={selectedTable}
          floor={floor}
          now={now}
          onClose={() => setTableId(null)}
          onDone={async (msg) => {
            if (msg) say(msg);
            await refresh();
          }}
        />
      )}
      {dialog?.kind === "walkin" && (
        <WalkInDialog
          floor={floor}
          now={now}
          onClose={() => setDialog(null)}
          onDone={async (msg) => {
            setDialog(null);
            say(msg);
            await refresh();
          }}
          onPickOnFloor={(party) => {
            if (view !== "floor") setView("floor");
            startPlacing({ kind: "walkin", party });
          }}
        />
      )}
      {dialog?.kind === "book" && (
        <BookingForm
          floor={floor}
          date={date}
          time={dialog.time}
          tableId={dialog.tableId}
          onClose={() => setDialog(null)}
          onDone={async (msg, id, d) => {
            setDialog(null);
            say(msg);
            setDate(d);
            setSegment("upcoming");
            await refresh();
            setOpenId(id);
          }}
        />
      )}
      {dialog?.kind === "queue" && (
        <QueueDialog
          onClose={() => setDialog(null)}
          onDone={async (msg) => {
            setDialog(null);
            say(msg);
            await refresh();
          }}
        />
      )}

      {drag && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[60] -translate-x-1/2 -translate-y-[130%] rounded-full bg-brand-9 px-3 py-1.5 text-sm font-bold whitespace-nowrap text-white shadow-xl"
          style={{ left: drag.x, top: drag.y }}
        >
          {drag.label}
          {drag.over
            ? ` → ${floor.tables.find((t) => t.id === drag.over)?.name ?? ""}`
            : " · drop on a table"}
        </div>
      )}

      {toast && (
        <div
          role="status"
          className={cn(
            "animate-toast-pop fixed left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-brand-9 px-4 py-2.5 text-sm font-semibold text-white shadow-lg",
            placing ? "bottom-24" : "bottom-6",
          )}
        >
          <CheckCircle2 className="size-4 text-tangerine-8" /> {toast}
        </div>
      )}
    </div>
  );
}

const AHEAD_STEPS = 16; // 4 hours in 15-minute steps

/**
 * Above the room: play the night forward with a slider, switch between the
 * drawn room and cards, and zoom on small screens.
 */
function RoomControls({
  ahead,
  setAhead,
  now,
  tz,
  projection,
  floorMode,
  setFloorMode,
  zoom,
  setZoom,
}: {
  ahead: number;
  setAhead: (m: number) => void;
  now: number;
  tz: string;
  projection: ReturnType<typeof projectFloor> | null;
  floorMode: "room" | "cards";
  setFloorMode: (m: "room" | "cards") => void;
  zoom: number;
  setZoom: (z: number) => void;
}) {
  const at = clock(new Date(now + ahead * 60_000).toISOString(), tz);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-panel p-2 ring-1 ring-gray-5">
        <label className="flex min-w-0 flex-1 items-center gap-3">
          <span className="w-24 shrink-0 text-xs font-bold text-gray-12">
            {ahead === 0 ? "Now (live)" : `At ~${at}`}
          </span>
          <input
            type="range"
            min={0}
            max={AHEAD_STEPS}
            step={1}
            value={ahead / 15}
            onChange={(e) => setAhead(Number(e.target.value) * 15)}
            aria-label="See the room later tonight"
            aria-valuetext={ahead === 0 ? "now" : `${ahead} minutes from now, about ${at}`}
            className="h-11 min-w-0 flex-1 accent-[var(--brand-9)]"
          />
          <span className="hidden w-14 shrink-0 text-right text-xs text-gray-11 sm:block">+4h</span>
        </label>
        <div className="flex shrink-0 items-center gap-1">
          {floorMode === "room" && (
            <div className="flex gap-0.5 rounded-lg bg-gray-3 p-0.5">
              <button
                onClick={() => setZoom(Math.max(0.75, +(zoom - 0.25).toFixed(2)))}
                aria-label="Zoom out"
                className="flex h-9 w-9 items-center justify-center rounded-md text-gray-12 hover:bg-panel"
              >
                <ZoomOut className="size-4" />
              </button>
              <button
                onClick={() => setZoom(Math.min(2.5, +(zoom + 0.25).toFixed(2)))}
                aria-label="Zoom in"
                className="flex h-9 w-9 items-center justify-center rounded-md text-gray-12 hover:bg-panel"
              >
                <ZoomIn className="size-4" />
              </button>
            </div>
          )}
          <div className="flex gap-0.5 rounded-lg bg-gray-3 p-0.5">
            <button
              onClick={() => setFloorMode("room")}
              aria-pressed={floorMode === "room"}
              aria-label="Room"
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-md",
                floorMode === "room" ? "bg-panel text-gray-12" : "text-gray-11",
              )}
            >
              <MapIcon className="size-4" />
            </button>
            <button
              onClick={() => setFloorMode("cards")}
              aria-pressed={floorMode === "cards"}
              aria-label="Cards"
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-md",
                floorMode === "cards" ? "bg-panel text-gray-12" : "text-gray-11",
              )}
            >
              <LayoutGrid className="size-4" />
            </button>
          </div>
        </div>
      </div>
      {projection && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-brand-3 px-3 py-2 text-sm text-brand-12"
        >
          <span className="font-bold">Around {at}, if the night goes as booked:</span>
          <span>
            <strong className="tabular-nums">{projection.guests}</strong> guests in
          </span>
          <span>
            <strong className="tabular-nums">{projection.free}</strong> tables free
          </span>
          <span className="text-xs text-brand-11">Faded guests are expected, not seated yet.</span>
          <button onClick={() => setAhead(0)} className="ml-auto text-sm font-bold underline">
            Back to now
          </button>
        </div>
      )}
    </div>
  );
}
