"use client";

import { useMemo } from "react";
import { Camera, Check, Clock3, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Projected } from "@/lib/reservations/project";
import { Room } from "./Room";
import {
  clock,
  minsSince,
  minsUntil,
  STATUS_STYLE,
  type Floor,
  type FloorTable,
} from "@/components/floor/types";
import { tableFit, type Fit, type Placing } from "./shared";

/**
 * The room. Each area drawn from above with its tables, chairs and the
 * people in them (see Room), or as a grid of cards for anyone who prefers
 * it. While a party is being placed, tables that fit glow and the rest fade.
 */
export function FloorView({
  floor,
  now,
  area,
  mode,
  placing,
  picked,
  projection,
  dropTarget,
  zoom,
  onTable,
}: {
  floor: Floor;
  now: number;
  area: string;
  mode: "room" | "cards";
  placing: Placing | null;
  picked: string[];
  projection: Map<string, Projected> | null;
  dropTarget: string | null;
  zoom: number;
  onTable: (t: FloorTable) => void;
}) {
  const areas = area === "All" ? floor.areas : [area];
  const fits = useMemo(() => {
    if (!placing || projection) return null;
    return new Map(floor.tables.map((t) => [t.id, tableFit(t, placing)]));
  }, [floor.tables, placing, projection]);
  return (
    <div className="space-y-4">
      {areas.map((a) => {
        const tables = floor.tables.filter((t) => t.area === a);
        if (tables.length === 0) return null;
        return (
          <section key={a} aria-label={a}>
            {areas.length > 1 && (
              <h3 className="mb-1.5 text-xs font-bold tracking-wide text-gray-11 uppercase">{a}</h3>
            )}
            {mode === "room" ? (
              <Room
                area={a}
                areaIndex={floor.areas.indexOf(a)}
                tables={tables}
                fixtures={floor.fixtures}
                now={now}
                timeZone={floor.restaurant.timeZone}
                projection={projection}
                fits={fits}
                picked={picked}
                dropTarget={dropTarget}
                zoom={zoom}
                onTable={onTable}
              />
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                {tables.map((t) => (
                  <TableCard
                    key={t.id}
                    t={t}
                    floor={floor}
                    now={now}
                    fit={fits?.get(t.id) ?? null}
                    picked={picked.includes(t.id)}
                    onClick={() => onTable(t)}
                    variant="card"
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function describe(t: FloorTable, now: number, tz: string) {
  let line1 = `${t.seats} seats`;
  let line2: string | null = null;
  let warn = false;
  if (t.status === "OCCUPIED" || t.status === "BILL") {
    line1 = `${t.partySize ?? "?"} · ${minsSince(t.seatedAt, now)}m`;
    if (t.estimate) {
      const m = minsUntil(t.estimate.freeAt, now);
      if (t.estimate.overdueMins > 10) {
        line2 = `over ${t.estimate.overdueMins}m`;
        warn = true;
      } else line2 = m <= 2 ? "free any min" : `free ~${clock(t.estimate.freeAt, tz)}`;
    }
  } else if (t.status === "RESERVED" && t.heldBy) {
    line1 = `${t.heldBy.customerName.split(" ")[0]} ×${t.heldBy.partySize}`;
    line2 = t.heldBy.lateMins > 0 ? `late ${t.heldBy.lateMins}m` : clock(t.heldBy.startAt, tz);
    warn = t.heldBy.lateMins > 0;
  } else if (t.status === "CLEANING") {
    line1 = `cleaning ${minsSince(t.leftAt, now)}m`;
  } else if (t.offeredTo) {
    line2 = `offered ${t.offeredTo.split(" ")[0]}`;
  } else if (t.next) {
    line2 = `next ${clock(t.next.startAt, tz)}`;
  }
  return { line1, line2, warn };
}

const FIT_RING: Record<Fit, string> = {
  fits: "ring-4 ring-success-8 ring-offset-2 ring-offset-panel",
  join: "border-dashed ring-2 ring-success-7",
  soon: "ring-2 ring-tangerine-7",
  no: "opacity-30 saturate-50",
};

export function TableCard({
  t,
  floor,
  now,
  fit,
  picked,
  onClick,
  variant,
}: {
  t: FloorTable;
  floor: Floor;
  now: number;
  fit: Fit | null;
  picked: boolean;
  onClick: () => void;
  variant: "plan" | "round" | "card";
}) {
  const tz = floor.restaurant.timeZone;
  const style = STATUS_STYLE[t.status];
  const onBill = t.status === "BILL";
  const { line1, line2, warn } = describe(t, now, tz);
  const dim = onBill ? "text-on-tangerine" : "text-gray-12";
  return (
    <button
      type="button"
      onClick={onClick}
      data-table={t.name}
      data-table-id={t.id}
      data-status={t.status}
      data-fit={fit ?? undefined}
      aria-pressed={picked || undefined}
      aria-label={`${t.name}, ${t.seats} seats, ${style.label}${line2 ? `, ${line2}` : ""}${
        fit === "fits" ? ", fits this party" : ""
      }`}
      className={cn(
        "relative flex h-full w-full flex-col items-center justify-center overflow-hidden border-2 p-1 text-center transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tangerine-8",
        variant === "round" ? "rounded-full" : "rounded-xl",
        variant === "card" && "min-h-24 rounded-2xl",
        style.tile,
        fit && FIT_RING[fit],
        picked && "ring-4 ring-brand-9 ring-offset-2 ring-offset-panel",
      )}
    >
      {picked && (
        <span className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-brand-9 text-white">
          <Check className="size-3" />
        </span>
      )}
      {t.cctv && !picked && (
        <Camera
          className={cn(
            "absolute top-1 right-1 size-3",
            onBill ? "text-on-tangerine" : "text-info-11",
          )}
        />
      )}
      {!t.reservable && (
        <span
          className="absolute top-1 left-1 text-[9px] font-bold text-gray-11"
          title="Walk-ins only"
        >
          W
        </span>
      )}
      <span className={cn("text-sm leading-tight font-black sm:text-base", dim)}>
        {t.name.replace(/^Table\s+/i, "")}
      </span>
      <span
        className={cn(
          "flex items-center gap-0.5 text-[10px] leading-tight tabular-nums sm:text-[11px]",
          onBill ? "text-on-tangerine/85" : "text-gray-11",
        )}
      >
        {(t.status === "OCCUPIED" || t.status === "BILL") && <Users className="size-3" />}
        {line1}
      </span>
      {line2 && (
        <span
          className={cn(
            "flex items-center gap-0.5 text-[10px] leading-tight font-bold tabular-nums sm:text-[11px]",
            warn ? (onBill ? "text-on-tangerine" : "text-danger-11") : dim,
          )}
        >
          {line2.startsWith("free") && <Clock3 className="size-3" />}
          {line2}
        </span>
      )}
      {variant === "card" && (
        <span
          className={cn(
            "text-[10px] font-bold uppercase",
            onBill ? "text-on-tangerine" : "text-gray-11",
          )}
        >
          {style.label}
        </span>
      )}
    </button>
  );
}

export function FloorLegend() {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-11">
      {(Object.keys(STATUS_STYLE) as (keyof typeof STATUS_STYLE)[]).map((s) => (
        <li key={s} className="flex items-center gap-1">
          <span className={cn("h-2.5 w-2.5 rounded-full", STATUS_STYLE[s].dot)} />{" "}
          {STATUS_STYLE[s].label}
        </li>
      ))}
      <li>&ldquo;~&rdquo; = estimate. Only a cleaned table is confirmed free.</li>
    </ul>
  );
}
