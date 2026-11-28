"use client";

import useSWR from "swr";
import { BellRing, Check, ChefHat, Receipt, X } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { formatMoney } from "@/lib/format";
import { useLiveRevision } from "@/lib/useLiveRevision";

type Board = {
  currency: string;
  orders: {
    id: string;
    status: "NEW" | "PREPARING";
    totalCents: number;
    note: string | null;
    createdAt: string;
    table: { name: string };
    items: { name: string; qty: number }[];
  }[];
  requests: { id: string; type: "BILL" | "WAITER"; createdAt: string; table: { name: string } }[];
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return m < 1 ? "just now" : `${m} min ago`;
}

export default function OrdersBoard() {
  const { data, mutate } = useSWR<Board>("/api/staff/orders", fetcher, { refreshInterval: 15_000 });
  useLiveRevision(() => void mutate());

  async function setStatus(id: string, status: string) {
    await apiFetch(`/api/staff/orders/${id}`, "PATCH", { status });
    void mutate();
  }
  async function done(id: string) {
    await apiFetch(`/api/staff/requests/${id}`, "DELETE");
    void mutate();
  }

  if (!data) return <main className="flex-1 p-6 text-gray-11">Loading…</main>;
  const empty = data.orders.length === 0 && data.requests.length === 0;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 p-4">
      {empty && (
        <p className="rounded-2xl bg-panel p-8 text-center text-gray-11 ring-1 ring-gray-5">
          Nothing waiting. New orders from the table QR codes appear here by themselves.
        </p>
      )}
      {data.requests.length > 0 && (
        <section aria-label="Calls from tables">
          <h2 className="mb-2 font-bold">Tables asking</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {data.requests.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 rounded-2xl bg-tangerine-3 p-3 ring-1 ring-tangerine-7"
              >
                {r.type === "BILL" ? <Receipt className="size-5" /> : <BellRing className="size-5" />}
                <span className="flex-1 font-semibold">
                  {r.table.name}: {r.type === "BILL" ? "wants the bill" : "needs a waiter"}
                  <span className="block text-xs font-normal text-gray-11">{ago(r.createdAt)}</span>
                </span>
                <button
                  onClick={() => done(r.id)}
                  className="min-h-10 rounded-xl bg-brand-9 px-3 text-sm font-bold text-white"
                >
                  Done
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.orders.length > 0 && (
        <section aria-label="Orders">
          <h2 className="mb-2 font-bold">Orders</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {data.orders.map((o) => (
              <li key={o.id} className="rounded-2xl bg-panel p-4 ring-1 ring-gray-5">
                <div className="flex items-baseline justify-between">
                  <p className="text-lg font-black">{o.table.name}</p>
                  <p className="text-xs text-gray-11">
                    {ago(o.createdAt)} · {formatMoney(o.totalCents, data.currency)}
                  </p>
                </div>
                <ul className="mt-2 space-y-0.5 text-sm">
                  {o.items.map((i, k) => (
                    <li key={k}>
                      <b>{i.qty}×</b> {i.name}
                    </li>
                  ))}
                </ul>
                {o.note && <p className="mt-2 rounded-lg bg-warning-3 p-2 text-sm">“{o.note}”</p>}
                <div className="mt-3 flex gap-2">
                  {o.status === "NEW" && (
                    <button
                      onClick={() => setStatus(o.id, "PREPARING")}
                      className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-tangerine-9 text-sm font-bold text-on-tangerine"
                    >
                      <ChefHat className="size-4" /> Start preparing
                    </button>
                  )}
                  <button
                    onClick={() => setStatus(o.id, "SERVED")}
                    className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-9 text-sm font-bold text-white"
                  >
                    <Check className="size-4" /> Served
                  </button>
                  <button
                    aria-label="Cancel order"
                    onClick={() => confirm("Cancel this order?") && setStatus(o.id, "CANCELLED")}
                    className="flex size-10 items-center justify-center rounded-xl ring-1 ring-gray-7"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
