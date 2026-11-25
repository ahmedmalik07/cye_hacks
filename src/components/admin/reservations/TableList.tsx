"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";

type Row = { id: string; name: string; seats: number; area: string };

const field =
  "min-h-10 rounded-xl border border-gray-7 bg-field px-3 text-sm text-gray-12 placeholder:text-gray-9";

/** Add, rename and retire tables. Seats and seating rules live under Hours & rules. */
export default function TableList({ tables, areas }: { tables: Row[]; areas: string[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [seats, setSeats] = useState(4);
  const [area, setArea] = useState(areas[0] ?? "Main hall");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(p: Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const res = await p;
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Something went wrong.");
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <section className="space-y-4 rounded-2xl bg-panel p-5 ring-1 ring-gray-5">
      <div>
        <h2 className="text-lg font-bold text-gray-12">Tables</h2>
        <p className="text-sm text-gray-11">
          Add every table in the room. Seats, smallest party, joining and online booking are set
          under Hours &amp; rules; where each one stands, under Floor plan.
        </p>
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(apiFetch("/api/admin/tables", "POST", { name, seats, area }))) setName("");
        }}
      >
        <label className="grid gap-1 text-xs font-semibold text-gray-11">
          Name
          <input
            required
            maxLength={20}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="T-08"
            className={`${field} w-28`}
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-gray-11">
          Seats
          <input
            type="number"
            min={1}
            max={30}
            value={seats}
            onChange={(e) => setSeats(Number(e.target.value))}
            className={`${field} w-20`}
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-gray-11">
          Area
          <input
            list="table-areas"
            maxLength={40}
            value={area}
            onChange={(e) => setArea(e.target.value)}
            className={`${field} w-40`}
          />
          <datalist id="table-areas">
            {areas.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </label>
        <button
          disabled={busy}
          className="flex min-h-10 items-center gap-1.5 rounded-xl bg-brand-9 px-4 text-sm font-bold text-white hover:bg-brand-10 disabled:opacity-50"
        >
          <Plus className="size-4" /> Add table
        </button>
      </form>
      {error && (
        <p role="alert" className="rounded-xl bg-danger-3 p-2.5 text-sm text-danger-11">
          {error}
        </p>
      )}
      <ul className="divide-y divide-gray-5 rounded-xl ring-1 ring-gray-5">
        {tables.map((t) => (
          <li key={t.id} className="flex items-center gap-3 px-3 py-2">
            <input
              defaultValue={t.name}
              maxLength={20}
              aria-label={`Rename ${t.name}`}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== t.name) void run(apiFetch(`/api/admin/tables/${t.id}`, "PATCH", { name: v }));
              }}
              className={`${field} w-28 font-semibold`}
            />
            <span className="flex-1 text-sm text-gray-11">
              {t.seats} seats · {t.area}
            </span>
            <button
              type="button"
              disabled={busy}
              aria-label={`Remove ${t.name}`}
              onClick={() => {
                if (confirm(`Remove ${t.name}?`)) void run(apiFetch(`/api/admin/tables/${t.id}`, "DELETE"));
              }}
              className="rounded-lg p-2 text-danger-11 hover:bg-danger-3 disabled:opacity-50"
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
        {tables.length === 0 && <li className="p-3 text-sm text-gray-11">No tables yet.</li>}
      </ul>
    </section>
  );
}
