"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, KeyRound, MessageCircle } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { cn } from "@/lib/utils";

type Policy = {
  reservationsEnabled: boolean;
  bookingOpensAt: string;
  bookingClosesAt: string;
  bookingSlotMins: number;
  bookingLeadMins: number;
  bookingMaxDaysAhead: number;
  bookingMaxParty: number;
  onlineTablesPct: number;
  defaultDiningMins: number;
  cleaningMins: number;
  graceMins: number;
  autoReleaseNoShows: boolean;
  reminderMinsBefore: number;
  holdMinsBefore: number;
  waitlistEnabled: boolean;
  waitlistAutoNotify: boolean;
  waitlistReplyMins: number;
  cctvAutoVacate: boolean;
};

type TableRow = {
  id: string;
  name: string;
  seats: number;
  minParty: number;
  area: string;
  joinGroup: string | null;
  reservable: boolean;
  sortOrder: number;
};

const field =
  "w-full rounded-lg border border-gray-6 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tangerine-6";

export default function ReservationSettings({
  policy: initialPolicy,
  tables: initialTables,
  isOwner,
  hasEdgeKey,
  whatsappApi,
}: {
  policy: Policy;
  tables: TableRow[];
  isOwner: boolean;
  hasEdgeKey: boolean;
  whatsappApi: boolean;
}) {
  const router = useRouter();
  const [p, setP] = useState(initialPolicy);
  const [tables, setTables] = useState(initialTables);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [edgeKey, setEdgeKey] = useState<{ key: string; restaurantId: string } | null>(null);

  const set = <K extends keyof Policy>(k: K, v: Policy[K]) => setP((prev) => ({ ...prev, [k]: v }));
  const num = (k: keyof Policy) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(k, Number(e.target.value) as never);
  const areas = [...new Set(tables.map((t) => t.area))];
  const reservable = tables.filter((t) => t.reservable).length;
  const onlineCap = reservable
    ? Math.max(1, Math.floor((reservable * p.onlineTablesPct) / 100))
    : 0;

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await apiFetch("/api/admin/reservations/settings", "PATCH", { policy: p, tables });
    setBusy(false);
    setMsg(
      res.ok
        ? { ok: true, text: "Saved. New bookings use these rules straight away." }
        : { ok: false, text: res.error },
    );
    if (res.ok) router.refresh();
  }

  async function rotateKey() {
    const res = await apiFetch<{ key: string; restaurantId: string }>(
      "/api/admin/reservations/edge-key",
      "POST",
    );
    if (res.ok) setEdgeKey(res.data);
    else setMsg({ ok: false, text: res.error });
  }

  const updateTable = (id: string, patch: Partial<TableRow>) =>
    setTables((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  return (
    <div className="space-y-5 pb-24">
      <Card title="Online booking" hint="What guests can book from your link.">
        <Toggle
          label="Take bookings online"
          checked={p.reservationsEnabled}
          onChange={(v) => set("reservationsEnabled", v)}
        />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="First seating">
            <input
              type="time"
              value={p.bookingOpensAt}
              onChange={(e) => set("bookingOpensAt", e.target.value)}
              className={field}
            />
          </Field>
          <Field label="Last seating" hint="Earlier than first = past midnight">
            <input
              type="time"
              value={p.bookingClosesAt}
              onChange={(e) => set("bookingClosesAt", e.target.value)}
              className={field}
            />
          </Field>
          <Field label="Time slots">
            <select
              value={p.bookingSlotMins}
              onChange={(e) => set("bookingSlotMins", Number(e.target.value))}
              className={field}
            >
              {[15, 30, 60].map((m) => (
                <option key={m} value={m}>
                  Every {m} min
                </option>
              ))}
            </select>
          </Field>
          <Field label="Book at least" hint="minutes ahead">
            <input
              type="number"
              min={0}
              max={1440}
              value={p.bookingLeadMins}
              onChange={num("bookingLeadMins")}
              className={field}
            />
          </Field>
          <Field label="Book up to" hint="days ahead">
            <input
              type="number"
              min={1}
              max={90}
              value={p.bookingMaxDaysAhead}
              onChange={num("bookingMaxDaysAhead")}
              className={field}
            />
          </Field>
          <Field label="Largest online party">
            <input
              type="number"
              min={1}
              max={60}
              value={p.bookingMaxParty}
              onChange={num("bookingMaxParty")}
              className={field}
            />
          </Field>
          <Field
            label="Online share of tables"
            hint={`At most ${onlineCap} of ${reservable} bookable tables at once`}
          >
            <input
              type="number"
              min={0}
              max={100}
              step={5}
              value={p.onlineTablesPct}
              onChange={num("onlineTablesPct")}
              className={field}
            />
          </Field>
        </div>
      </Card>

      <Card
        title="Timing & no-shows"
        hint="Used to plan every booking and to release tables nobody comes for."
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Planning meal length" hint="min, until Mezbaan learns yours">
            <input
              type="number"
              min={30}
              max={300}
              step={5}
              value={p.defaultDiningMins}
              onChange={num("defaultDiningMins")}
              className={field}
            />
          </Field>
          <Field label="Cleaning between parties" hint="minutes">
            <input
              type="number"
              min={0}
              max={60}
              value={p.cleaningMins}
              onChange={num("cleaningMins")}
              className={field}
            />
          </Field>
          <Field label="Show as Reserved" hint="minutes before arrival">
            <input
              type="number"
              min={0}
              max={180}
              step={5}
              value={p.holdMinsBefore}
              onChange={num("holdMinsBefore")}
              className={field}
            />
          </Field>
          <Field label="Grace period" hint="minutes held past booking time">
            <input
              type="number"
              min={0}
              max={60}
              value={p.graceMins}
              onChange={num("graceMins")}
              className={field}
            />
          </Field>
          <Field label="WhatsApp reminder" hint="minutes before (0 = off)">
            <input
              type="number"
              min={0}
              max={1440}
              step={15}
              value={p.reminderMinsBefore}
              onChange={num("reminderMinsBefore")}
              className={field}
            />
          </Field>
        </div>
        <Toggle
          label={`Release no-shows automatically after ${p.graceMins} minutes`}
          hint="Off: late bookings are flagged on the floor and staff decide."
          checked={p.autoReleaseNoShows}
          onChange={(v) => set("autoReleaseNoShows", v)}
        />
      </Card>

      <Card title="Waiting list">
        <Toggle
          label="Guests can join the waiting list online"
          checked={p.waitlistEnabled}
          onChange={(v) => set("waitlistEnabled", v)}
        />
        <Toggle
          label="Offer freed tables to the next family automatically"
          hint="When a table is cleaned or a booking released, the first waiting party that fits gets a WhatsApp."
          checked={p.waitlistAutoNotify}
          onChange={(v) => set("waitlistAutoNotify", v)}
        />
        <div className="max-w-xs">
          <Field label="They have this long to arrive" hint="minutes, then it goes to the next">
            <input
              type="number"
              min={3}
              max={60}
              value={p.waitlistReplyMins}
              onChange={num("waitlistReplyMins")}
              className={field}
            />
          </Field>
        </div>
      </Card>

      <Card
        title="Tables"
        hint="Seats, area and which tables push together. Walk-in-only tables are never offered online."
      >
        <datalist id="areas">
          {[...new Set([...areas, "Main hall", "Family hall", "Rooftop", "Outdoor"])].map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-11">
                <th className="py-2 pr-2">Table</th>
                <th className="py-2 pr-2">Area</th>
                <th className="py-2 pr-2">Seats</th>
                <th className="py-2 pr-2">Min. party</th>
                <th className="py-2 pr-2">Joins with</th>
                <th className="py-2 pr-2">Order</th>
                <th className="py-2">Online</th>
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => (
                <tr key={t.id} className="border-t border-gray-4">
                  <td className="py-2 pr-2 font-semibold text-gray-12">{t.name}</td>
                  <td className="py-2 pr-2">
                    <input
                      list="areas"
                      value={t.area}
                      onChange={(e) => updateTable(t.id, { area: e.target.value })}
                      className={field}
                      aria-label={`${t.name} area`}
                    />
                  </td>
                  <td className="w-20 py-2 pr-2">
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={t.seats}
                      onChange={(e) => updateTable(t.id, { seats: Number(e.target.value) })}
                      className={field}
                      aria-label={`${t.name} seats`}
                    />
                  </td>
                  <td className="w-20 py-2 pr-2">
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={t.minParty}
                      onChange={(e) => updateTable(t.id, { minParty: Number(e.target.value) })}
                      className={field}
                      aria-label={`${t.name} minimum party`}
                    />
                  </td>
                  <td className="w-28 py-2 pr-2">
                    <input
                      value={t.joinGroup ?? ""}
                      placeholder="e.g. A"
                      onChange={(e) => updateTable(t.id, { joinGroup: e.target.value || null })}
                      className={field}
                      aria-label={`${t.name} join group`}
                    />
                  </td>
                  <td className="w-20 py-2 pr-2">
                    <input
                      type="number"
                      min={0}
                      max={999}
                      value={t.sortOrder}
                      onChange={(e) => updateTable(t.id, { sortOrder: Number(e.target.value) })}
                      className={field}
                      aria-label={`${t.name} order`}
                    />
                  </td>
                  <td className="py-2">
                    <input
                      type="checkbox"
                      checked={t.reservable}
                      onChange={(e) => updateTable(t.id, { reservable: e.target.checked })}
                      aria-label={`${t.name} bookable online`}
                      className="h-5 w-5 accent-brand-9"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-11">
          Tables with the same &ldquo;joins with&rdquo; letter can be pushed together for a big
          family; the system joins up to three when no single table fits. Add or rename tables under
          Tables.
        </p>
      </Card>

      <Card title="WhatsApp">
        <p className="flex items-start gap-2 text-sm text-gray-12">
          <MessageCircle className="mt-0.5 size-4 shrink-0 text-success-11" />
          {whatsappApi
            ? "Connected: confirmations, reminders and table-ready messages go out automatically from your WhatsApp Business number."
            : 'Manual mode: each message waits on the floor board with an "Open WhatsApp" button that sends it from your own phone. Free, and nothing to set up. Ask dish.ly to connect the WhatsApp Business API to send automatically.'}
        </p>
      </Card>

      <Card title="CCTV table occupancy" hint="Optional. Everything works without cameras.">
        <p className="flex items-start gap-2 text-sm text-gray-12">
          <Camera className="mt-0.5 size-4 shrink-0 text-info-11" />
          An on-site edge box watches your floor cameras and reports only &ldquo;table 4:
          empty&rdquo; or &ldquo;occupied, 3 people&rdquo;. Video never leaves the restaurant.
          Readings appear as suggestions on the floor board.
        </p>
        <Toggle
          label="Let the camera close a paid table by itself"
          hint="Only after the bill is asked for or paid and the table has looked empty for 3 minutes. Staff still confirm cleaning."
          checked={p.cctvAutoVacate}
          onChange={(v) => set("cctvAutoVacate", v)}
        />
        {isOwner && (
          <div className="rounded-xl bg-gray-2 p-3 ring-1 ring-gray-5">
            <div className="flex flex-wrap items-center gap-3">
              <KeyRound className="size-4 text-gray-11" />
              <p className="flex-1 text-sm text-gray-12">
                Edge box key: {hasEdgeKey || edgeKey ? "issued" : "none yet"}
              </p>
              <button
                onClick={rotateKey}
                className="min-h-9 rounded-lg px-3 text-xs font-semibold text-gray-12 ring-1 ring-gray-6 hover:bg-gray-3"
              >
                {hasEdgeKey || edgeKey ? "Issue a new key" : "Issue key"}
              </button>
            </div>
            {edgeKey && (
              <div className="mt-3 space-y-2 text-xs">
                <p className="font-semibold text-tangerine-11">
                  Copy it now. It won&apos;t be shown again; issuing a new one stops the old.
                </p>
                <pre className="overflow-x-auto rounded-lg bg-gray-12 p-3 text-gray-1">{`POST ${typeof window === "undefined" ? "" : window.location.origin}/api/edge/occupancy
Authorization: Bearer ${edgeKey.key}
X-Restaurant-Id: ${edgeKey.restaurantId}
{"readings":[{"table":"<table name or id>","occupied":false,"people":0,"confidence":0.92}]}`}</pre>
              </div>
            )}
          </div>
        )}
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-5 bg-panel/95 backdrop-blur md:left-60">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          {msg && (
            <p
              role={msg.ok ? "status" : "alert"}
              className={cn("flex-1 text-sm", msg.ok ? "text-success-11" : "text-danger-11")}
            >
              {msg.text}
            </p>
          )}
          <button
            onClick={save}
            disabled={busy}
            className="ml-auto min-h-11 rounded-xl bg-brand-9 px-6 text-sm font-bold text-white hover:bg-brand-10 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-2xl bg-panel p-4 ring-1 ring-gray-5">
      <div>
        <h2 className="text-base font-bold text-gray-12">{title}</h2>
        {hint && <p className="text-sm text-gray-11">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-gray-12">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-gray-11">{hint}</span>}
    </label>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 accent-brand-9"
      />
      <span>
        <span className="block text-sm font-semibold text-gray-12">{label}</span>
        {hint && <span className="block text-xs text-gray-11">{hint}</span>}
      </span>
    </label>
  );
}
