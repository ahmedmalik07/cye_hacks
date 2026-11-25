"use client";

import { useState } from "react";
import Link from "next/link";
import useSWRInfinite from "swr/infinite";
import { Search, Star, UserPlus } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { cn } from "@/lib/utils";
import { Modal, ModalHeader } from "@/components/ui/modal";

type Row = {
  id: string;
  name: string;
  phone: string | null;
  vip: boolean;
  tags: string[];
  allergies: string | null;
  lastSeenAt: string;
  visits?: number;
  noShows?: number;
  spendCents?: number;
  lastVisitAt?: string | null;
};
type Page = { guests: Row[]; next: string | null };

const FILTERS = [
  { key: "", label: "Everyone" },
  { key: "vip", label: "VIP" },
  { key: "allergy", label: "Allergies" },
  { key: "noshow", label: "Had a no-show" },
  { key: "lapsed", label: "Not seen in 60 days" },
] as const;

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json());
const field =
  "min-h-11 w-full rounded-xl bg-panel px-3 text-sm text-gray-12 ring-1 ring-gray-6 outline-none focus:ring-2 focus:ring-brand-8";

/**
 * Everyone who has booked or queued, and what the team knows about them.
 * Search by name or the last digits of a number.
 */
export default function GuestBook() {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const key = (i: number, prev: Page | null) => {
    if (prev && !prev.next) return null;
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (filter) params.set("filter", filter);
    if (prev?.next) params.set("cursor", prev.next);
    return `/api/staff/guests?${params}`;
  };
  const { data, size, setSize, isLoading, mutate } = useSWRInfinite<Page>(key, fetcher);
  const rows = data?.flatMap((p) => p.guests) ?? [];
  const more = data?.at(-1)?.next;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-gray-11" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or phone"
            aria-label="Search guests"
            className={cn(field, "pl-9")}
          />
        </div>
        <button
          onClick={() => setAdding(true)}
          className="flex min-h-11 items-center gap-2 rounded-xl bg-brand-9 px-4 text-sm font-bold text-white hover:bg-brand-10"
        >
          <UserPlus className="size-4" /> Add guest
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={cn(
              "min-h-9 rounded-full px-3 text-xs font-semibold",
              filter === f.key
                ? "bg-brand-9 text-white"
                : "bg-panel text-gray-11 ring-1 ring-gray-5",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl bg-panel ring-1 ring-gray-5">
        {isLoading && rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-11">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-11">
            {q || filter
              ? "No guest matches."
              : "No guests yet. Everyone who books or joins the waiting list with a WhatsApp number appears here."}
          </p>
        ) : (
          <ul className="divide-y divide-gray-4">
            {rows.map((g) => (
              <li key={g.id}>
                <Link
                  href={`/admin/reservations/guests/${g.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-gray-2"
                >
                  <span className="flex min-w-48 flex-1 items-center gap-2">
                    {g.vip && (
                      <Star className="size-4 shrink-0 text-tangerine-10" aria-label="VIP" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-gray-12">
                        {g.name}
                      </span>
                      <span className="block text-xs text-gray-11">{g.phone ?? "no number"}</span>
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {g.allergies && (
                      <span className="rounded-full bg-danger-3 px-2 py-0.5 text-[11px] font-bold text-danger-11">
                        Allergy
                      </span>
                    )}
                    {g.tags.slice(0, 3).map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-gray-4 px-2 py-0.5 text-[11px] font-bold text-gray-12"
                      >
                        {t}
                      </span>
                    ))}
                  </span>
                  <span className="w-20 text-right text-xs text-gray-11 tabular-nums">
                    <strong className="text-gray-12">{g.visits ?? 0}</strong> visits
                  </span>
                  <span className="w-24 text-right text-xs tabular-nums">
                    {g.noShows ? (
                      <span className="font-semibold text-tangerine-11">{g.noShows} no-show</span>
                    ) : (
                      <span className="text-gray-11">no no-shows</span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {more && (
        <button
          onClick={() => setSize(size + 1)}
          className="min-h-11 w-full rounded-xl text-sm font-semibold text-gray-12 ring-1 ring-gray-6 hover:bg-gray-3"
        >
          Show more
        </button>
      )}
      {adding && (
        <AddGuest
          onClose={() => setAdding(false)}
          onDone={async () => {
            setAdding(false);
            await mutate();
          }}
        />
      )}
    </div>
  );
}

function AddGuest({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [vip, setVip] = useState(false);
  const [allergies, setAllergies] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    const res = await apiFetch("/api/staff/guests", "POST", {
      name,
      phone,
      vip,
      allergies: allergies || undefined,
      notes: notes || undefined,
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onDone();
  }
  return (
    <Modal onClose={onClose} maxWidthClassName="max-w-md" ariaLabel="Add guest">
      <ModalHeader title="Add a guest" onClose={onClose} />
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input
          className={field}
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          className={field}
          placeholder="WhatsApp number"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
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
        <input
          className={field}
          placeholder="Allergies"
          value={allergies}
          onChange={(e) => setAllergies(e.target.value)}
        />
        <textarea
          className={cn(field, "min-h-20 py-2")}
          placeholder="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        {error && (
          <p role="alert" className="text-sm text-danger-11">
            {error}
          </p>
        )}
        <button
          disabled={busy}
          className="min-h-11 w-full rounded-xl bg-brand-9 text-sm font-bold text-white disabled:opacity-50"
        >
          Save guest
        </button>
      </form>
    </Modal>
  );
}
