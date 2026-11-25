"use client";

import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Baby,
  CalendarDays,
  Check,
  Minus,
  Plus,
  Sparkles,
  User,
  Users,
} from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { cn } from "@/lib/utils";
import { CoastalShell, Panel, StepHeader, WaveHeader } from "./Coastal";

type Restaurant = { name: string; slug: string; logoUrl: string | null; timeZone: string };
type Slot = { key: string; at: string; available: boolean };
type TableState = "free" | "booked" | "occupied" | "unsuitable";
type TableView = { id: string; name: string; seats: number; area: string; state: TableState };
type FloorView = {
  durationMins: number;
  areas: string[];
  tables: TableView[];
  recommended: string[] | null;
  reason: string | null;
};
type Alternative = { at: string; label: string };
type Booked = { code: string; manageToken: string; startAt: string; tables: string[] };

const STEPS = 3;
const fetcher = (url: string) => fetch(url).then((r) => r.json());

/** "2026-11-22" → { weekday: "Sun", day: "22 Nov" }, independent of the device's zone. */
function describeDate(key: string, todayKey: string) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(
    date,
  );
  const day = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
  return { weekday: key === todayKey ? "Today" : weekday, day };
}

function friendlyWhen(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

export default function BookingWizard({
  restaurant,
  dates,
  enabled,
  maxParty,
}: {
  restaurant: Restaurant;
  dates: string[];
  enabled: boolean;
  maxParty: number;
}) {
  const [step, setStep] = useState(1);
  const [date, setDate] = useState(dates[0]);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [floor, setFloor] = useState<FloorView | null>(null);
  const [area, setArea] = useState<string | null>(null);
  // null = "pick the best table for us"
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alternatives, setAlternatives] = useState<Alternative[]>([]);
  const [booked, setBooked] = useState<Booked | null>(null);

  const party = adults + children;
  const base = `/api/r/${restaurant.slug}`;

  // One availability read per (date, party): step 1's grid and step 2's
  // "is that time still free for this many?" check are the same question.
  const { data: slotData } = useSWR<{ slots?: Slot[] }>(
    `${base}/availability?date=${date}&party=${party}`,
    fetcher,
    { keepPreviousData: false },
  );
  const slots = useMemo(() => (slotData ? (slotData.slots ?? []) : null), [slotData]);

  const loadFloor = useCallback(
    async (at: string, forParty: number) => {
      setFloor(null);
      const res = await fetch(
        `${base}/availability?at=${encodeURIComponent(at)}&party=${forParty}`,
      );
      const data = (await res.json()) as FloorView;
      setFloor(data);
      setArea(
        (prev) =>
          prev ??
          data.tables.find((t) => t.id === data.recommended?.[0])?.area ??
          data.areas[0] ??
          null,
      );
      return data;
    },
    [base],
  );

  const slotStillFree = !slots || !slot || slots.find((s) => s.key === slot.key)?.available;
  const nearby = useMemo(() => {
    if (!slots || !slot) return [];
    const at = new Date(slot.at).getTime();
    return slots
      .filter((s) => s.available)
      .sort(
        (a, b) => Math.abs(new Date(a.at).getTime() - at) - Math.abs(new Date(b.at).getTime() - at),
      )
      .slice(0, 4)
      .sort((a, b) => a.at.localeCompare(b.at));
  }, [slots, slot]);

  const phoneOk = /^\+?[\d\s-]{10,16}$/.test(phone.trim());
  const detailsOk = name.trim().length >= 2 && phoneOk;

  async function goToTables() {
    if (!slot) return;
    setError(null);
    setChosen(null);
    setStep(3);
    await loadFloor(slot.at, party);
  }

  async function confirm() {
    if (!slot) return;
    setBusy(true);
    setError(null);
    setAlternatives([]);
    const result = await apiFetch<Booked & { ok: true }>(`${base}/reservations`, "POST", {
      customerName: name.trim(),
      customerPhone: phone.trim(),
      adults,
      children,
      startAt: slot.at,
      tableIds: chosen ? [chosen] : undefined,
      area: area ?? undefined,
      note: note.trim() || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      const alts = (result.body?.alternatives as Alternative[] | undefined) ?? [];
      setAlternatives(alts);
      // Someone else got there first: show the map as it is now.
      if (result.status === 409) {
        setChosen(null);
        void loadFloor(slot.at, party);
      }
      return;
    }
    setBooked(result.data);
  }

  async function switchTime(at: string, label: string) {
    const next = { key: label, at, available: true };
    setSlot(next);
    setAlternatives([]);
    setError(null);
    setChosen(null);
    await loadFloor(at, party);
  }

  if (!enabled) {
    return (
      <CoastalShell>
        <WaveHeader eyebrow="Reservations" title={restaurant.name} logoUrl={restaurant.logoUrl} />
        <div className="relative z-10 mx-auto -mt-16 w-full max-w-md px-4 pb-10">
          <Panel>
            <p className="font-semibold text-gray-12">Online booking is switched off.</p>
            <p className="mt-1 text-sm text-gray-11">Please call the restaurant to book a table.</p>
          </Panel>
        </div>
      </CoastalShell>
    );
  }

  if (booked) {
    return (
      <CoastalShell>
        <WaveHeader eyebrow="You're booked" title={restaurant.name} logoUrl={restaurant.logoUrl} />
        <div className="relative z-10 mx-auto -mt-20 w-full max-w-md space-y-4 px-4 pb-10">
          <Panel>
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-tangerine-9 text-on-tangerine">
                <Check className="size-6" strokeWidth={3} />
              </span>
              <div>
                <p className="text-lg font-bold text-gray-12">Table confirmed</p>
                <p className="text-sm text-gray-11">Show this code at the door</p>
              </div>
            </div>
            <p className="mt-4 rounded-xl bg-gray-3 py-3 text-center font-mono text-3xl font-black tracking-[0.2em] text-gray-12">
              {booked.code}
            </p>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-gray-11">When</dt>
              <dd className="font-semibold text-gray-12">
                {friendlyWhen(booked.startAt, restaurant.timeZone)}
              </dd>
              <dt className="text-gray-11">Guests</dt>
              <dd className="font-semibold text-gray-12">
                {adults} adult{adults === 1 ? "" : "s"}
                {children ? `, ${children} child${children === 1 ? "" : "ren"}` : ""}
              </dd>
              <dt className="text-gray-11">Table</dt>
              <dd className="font-semibold text-gray-12">{booked.tables.join(" + ")}</dd>
            </dl>
          </Panel>
          <Panel>
            <p className="text-sm text-gray-12">
              A WhatsApp confirmation is on its way to <strong>{phone}</strong> with a link to
              confirm, tell us you&apos;re running late, or cancel. We&apos;ll remind you before
              your table.
            </p>
            <Link
              href={`/r/${restaurant.slug}/booking/${booked.manageToken}`}
              className="mt-3 flex min-h-11 items-center justify-center rounded-xl bg-brand-9 px-4 text-sm font-bold text-white hover:bg-brand-10"
            >
              Manage this booking
            </Link>
          </Panel>
        </div>
      </CoastalShell>
    );
  }

  const tablesInArea = floor?.tables.filter((t) => !area || t.area === area) ?? [];
  const recommendedNames = floor?.recommended
    ?.map((id) => floor.tables.find((t) => t.id === id)?.name)
    .filter(Boolean)
    .join(" + ");

  return (
    <CoastalShell>
      {step === 1 && (
        <WaveHeader
          eyebrow="Book a table"
          title={restaurant.name}
          logoUrl={restaurant.logoUrl}
          compact
        >
          <p className="mt-2 max-w-[16rem] text-sm font-medium text-gray-12">
            Instant confirmation. No account, no app: just your WhatsApp number.
          </p>
        </WaveHeader>
      )}

      <div
        className={cn(
          "relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col",
          step === 1 && "-mt-12",
        )}
      >
        <div className={cn("overflow-hidden", step === 1 ? "mx-4 rounded-t-2xl" : "")}>
          <StepHeader
            step={step}
            total={STEPS}
            title="Booking"
            subtitle={
              step === 1
                ? "Pick a date and time"
                : step === 2
                  ? "Who's coming"
                  : "Choose your table"
            }
          />
        </div>

        <div className="flex-1 space-y-4 px-4 pt-4 pb-32">
          {step === 1 && (
            <>
              <Panel title="Date">
                <div
                  className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
                  role="listbox"
                  aria-label="Date"
                >
                  {dates.map((key) => {
                    const d = describeDate(key, dates[0]);
                    const active = key === date;
                    return (
                      <button
                        key={key}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => {
                          setDate(key);
                          setSlot(null);
                        }}
                        className={cn(
                          "flex min-h-14 min-w-[4.5rem] shrink-0 flex-col items-center justify-center rounded-xl px-3 text-xs transition",
                          active
                            ? "bg-brand-9 text-white"
                            : "bg-gray-3 text-gray-12 hover:bg-gray-4",
                        )}
                      >
                        <span className={active ? "text-white/80" : "text-gray-11"}>
                          {d.weekday}
                        </span>
                        <span className="font-bold">{d.day}</span>
                      </button>
                    );
                  })}
                </div>
              </Panel>

              <Panel title="Time">
                {slots == null ? (
                  <div className="grid grid-cols-4 gap-2" aria-busy="true">
                    {Array.from({ length: 12 }, (_, i) => (
                      <span key={i} className="h-10 animate-pulse rounded-full bg-gray-3" />
                    ))}
                  </div>
                ) : slots.length === 0 ? (
                  <p className="text-sm text-gray-11">No seatings on this day.</p>
                ) : (
                  <>
                    <div className="grid grid-cols-4 gap-2">
                      {slots.map((s) => {
                        const active = slot?.key === s.key;
                        return (
                          <button
                            key={s.key}
                            type="button"
                            disabled={!s.available}
                            onClick={() => setSlot(s)}
                            aria-pressed={active}
                            className={cn(
                              "min-h-10 rounded-full text-sm font-semibold tabular-nums transition",
                              active
                                ? "bg-brand-9 text-white ring-2 ring-tangerine-8 ring-offset-2 ring-offset-panel"
                                : s.available
                                  ? "bg-gray-3 text-gray-12 hover:bg-gray-4"
                                  : "cursor-not-allowed bg-transparent text-gray-8 line-through",
                            )}
                          >
                            {s.key}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-3 text-xs text-gray-11">
                      Showing times with a table for {party}. Struck-through times are full.
                    </p>
                    {slots.every((s) => !s.available) && (
                      <p className="mt-3 rounded-xl bg-tangerine-3 p-3 text-sm text-tangerine-12">
                        Fully booked.{" "}
                        <Link
                          href={`/r/${restaurant.slug}/waitlist`}
                          className="font-bold underline"
                        >
                          Join the waiting list
                        </Link>{" "}
                        if you&apos;re coming today.
                      </p>
                    )}
                  </>
                )}
              </Panel>
            </>
          )}

          {step === 2 && (
            <>
              <Panel title="Guests">
                <Counter
                  icon={<User className="size-4" />}
                  label="Adults"
                  value={adults}
                  min={1}
                  max={maxParty - children}
                  onChange={setAdults}
                  highlighted
                />
                <Counter
                  icon={<Baby className="size-4" />}
                  label="Children"
                  hint="They count for seats; tell us if you need a high chair."
                  value={children}
                  min={0}
                  max={maxParty - adults}
                  onChange={setChildren}
                />
                {!slotStillFree && (
                  <div className="mt-3 rounded-xl bg-tangerine-3 p-3 text-sm text-tangerine-12">
                    <p className="font-semibold">
                      No table for {party} at {slot?.key}.
                    </p>
                    {nearby.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {nearby.map((s) => (
                          <button
                            key={s.key}
                            type="button"
                            onClick={() => setSlot(s)}
                            className="min-h-9 rounded-full bg-panel px-3 font-semibold text-gray-12 ring-1 ring-tangerine-7"
                          >
                            {s.key}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1">
                        Try another day, or{" "}
                        <Link
                          href={`/r/${restaurant.slug}/waitlist`}
                          className="font-bold underline"
                        >
                          join the waiting list
                        </Link>
                        .
                      </p>
                    )}
                  </div>
                )}
              </Panel>

              <Panel title="Your details">
                <div className="space-y-3">
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-gray-11">Name</span>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="name"
                      placeholder="e.g. Ayesha Khan"
                      className="w-full rounded-xl border border-gray-6 px-4 py-3 text-base outline-none focus:border-brand-8 focus:ring-2 focus:ring-tangerine-6"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-gray-11">
                      WhatsApp number
                    </span>
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="0300 1234567"
                      className="w-full rounded-xl border border-gray-6 px-4 py-3 text-base outline-none focus:border-brand-8 focus:ring-2 focus:ring-tangerine-6"
                    />
                    <span className="mt-1 block text-xs text-gray-11">
                      For your confirmation and reminder, and so the restaurant remembers you next
                      time. Never shared; ask them to delete it any time.
                    </span>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-gray-11">
                      Anything we should know? <span className="font-normal">(optional)</span>
                    </span>
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      maxLength={300}
                      placeholder="Birthday, high chair, wheelchair access…"
                      className="w-full rounded-xl border border-gray-6 px-4 py-3 text-base outline-none focus:border-brand-8 focus:ring-2 focus:ring-tangerine-6"
                    />
                  </label>
                </div>
              </Panel>
            </>
          )}

          {step === 3 && (
            <>
              {floor && floor.areas.length > 1 && (
                <div
                  className="flex gap-2 rounded-full bg-panel p-1 ring-1 ring-gray-5"
                  role="tablist"
                >
                  {floor.areas.map((a) => (
                    <button
                      key={a}
                      type="button"
                      role="tab"
                      aria-selected={area === a}
                      onClick={() => setArea(a)}
                      className={cn(
                        "min-h-10 flex-1 rounded-full text-sm font-semibold transition",
                        area === a ? "bg-brand-9 text-white" : "text-gray-11 hover:text-gray-12",
                      )}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={() => setChosen(null)}
                disabled={!floor?.recommended}
                className={cn(
                  "flex w-full items-center gap-3 rounded-2xl bg-panel p-4 text-left ring-1 transition disabled:opacity-60",
                  chosen === null ? "ring-2 ring-tangerine-8" : "ring-gray-5 hover:ring-gray-7",
                )}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-tangerine-9 text-on-tangerine">
                  <Sparkles className="size-5" />
                </span>
                <span className="flex-1">
                  <span className="block font-bold text-gray-12">Best table for {party}</span>
                  <span className="block text-sm text-gray-11">
                    {floor == null
                      ? "Finding the right table…"
                      : floor.recommended
                        ? `We'll seat you at ${recommendedNames}`
                        : "No table fits at this time"}
                  </span>
                </span>
                {chosen === null && floor?.recommended && (
                  <Check className="size-5 text-tangerine-11" />
                )}
              </button>

              <Panel title="Or pick one yourself">
                {floor == null ? (
                  <div className="grid grid-cols-3 gap-3" aria-busy="true">
                    {Array.from({ length: 6 }, (_, i) => (
                      <span key={i} className="h-20 animate-pulse rounded-xl bg-gray-3" />
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      {tablesInArea.map((t) => (
                        <TableTile
                          key={t.id}
                          table={t}
                          selected={chosen === t.id}
                          recommended={!chosen && !!floor.recommended?.includes(t.id)}
                          onSelect={() => setChosen(t.id)}
                        />
                      ))}
                    </div>
                    <Legend />
                  </>
                )}
              </Panel>

              {slot && (
                <Panel>
                  <div className="flex items-center gap-3 text-sm">
                    <CalendarDays className="size-5 shrink-0 text-tangerine-11" />
                    <div className="flex-1">
                      <p className="font-bold text-gray-12">
                        {friendlyWhen(slot.at, restaurant.timeZone)}
                      </p>
                      <p className="text-gray-11">
                        <Users className="mr-1 inline size-3.5" />
                        {party} guest{party === 1 ? "" : "s"} · about {floor?.durationMins ?? 90}{" "}
                        min
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="text-sm font-semibold text-brand-11 underline"
                    >
                      Change
                    </button>
                  </div>
                </Panel>
              )}

              {error && (
                <div role="alert" className="rounded-xl bg-danger-3 p-3 text-sm text-danger-12">
                  <p>{error}</p>
                  {alternatives.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="w-full text-xs">These times still have a table:</span>
                      {alternatives.map((a) => (
                        <button
                          key={a.at}
                          type="button"
                          onClick={() => switchTime(a.at, a.label)}
                          className="min-h-9 rounded-full bg-panel px-3 font-semibold text-gray-12 ring-1 ring-gray-6"
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-gray-5 bg-panel/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-md gap-3 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {step > 1 && (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStep(step - 1);
                }}
                className="flex min-h-12 flex-1 items-center justify-center gap-1 rounded-full border border-gray-6 bg-panel font-semibold text-gray-12 hover:bg-gray-3"
              >
                <ArrowLeft className="size-4" /> Back
              </button>
            )}
            {step === 1 && (
              <PrimaryButton disabled={!slot} onClick={() => setStep(2)}>
                Next <ArrowRight className="size-4" />
              </PrimaryButton>
            )}
            {step === 2 && (
              <PrimaryButton disabled={!detailsOk || !slotStillFree} onClick={goToTables}>
                Next <ArrowRight className="size-4" />
              </PrimaryButton>
            )}
            {step === 3 && (
              <PrimaryButton
                disabled={busy || !floor || (!chosen && !floor.recommended)}
                onClick={confirm}
              >
                {busy ? "Confirming…" : "Confirm booking"}
              </PrimaryButton>
            )}
          </div>
        </div>
      </div>
    </CoastalShell>
  );
}

function PrimaryButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-12 flex-[2] items-center justify-center gap-1 rounded-full bg-brand-9 font-bold text-white transition hover:bg-brand-10 disabled:bg-gray-6 disabled:text-gray-11"
    >
      {children}
    </button>
  );
}

function Counter({
  icon,
  label,
  hint,
  value,
  min,
  max,
  onChange,
  highlighted,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  highlighted?: boolean;
}) {
  return (
    <div className="border-b border-gray-4 py-3 last:border-0">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-brand-11">
        {icon} {label}
      </div>
      <div
        className={cn(
          "flex items-center justify-between rounded-xl px-2 py-1.5",
          highlighted || value > 0 ? "bg-brand-9 text-white" : "bg-gray-3 text-gray-12",
        )}
      >
        <button
          type="button"
          aria-label={`One fewer ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 disabled:opacity-40"
        >
          <Minus className="size-4" />
        </button>
        <span className="text-lg font-bold tabular-nums" aria-live="polite">
          {value}
        </span>
        <button
          type="button"
          aria-label={`One more ${label.toLowerCase()}`}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 disabled:opacity-40"
        >
          <Plus className="size-4" />
        </button>
      </div>
      {hint && <p className="mt-1.5 text-xs text-gray-11">{hint}</p>}
    </div>
  );
}

const STATE_STYLE: Record<TableState, { bar: string; label: string }> = {
  free: { bar: "bg-success-9", label: "Free" },
  booked: { bar: "bg-tangerine-9", label: "Booked" },
  occupied: { bar: "bg-brand-9", label: "Occupied" },
  unsuitable: { bar: "bg-gray-6", label: "Wrong size" },
};

function TableTile({
  table,
  selected,
  recommended,
  onSelect,
}: {
  table: TableView;
  selected: boolean;
  recommended: boolean;
  onSelect: () => void;
}) {
  const style = STATE_STYLE[table.state];
  const selectable = table.state === "free";
  return (
    <button
      type="button"
      disabled={!selectable}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${table.name}, ${table.seats} seats, ${style.label}`}
      className={cn(
        "relative flex min-h-20 flex-col items-start justify-between overflow-hidden rounded-xl bg-gray-2 p-2.5 pl-4 text-left ring-1 transition",
        selected ? "ring-2 ring-tangerine-8" : recommended ? "ring-2 ring-brand-7" : "ring-gray-5",
        selectable ? "hover:bg-gray-3" : "opacity-70",
      )}
    >
      <span
        aria-hidden="true"
        className={cn("absolute inset-y-2 left-1.5 w-1 rounded-full", style.bar)}
      />
      <span className="text-sm font-bold text-gray-12">{table.name}</span>
      <span className="text-[11px] text-gray-11">
        {table.seats} seats · {style.label}
      </span>
      {selected && (
        <Check className="absolute top-2 right-2 size-4 text-tangerine-11" strokeWidth={3} />
      )}
    </button>
  );
}

function Legend() {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-11">
      {(["free", "booked", "occupied"] as TableState[]).map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <span className={cn("h-2.5 w-1 rounded-full", STATE_STYLE[s].bar)} />
          {STATE_STYLE[s].label}
        </li>
      ))}
    </ul>
  );
}
