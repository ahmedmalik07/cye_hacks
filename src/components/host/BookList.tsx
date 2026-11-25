"use client";

import { BellRing, CheckCircle2, Clock, DoorOpen, GripVertical, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { clock, minsSince, minsUntil, type Floor, type Waiting } from "@/components/floor/types";
import { Badges, BOOKING_STATUS, SOURCE_LABEL, type BookEntry, type Placing } from "./shared";

export type DragStart = (e: React.PointerEvent, p: Placing, label: string) => void;

export type Segment = "upcoming" | "seated" | "waiting" | "done";

export function segmentOf(b: BookEntry): Segment {
  if (b.status === "CONFIRMED") return "upcoming";
  if (b.status === "SEATED") return "seated";
  return "done";
}

/**
 * The night's guests as a list: who's due, who's sitting, who's waiting,
 * who's been and gone. Each row carries its next action as one button.
 */
export function BookList({
  floor,
  bookings,
  date,
  now,
  segment,
  onSegment,
  selectedId,
  onOpen,
  onSeat,
  onWaitSeat,
  onWaitOffer,
  onDrag,
}: {
  floor: Floor;
  bookings: BookEntry[] | null;
  date: string;
  now: number;
  segment: Segment;
  onSegment: (s: Segment) => void;
  selectedId: string | null;
  onOpen: (b: BookEntry) => void;
  onSeat: (b: BookEntry) => void;
  onWaitSeat: (w: Waiting) => void;
  onWaitOffer: (w: Waiting) => void;
  /** Start dragging a guest onto a table in the room. */
  onDrag?: DragStart;
}) {
  const tz = floor.restaurant.timeZone;
  const isToday = date === floor.today;
  const rows = bookings ?? [];
  const counts: Record<Segment, number> = {
    upcoming: rows.filter((b) => segmentOf(b) === "upcoming").length,
    seated: rows.filter((b) => segmentOf(b) === "seated").length,
    waiting: isToday ? floor.waitlist.length : 0,
    done: rows.filter((b) => segmentOf(b) === "done").length,
  };
  const segs: { key: Segment; label: string }[] = [
    { key: "upcoming", label: "Arriving" },
    { key: "seated", label: "Seated" },
    ...(isToday ? [{ key: "waiting" as const, label: "Waiting" }] : []),
    { key: "done", label: "Done" },
  ];
  const shown = rows
    .filter((b) => segmentOf(b) === segment)
    .sort((a, b) =>
      segment === "done" ? b.startAt.localeCompare(a.startAt) : a.startAt.localeCompare(b.startAt),
    );

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div
        role="tablist"
        aria-label="Guests"
        className="grid grid-cols-4 gap-1 rounded-xl bg-gray-3 p-1"
      >
        {segs.map((s) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={segment === s.key}
            onClick={() => onSegment(s.key)}
            className={cn(
              "flex min-h-10 flex-col items-center justify-center rounded-lg px-1 text-xs font-bold transition",
              segment === s.key
                ? "bg-panel text-gray-12 shadow-sm"
                : "text-gray-11 hover:text-gray-12",
            )}
          >
            <span className="tabular-nums">{counts[s.key]}</span>
            <span className="text-[11px] font-semibold">{s.label}</span>
          </button>
        ))}
      </div>

      {segment === "waiting" ? (
        floor.waitlist.length === 0 ? (
          <Empty text="Nobody is waiting. Add walk-ins to the list when every table is full." />
        ) : (
          <ul className="space-y-2">
            {floor.waitlist.map((w) => (
              <WaitRow
                key={w.id}
                w={w}
                tz={tz}
                now={now}
                onSeat={() => onWaitSeat(w)}
                onOffer={() => onWaitOffer(w)}
                onDrag={onDrag}
              />
            ))}
          </ul>
        )
      ) : bookings == null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-3" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <Empty
          text={
            segment === "upcoming"
              ? "No more bookings due on this day."
              : segment === "seated"
                ? "Nobody from a booking is seated yet."
                : "Nothing finished yet."
          }
        />
      ) : (
        <ul className="space-y-2">
          {shown.map((b) => (
            <BookingRow
              key={b.id}
              b={b}
              tz={tz}
              now={now}
              date={date}
              isToday={isToday}
              selected={b.id === selectedId}
              onOpen={() => onOpen(b)}
              onSeat={() => onSeat(b)}
              onDrag={onDrag}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-xl bg-panel p-4 text-center text-sm text-gray-11 ring-1 ring-gray-5">
      {text}
    </p>
  );
}

function BookingRow({
  b,
  tz,
  now,
  date,
  isToday,
  selected,
  onOpen,
  onSeat,
  onDrag,
}: {
  b: BookEntry;
  tz: string;
  now: number;
  date: string;
  isToday: boolean;
  selected: boolean;
  onOpen: () => void;
  onSeat: () => void;
  onDrag?: DragStart;
}) {
  const inMins = minsUntil(b.startAt, now);
  const late = b.status === "CONFIRMED" && isToday && !b.arrivedAt && inMins < -5;
  const due = b.status === "CONFIRMED" && isToday && inMins <= 120;
  return (
    <li
      className={cn(
        "flex items-stretch gap-2 rounded-xl bg-panel p-2 ring-1 transition",
        selected ? "ring-2 ring-brand-8" : "ring-gray-5",
        late && "ring-danger-7",
      )}
    >
      {due && onDrag && (
        <Grip
          label={`${b.customerName} ×${b.partySize}`}
          onDown={(e) =>
            onDrag(
              e,
              {
                kind: "booking",
                id: b.id,
                name: b.customerName,
                party: b.partySize,
                current: b.tables.map((t) => t.id),
                seatNow: true,
              },
              `${b.customerName} ×${b.partySize}`,
            )
          }
        />
      )}
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-start gap-2 text-left"
        aria-label={`${b.customerName}, ${b.partySize} guests, ${clock(b.startAt, tz)}`}
      >
        <div className="w-14 shrink-0 pt-0.5 text-center">
          <p className="text-sm font-black text-gray-12 tabular-nums">{clock(b.startAt, tz)}</p>
          {b.status === "CONFIRMED" && isToday ? (
            <p
              className={cn("text-[11px] font-semibold", late ? "text-danger-11" : "text-gray-11")}
            >
              {b.arrivedAt
                ? "here"
                : late
                  ? `late ${-inMins}m`
                  : inMins <= 0
                    ? "now"
                    : inMins < 90
                      ? `in ${inMins}m`
                      : ""}
            </p>
          ) : (
            <p
              className={cn(
                "mt-0.5 rounded-full px-1 text-[10px] font-bold",
                BOOKING_STATUS[b.status].pill,
              )}
            >
              {BOOKING_STATUS[b.status].label}
            </p>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-gray-12">
            {b.customerName} <span className="font-semibold text-gray-11">×{b.partySize}</span>
          </p>
          <p className="truncate text-xs text-gray-11">
            {b.tables.length ? b.tables.map((t) => t.name).join(" + ") : "No table"} ·{" "}
            {SOURCE_LABEL[b.source]}
            {b.guestConfirmed && (
              <span className="ml-1 font-semibold text-success-11">✓ coming</span>
            )}
            {b.lateUntil && b.status === "CONFIRMED" && (
              <span className="ml-1 font-semibold text-tangerine-11">
                ETA {clock(b.lateUntil, tz)}
              </span>
            )}
          </p>
          <Badges guest={b.guest} dateKey={date} tags={b.tags} className="mt-1" max={4} />
          {(b.note || b.staffNote) && (
            <p className="mt-0.5 truncate text-xs text-gray-12 italic">
              {b.staffNote ? `Staff: ${b.staffNote}` : `“${b.note}”`}
            </p>
          )}
        </div>
      </button>
      {due && (
        <div className="flex shrink-0 flex-col justify-center gap-1">
          <button
            type="button"
            onClick={onSeat}
            className="min-h-11 rounded-lg bg-brand-9 px-3 text-xs font-bold text-white hover:bg-brand-10"
          >
            Seat
          </button>
          {b.arrivedAt && (
            <span className="flex items-center justify-center gap-0.5 text-[10px] font-bold text-success-11">
              <DoorOpen className="size-3" /> arrived
            </span>
          )}
        </div>
      )}
    </li>
  );
}

function WaitRow({
  w,
  tz,
  now,
  onSeat,
  onOffer,
  onDrag,
}: {
  w: Waiting;
  tz: string;
  now: number;
  onSeat: () => void;
  onOffer: () => void;
  onDrag?: DragStart;
}) {
  const notified = w.status === "NOTIFIED";
  const eta = w.etaAt ? minsUntil(w.etaAt, now) : null;
  return (
    <li
      className={cn(
        "rounded-xl p-2 ring-1",
        notified ? "bg-tangerine-2 ring-tangerine-7" : "bg-panel ring-gray-5",
      )}
    >
      <div className="flex items-start gap-2">
        {onDrag && (
          <Grip
            label={`${w.customerName} ×${w.partySize}`}
            onDown={(e) =>
              onDrag(
                e,
                { kind: "wait", id: w.id, name: w.customerName, party: w.partySize },
                `${w.customerName} ×${w.partySize}`,
              )
            }
          />
        )}
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-4 text-sm font-black text-gray-12">
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
              ? ` · offered ${w.offeredTables.join(" + ")} until ${clock(w.respondBy, tz)}`
              : eta != null
                ? ` · ~${Math.max(0, eta)}m${w.suggestedTable ? ` (${w.suggestedTable.name})` : ""}`
                : " · no table fits yet"}
          </p>
          <Badges guest={w.guest} className="mt-1" max={3} />
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onSeat}
          className="flex min-h-10 items-center justify-center gap-1 rounded-lg bg-brand-9 text-xs font-bold text-white hover:bg-brand-10"
        >
          <CheckCircle2 className="size-3.5" /> Seat
        </button>
        <button
          type="button"
          onClick={onOffer}
          className="flex min-h-10 items-center justify-center gap-1 rounded-lg bg-tangerine-9 text-xs font-bold text-on-tangerine hover:bg-tangerine-10"
        >
          <Clock className="size-3.5" />{" "}
          {notified ? "Options" : w.suggestedTable ? `Offer ${w.suggestedTable.name}` : "Options"}
        </button>
      </div>
    </li>
  );
}

/**
 * Drag handle: hold and drag the guest onto a table in the room. Only the
 * handle starts a drag, so scrolling the list and tapping a row still work.
 */
function Grip({ label, onDown }: { label: string; onDown: (e: React.PointerEvent) => void }) {
  return (
    <span
      role="img"
      aria-label={`Drag ${label} onto a table`}
      title="Drag onto a table"
      onPointerDown={onDown}
      className="-my-1 -ml-1 hidden w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-gray-9 hover:bg-gray-3 hover:text-gray-12 active:cursor-grabbing lg:flex"
    >
      <GripVertical className="size-4" />
    </span>
  );
}
