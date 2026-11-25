"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRightLeft,
  CalendarClock,
  DoorOpen,
  MessageCircle,
  Phone,
  Star,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { cn } from "@/lib/utils";
import { BOOKING_TAGS, GUEST_TAGS } from "@/lib/reservations/tags";
import { clock } from "@/components/floor/types";
import type { Floor } from "@/components/floor/types";
import {
  Badges,
  BOOKING_STATUS,
  btn,
  dayLabel,
  fieldCls,
  hhmm,
  localDateKey,
  money,
  SOURCE_LABEL,
  Stepper,
  type BookEntry,
  type GuestCard,
} from "./shared";
import { TagPicker, timeOptions } from "./BookingForm";
import { zonedMidnight } from "./Timeline";

type Detail = { reservation: BookEntry; phone: string | null };

const fetcher = (url: string) =>
  fetch(url, { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });

/**
 * Everything about one booking, and everything you can do to it, in one
 * panel: who they are (history, allergies, notes), when and where, and the
 * next action. Edits to time, size or table go through the same allocator
 * as new bookings, so a change can never double-book.
 */
export function ReservationPanel({
  id,
  floor,
  isAdmin,
  now,
  revision,
  onClose,
  onChanged,
  onSeat,
  onChangeTable,
}: {
  id: string;
  floor: Floor;
  isAdmin: boolean;
  now: number;
  revision: number;
  onClose: () => void;
  onChanged: (msg?: string) => Promise<void> | void;
  onSeat: (b: BookEntry) => void;
  onChangeTable: (b: BookEntry) => void;
}) {
  const { data, error, mutate } = useSWR<Detail>(`/api/staff/reservations/${id}`, fetcher);
  useEffect(() => {
    void mutate();
  }, [revision, mutate]);
  const tz = floor.restaurant.timeZone;
  const r = data?.reservation;

  return (
    <aside
      aria-label="Booking"
      className="fixed inset-0 z-40 flex flex-col bg-panel shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[26rem] sm:border-l sm:border-gray-5"
    >
      <header className="flex items-start gap-2 border-b border-gray-5 p-4">
        <div className="min-w-0 flex-1">
          {r ? (
            <>
              <p className="truncate text-lg font-black text-gray-12">
                {r.customerName} <span className="text-gray-11">×{r.partySize}</span>
              </p>
              <p className="text-xs text-gray-11">
                {dayLabel(localDateKey(r.startAt, tz), floor.today)} · {clock(r.startAt, tz)} ·{" "}
                {r.tables.map((t) => t.name).join(" + ") || "no table"} · {SOURCE_LABEL[r.source]} ·{" "}
                {r.code}
              </p>
              <span
                className={cn(
                  "mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-bold",
                  BOOKING_STATUS[r.status].pill,
                )}
              >
                {BOOKING_STATUS[r.status].label}
                {r.arrivedAt && r.status === "CONFIRMED" ? " · arrived" : ""}
              </span>
            </>
          ) : (
            <p className="text-lg font-black text-gray-12">
              {error ? "Couldn't load" : "Loading…"}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Close booking"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-3 text-gray-12 hover:bg-gray-4"
        >
          <X className="size-5" />
        </button>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {r && (
          <Body
            key={`${r.id}:${r.startAt}:${r.partySize}:${r.status}`}
            r={r}
            phone={data!.phone}
            floor={floor}
            isAdmin={isAdmin}
            now={now}
            reload={async (msg) => {
              await mutate();
              await onChanged(msg);
            }}
            onSeat={() => onSeat(r)}
            onChangeTable={() => onChangeTable(r)}
            onClose={onClose}
          />
        )}
      </div>
    </aside>
  );
}

function Body({
  r,
  phone,
  floor,
  isAdmin,
  now,
  reload,
  onSeat,
  onChangeTable,
  onClose,
}: {
  r: BookEntry;
  phone: string | null;
  floor: Floor;
  isAdmin: boolean;
  now: number;
  reload: (msg?: string) => Promise<void>;
  onSeat: () => void;
  onChangeTable: () => void;
  onClose: () => void;
}) {
  const tz = floor.restaurant.timeZone;
  const dateKey = localDateKey(r.startAt, tz);
  const isToday = dateKey === floor.today;
  const confirmed = r.status === "CONFIRMED";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alts, setAlts] = useState<{ at: string; label: string }[]>([]);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Editable copy
  const [name, setName] = useState(r.customerName);
  const [phoneInput, setPhoneInput] = useState("");
  const [party, setParty] = useState(r.partySize);
  const [children, setChildren] = useState(r.childCount);
  const [day, setDay] = useState(dateKey);
  const [time, setTime] = useState(hhmm(r.startAt, tz));
  const [tags, setTags] = useState(r.tags);
  const [note, setNote] = useState(r.note ?? "");
  const [staffNote, setStaffNote] = useState(r.staffNote ?? "");

  const moved = day !== dateKey || time !== hhmm(r.startAt, tz) || party !== r.partySize;
  const detailsChanged =
    name.trim() !== r.customerName ||
    phoneInput.trim() !== "" ||
    children !== r.childCount ||
    tags.join("|") !== r.tags.join("|") ||
    note.trim() !== (r.note ?? "") ||
    staffNote.trim() !== (r.staffNote ?? "");
  const dirty = (confirmed && moved) || detailsChanged;

  async function patch(body: Record<string, unknown>) {
    const res = await apiFetch(`/api/staff/reservations/${r.id}`, "PATCH", body);
    if (!res.ok) {
      setError(res.error);
      const a = (res.body as { alternatives?: { at: string; label: string }[] } | undefined)
        ?.alternatives;
      setAlts(a ?? []);
    }
    return res.ok;
  }

  async function save(startOverride?: string) {
    setBusy(true);
    setError(null);
    setAlts([]);
    if (confirmed && (moved || startOverride)) {
      const startAt = startOverride ?? toInstant(day, time);
      if (
        !startAt ||
        !(await patch({ action: "move", startAt, partySize: party, keepTables: true }))
      ) {
        setBusy(false);
        return;
      }
    }
    if (detailsChanged) {
      const ok = await patch({
        action: "details",
        customerName: name.trim() || r.customerName,
        ...(phoneInput.trim() ? { customerPhone: phoneInput.trim() } : {}),
        childCount: Math.min(children, party),
        tags,
        note: note.trim() || null,
        staffNote: staffNote.trim() || null,
      });
      if (!ok) {
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    setPhoneInput("");
    await reload("Booking updated");
  }

  function toInstant(d: string, t: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      setError("Pick a valid date.");
      return null;
    }
    const [h, m] = t.split(":").map(Number);
    return new Date(zonedMidnight(d, tz) + (h * 60 + m) * 60_000).toISOString();
  }

  async function act(body: Record<string, unknown>, msg: string, close = false) {
    setBusy(true);
    setError(null);
    const ok = await patch(body);
    setBusy(false);
    if (ok) {
      await reload(msg);
      if (close) onClose();
    }
  }

  const lateBy = Math.round((now - new Date(r.startAt).getTime()) / 60_000);

  return (
    <>
      {/* Next action */}
      {confirmed && isToday && (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onSeat}
            disabled={busy}
            className={cn(btn.primary, "col-span-2 min-h-12 text-base")}
          >
            Seat {r.tables.length ? `at ${r.tables.map((t) => t.name).join(" + ")}` : "now"}
          </button>
          <button
            onClick={() =>
              act(
                { action: "arrived", arrived: !r.arrivedAt },
                r.arrivedAt ? "Arrival undone" : "Checked in",
              )
            }
            disabled={busy}
            className={cn(btn.quiet, r.arrivedAt && "bg-success-3 ring-success-7")}
          >
            <DoorOpen className="size-4" /> {r.arrivedAt ? "Arrived ✓" : "Arrived, wait"}
          </button>
          <button onClick={onChangeTable} disabled={busy} className={btn.quiet}>
            <ArrowRightLeft className="size-4" /> Other table
          </button>
        </div>
      )}
      {confirmed && !isToday && (
        <button onClick={onChangeTable} disabled={busy} className={cn(btn.quiet, "w-full")}>
          <ArrowRightLeft className="size-4" /> Change table
        </button>
      )}

      {phone && (
        <div className="grid grid-cols-2 gap-2">
          <a href={`tel:${phone}`} className={btn.quiet}>
            <Phone className="size-4" /> Call
          </a>
          <a
            href={`https://wa.me/${phone.replace(/\D/g, "")}`}
            target="_blank"
            rel="noreferrer noopener"
            className={cn(btn.quiet, "text-success-11")}
          >
            <MessageCircle className="size-4" /> WhatsApp
          </a>
        </div>
      )}

      <GuestBox
        guest={r.guest}
        dateKey={dateKey}
        isAdmin={isAdmin}
        currency={floor.restaurant.currency}
        onSaved={reload}
      />

      {r.note && (
        <p className="rounded-xl bg-tangerine-2 p-3 text-sm text-gray-12 ring-1 ring-tangerine-6">
          <span className="block text-xs font-bold text-tangerine-11">Guest asked</span>“{r.note}”
        </p>
      )}

      {/* The booking */}
      <section className="space-y-3 rounded-2xl bg-gray-2 p-3 ring-1 ring-gray-5">
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-gray-12">
          <CalendarClock className="size-4" /> Booking
        </h3>
        {confirmed ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold text-gray-11">Date</span>
                <input
                  type="date"
                  className={fieldCls}
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold text-gray-11">Time</span>
                <select className={fieldCls} value={time} onChange={(e) => setTime(e.target.value)}>
                  {timeOptions().map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <span className="mb-1 block text-[11px] font-bold text-gray-11">Guests</span>
                <Stepper value={party} onChange={setParty} />
              </div>
              <div>
                <span className="mb-1 block text-[11px] font-bold text-gray-11">Children</span>
                <Stepper
                  value={children}
                  onChange={setChildren}
                  min={0}
                  max={party}
                  label="children"
                />
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-gray-12">
            {r.seatedAt ? `Seated ${clock(r.seatedAt, tz)}` : `${clock(r.startAt, tz)}`} ·{" "}
            {r.tables.map((t) => t.name).join(" + ") || "no table"}
            {r.childCount ? ` · ${r.childCount} children` : ""}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-gray-11">Name</span>
            <input
              className={fieldCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-gray-11">
              {r.hasPhone ? `Number (${r.phone})` : "Add a number"}
            </span>
            <input
              className={fieldCls}
              inputMode="tel"
              placeholder={r.hasPhone ? "Replace…" : "0300 1234567"}
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
            />
          </label>
        </div>
        <div>
          <span className="mb-1 block text-[11px] font-bold text-gray-11">Occasion and needs</span>
          <TagPicker options={BOOKING_TAGS} value={tags} onChange={setTags} />
        </div>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-gray-11">
            Guest&apos;s request
          </span>
          <input
            className={fieldCls}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-gray-11">
            Staff note (guest never sees)
          </span>
          <textarea
            className={cn(fieldCls, "min-h-16 py-2")}
            value={staffNote}
            onChange={(e) => setStaffNote(e.target.value)}
            maxLength={500}
          />
        </label>
        {error && (
          <div role="alert" className="rounded-xl bg-danger-3 p-3 text-sm text-danger-12">
            <p>{error}</p>
            {alts.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="self-center text-xs font-semibold">Open instead:</span>
                {alts.map((a) => (
                  <button
                    key={a.at}
                    onClick={() => void save(a.at)}
                    className="min-h-9 rounded-lg bg-panel px-3 text-xs font-bold text-gray-12 ring-1 ring-gray-6"
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {dirty && (
          <button onClick={() => void save()} disabled={busy} className={cn(btn.primary, "w-full")}>
            {busy ? "Saving…" : moved && confirmed ? "Save and re-check tables" : "Save changes"}
          </button>
        )}
      </section>

      {confirmed && (
        <div className="grid grid-cols-2 gap-2">
          {lateBy > 0 && isToday && (
            <button
              onClick={() => act({ action: "no_show" }, "Marked as no-show", true)}
              disabled={busy}
              className={btn.quiet}
            >
              No-show
            </button>
          )}
          {confirmCancel ? (
            <button
              onClick={() => act({ action: "cancel" }, "Booking cancelled", true)}
              disabled={busy}
              className={cn(btn.danger, "bg-danger-3", lateBy > 0 && isToday ? "" : "col-span-2")}
            >
              <AlertTriangle className="size-4" /> Yes, cancel it
            </button>
          ) : (
            <button
              onClick={() => setConfirmCancel(true)}
              disabled={busy}
              className={cn(btn.danger, lateBy > 0 && isToday ? "" : "col-span-2")}
            >
              Cancel booking
            </button>
          )}
        </div>
      )}
    </>
  );
}

function GuestBox({
  guest,
  dateKey,
  isAdmin,
  currency,
  onSaved,
}: {
  guest: GuestCard | null;
  dateKey: string;
  isAdmin: boolean;
  currency: string;
  onSaved: (msg?: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [vip, setVip] = useState(guest?.vip ?? false);
  const [tags, setTags] = useState(guest?.tags ?? []);
  const [allergies, setAllergies] = useState(guest?.allergies ?? "");
  const [notes, setNotes] = useState(guest?.notes ?? "");
  const [birthday, setBirthday] = useState(guest?.birthday ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!guest) {
    return (
      <p className="rounded-xl bg-gray-2 p-3 text-sm text-gray-11 ring-1 ring-gray-5">
        No guest profile: add their WhatsApp number below and Mezbaan will remember their visits,
        allergies and notes.
      </p>
    );
  }

  async function save() {
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/api/staff/guests/${guest!.id}`, "PATCH", {
      vip,
      tags: tags.filter((t) => t !== "VIP"),
      allergies: allergies.trim() || null,
      notes: notes.trim() || null,
      birthday: birthday.trim() || "",
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setEditing(false);
    await onSaved("Guest profile saved");
  }

  const last = guest.lastVisitAt
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(
        new Date(guest.lastVisitAt),
      )
    : "never";

  return (
    <section className="space-y-2 rounded-2xl bg-panel p-3 ring-1 ring-gray-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-gray-12">
          {guest.vip && <Star className="size-4 text-tangerine-10" />} Guest
        </h3>
        <div className="flex gap-2">
          {isAdmin && (
            <Link
              href={`/admin/reservations/guests/${guest.id}`}
              className="text-xs font-semibold text-brand-11 underline"
            >
              Full profile
            </Link>
          )}
          <button
            onClick={() => setEditing(!editing)}
            className="text-xs font-semibold text-brand-11 underline"
          >
            {editing ? "Close" : "Edit"}
          </button>
        </div>
      </div>
      <Badges guest={guest} dateKey={dateKey} max={8} />
      <div className="grid grid-cols-4 gap-1.5 text-center">
        {[
          ["Visits", guest.visits],
          ["No-shows", guest.noShows],
          ["Last", last],
          ["Spent", guest.spendCents ? money(guest.spendCents, currency) : "–"],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-lg bg-gray-3 px-1 py-1.5">
            <p className="truncate text-xs font-black text-gray-12 tabular-nums">{value}</p>
            <p className="text-[10px] text-gray-11">{label}</p>
          </div>
        ))}
      </div>
      {guest.allergies && !editing && (
        <p className="flex items-start gap-1.5 rounded-lg bg-danger-3 p-2 text-sm font-semibold text-danger-12">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {guest.allergies}
        </p>
      )}
      {guest.notes && !editing && <p className="text-sm text-gray-12">{guest.notes}</p>}
      {editing && (
        <div className="space-y-2">
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-gray-12">
            <input
              type="checkbox"
              checked={vip}
              onChange={(e) => setVip(e.target.checked)}
              className="size-5"
            />
            VIP
          </label>
          <TagPicker
            options={GUEST_TAGS.filter((t) => t !== "VIP")}
            value={tags}
            onChange={setTags}
          />
          <input
            className={fieldCls}
            placeholder="Allergies (e.g. peanuts)"
            value={allergies}
            onChange={(e) => setAllergies(e.target.value)}
            maxLength={300}
          />
          <input
            className={fieldCls}
            placeholder="Birthday MM-DD (e.g. 03-14)"
            value={birthday}
            onChange={(e) => setBirthday(e.target.value)}
            maxLength={5}
          />
          <textarea
            className={cn(fieldCls, "min-h-16 py-2")}
            placeholder="Notes for every visit"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={1000}
          />
          {error && (
            <p role="alert" className="text-sm text-danger-11">
              {error}
            </p>
          )}
          <button onClick={() => void save()} disabled={busy} className={cn(btn.primary, "w-full")}>
            Save profile
          </button>
        </div>
      )}
    </section>
  );
}
