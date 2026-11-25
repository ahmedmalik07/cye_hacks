"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { AlertTriangle, ArrowLeft, MessageCircle, Phone, Star } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { cn } from "@/lib/utils";
import { GUEST_TAGS } from "@/lib/reservations/tags";

type Guest = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  vip: boolean;
  tags: string[];
  allergies: string | null;
  notes: string | null;
  birthday: string | null;
  marketingOptIn: boolean;
  createdAt: string;
  lastSeenAt: string;
  visits?: number;
  noShows?: number;
  cancellations?: number;
  upcoming?: number;
  spendCents?: number;
  lastVisitAt?: string | null;
};
type Visit = {
  id: string;
  code: string | null;
  startAt: string;
  partySize: number;
  status: string;
  source: string;
  tags: string[];
  note: string | null;
  staffNote: string | null;
  tables: string[];
  spendCents: number;
};

const fetcher = (url: string) =>
  fetch(url, { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });
const field =
  "min-h-11 w-full rounded-xl bg-panel px-3 text-sm text-gray-12 ring-1 ring-gray-6 outline-none focus:ring-2 focus:ring-brand-8";
const STATUS: Record<string, string> = {
  CONFIRMED: "bg-brand-3 text-brand-11",
  SEATED: "bg-tangerine-3 text-tangerine-12",
  COMPLETED: "bg-gray-4 text-gray-11",
  NO_SHOW: "bg-danger-3 text-danger-11",
  CANCELLED: "bg-gray-3 text-gray-11",
};

/** One guest: who they are, what to remember, and every visit. */
export default function GuestProfile({
  id,
  currency,
  timeZone,
  canForget,
}: {
  id: string;
  currency: string;
  timeZone: string;
  canForget: boolean;
}) {
  const router = useRouter();
  const { data, error, mutate } = useSWR<{ guest: Guest; history: Visit[] }>(
    `/api/staff/guests/${id}`,
    fetcher,
  );
  const money = (c: number) =>
    new Intl.NumberFormat("en-PK", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(c / 100);
  const when = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));

  if (error) return <p className="text-sm text-danger-11">This guest couldn&apos;t be loaded.</p>;
  if (!data) return <div className="h-40 animate-pulse rounded-2xl bg-gray-3" />;
  const g = data.guest;

  return (
    <div className="space-y-4">
      <Link
        href="/admin/reservations/guests"
        className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-gray-11 hover:text-gray-12"
      >
        <ArrowLeft className="size-4" /> All guests
      </Link>
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-4">
          <section className="space-y-3 rounded-2xl bg-panel p-4 ring-1 ring-gray-5">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-black text-gray-12">
                {g.vip && <Star className="size-5 text-tangerine-10" />} {g.name}
              </h2>
              <p className="text-sm text-gray-11">
                {g.phone ?? "no number"} · guest since{" "}
                {new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(
                  new Date(g.createdAt),
                )}
              </p>
            </div>
            {g.phone && (
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={`tel:${g.phone}`}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-gray-12 ring-1 ring-gray-6 hover:bg-gray-3"
                >
                  <Phone className="size-4" /> Call
                </a>
                <a
                  href={`https://wa.me/${g.phone.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-success-11 ring-1 ring-gray-6 hover:bg-gray-3"
                >
                  <MessageCircle className="size-4" /> WhatsApp
                </a>
              </div>
            )}
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                ["Visits", g.visits ?? 0],
                ["No-shows", g.noShows ?? 0],
                ["Cancelled", g.cancellations ?? 0],
                ["Upcoming", g.upcoming ?? 0],
                ["Spent", g.spendCents ? money(g.spendCents) : "–"],
                [
                  "Avg / visit",
                  g.spendCents && g.visits ? money(Math.round(g.spendCents / g.visits)) : "–",
                ],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-xl bg-gray-3 py-2">
                  <p className="truncate px-1 text-sm font-black text-gray-12 tabular-nums">
                    {value}
                  </p>
                  <p className="text-[11px] text-gray-11">{label}</p>
                </div>
              ))}
            </div>
          </section>
          <EditProfile g={g} onSaved={() => mutate()} />
          {canForget && (
            <Forget
              id={g.id}
              name={g.name}
              onDone={() => router.push("/admin/reservations/guests")}
            />
          )}
        </div>

        <section className="rounded-2xl bg-panel p-4 ring-1 ring-gray-5">
          <h3 className="mb-3 text-sm font-bold text-gray-12">Visits and bookings</h3>
          {data.history.length === 0 ? (
            <p className="text-sm text-gray-11">No bookings yet.</p>
          ) : (
            <ul className="divide-y divide-gray-4">
              {data.history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-start gap-3 py-2.5">
                  <span className="w-44 shrink-0 text-sm text-gray-12">{when(h.startAt)}</span>
                  <span className="min-w-0 flex-1 text-sm text-gray-12">
                    {h.partySize} guests · {h.tables.join(" + ") || "no table"} ·{" "}
                    {h.source.toLowerCase().replace("_", "-")}
                    {h.tags.length > 0 && (
                      <span className="text-gray-11"> · {h.tags.join(", ")}</span>
                    )}
                    {h.note && (
                      <span className="block text-xs text-gray-11 italic">“{h.note}”</span>
                    )}
                    {h.staffNote && (
                      <span className="block text-xs text-gray-11">Staff: {h.staffNote}</span>
                    )}
                  </span>
                  {h.spendCents > 0 && (
                    <span className="text-sm font-semibold text-gray-12 tabular-nums">
                      {money(h.spendCents)}
                    </span>
                  )}
                  <span
                    className={cn("rounded-full px-2 py-0.5 text-xs font-bold", STATUS[h.status])}
                  >
                    {h.status.toLowerCase().replace("_", "-")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function EditProfile({ g, onSaved }: { g: Guest; onSaved: () => void }) {
  const [name, setName] = useState(g.name);
  const [vip, setVip] = useState(g.vip);
  const [tags, setTags] = useState(g.tags);
  const [allergies, setAllergies] = useState(g.allergies ?? "");
  const [notes, setNotes] = useState(g.notes ?? "");
  const [birthday, setBirthday] = useState(g.birthday ?? "");
  const [email, setEmail] = useState(g.email ?? "");
  const [optIn, setOptIn] = useState(g.marketingOptIn);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await apiFetch(`/api/staff/guests/${g.id}`, "PATCH", {
      name,
      vip,
      tags: tags.filter((t) => t !== "VIP"),
      allergies: allergies.trim() || null,
      notes: notes.trim() || null,
      birthday: birthday.trim(),
      email: email.trim(),
      marketingOptIn: optIn,
    });
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.error });
    if (res.ok) onSaved();
  }

  return (
    <section className="space-y-3 rounded-2xl bg-panel p-4 ring-1 ring-gray-5">
      <h3 className="text-sm font-bold text-gray-12">What the team should know</h3>
      <input
        className={field}
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Name"
      />
      <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-gray-12">
        <input
          type="checkbox"
          className="size-5"
          checked={vip}
          onChange={(e) => setVip(e.target.checked)}
        />{" "}
        VIP
      </label>
      <div className="flex flex-wrap gap-1.5">
        {GUEST_TAGS.filter((t) => t !== "VIP").map((t) => {
          const on = tags.includes(t);
          return (
            <button
              key={t}
              type="button"
              aria-pressed={on}
              onClick={() => setTags(on ? tags.filter((x) => x !== t) : [...tags, t])}
              className={cn(
                "min-h-9 rounded-full px-3 text-xs font-semibold ring-1",
                on ? "bg-brand-9 text-white ring-brand-9" : "bg-panel text-gray-12 ring-gray-6",
              )}
            >
              {t}
            </button>
          );
        })}
      </div>
      <label className="block">
        <span className="mb-1 flex items-center gap-1 text-xs font-bold text-danger-11">
          <AlertTriangle className="size-3.5" /> Allergies
        </span>
        <input
          className={field}
          value={allergies}
          onChange={(e) => setAllergies(e.target.value)}
          placeholder="e.g. peanuts, shellfish"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-bold text-gray-11">Notes for every visit</span>
        <textarea
          className={cn(field, "min-h-20 py-2")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. likes the corner table, always orders mutton karahi"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-gray-11">Birthday (MM-DD)</span>
          <input
            className={field}
            value={birthday}
            onChange={(e) => setBirthday(e.target.value)}
            placeholder="03-14"
            maxLength={5}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-gray-11">Email</span>
          <input
            className={field}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
      </div>
      <label className="flex min-h-11 items-start gap-2 text-sm text-gray-12">
        <input
          type="checkbox"
          className="mt-0.5 size-5"
          checked={optIn}
          onChange={(e) => setOptIn(e.target.checked)}
        />
        <span>
          Agreed to offers on WhatsApp
          <span className="block text-xs text-gray-11">Only tick this if the guest said yes.</span>
        </span>
      </label>
      {msg && (
        <p role="status" className={cn("text-sm", msg.ok ? "text-success-11" : "text-danger-11")}>
          {msg.text}
        </p>
      )}
      <button
        onClick={() => void save()}
        disabled={busy}
        className="min-h-11 w-full rounded-xl bg-brand-9 text-sm font-bold text-white hover:bg-brand-10 disabled:opacity-50"
      >
        Save
      </button>
    </section>
  );
}

function Forget({ id, name, onDone }: { id: string; name: string; onDone: () => void }) {
  const [sure, setSure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="rounded-2xl bg-panel p-4 ring-1 ring-danger-6">
      <h3 className="text-sm font-bold text-danger-11">Forget this guest</h3>
      <p className="mt-1 text-xs text-gray-11">
        If {name} asks you to delete their details: removes the profile and their number from every
        booking. Visit counts in Insights stay. This can&apos;t be undone.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger-11">
          {error}
        </p>
      )}
      <button
        onClick={async () => {
          if (!sure) return setSure(true);
          const res = await apiFetch(`/api/staff/guests/${id}`, "DELETE");
          if (!res.ok) return setError(res.error);
          onDone();
        }}
        className={cn(
          "mt-3 min-h-11 w-full rounded-xl text-sm font-bold ring-1 ring-danger-7",
          sure ? "bg-danger-9 text-white" : "text-danger-11 hover:bg-danger-2",
        )}
      >
        {sure ? `Yes, forget ${name}` : "Forget guest"}
      </button>
    </section>
  );
}
