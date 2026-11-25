"use client";

import { useEffect, useMemo, useState } from "react";
import { Star } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { cn } from "@/lib/utils";
import { BOOKING_TAGS } from "@/lib/reservations/tags";
import { Modal, ModalHeader } from "@/components/ui/modal";
import type { Floor } from "@/components/floor/types";
import { btn, fieldCls, Stepper } from "./shared";

type GuestHit = {
  id: string;
  name: string;
  phone: string | null;
  vip: boolean;
  visits?: number;
  noShows?: number;
  allergies: string | null;
};

/** 15-minute times across the day, as the host thinks of them. */
export function timeOptions(step = 15) {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += step) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
}

export function TagPicker({
  options,
  value,
  onChange,
}: {
  options: readonly string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((t) => {
        const on = value.includes(t);
        return (
          <button
            key={t}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== t) : [...value, t])}
            className={cn(
              "min-h-9 rounded-full px-3 text-xs font-semibold ring-1 transition",
              on
                ? "bg-brand-9 text-white ring-brand-9"
                : "bg-panel text-gray-12 ring-gray-6 hover:bg-gray-3",
            )}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A booking taken by staff: phone call, WhatsApp, or a guest at the counter
 * booking for later. Typing a number we know fills in the guest and shows
 * what to remember about them.
 */
export function BookingForm({
  floor,
  date,
  time,
  tableId,
  onClose,
  onDone,
}: {
  floor: Floor;
  date: string;
  time?: string;
  tableId?: string;
  onClose: () => void;
  onDone: (msg: string, id: string, date: string) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [party, setParty] = useState(2);
  const [children, setChildren] = useState(0);
  const [day, setDay] = useState(date);
  const [at, setAt] = useState(time ?? "20:00");
  const [table, setTable] = useState(tableId ?? "");
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [staffNote, setStaffNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alts, setAlts] = useState<{ at: string; label: string }[]>([]);
  const [found, setKnown] = useState<GuestHit | null>(null);

  const digits = phone.replace(/\D/g, "");
  useEffect(() => {
    if (digits.length < 10) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      const res = await fetch(`/api/staff/guests?q=${digits}`, { signal: ctl.signal }).catch(
        () => null,
      );
      if (!res?.ok) return;
      const data = (await res.json()) as { guests: GuestHit[] };
      const hit = data.guests[0] ?? null;
      setKnown(hit);
      if (hit && !name.trim()) setName(hit.name);
    }, 300);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digits]);

  const known = digits.length >= 10 ? found : null;
  const tables = useMemo(
    () => floor.tables.filter((t) => t.seats >= Math.min(party, 2)),
    [floor.tables, party],
  );

  async function submit(override?: string) {
    setBusy(true);
    setError(null);
    setAlts([]);
    const body: Record<string, unknown> = {
      customerName: name.trim(),
      partySize: party,
      childCount: children,
      tags,
      note: note.trim() || undefined,
      staffNote: staffNote.trim() || undefined,
      tableIds: table ? [table] : undefined,
      source: "PHONE",
    };
    if (phone.trim()) body.customerPhone = phone.trim();
    if (override) body.startAt = override;
    else {
      body.date = day;
      body.time = at;
    }
    const res = await apiFetch<{ id: string; code: string; tables: string[] }>(
      "/api/staff/reservations",
      "POST",
      body,
    );
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      const a = (res.body as { alternatives?: { at: string; label: string }[] } | undefined)
        ?.alternatives;
      if (a?.length) setAlts(a);
      return;
    }
    onDone(`Booked ${name.trim()} ×${party} · ${res.data.tables.join(" + ")}`, res.data.id, day);
  }

  const valid = name.trim().length >= 1 && party >= 1 && /^\d{4}-\d{2}-\d{2}$/.test(day);

  return (
    <Modal
      onClose={onClose}
      maxWidthClassName="max-w-lg"
      className="max-h-[92dvh] overflow-y-auto"
      ariaLabel="New booking"
    >
      <ModalHeader title="New booking" onClose={onClose} />
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !busy) void submit();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-gray-11">WhatsApp number</span>
            <input
              className={fieldCls}
              inputMode="tel"
              autoComplete="off"
              placeholder="0300 1234567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-gray-11">Name</span>
            <input
              className={fieldCls}
              required
              autoComplete="off"
              placeholder="Guest's name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </div>
        {known && (
          <div className="flex items-start gap-2 rounded-xl bg-success-2 p-2.5 text-sm text-gray-12 ring-1 ring-success-6">
            {known.vip && <Star className="mt-0.5 size-4 shrink-0 text-tangerine-10" />}
            <p>
              <strong>Returning guest: {known.name}</strong> · {known.visits ?? 0} visit
              {(known.visits ?? 0) === 1 ? "" : "s"}
              {known.noShows ? ` · ${known.noShows} no-show${known.noShows > 1 ? "s" : ""}` : ""}
              {known.allergies && (
                <span className="block font-semibold text-danger-11">
                  Allergy: {known.allergies}
                </span>
              )}
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-4">
          <div>
            <span className="mb-1 block text-xs font-bold text-gray-11">Guests</span>
            <Stepper
              value={party}
              onChange={(n) => {
                setParty(n);
                setChildren((c) => Math.min(c, n));
              }}
            />
          </div>
          <div>
            <span className="mb-1 block text-xs font-bold text-gray-11">of them children</span>
            <Stepper value={children} onChange={setChildren} min={0} max={party} label="children" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-gray-11">Date</span>
            <input
              type="date"
              className={fieldCls}
              value={day}
              onChange={(e) => setDay(e.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-gray-11">Time</span>
            <select className={fieldCls} value={at} onChange={(e) => setAt(e.target.value)}>
              {timeOptions().map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-bold text-gray-11">Table</span>
          <select className={fieldCls} value={table} onChange={(e) => setTable(e.target.value)}>
            <option value="">Best free table (recommended)</option>
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.seats} seats · {t.area}
              </option>
            ))}
          </select>
        </label>

        <div>
          <span className="mb-1 block text-xs font-bold text-gray-11">Occasion and needs</span>
          <TagPicker options={BOOKING_TAGS} value={tags} onChange={setTags} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-gray-11">Guest&apos;s request</span>
            <input
              className={fieldCls}
              maxLength={300}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. near the window"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-gray-11">
              Staff note (guest never sees)
            </span>
            <input
              className={fieldCls}
              maxLength={500}
              value={staffNote}
              onChange={(e) => setStaffNote(e.target.value)}
              placeholder="e.g. owner's friend"
            />
          </label>
        </div>

        {error && (
          <div role="alert" className="rounded-xl bg-danger-3 p-3 text-sm text-danger-12">
            <p>{error}</p>
            {alts.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="self-center text-xs font-semibold">These times work:</span>
                {alts.map((a) => (
                  <button
                    key={a.at}
                    type="button"
                    onClick={() => {
                      setAt(a.label);
                      void submit(a.at);
                    }}
                    className="min-h-9 rounded-lg bg-panel px-3 text-xs font-bold text-gray-12 ring-1 ring-gray-6"
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button type="button" onClick={onClose} className={cn(btn.quiet, "flex-1")}>
            Cancel
          </button>
          <button type="submit" disabled={!valid || busy} className={cn(btn.primary, "flex-[2]")}>
            {busy ? "Booking…" : "Confirm booking"}
          </button>
        </div>
        {!phone.trim() && (
          <p className="text-xs text-gray-11">
            Without a number the guest gets no WhatsApp confirmation or reminder, and their visits
            aren&apos;t remembered.
          </p>
        )}
      </form>
    </Modal>
  );
}
