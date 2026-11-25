"use client";

import { useId, useMemo } from "react";
import {
  chairsFor,
  layoutArea,
  roomSize,
  type Chair,
  type Fixture,
  type Placed,
  type Shape,
} from "@/lib/reservations/layout";
import type { Projected } from "@/lib/reservations/project";
import {
  clock,
  minsSince,
  minsUntil,
  STATUS_STYLE,
  type FloorTable,
} from "@/components/floor/types";
import type { Fit } from "./shared";

/**
 * The dining room drawn from above: the floor, its walls, doors and
 * counter, and every table with its chairs. People sit in the chairs when a
 * party is seated, plates appear once they've ordered, a bill slip when
 * they ask for it. The same drawing plays the night forward when the host
 * moves the time slider (`projection`), with future guests drawn faintly.
 */

const GUEST_COLOURS = [
  "var(--tangerine-9)",
  "var(--brand-9)",
  "var(--success-9)",
  "var(--info-9)",
  "var(--danger-9)",
  "var(--tangerine-11)",
  "var(--brand-11)",
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

type Look = {
  top: string;
  edge: string;
  ink: string;
  sub: string;
  guests: number;
  ghost: boolean;
  plates: boolean;
  line1: string;
  line2: string | null;
  warn: boolean;
  badge: string | null;
  progress: number | null;
  icon: "bill" | "clean" | "ready" | null;
  label: string;
};

const LOOK = {
  free: {
    top: "var(--success-3)",
    edge: "var(--success-8)",
    ink: "var(--gray-12)",
    sub: "var(--gray-11)",
  },
  ready: {
    top: "var(--success-4)",
    edge: "var(--success-9)",
    ink: "var(--gray-12)",
    sub: "var(--success-11)",
  },
  held: {
    top: "var(--brand-3)",
    edge: "var(--brand-8)",
    ink: "var(--brand-12)",
    sub: "var(--brand-11)",
  },
  busy: {
    top: "var(--tangerine-3)",
    edge: "var(--tangerine-8)",
    ink: "var(--gray-12)",
    sub: "var(--gray-11)",
  },
  bill: {
    top: "var(--tangerine-9)",
    edge: "var(--tangerine-10)",
    ink: "var(--on-tangerine)",
    sub: "var(--on-tangerine)",
  },
  clean: {
    top: "var(--gray-5)",
    edge: "var(--gray-8)",
    ink: "var(--gray-12)",
    sub: "var(--gray-11)",
  },
};

function liveLook(t: FloorTable, now: number, tz: string): Look {
  const base = {
    guests: 0,
    ghost: false,
    plates: false,
    warn: false,
    badge: null as string | null,
    progress: null as number | null,
    icon: null as Look["icon"],
    label: STATUS_STYLE[t.status].label,
  };
  if (t.status === "OCCUPIED" || t.status === "BILL") {
    const seated = minsSince(t.seatedAt, now);
    let line2: string | null = null;
    let progress: number | null = null;
    let warn = false;
    if (t.estimate) {
      const start = t.seatedAt ? Date.parse(t.seatedAt) : now;
      const end = Date.parse(t.estimate.freeAt);
      progress = end > start ? (now - start) / (end - start) : 1;
      if (t.estimate.overdueMins > 10) {
        line2 = `over ${t.estimate.overdueMins}m`;
        warn = true;
      } else {
        const m = minsUntil(t.estimate.freeAt, now);
        line2 = m <= 2 ? "free any min" : `free ~${clock(t.estimate.freeAt, tz)}`;
      }
    }
    return {
      ...(t.status === "BILL" ? LOOK.bill : LOOK.busy),
      ...base,
      guests: t.partySize ?? Math.min(2, t.seats),
      plates: t.stage != null && t.stage !== "SEATED",
      line1: t.status === "BILL" ? "Bill" : `${seated}m`,
      line2,
      warn,
      badge: `${t.partySize ?? "?"}`,
      progress,
      icon: t.status === "BILL" ? "bill" : null,
    };
  }
  if (t.status === "RESERVED" && t.heldBy) {
    const late = t.heldBy.lateMins > 0;
    return {
      ...LOOK.held,
      ...base,
      line1: `${t.heldBy.customerName.split(" ")[0]} ×${t.heldBy.partySize}`,
      line2: late ? `late ${t.heldBy.lateMins}m` : clock(t.heldBy.startAt, tz),
      warn: late,
    };
  }
  if (t.status === "CLEANING") {
    return {
      ...LOOK.clean,
      ...base,
      line1: "Cleaning",
      line2: `${minsSince(t.leftAt, now)}m`,
      icon: "clean",
    };
  }
  return {
    ...(t.status === "READY" ? LOOK.ready : LOOK.free),
    ...base,
    line1: `${t.seats} seats`,
    line2: t.offeredTo
      ? `offered ${t.offeredTo.split(" ")[0]}`
      : t.next
        ? `next ${clock(t.next.startAt, tz)}`
        : t.status === "READY"
          ? "Ready"
          : null,
    icon: t.status === "READY" ? "ready" : null,
  };
}

function projectedLook(t: FloorTable, p: Projected, tz: string): Look {
  const base = {
    ghost: true,
    plates: false,
    warn: false,
    badge: null,
    progress: null,
    icon: null,
  };
  const at = (ms: number) => clock(new Date(ms).toISOString(), tz);
  switch (p.kind) {
    case "STILL_SEATED":
      return {
        ...LOOK.busy,
        ...base,
        guests: p.party ?? 2,
        plates: true,
        line1: "Still eating",
        line2: `till ~${at(p.until)}`,
        label: "Probably still occupied",
      };
    case "CLEANING":
      return {
        ...LOOK.clean,
        ...base,
        guests: 0,
        line1: "Resetting",
        line2: `~${at(p.until)}`,
        icon: "clean",
        label: "Probably being reset",
      };
    case "BOOKED":
      return {
        ...LOOK.held,
        ...base,
        guests: p.party,
        line1: `${p.name.split(" ")[0]} ×${p.party}`,
        line2: `booked ${at(p.from)}`,
        label: `Booked for ${p.name}`,
      };
    case "HELD":
      return {
        ...LOOK.held,
        ...base,
        guests: 0,
        line1: `${p.name.split(" ")[0]} ×${p.party}`,
        line2: `due ${at(p.at)}`,
        label: `Held for ${p.name}`,
      };
    default:
      return {
        ...LOOK.free,
        ...base,
        ghost: false,
        guests: 0,
        line1: "Free",
        line2: p.nextAt ? `next ${at(p.nextAt)}` : `${t.seats} seats`,
        label: "Free",
      };
  }
}

export function Room({
  area,
  areaIndex,
  tables,
  fixtures,
  now,
  timeZone,
  projection,
  fits,
  picked,
  dropTarget,
  zoom,
  onTable,
}: {
  area: string;
  areaIndex: number;
  tables: FloorTable[];
  fixtures: Fixture[];
  now: number;
  timeZone: string;
  projection: Map<string, Projected> | null;
  fits: Map<string, Fit> | null;
  picked: string[];
  dropTarget: string | null;
  zoom: number;
  onTable: (t: FloorTable) => void;
}) {
  const uid = useId().replace(/:/g, "");
  const mine = fixtures.filter((f) => f.area === area);
  const layout = useMemo(
    () =>
      layoutArea(tables.map((t) => ({ id: t.id, seats: t.seats, shape: t.shape, plan: t.plan }))),
    [tables],
  );
  // Keep chairs and fixtures drawn at the very edge inside the walls.
  // Only tables need room for their chairs inside the walls; fixtures
  // (doors, windows) belong on the wall itself.
  const minX = Math.min(...layout.placed.map((p) => p.box.x), 60);
  const minY = Math.min(...layout.placed.map((p) => p.box.y), 60);
  const shiftX = Math.max(0, 32 - minX);
  const shiftY = Math.max(0, 32 - minY);
  const inner = roomSize(layout.placed, mine);
  const size = { width: inner.width + shiftX, height: inner.height + shiftY };
  const byId = new Map(tables.map((t) => [t.id, t]));
  const floorPattern = ["wood", "tile", "deck"][areaIndex % 3];

  return (
    <div
      className="overflow-auto rounded-2xl ring-1 ring-gray-5"
      style={{ maxHeight: "calc(100dvh - 12rem)" }}
    >
      <svg
        viewBox={`0 0 ${size.width} ${size.height}`}
        role="group"
        aria-label={`${area} room`}
        className="block select-none"
        style={{
          width: `${zoom * 100}%`,
          minWidth: `${Math.round(size.width * 0.75 * zoom)}px`,
          height: "auto",
        }}
      >
        <defs>
          <pattern id={`wood${uid}`} width="120" height="24" patternUnits="userSpaceOnUse">
            <rect width="120" height="24" fill="var(--gray-2)" />
            <rect width="120" height="1.5" y="22.5" fill="var(--gray-5)" />
            <rect width="1.5" height="24" x="70" fill="var(--gray-4)" />
          </pattern>
          <pattern id={`tile${uid}`} width="40" height="40" patternUnits="userSpaceOnUse">
            <rect width="40" height="40" fill="var(--gray-1)" />
            <rect width="40" height="1" fill="var(--gray-4)" />
            <rect width="1" height="40" fill="var(--gray-4)" />
          </pattern>
          <pattern id={`deck${uid}`} width="30" height="30" patternUnits="userSpaceOnUse">
            <rect width="30" height="30" fill="var(--gray-3)" />
            <rect width="30" height="2" y="14" fill="var(--gray-5)" />
          </pattern>
          <pattern
            id={`hatch${uid}`}
            width="10"
            height="10"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="10" height="10" fill="var(--gray-5)" />
            <rect width="3" height="10" fill="var(--gray-6)" />
          </pattern>
        </defs>

        {/* Floor and outer walls */}
        <rect
          x="4"
          y="4"
          width={size.width - 8}
          height={size.height - 8}
          rx="12"
          fill={`url(#${floorPattern}${uid})`}
          stroke="var(--gray-10)"
          strokeWidth="6"
        />

        <g transform={`translate(${shiftX} ${shiftY})`}>
          {mine.map((f) => (
            <FixtureShape key={f.id} f={f} hatch={`hatch${uid}`} />
          ))}

          {layout.placed.map((p) => {
            const t = byId.get(p.id)!;
            const proj = projection?.get(t.id) ?? null;
            const look = proj ? projectedLook(t, proj, timeZone) : liveLook(t, now, timeZone);
            return (
              <TableGlyph
                key={p.id}
                t={t}
                p={p}
                look={look}
                fit={fits?.get(t.id) ?? null}
                picked={picked.includes(t.id)}
                dropping={dropTarget === t.id}
                onClick={() => onTable(t)}
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}

function TableGlyph({
  t,
  p,
  look,
  fit,
  picked,
  dropping,
  onClick,
}: {
  t: FloorTable;
  p: Placed;
  look: Look;
  fit: Fit | null;
  picked: boolean;
  dropping: boolean;
  onClick: () => void;
}) {
  const { x, y, w, h } = p.box;
  const chairs = chairsFor(p.shape, w, h, t.seats);
  const guests = Math.min(look.guests, chairs.length);
  const seed = hash(t.id);
  const small = Math.min(w, h) < 80;
  const name = t.name.replace(/^Table\s+/i, "");
  const label = `${t.name}, ${t.seats} seats, ${look.label}${look.line2 ? `, ${look.line2}` : ""}${
    fit === "fits" ? ", fits this party" : ""
  }`;
  return (
    <g
      transform={`translate(${x} ${y})`}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={picked || undefined}
      data-table={t.name}
      data-table-id={t.id}
      data-status={t.status}
      data-fit={fit ?? undefined}
      className="room-table cursor-pointer outline-none focus-visible:[&>.focus]:opacity-100"
      opacity={fit === "no" ? 0.28 : 1}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {/* A hit area covering the chairs too, so a thumb can't miss. */}
      <rect x={-24} y={-24} width={w + 48} height={h + 48} rx={18} fill="transparent" />

      {(fit === "fits" || fit === "join" || fit === "soon" || dropping) && (
        <Outline
          shape={p.shape}
          w={w}
          h={h}
          pad={22}
          stroke={
            dropping
              ? "var(--tangerine-9)"
              : fit === "soon"
                ? "var(--tangerine-8)"
                : "var(--success-9)"
          }
          fill={dropping ? "var(--tangerine-9)" : "var(--success-9)"}
          dashed={fit === "join"}
          className={dropping ? undefined : "room-fit"}
        />
      )}
      {picked && (
        <Outline
          shape={p.shape}
          w={w}
          h={h}
          pad={22}
          stroke="var(--brand-9)"
          fill="var(--brand-9)"
          width={4}
        />
      )}
      <Outline
        shape={p.shape}
        w={w}
        h={h}
        pad={26}
        stroke="var(--tangerine-8)"
        fill="none"
        width={3}
        className="focus opacity-0"
      />

      {chairs.map((c, i) => (
        <ChairShape
          key={i}
          c={c}
          seated={i < guests}
          ghost={look.ghost}
          colour={GUEST_COLOURS[(seed + i) % GUEST_COLOURS.length]}
        />
      ))}

      {/* Table top */}
      {p.shape === "ROUND" ? (
        <ellipse
          cx={w / 2}
          cy={h / 2}
          rx={w / 2}
          ry={h / 2}
          fill={look.top}
          stroke={look.edge}
          strokeWidth={2.5}
        />
      ) : (
        <rect
          width={w}
          height={h}
          rx={p.shape === "SQUARE" ? 8 : 10}
          fill={look.top}
          stroke={look.edge}
          strokeWidth={2.5}
        />
      )}

      {look.plates &&
        !small &&
        chairs.slice(0, guests).map((c, i) => {
          const cx = w / 2;
          const cy = h / 2;
          const dx = cx - c.x;
          const dy = cy - c.y;
          const d = Math.hypot(dx, dy) || 1;
          const k = Math.min(24, d - 6) / d;
          return (
            <circle
              key={`plate${i}`}
              cx={c.x + dx * k}
              cy={c.y + dy * k}
              r={6}
              fill="var(--panel)"
              stroke="var(--gray-7)"
              strokeWidth={1.2}
              opacity={look.ghost ? 0.5 : 0.95}
            />
          );
        })}

      {look.progress != null && !small && (
        <g aria-hidden="true">
          <rect
            x={10}
            y={h - 10}
            width={w - 20}
            height={4}
            rx={2}
            fill="var(--gray-6)"
            opacity={0.6}
          />
          <rect
            x={10}
            y={h - 10}
            width={Math.max(4, Math.min(1, look.progress) * (w - 20))}
            height={4}
            rx={2}
            fill={
              look.progress > 1.1
                ? "var(--danger-9)"
                : look.progress > 0.8
                  ? "var(--tangerine-10)"
                  : "var(--success-9)"
            }
          />
        </g>
      )}

      <text
        x={w / 2}
        y={h / 2 - (look.line2 ? 9 : 3)}
        textAnchor="middle"
        fontSize={small ? 13 : 16}
        fontWeight={900}
        fill={look.ink}
      >
        {name}
      </text>
      <text
        x={w / 2}
        y={h / 2 + (look.line2 ? 5 : 11)}
        textAnchor="middle"
        fontSize={small ? 9.5 : 11}
        fontWeight={600}
        fill={look.sub}
      >
        {look.line1}
      </text>
      {look.line2 && (
        <text
          x={w / 2}
          y={h / 2 + 18}
          textAnchor="middle"
          fontSize={small ? 9.5 : 11}
          fontWeight={800}
          fill={look.warn ? "var(--danger-11)" : look.ink}
        >
          {look.line2}
        </text>
      )}

      {look.icon === "bill" && (
        <g transform={`translate(${w - 16} 4)`} aria-hidden="true">
          <rect
            width={12}
            height={15}
            rx={1.5}
            fill="var(--panel)"
            stroke="var(--on-tangerine)"
            strokeWidth={1}
          />
          <rect x={2.5} y={4} width={7} height={1.2} fill="var(--on-tangerine)" />
          <rect x={2.5} y={7} width={7} height={1.2} fill="var(--on-tangerine)" />
          <rect x={2.5} y={10} width={4} height={1.2} fill="var(--on-tangerine)" />
        </g>
      )}
      {look.icon === "clean" && (
        <text
          x={w - 9}
          y={14}
          textAnchor="middle"
          fontSize={12}
          fill="var(--gray-11)"
          aria-hidden="true"
        >
          ✦
        </text>
      )}
      {look.badge && (
        <g transform={`translate(${w - 2} -2)`} aria-hidden="true">
          <circle r={10} fill="var(--panel)" stroke={look.edge} strokeWidth={2} />
          <text y={4} textAnchor="middle" fontSize={11} fontWeight={900} fill="var(--gray-12)">
            {look.badge}
          </text>
        </g>
      )}
      {!t.reservable && (
        <text x={6} y={13} fontSize={9} fontWeight={800} fill={look.sub} aria-hidden="true">
          W
        </text>
      )}
      {picked && (
        <g transform="translate(-4 -4)" aria-hidden="true">
          <circle r={9} fill="var(--brand-9)" />
          <path d="M-4 0 l3 3 l5 -6" stroke="white" strokeWidth={2} fill="none" />
        </g>
      )}
    </g>
  );
}

function Outline({
  shape,
  w,
  h,
  pad,
  stroke,
  fill,
  dashed,
  width = 3,
  className,
}: {
  shape: Shape;
  w: number;
  h: number;
  pad: number;
  stroke: string;
  fill: string;
  dashed?: boolean;
  width?: number;
  className?: string;
}) {
  const common = {
    fill,
    fillOpacity: fill === "none" ? undefined : 0.08,
    stroke,
    strokeWidth: width,
    strokeDasharray: dashed ? "8 6" : undefined,
    className,
  };
  return shape === "ROUND" ? (
    <ellipse cx={w / 2} cy={h / 2} rx={w / 2 + pad} ry={h / 2 + pad} {...common} />
  ) : (
    <rect x={-pad} y={-pad} width={w + pad * 2} height={h + pad * 2} rx={18} {...common} />
  );
}

export function ChairShape({
  c,
  seated,
  ghost,
  colour,
}: {
  c: Chair;
  seated: boolean;
  ghost: boolean;
  colour: string;
}) {
  return (
    <g transform={`translate(${c.x} ${c.y}) rotate(${c.angle})`}>
      {/* Seat with its back away from the table */}
      <rect
        x={-9}
        y={-7}
        width={18}
        height={14}
        rx={4}
        fill="var(--gray-6)"
        stroke="var(--gray-8)"
        strokeWidth={1}
      />
      <rect x={-9} y={4} width={18} height={4} rx={2} fill="var(--gray-8)" />
      {seated && (
        <g className="room-guest" opacity={ghost ? 0.45 : 1}>
          <circle r={8.5} fill={colour} stroke="var(--panel)" strokeWidth={2} />
          <circle cy={-2} r={3} fill="var(--panel)" opacity={0.55} />
        </g>
      )}
    </g>
  );
}

const FIXTURE_LABEL: Record<Fixture["kind"], string> = {
  WALL: "",
  DOOR: "Entrance",
  WINDOW: "",
  COUNTER: "Counter",
  KITCHEN: "Kitchen",
  PLANT: "",
  PILLAR: "",
  WASHROOM: "WC",
};

export function FixtureShape({ f, hatch }: { f: Fixture; hatch: string }) {
  const { x, y, w, h } = f;
  const label = FIXTURE_LABEL[f.kind];
  const text = label ? (
    <text
      x={x + w / 2}
      y={y + h / 2 + 4}
      textAnchor="middle"
      fontSize={12}
      fontWeight={800}
      fill={f.kind === "COUNTER" ? "white" : "var(--gray-12)"}
    >
      {label}
    </text>
  ) : null;
  switch (f.kind) {
    case "WALL":
      return <rect x={x} y={y} width={w} height={h} rx={2} fill="var(--gray-10)" />;
    case "PILLAR":
      return (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={4}
          fill="var(--gray-9)"
          stroke="var(--gray-11)"
        />
      );
    case "WINDOW":
      return (
        <g>
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            fill="var(--info-4)"
            stroke="var(--info-8)"
            strokeWidth={1.5}
          />
          {w >= h ? (
            <line x1={x} x2={x + w} y1={y + h / 2} y2={y + h / 2} stroke="var(--info-8)" />
          ) : (
            <line y1={y} y2={y + h} x1={x + w / 2} x2={x + w / 2} stroke="var(--info-8)" />
          )}
        </g>
      );
    case "DOOR": {
      const horizontal = w >= h;
      const r = horizontal ? w : h;
      return (
        <g>
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            fill="var(--tangerine-4)"
            stroke="var(--tangerine-8)"
          />
          <path
            d={
              horizontal
                ? `M${x} ${y + h} A${r} ${r} 0 0 0 ${x + w} ${y + h + r} L${x} ${y + h + r} Z`
                : `M${x + w} ${y} A${r} ${r} 0 0 1 ${x + w + r} ${y + h} L${x + w + r} ${y} Z`
            }
            fill="var(--tangerine-3)"
            fillOpacity={0.5}
            stroke="var(--tangerine-8)"
            strokeDasharray="4 4"
          />
          <text
            x={horizontal ? x + w / 2 : x + w + 6}
            y={horizontal ? y + h + 16 : y - 6}
            textAnchor={horizontal ? "middle" : "start"}
            fontSize={11}
            fontWeight={800}
            fill="var(--tangerine-11)"
          >
            Entrance
          </text>
        </g>
      );
    }
    case "COUNTER":
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={8} fill="var(--brand-9)" />
          {text}
        </g>
      );
    case "KITCHEN":
      return (
        <g>
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            rx={6}
            fill={`url(#${hatch})`}
            stroke="var(--gray-9)"
            strokeWidth={2}
          />
          <rect
            x={x + w / 2 - 34}
            y={y + h / 2 - 11}
            width={68}
            height={22}
            rx={6}
            fill="var(--panel)"
          />
          {text}
        </g>
      );
    case "WASHROOM":
      return (
        <g>
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            rx={6}
            fill="var(--info-3)"
            stroke="var(--info-7)"
            strokeWidth={2}
          />
          {text}
        </g>
      );
    case "PLANT": {
      const r = Math.min(w, h) / 2;
      return (
        <g>
          <circle cx={x + w / 2} cy={y + h / 2} r={r} fill="var(--success-9)" opacity={0.85} />
          <circle cx={x + w / 2 - r / 3} cy={y + h / 2 - r / 3} r={r / 2} fill="var(--success-7)" />
          <circle
            cx={x + w / 2 + r / 3}
            cy={y + h / 2 + r / 4}
            r={r / 2.5}
            fill="var(--success-10)"
          />
        </g>
      );
    }
  }
}
