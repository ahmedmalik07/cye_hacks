"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { formatMoney } from "@/lib/format";

type Item = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  category: string;
  available: boolean;
};

const field =
  "min-h-10 rounded-xl border border-gray-7 bg-field px-3 text-sm text-gray-12 placeholder:text-gray-9";

/** The dishes guests see after scanning a table's QR. */
export default function MenuManager({ items, currency }: { items: Item[]; currency: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState(items[0]?.category ?? "Mains");
  const [error, setError] = useState<string | null>(null);
  const categories = [...new Set(items.map((i) => i.category))];

  async function run(p: Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    const res = await p;
    if (!res.ok) setError(res.error ?? "Something went wrong.");
    else router.refresh();
    return res.ok;
  }

  return (
    <section className="space-y-4 rounded-2xl bg-panel p-5 ring-1 ring-gray-5">
      <div>
        <h2 className="text-lg font-bold text-gray-12">Menu</h2>
        <p className="text-sm text-gray-11">
          What guests can order from the QR code on their table. Switch a dish off when it sells
          out; it stays on the menu, marked Sold out.
        </p>
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(apiFetch("/api/admin/menu", "POST", { name, price: Number(price), category }))) {
            setName("");
            setPrice("");
          }
        }}
      >
        <label className="grid gap-1 text-xs font-semibold text-gray-11">
          Dish
          <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={`${field} w-56`} />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-gray-11">
          Price ({currency})
          <input
            required
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))}
            className={`${field} w-28`}
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-gray-11">
          Category
          <input list="menu-cats" maxLength={40} value={category} onChange={(e) => setCategory(e.target.value)} className={`${field} w-36`} />
          <datalist id="menu-cats">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <button className="flex min-h-10 items-center gap-1.5 rounded-xl bg-brand-9 px-4 text-sm font-bold text-white hover:bg-brand-10">
          <Plus className="size-4" /> Add dish
        </button>
      </form>
      {error && (
        <p role="alert" className="rounded-xl bg-danger-3 p-2.5 text-sm text-danger-11">
          {error}
        </p>
      )}
      <ul className="divide-y divide-gray-5 rounded-xl ring-1 ring-gray-5">
        {items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{i.name}</span>
              <span className="block text-xs text-gray-11">
                {i.category} · {formatMoney(i.priceCents, currency)}
              </span>
            </span>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={i.available}
                onChange={(e) => run(apiFetch(`/api/admin/menu/${i.id}`, "PATCH", { available: e.target.checked }))}
              />
              Available
            </label>
            <button
              aria-label={`Remove ${i.name}`}
              onClick={() => confirm(`Remove ${i.name}?`) && run(apiFetch(`/api/admin/menu/${i.id}`, "DELETE"))}
              className="rounded-lg p-2 text-danger-11 hover:bg-danger-3"
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="p-3 text-sm text-gray-11">No dishes yet.</li>}
      </ul>
    </section>
  );
}
