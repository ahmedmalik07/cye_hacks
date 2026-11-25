"use client";

import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import type { Floor, FloorTable } from "@/components/floor/types";
import { BOOKING_STATUS, tableFit, type BookEntry, type Placing } from "./shared";

const PX = 2; // pixels per minute: an hour is 120px
const ROW = 48;
const NAME_W = 84;
const SNAP = 15;

function hm(v: string) {
  const [h, m] = v.split(":").map(Number);
  return h * 60 + m;
}

/** Midnight at the start of a local day, as epoch ms. */
export function zonedMidnight(dateKey: string, timeZone: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
  );
  return guess - (asUtc - guess);
}

/**
 * The night on one screen: tables down the side, time across. Every
 * booking on the day is inside the window, however early or late. Tap a
 * bar to open it, tap empty space to book that table then.
 */
export function Timeline({
  floor,
  bookings,
  date,
  now,
  area,
  placing,
  picked,
  onBooking,
  onEmpty,
  onRow,
}: {
  floor: Floor;
  bookings: BookEntry[];
  date: string;
  now: number;
  area: string;
  placing: Placing | null;
  picked: string[];
  onBooking: (id: string) => void;
  onEmpty: (tableId: string, time: string) => void;
  onRow: (t: FloorTable) => void;
}) {
  const tz = floor.restaurant.timeZone;
  const isToday = date === floor.today;
  const midnight = useMemo(() => zonedMidnight(date, tz), [date, tz]);
  const local = (iso: string) => (new Date(iso).getTime() - midnight) / 60_000;

  const live = bookings.filter((b) => b.status !== "CANCELLED");
  // Walk-ins and waiting-list parties sitting now have no booking: draw
  // them from the live floor, from when they sat to the estimate.
  const sessions = isToday
    ? floor.tables
        .filter((t) => t.seatedAt && (t.status === "OCCUPIED" || t.status === "BILL"))
        .filter(
          (t) => !live.some((b) => b.status === "SEATED" && b.tables.some((x) => x.id === t.id)),
        )
        .map((t) => ({
          tableId: t.id,
          start: local(t.seatedAt!),
          end: t.estimate ? local(t.estimate.freeAt) : (now - midnight) / 60_000 + 30,
          label: `Walk-in ×${t.partySize ?? "?"}`,
        }))
    : [];

  const range = useMemo(() => {
    let start = hm(floor.policy.opensAt);
    let end = hm(floor.policy.closesAt);
    if (end <= start) end += 24 * 60;
    end += 120;
    for (const b of live) {
      start = Math.min(start, local(b.startAt));
      end = Math.max(end, local(b.endAt));
    }
    for (const s of sessions) {
      start = Math.min(start, s.start);
      end = Math.max(end, s.end);
    }
    if (isToday) {
      const n = (now - midnight) / 60_000;
      start = Math.min(start, n - 60);
      end = Math.max(end, n + 120);
    }
    start = Math.max(0, Math.floor(start / 60) * 60);
    end = Math.min(36 * 60, Math.ceil(end / 60) * 60);
    return { start, end };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.length, sessions.length, date, floor.policy.opensAt, floor.policy.closesAt, isToday]);

  const width = (range.end - range.start) * PX;
  const hours: number[] = [];
  for (let m = range.start; m <= range.end; m += 60) hours.push(m);
  const nowMin = (now - midnight) / 60_000;

  const scroller = useRef<HTMLDivElement>(null);
  // Open on "now" (or the first booking), not at opening time.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const first = live.length ? Math.min(...live.map((b) => local(b.startAt))) : range.start;
    const focus = isToday ? nowMin - 60 : first - 30;
    el.scrollLeft = Math.max(0, (focus - range.start) * PX);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // Covers starting in each hour, for the header.
  const coversByHour = new Map<number, number>();
  for (const b of live) {
    if (b.status === "NO_SHOW") continue;
    const h = Math.floor(local(b.startAt) / 60) * 60;
    coversByHour.set(h, (coversByHour.get(h) ?? 0) + b.partySize);
  }

  const tables = floor.tables.filter((t) => area === "All" || t.area === area);
  const groups = [...new Set(tables.map((t) => t.area))];

  function emptyClick(e: React.MouseEvent<HTMLDivElement>, tableId: string) {
    if (e.target !== e.currentTarget) return;
    const x = e.nativeEvent.offsetX;
    const mins = Math.floor((range.start + x / PX) / SNAP) * SNAP;
    const h = Math.floor(mins / 60) % 24;
    onEmpty(tableId, `${String(h).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`);
  }

  return (
    <div
      ref={scroller}
      className="relative max-h-[calc(100dvh-14rem)] overflow-auto rounded-2xl bg-panel ring-1 ring-gray-5"
      role="grid"
      aria-label="Bookings by table and time"
    >
      <div style={{ width: width + NAME_W }} className="relative">
        {/* Hour header */}
        <div className="sticky top-0 z-20 flex border-b border-gray-5 bg-panel">
          <div
            className="sticky left-0 z-10 shrink-0 border-r border-gray-5 bg-panel px-2 py-1 text-[11px] font-bold text-gray-11"
            style={{ width: NAME_W }}
          >
            Covers
          </div>
          <div className="relative h-10" style={{ width }}>
            {hours.map((m) => (
              <div
                key={m}
                className="absolute top-0 flex h-full -translate-x-px flex-col justify-center border-l border-gray-4 pl-1"
                style={{ left: (m - range.start) * PX }}
              >
                <span className="text-[11px] font-semibold text-gray-12 tabular-nums">
                  {String(Math.floor(m / 60) % 24).padStart(2, "0")}:00
                </span>
                <span className="text-[10px] text-gray-11 tabular-nums">
                  {coversByHour.get(m) ? `${coversByHour.get(m)} guests` : " "}
                </span>
              </div>
            ))}
          </div>
        </div>

        {groups.map((g) => (
          <div key={g}>
            {groups.length > 1 && (
              <div
                className="bg-gray-2 py-1 text-[11px] font-bold tracking-wide text-gray-11 uppercase"
                style={{ width: NAME_W + width }}
              >
                <span className="sticky left-0 px-2">{g}</span>
              </div>
            )}
            {tables
              .filter((t) => t.area === g)
              .map((t) => {
                const fit = placing && isToday ? tableFit(t, placing) : null;
                const isPicked = picked.includes(t.id);
                return (
                  <div key={t.id} className="flex border-b border-gray-3" style={{ height: ROW }}>
                    <button
                      type="button"
                      onClick={() => onRow(t)}
                      className={cn(
                        "sticky left-0 z-10 flex shrink-0 flex-col justify-center border-r border-gray-5 bg-panel px-2 text-left",
                        isPicked && "bg-brand-3",
                        fit === "fits" && "bg-success-3",
                        fit === "no" && "opacity-40",
                      )}
                      style={{ width: NAME_W }}
                      aria-label={`${t.name}, ${t.seats} seats`}
                    >
                      <span className="truncate text-sm font-bold text-gray-12">{t.name}</span>
                      <span className="text-[10px] text-gray-11">{t.seats} seats</span>
                    </button>
                    <div
                      className={cn(
                        "relative cursor-copy",
                        placing && !isToday && "bg-success-2/40",
                      )}
                      style={{ width }}
                      onClick={(e) => emptyClick(e, t.id)}
                    >
                      {hours.map((m) => (
                        <span
                          key={m}
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-y-0 w-px bg-gray-3"
                          style={{ left: (m - range.start) * PX }}
                        />
                      ))}
                      {sessions
                        .filter((s) => s.tableId === t.id)
                        .map((s, i) => (
                          <div
                            key={`s${i}`}
                            className="pointer-events-none absolute top-1.5 bottom-1.5 flex items-center overflow-hidden rounded-md bg-tangerine-4 px-2 text-[11px] font-semibold whitespace-nowrap text-tangerine-12 ring-1 ring-tangerine-7"
                            style={{
                              left: (Math.max(s.start, range.start) - range.start) * PX,
                              width: Math.max(
                                24,
                                (s.end - Math.max(s.start, range.start)) * PX - 2,
                              ),
                            }}
                          >
                            {s.label}
                          </div>
                        ))}
                      {live
                        .filter((b) => b.tables.some((x) => x.id === t.id))
                        .map((b) => {
                          const a = local(b.startAt) - range.start;
                          const w = Math.max(28, (local(b.endAt) - local(b.startAt)) * PX - 2);
                          const late =
                            b.status === "CONFIRMED" &&
                            !b.arrivedAt &&
                            nowMin > local(b.startAt) + 5 &&
                            isToday;
                          return (
                            <button
                              key={b.id}
                              type="button"
                              onClick={() => onBooking(b.id)}
                              title={`${b.customerName} ×${b.partySize}`}
                              className={cn(
                                "absolute top-1.5 bottom-1.5 flex items-center gap-1 overflow-hidden rounded-md px-2 text-left text-[11px] font-semibold whitespace-nowrap shadow-sm",
                                BOOKING_STATUS[b.status].bar,
                                b.arrivedAt && b.status === "CONFIRMED" && "ring-2 ring-success-8",
                                late && "ring-2 ring-danger-8",
                              )}
                              style={{ left: a * PX + 1, width: w }}
                            >
                              <span className="truncate">
                                {b.customerName.split(" ")[0]} ×{b.partySize}
                              </span>
                              {b.guest?.vip && <span className="text-[10px]">VIP</span>}
                              {b.guest?.allergies && (
                                <span className="rounded bg-danger-9 px-1 text-[9px] text-white">
                                  !
                                </span>
                              )}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                );
              })}
          </div>
        ))}

        {isToday && nowMin >= range.start && nowMin <= range.end && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 bg-danger-9"
            style={{ left: NAME_W + (nowMin - range.start) * PX }}
          />
        )}
      </div>
    </div>
  );
}
