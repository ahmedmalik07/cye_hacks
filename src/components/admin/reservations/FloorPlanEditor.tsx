"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Circle,
  DoorOpen,
  Flower2,
  Minus,
  Plus,
  RectangleHorizontal,
  RotateCw,
  Square,
  Trash2,
  Wand2,
} from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { cn } from "@/lib/utils";
import {
  chairsFor,
  FIXTURE_SIZE,
  layoutArea,
  roomSize,
  snap,
  type Fixture,
  type FixtureKind,
  type PlanBox,
  type Shape,
} from "@/lib/reservations/layout";
import { ChairShape, FixtureShape } from "@/components/host/Room";

type T = {
  id: string;
  name: string;
  seats: number;
  area: string;
  shape: string;
  plan: PlanBox | null;
};
type Placed = { id: string; shape: Shape; box: PlanBox };
type Sel = { kind: "table" | "fixture"; id: string } | null;

const MIN_W = 900;
const MIN_H = 560;

const PALETTE: { kind: FixtureKind; label: string }[] = [
  { kind: "WALL", label: "Wall" },
  { kind: "DOOR", label: "Entrance" },
  { kind: "WINDOW", label: "Window" },
  { kind: "COUNTER", label: "Counter" },
  { kind: "KITCHEN", label: "Kitchen" },
  { kind: "WASHROOM", label: "Washroom" },
  { kind: "PILLAR", label: "Pillar" },
  { kind: "PLANT", label: "Plant" },
];

function initialFor(tables: T[]) {
  const out = new Map<string, Placed>();
  for (const area of new Set(tables.map((t) => t.area))) {
    const inArea = tables.filter((t) => t.area === area);
    const { placed } = layoutArea(
      inArea.map((t) => ({ id: t.id, seats: t.seats, shape: t.shape, plan: t.plan })),
    );
    for (const p of placed) out.set(p.id, { id: p.id, shape: p.shape, box: p.box });
  }
  return out;
}

/**
 * Draw the room once, so the host screen looks like the restaurant: drag
 * tables where they stand, then add the walls, entrance, counter and
 * kitchen around them. Works with a finger, a mouse, or arrow keys.
 */
export default function FloorPlanEditor({
  tables,
  fixtures: initialFixtures,
}: {
  tables: T[];
  fixtures: Fixture[];
}) {
  const router = useRouter();
  const uid = useId().replace(/:/g, "");
  const areas = useMemo(() => [...new Set(tables.map((t) => t.area))], [tables]);
  const [area, setArea] = useState(areas[0] ?? "");
  const [placed, setPlaced] = useState(() => initialFor(tables));
  const [fixtures, setFixtures] = useState(initialFixtures);
  const [sel, setSel] = useState<Sel>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ sel: NonNullable<Sel>; dx: number; dy: number } | null>(null);

  const inArea = tables.filter((t) => t.area === area);
  const boxes = inArea.map((t) => placed.get(t.id)!).filter(Boolean);
  const areaFixtures = fixtures.filter((f) => f.area === area);
  const size = roomSize(
    boxes.map((b) => ({ ...b, auto: false })),
    areaFixtures,
  );
  const W = Math.max(MIN_W, size.width + 60);
  const H = Math.max(MIN_H, size.height + 60);

  const selTable = sel?.kind === "table" ? tables.find((t) => t.id === sel.id) : undefined;
  const selPlaced = sel?.kind === "table" ? placed.get(sel.id) : undefined;
  const selFixture = sel?.kind === "fixture" ? fixtures.find((f) => f.id === sel.id) : undefined;

  function touched() {
    setDirty(true);
    setMsg(null);
  }
  function updateTable(id: string, f: (p: Placed) => Placed) {
    setPlaced((m) => {
      const next = new Map(m);
      next.set(id, f(m.get(id)!));
      return next;
    });
    touched();
  }
  function updateFixture(id: string, f: (x: Fixture) => Fixture) {
    setFixtures((fs) => fs.map((x) => (x.id === id ? f(x) : x)));
    touched();
  }

  /** Pointer position in room units. */
  function point(e: { clientX: number; clientY: number }) {
    const el = svg.current;
    if (!el) return { x: 0, y: 0 };
    const m = el.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }

  function boxOf(s: NonNullable<Sel>) {
    if (s.kind === "table") return placed.get(s.id)!.box;
    const f = fixtures.find((x) => x.id === s.id)!;
    return { x: f.x, y: f.y, w: f.w, h: f.h };
  }

  function onDown(e: React.PointerEvent, s: NonNullable<Sel>) {
    e.stopPropagation();
    const p = point(e);
    const b = boxOf(s);
    drag.current = { sel: s, dx: p.x - b.x, dy: p.y - b.y };
    svg.current?.setPointerCapture(e.pointerId);
    setSel(s);
  }
  function onMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const p = point(e);
    const x = Math.max(0, Math.min(1990, snap(p.x - d.dx)));
    const y = Math.max(0, Math.min(1990, snap(p.y - d.dy)));
    if (d.sel.kind === "table") updateTable(d.sel.id, (t) => ({ ...t, box: { ...t.box, x, y } }));
    else updateFixture(d.sel.id, (f) => ({ ...f, x, y }));
  }
  function onUp() {
    drag.current = null;
  }

  function nudge(dx: number, dy: number) {
    if (!sel) return;
    if (sel.kind === "table")
      updateTable(sel.id, (p) => ({
        ...p,
        box: { ...p.box, x: Math.max(0, p.box.x + dx), y: Math.max(0, p.box.y + dy) },
      }));
    else
      updateFixture(sel.id, (f) => ({ ...f, x: Math.max(0, f.x + dx), y: Math.max(0, f.y + dy) }));
  }

  function resize(key: "w" | "h", delta: number) {
    if (!sel) return;
    if (sel.kind === "table")
      updateTable(sel.id, (p) => ({
        ...p,
        box: { ...p.box, [key]: Math.max(40, Math.min(400, p.box[key] + delta)) },
      }));
    else
      updateFixture(sel.id, (f) => ({ ...f, [key]: Math.max(6, Math.min(1000, f[key] + delta)) }));
  }

  function turn() {
    if (!sel) return;
    if (sel.kind === "table")
      updateTable(sel.id, (p) => ({ ...p, box: { ...p.box, w: p.box.h, h: p.box.w } }));
    else updateFixture(sel.id, (f) => ({ ...f, w: f.h, h: f.w }));
  }

  function addFixture(kind: FixtureKind) {
    const s = FIXTURE_SIZE[kind];
    let n = fixtures.length + 1;
    while (fixtures.some((x) => x.id === `${kind.toLowerCase()}-${n}`)) n++;
    const f: Fixture = {
      id: `${kind.toLowerCase()}-${n}`,
      area,
      kind,
      x: snap(Math.max(20, W / 2 - s.w / 2)),
      y: snap(
        Math.max(20, kind === "DOOR" || kind === "WINDOW" || kind === "WALL" ? 0 : H / 2 - s.h / 2),
      ),
      w: s.w,
      h: s.h,
    };
    setFixtures((fs) => [...fs, f]);
    setSel({ kind: "fixture", id: f.id });
    touched();
  }

  function removeFixture(id: string) {
    setFixtures((fs) => fs.filter((f) => f.id !== id));
    setSel(null);
    touched();
  }

  function arrange() {
    const { placed: auto } = layoutArea(
      inArea.map((t) => ({ id: t.id, seats: t.seats, shape: null, plan: null })),
    );
    setPlaced((m) => {
      const next = new Map(m);
      for (const p of auto) next.set(p.id, { id: p.id, shape: p.shape, box: p.box });
      return next;
    });
    touched();
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    const plan = [...placed.values()].map((p) => ({
      id: p.id,
      x: p.box.x,
      y: p.box.y,
      w: Math.max(20, p.box.w),
      h: Math.max(20, p.box.h),
      shape: p.shape,
    }));
    const res = await apiFetch("/api/admin/reservations/settings", "PATCH", { plan, fixtures });
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    setDirty(false);
    setMsg({ ok: true, text: "Saved. The host screen shows the new room." });
    router.refresh();
  }

  const keys = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 50 : 10;
    if (e.key === "ArrowLeft") nudge(-step, 0);
    else if (e.key === "ArrowRight") nudge(step, 0);
    else if (e.key === "ArrowUp") nudge(0, -step);
    else if (e.key === "ArrowDown") nudge(0, step);
    else if ((e.key === "Delete" || e.key === "Backspace") && sel?.kind === "fixture")
      removeFixture(sel.id);
    else return;
    e.preventDefault();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {areas.map((a) => (
          <button
            key={a}
            onClick={() => {
              setArea(a);
              setSel(null);
            }}
            aria-pressed={area === a}
            className={cn(
              "min-h-10 rounded-full px-4 text-sm font-semibold",
              area === a ? "bg-brand-9 text-white" : "bg-panel text-gray-11 ring-1 ring-gray-5",
            )}
          >
            {a}
          </button>
        ))}
        <span className="ml-auto flex gap-2">
          <button
            onClick={arrange}
            className="flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-gray-12 ring-1 ring-gray-6 hover:bg-gray-3"
          >
            <Wand2 className="size-4" /> Tidy tables
          </button>
          <button
            onClick={() => void save()}
            disabled={!dirty || busy}
            className="min-h-10 rounded-xl bg-brand-9 px-4 text-sm font-bold text-white hover:bg-brand-10 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save room"}
          </button>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 rounded-2xl bg-panel p-2 ring-1 ring-gray-5">
        <span className="px-1 text-xs font-bold text-gray-11">Add to the room:</span>
        {PALETTE.map((p) => (
          <button
            key={p.kind}
            onClick={() => addFixture(p.kind)}
            className="flex min-h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-gray-12 ring-1 ring-gray-6 hover:bg-gray-3"
          >
            {p.kind === "DOOR" ? (
              <DoorOpen className="size-3.5" />
            ) : p.kind === "PLANT" ? (
              <Flower2 className="size-3.5" />
            ) : (
              <Plus className="size-3.5" />
            )}
            {p.label}
          </button>
        ))}
      </div>

      {msg && (
        <p role="status" className={cn("text-sm", msg.ok ? "text-success-11" : "text-danger-11")}>
          {msg.text}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
        <div className="overflow-auto rounded-2xl ring-1 ring-gray-5">
          <svg
            ref={svg}
            viewBox={`0 0 ${W} ${H}`}
            className="block w-full touch-none select-none"
            style={{ minWidth: `${Math.round(W * 0.55)}px` }}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onPointerDown={() => setSel(null)}
            aria-label={`${area} layout. Select a table or fixture, then drag it or use the arrow keys.`}
          >
            <defs>
              <pattern id={`grid${uid}`} width="40" height="40" patternUnits="userSpaceOnUse">
                <rect width="40" height="40" fill="var(--gray-1)" />
                <path d="M40 0H0V40" fill="none" stroke="var(--gray-5)" strokeWidth="1" />
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
            <rect width={W} height={H} fill={`url(#grid${uid})`} />

            {areaFixtures.map((f) => (
              <g
                key={f.id}
                role="button"
                tabIndex={0}
                aria-label={`${f.kind.toLowerCase()}, drag to move`}
                className="cursor-grab outline-none"
                onPointerDown={(e) => onDown(e, { kind: "fixture", id: f.id })}
                onFocus={() => setSel({ kind: "fixture", id: f.id })}
                onKeyDown={keys}
              >
                <FixtureShape f={f} hatch={`hatch${uid}`} />
                {/* Thin fixtures get a fatter grab area. */}
                <rect
                  x={f.x - 8}
                  y={f.y - 8}
                  width={f.w + 16}
                  height={f.h + 16}
                  fill="transparent"
                />
                {sel?.kind === "fixture" && sel.id === f.id && (
                  <rect
                    x={f.x - 5}
                    y={f.y - 5}
                    width={f.w + 10}
                    height={f.h + 10}
                    rx={6}
                    fill="none"
                    stroke="var(--brand-9)"
                    strokeWidth={3}
                    strokeDasharray="6 4"
                  />
                )}
              </g>
            ))}

            {inArea.map((t) => {
              const p = placed.get(t.id);
              if (!p) return null;
              const { x, y, w, h } = p.box;
              const on = sel?.kind === "table" && sel.id === t.id;
              return (
                <g
                  key={t.id}
                  transform={`translate(${x} ${y})`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${t.name}, ${t.seats} seats. Drag, or use arrow keys to move.`}
                  data-table={t.name}
                  className="cursor-grab outline-none"
                  onPointerDown={(e) => onDown(e, { kind: "table", id: t.id })}
                  onFocus={() => setSel({ kind: "table", id: t.id })}
                  onKeyDown={keys}
                >
                  <rect x={-24} y={-24} width={w + 48} height={h + 48} fill="transparent" />
                  {on && (
                    <rect
                      x={-22}
                      y={-22}
                      width={w + 44}
                      height={h + 44}
                      rx={16}
                      fill="var(--brand-9)"
                      fillOpacity={0.08}
                      stroke="var(--brand-9)"
                      strokeWidth={3}
                    />
                  )}
                  {chairsFor(p.shape, w, h, t.seats).map((c, i) => (
                    <ChairShape key={i} c={c} seated={false} ghost={false} colour="" />
                  ))}
                  {p.shape === "ROUND" ? (
                    <ellipse
                      cx={w / 2}
                      cy={h / 2}
                      rx={w / 2}
                      ry={h / 2}
                      fill="var(--success-3)"
                      stroke="var(--success-8)"
                      strokeWidth={2.5}
                    />
                  ) : (
                    <rect
                      width={w}
                      height={h}
                      rx={8}
                      fill="var(--success-3)"
                      stroke="var(--success-8)"
                      strokeWidth={2.5}
                    />
                  )}
                  <text
                    x={w / 2}
                    y={h / 2 - 2}
                    textAnchor="middle"
                    fontSize={15}
                    fontWeight={900}
                    fill="var(--gray-12)"
                  >
                    {t.name}
                  </text>
                  <text
                    x={w / 2}
                    y={h / 2 + 14}
                    textAnchor="middle"
                    fontSize={11}
                    fill="var(--gray-11)"
                  >
                    {t.seats} seats
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <aside className="space-y-3 rounded-2xl bg-panel p-4 ring-1 ring-gray-5">
          {selTable && selPlaced ? (
            <>
              <p className="text-lg font-black text-gray-12">
                {selTable.name}{" "}
                <span className="text-sm font-semibold text-gray-11">· {selTable.seats} seats</span>
              </p>
              <div>
                <p className="mb-1 text-xs font-bold text-gray-11">Shape</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      ["ROUND", "Round", Circle],
                      ["SQUARE", "Square", Square],
                      ["RECT", "Long", RectangleHorizontal],
                    ] as const
                  ).map(([shape, label, Icon]) => (
                    <button
                      key={shape}
                      onClick={() =>
                        updateTable(selTable.id, (p) => ({
                          ...p,
                          shape,
                          box:
                            shape === "RECT" && p.box.w === p.box.h
                              ? { ...p.box, w: p.box.w + 50 }
                              : shape !== "RECT"
                                ? {
                                    ...p.box,
                                    w: Math.min(p.box.w, p.box.h),
                                    h: Math.min(p.box.w, p.box.h),
                                  }
                                : p.box,
                        }))
                      }
                      aria-pressed={selPlaced.shape === shape}
                      className={cn(
                        "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-semibold ring-1",
                        selPlaced.shape === shape
                          ? "bg-brand-9 text-white ring-brand-9"
                          : "text-gray-12 ring-gray-6",
                      )}
                    >
                      <Icon className="size-4" /> {label}
                    </button>
                  ))}
                </div>
              </div>
              <SizeControls
                w={selPlaced.box.w}
                h={selPlaced.box.h}
                onResize={resize}
                onTurn={turn}
              />
            </>
          ) : selFixture ? (
            <>
              <p className="text-lg font-black text-gray-12">
                {PALETTE.find((p) => p.kind === selFixture.kind)?.label}
              </p>
              <SizeControls w={selFixture.w} h={selFixture.h} onResize={resize} onTurn={turn} />
              <button
                onClick={() => removeFixture(selFixture.id)}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-danger-11 ring-1 ring-danger-6 hover:bg-danger-2"
              >
                <Trash2 className="size-4" /> Remove
              </button>
            </>
          ) : (
            <div className="space-y-2 text-sm text-gray-11">
              <p className="font-bold text-gray-12">How to draw your room</p>
              <p>1. Drag each table to where it stands. Tap one to change its shape or size.</p>
              <p>
                2. Add the entrance, walls, windows, counter and kitchen so staff recognise the
                room.
              </p>
              <p>3. Save. The host screen draws the same room with guests in the chairs.</p>
              <p className="text-xs">
                Seats, areas and which tables push together are set in Hours &amp; rules.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function SizeControls({
  w,
  h,
  onResize,
  onTurn,
}: {
  w: number;
  h: number;
  onResize: (key: "w" | "h", delta: number) => void;
  onTurn: () => void;
}) {
  return (
    <>
      {(
        [
          ["w", "Width", w],
          ["h", "Depth", h],
        ] as const
      ).map(([k, label, v]) => (
        <div key={k} className="flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-12">{label}</span>
          <div className="flex items-center gap-1 rounded-xl bg-gray-3 p-1">
            <button
              aria-label={`Smaller ${label.toLowerCase()}`}
              onClick={() => onResize(k, -10)}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-panel"
            >
              <Minus className="size-4" />
            </button>
            <span className="w-10 text-center text-sm font-bold tabular-nums">{v}</span>
            <button
              aria-label={`Bigger ${label.toLowerCase()}`}
              onClick={() => onResize(k, 10)}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-panel"
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>
      ))}
      <button
        onClick={onTurn}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-gray-12 ring-1 ring-gray-6 hover:bg-gray-3"
      >
        <RotateCw className="size-4" /> Turn 90°
      </button>
    </>
  );
}
