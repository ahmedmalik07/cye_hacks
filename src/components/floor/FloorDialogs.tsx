"use client";

import { useMemo, useState } from "react";
import { Camera, Minus, Plus } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { cn } from "@/lib/utils";
import { Modal, ModalHeader } from "@/components/ui/modal";
import { clock, minsSince, STATUS_STYLE, type Arrival, type Floor, type FloorTable } from "./types";

const BASIS: Record<string, string> = {
  staff: "set by staff",
  camera: "camera sees the table empty",
  paid: "from when they paid",
  bill: "from when they asked for the bill",
  order: "from when they ordered",
  seated: "from when they sat down",
};

const STAGE: Record<string, string> = {
  SEATED: "Seated, not ordered yet",
  ORDERED: "Food on its way",
  EATING: "Eating",
  BILL: "Asked for the bill",
  PAID: "Paid, leaving soon",
};

function Stepper({
  value,
  onChange,
  min = 1,
  max = 40,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="flex items-center gap-1 rounded-xl bg-gray-3 p-1">
      <button
        type="button"
        aria-label="Fewer guests"
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
        className="flex h-9 w-9 items-center justify-center rounded-lg bg-panel text-gray-12 disabled:opacity-40"
      >
        <Minus className="size-4" />
      </button>
      <span className="w-8 text-center font-bold text-gray-12 tabular-nums">{value}</span>
      <button
        type="button"
        aria-label="More guests"
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
        className="flex h-9 w-9 items-center justify-center rounded-lg bg-panel text-gray-12 disabled:opacity-40"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}

const btn = {
  primary:
    "min-h-11 rounded-xl bg-brand-9 px-4 text-sm font-bold text-white hover:bg-brand-10 disabled:opacity-50",
  accent:
    "min-h-11 rounded-xl bg-tangerine-9 px-4 text-sm font-bold text-on-tangerine hover:bg-tangerine-10 disabled:opacity-50",
  quiet:
    "min-h-11 rounded-xl px-4 text-sm font-semibold text-gray-12 ring-1 ring-gray-6 hover:bg-gray-3 disabled:opacity-50",
};

/** Everything you can do with one table, depending on where it is in its cycle. */
export function TableSheet({
  table: t,
  floor,
  now,
  onClose,
  onDone,
}: {
  table: FloorTable;
  floor: Floor;
  now: number;
  onClose: () => void;
  onDone: (msg?: string) => Promise<void>;
}) {
  const tz = floor.restaurant.timeZone;
  const [party, setParty] = useState(Math.min(t.seats, 2));
  const [bill, setBill] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [held, setHeld] = useState<{ msg: string; body: Record<string, unknown> } | null>(null);
  const style = STATUS_STYLE[t.status];
  const url = `/api/staff/floor/tables/${t.id}`;
  const canSeat = ["AVAILABLE", "READY", "RESERVED", "CLEANING"].includes(t.status);
  const waiting = floor.waitlist.filter((w) => w.partySize <= t.seats);

  async function post(body: Record<string, unknown>, msg: string, close = true) {
    setBusy(true);
    setError(null);
    const res = await apiFetch<{ moved?: string[]; unplaced?: string[] }>(url, "POST", body);
    setBusy(false);
    if (!res.ok) {
      if (res.body?.code === "HELD") {
        setHeld({ msg: res.error, body });
        return;
      }
      setError(res.error);
      return;
    }
    const extra = [
      res.data.moved?.length ? `Moved ${res.data.moved.join(", ")}` : "",
      res.data.unplaced?.length ? `${res.data.unplaced.join(", ")} needs a table` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    await onDone(extra ? `${msg} · ${extra}` : msg);
    if (close) onClose();
  }

  async function seatBooking(id: string) {
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/api/staff/reservations/${id}`, "PATCH", { action: "seat" });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    await onDone("Booking seated");
    onClose();
  }

  function shift(mins: number) {
    if (!t.estimate) return;
    const base = Math.max(now, new Date(t.estimate.freeAt).getTime());
    void post(
      { action: "ESTIMATE", freeAt: new Date(base + mins * 60_000).toISOString() },
      "Estimate updated",
      false,
    );
  }

  return (
    <Modal onClose={onClose} maxWidthClassName="max-w-md" ariaLabel={`${t.name} actions`}>
      <ModalHeader
        title={
          <span className="flex items-center gap-2">
            {t.name}
            <span className={cn("rounded-full border px-2 py-0.5 text-xs font-bold", style.tile)}>
              {style.label}
            </span>
          </span>
        }
        onClose={onClose}
      />
      <p className="-mt-2 mb-3 text-sm text-gray-11">
        {t.seats} seats · {t.area}
        {t.next &&
          ` · next booking ${clock(t.next.startAt, tz)} (${t.next.customerName} ×${t.next.partySize})`}
      </p>

      {(t.status === "OCCUPIED" || t.status === "BILL") && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Fact label="Guests" value={t.partySize ?? "?"} />
            <Fact label="Seated" value={`${minsSince(t.seatedAt, now)}m`} />
            <Fact
              label="Bill"
              value={
                t.billCents
                  ? new Intl.NumberFormat("en-PK", {
                      style: "currency",
                      currency: floor.restaurant.currency,
                      maximumFractionDigits: 0,
                    }).format(t.billCents / 100)
                  : t.paidAt
                    ? "Paid"
                    : "–"
              }
            />
          </div>
          {t.stage && <p className="text-sm font-semibold text-gray-12">{STAGE[t.stage]}</p>}
          {t.estimate && (
            <div className="rounded-xl bg-tangerine-2 p-3 ring-1 ring-tangerine-6">
              <p className="text-xs font-bold tracking-wide text-tangerine-11 uppercase">
                Estimated, not confirmed
              </p>
              <p className="mt-1 text-lg font-black text-gray-12">
                Free ~{clock(t.estimate.freeAt, tz)}{" "}
                <span className="text-sm font-semibold text-gray-11">
                  ({clock(t.estimate.low, tz)}–{clock(t.estimate.high, tz)})
                </span>
              </p>
              <p className="text-sm text-gray-11">
                Ready for the next party ~{clock(t.estimate.readyAt, tz)} · {t.estimate.confidence}{" "}
                confidence, {BASIS[t.estimate.basis]}
                {t.estimate.learning ? " · still learning your timings" : ""}
              </p>
              {t.estimate.overdueMins > 0 && (
                <p className="mt-1 text-sm font-semibold text-danger-11">
                  {t.estimate.overdueMins} min past the usual time for this stage.
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="self-center text-xs font-semibold text-gray-11">
                  You know better:
                </span>
                {[-10, 10, 20].map((m) => (
                  <button
                    key={m}
                    disabled={busy}
                    onClick={() => shift(m)}
                    className="min-h-9 rounded-lg bg-panel px-3 text-xs font-bold text-gray-12 ring-1 ring-gray-6"
                  >
                    {m > 0 ? `+${m}` : m} min
                  </button>
                ))}
                {t.estimate.basis === "staff" && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      post(
                        { action: "ESTIMATE", freeAt: null },
                        "Back to the automatic estimate",
                        false,
                      )
                    }
                    className="min-h-9 rounded-lg px-3 text-xs font-semibold text-gray-11 underline"
                  >
                    Use automatic
                  </button>
                )}
              </div>
            </div>
          )}
          {t.cctv?.empty && (
            <p className="flex items-center gap-2 rounded-xl bg-info-3 p-2.5 text-sm text-info-12">
              <Camera className="size-4" /> The camera has seen this table empty since{" "}
              {clock(t.cctv.since, tz)}.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            {!t.orderedAt && (
              <button
                disabled={busy}
                onClick={() => post({ action: "ORDERED" }, `${t.name}: order placed`, false)}
                className={btn.quiet}
              >
                Order placed
              </button>
            )}
            {t.status === "OCCUPIED" && (
              <button
                disabled={busy}
                onClick={() => post({ action: "BILL" }, `${t.name}: bill requested`)}
                className={btn.accent}
              >
                Bill requested
              </button>
            )}
            {!t.paidAt && (
              <label className="col-span-2 flex items-center gap-2">
                <input
                  inputMode="numeric"
                  placeholder="Bill total (optional)"
                  value={bill}
                  onChange={(e) => setBill(e.target.value.replace(/[^\d]/g, ""))}
                  className="min-w-0 flex-1 rounded-xl border border-gray-7 bg-field px-3 py-2.5 text-sm text-gray-12"
                  aria-label="Bill total"
                />
                <button
                  disabled={busy}
                  onClick={() =>
                    post(
                      { action: "PAID", billCents: bill ? Number(bill) * 100 : undefined },
                      `${t.name}: paid`,
                    )
                  }
                  className={btn.quiet}
                >
                  Paid
                </button>
              </label>
            )}
            <button
              disabled={busy}
              onClick={() => post({ action: "LEFT" }, `${t.name}: guests left, cleaning`)}
              className={cn(btn.primary, "col-span-2")}
            >
              Guests left
            </button>
          </div>
        </div>
      )}

      {t.status === "CLEANING" && (
        <div className="space-y-3">
          <p className="text-sm text-gray-12">
            Guests left {minsSince(t.leftAt, now)} min ago. The table is only offered to the next
            party once it&apos;s reset.
          </p>
          <button
            disabled={busy}
            onClick={() => post({ action: "CLEANED" }, `${t.name} is ready`)}
            className={cn(btn.primary, "w-full")}
          >
            Cleaning done, table ready
          </button>
        </div>
      )}

      {canSeat && (
        <div className="mt-3 space-y-3">
          {t.heldBy && (
            <div className="rounded-xl bg-brand-3 p-3">
              <p className="text-sm text-brand-12">
                Held for <strong>{t.heldBy.customerName}</strong> ×{t.heldBy.partySize} at{" "}
                {clock(t.heldBy.startAt, tz)}
                {t.heldBy.lateMins > 0 && ` · ${t.heldBy.lateMins} min late`}
              </p>
              <button
                disabled={busy}
                onClick={() => seatBooking(t.heldBy!.id)}
                className={cn(btn.primary, "mt-2 w-full")}
              >
                They&apos;re here: seat the booking
              </button>
            </div>
          )}
          {t.cctv?.unseated && (
            <p className="flex items-center gap-2 rounded-xl bg-info-3 p-2.5 text-sm text-info-12">
              <Camera className="size-4" /> The camera sees people here. Seat them so the board
              knows.
            </p>
          )}
          <div className="rounded-xl bg-gray-2 p-3 ring-1 ring-gray-5">
            <p className="mb-2 text-sm font-bold text-gray-12">Walk-in</p>
            <div className="flex items-center justify-between gap-3">
              <Stepper value={party} onChange={setParty} max={Math.max(t.seats + 4, 8)} />
              <button
                disabled={busy}
                onClick={() =>
                  post({ action: "SEAT", partySize: party }, `${t.name}: seated ${party}`)
                }
                className={cn(btn.primary, "flex-1")}
              >
                Seat {party}
              </button>
            </div>
          </div>
          {waiting.length > 0 && (
            <div className="rounded-xl bg-gray-2 p-3 ring-1 ring-gray-5">
              <p className="mb-2 text-sm font-bold text-gray-12">From the waiting list</p>
              <ul className="space-y-2">
                {waiting.slice(0, 4).map((w) => (
                  <li key={w.id} className="flex items-center gap-2">
                    <span className="flex-1 truncate text-sm text-gray-12">
                      {w.position ? `${w.position}. ` : ""}
                      {w.customerName} ×{w.partySize}
                      <span className="text-gray-11"> · {minsSince(w.joinedAt, now)}m</span>
                    </span>
                    <button
                      disabled={busy}
                      onClick={() =>
                        post(
                          { action: "SEAT", partySize: w.partySize, waitlistEntryId: w.id },
                          `${w.customerName} seated`,
                        )
                      }
                      className="min-h-9 rounded-lg bg-tangerine-9 px-3 text-xs font-bold text-on-tangerine"
                    >
                      Seat
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {held && (
        <div className="mt-3 rounded-xl bg-tangerine-3 p-3 text-sm text-tangerine-12" role="alert">
          <p>{held.msg}</p>
          <div className="mt-2 flex gap-2">
            <button onClick={() => setHeld(null)} className={cn(btn.quiet, "flex-1")}>
              Pick another table
            </button>
            <button
              disabled={busy}
              onClick={() => {
                const body = { ...held.body, force: true };
                setHeld(null);
                void post(body, `${t.name}: seated (booking moved)`);
              }}
              className={cn(btn.accent, "flex-1")}
            >
              Seat anyway
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-danger-3 p-3 text-sm text-danger-12">
          {error}
        </p>
      )}
    </Modal>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-gray-3 py-2">
      <p className="text-base font-black text-gray-12 tabular-nums">{value}</p>
      <p className="text-[11px] text-gray-11">{label}</p>
    </div>
  );
}

/** A booking has arrived: seat it where planned, or somewhere else that's free. */
export function SeatArrivalDialog({
  arrival: r,
  floor,
  onClose,
  onDone,
}: {
  arrival: Arrival;
  floor: Floor;
  onClose: () => void;
  onDone: (msg: string) => Promise<void>;
}) {
  const tz = floor.restaurant.timeZone;
  const planned = r.tables.map((t) => t.id);
  const plannedReady = r.tables.every((pt) => {
    const live = floor.tables.find((t) => t.id === pt.id);
    return live && ["AVAILABLE", "READY", "RESERVED", "CLEANING"].includes(live.status);
  });
  const others = floor.tables.filter(
    (t) =>
      !planned.includes(t.id) &&
      ["AVAILABLE", "READY", "CLEANING"].includes(t.status) &&
      t.seats >= r.partySize,
  );
  const [choice, setChoice] = useState<string>(
    plannedReady && planned.length ? "planned" : (others[0]?.id ?? ""),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function seat() {
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/api/staff/reservations/${r.id}`, "PATCH", {
      action: "seat",
      tableIds: choice === "planned" ? undefined : [choice],
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    await onDone(`${r.customerName} seated`);
  }

  return (
    <Modal onClose={onClose} maxWidthClassName="max-w-sm" ariaLabel="Seat booking">
      <ModalHeader title={`Seat ${r.customerName} ×${r.partySize}`} onClose={onClose} />
      <p className="-mt-2 mb-3 text-sm text-gray-11">
        Booked {clock(r.startAt, tz)} · {r.code}
        {r.childCount ? ` · ${r.childCount} child${r.childCount === 1 ? "" : "ren"}` : ""}
      </p>
      <div className="space-y-2">
        {planned.length > 0 && (
          <label
            className={cn(
              "flex items-center gap-3 rounded-xl p-3 ring-1",
              choice === "planned" ? "ring-2 ring-tangerine-8" : "ring-gray-6",
              !plannedReady && "opacity-60",
            )}
          >
            <input
              type="radio"
              name="table"
              disabled={!plannedReady}
              checked={choice === "planned"}
              onChange={() => setChoice("planned")}
            />
            <span className="text-sm text-gray-12">
              <strong>{r.tables.map((t) => t.name).join(" + ")}</strong> (planned)
              {!plannedReady && (
                <span className="block text-xs text-danger-11">Still occupied</span>
              )}
            </span>
          </label>
        )}
        {others.map((t) => (
          <label
            key={t.id}
            className={cn(
              "flex items-center gap-3 rounded-xl p-3 ring-1",
              choice === t.id ? "ring-2 ring-tangerine-8" : "ring-gray-6",
            )}
          >
            <input
              type="radio"
              name="table"
              checked={choice === t.id}
              onChange={() => setChoice(t.id)}
            />
            <span className="text-sm text-gray-12">
              <strong>{t.name}</strong> · {t.seats} seats ·{" "}
              {STATUS_STYLE[t.status].label.toLowerCase()}
            </span>
          </label>
        ))}
        {!planned.length && !others.length && (
          <p className="text-sm text-gray-11">No free table fits right now.</p>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-danger-3 p-3 text-sm text-danger-12">
          {error}
        </p>
      )}
      <button disabled={busy || !choice} onClick={seat} className={cn(btn.primary, "mt-4 w-full")}>
        {busy ? "Seating…" : "Seat now"}
      </button>
    </Modal>
  );
}

function localDateKey(timeZone: string, offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function nextHalfHour(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(Date.now() + 30 * 60_000))
    .split(":")
    .map(Number);
  const mins = Math.ceil((parts[0] * 60 + parts[1]) / 30) * 30;
  return `${String(Math.floor(mins / 60) % 24).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

/** A booking taken over the phone (or for a regular at the counter). */
export function NewBookingDialog({
  timeZone: tz,
  tables,
  onClose,
  onDone,
}: {
  timeZone: string;
  tables: { id: string; name: string; seats: number; area: string }[];
  onClose: () => void;
  onDone: (msg: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [party, setParty] = useState(4);
  const [date, setDate] = useState(localDateKey(tz));
  const [time, setTime] = useState(nextHalfHour(tz));
  const [tableId, setTableId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alts, setAlts] = useState<{ at: string; label: string }[]>([]);
  const fits = useMemo(() => tables.filter((t) => t.seats >= party), [tables, party]);

  async function save(e?: React.FormEvent, override?: { time: string }) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    setAlts([]);
    const res = await apiFetch<{ code: string; tables: string[] }>(
      "/api/staff/reservations",
      "POST",
      {
        customerName: name.trim(),
        customerPhone: phone.trim() || undefined,
        partySize: party,
        date,
        time: override?.time ?? time,
        tableIds: tableId ? [tableId] : undefined,
        note: note.trim() || undefined,
        source: "PHONE",
      },
    );
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      setAlts((res.body?.alternatives as { at: string; label: string }[]) ?? []);
      return;
    }
    await onDone(`Booked ${res.data.code} · ${res.data.tables.join(" + ")}`);
  }

  const field =
    "w-full rounded-xl border border-gray-6 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-tangerine-6";
  return (
    <Modal onClose={onClose} maxWidthClassName="max-w-md" ariaLabel="New booking">
      <ModalHeader title="Phone booking" onClose={onClose} />
      <form onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className={field}
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="WhatsApp (optional)"
            type="tel"
            className={field}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-gray-12">Guests</span>
          <Stepper value={party} onChange={setParty} max={60} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="date"
            value={date}
            min={localDateKey(tz)}
            onChange={(e) => setDate(e.target.value)}
            className={field}
            aria-label="Date"
          />
          <input
            type="time"
            value={time}
            step={900}
            onChange={(e) => setTime(e.target.value)}
            className={field}
            aria-label="Time"
          />
        </div>
        <select
          value={tableId}
          onChange={(e) => setTableId(e.target.value)}
          className={field}
          aria-label="Table"
        >
          <option value="">Best table, chosen automatically</option>
          {fits.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} · {t.seats} seats · {t.area}
            </option>
          ))}
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (occasion, high chair…)"
          className={field}
        />
        {error && (
          <div role="alert" className="rounded-xl bg-danger-3 p-3 text-sm text-danger-12">
            {error}
            {alts.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {alts.map((a) => (
                  <button
                    key={a.at}
                    type="button"
                    onClick={() => {
                      setTime(a.label);
                      void save(undefined, { time: a.label });
                    }}
                    className="min-h-9 rounded-full bg-panel px-3 font-semibold text-gray-12 ring-1 ring-gray-6"
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button disabled={busy || !name.trim()} className={cn(btn.primary, "w-full")}>
          {busy ? "Booking…" : "Book table"}
        </button>
        <p className="text-xs text-gray-11">
          Same rules as online: a table is held only if it&apos;s free for the whole meal plus
          cleaning. Staff can book walk-in-only tables and beyond the online share.
        </p>
      </form>
    </Modal>
  );
}

/** A family at the door and no table: put them in the queue. */
export function QueueDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (msg: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [party, setParty] = useState(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await apiFetch("/api/staff/waitlist", "POST", {
      customerName: name.trim(),
      customerPhone: phone.trim() || undefined,
      partySize: party,
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    await onDone(`${name.trim()} added to the queue`);
  }
  const field =
    "w-full rounded-xl border border-gray-6 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-tangerine-6";
  return (
    <Modal onClose={onClose} maxWidthClassName="max-w-sm" ariaLabel="Add to waiting list">
      <ModalHeader title="Add to the waiting list" onClose={onClose} />
      <form onSubmit={save} className="space-y-3">
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className={field}
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="WhatsApp, to message them (optional)"
          type="tel"
          className={field}
        />
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-12">Guests</span>
          <Stepper value={party} onChange={setParty} max={60} />
        </div>
        {error && (
          <p role="alert" className="rounded-xl bg-danger-3 p-3 text-sm text-danger-12">
            {error}
          </p>
        )}
        <button disabled={busy || !name.trim()} className={cn(btn.accent, "w-full")}>
          {busy ? "Adding…" : "Add to queue"}
        </button>
      </form>
    </Modal>
  );
}
