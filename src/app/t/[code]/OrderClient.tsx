"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { BellRing, Minus, Plus, Receipt, ShoppingBag } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

type Data = {
  restaurant: { name: string; currency: string };
  table: { name: string };
  menu: { id: string; name: string; description: string | null; priceCents: number; category: string; available: boolean }[];
  orders: { id: string; status: string; totalCents: number; items: { name: string; qty: number }[] }[];
  totalCents: number;
  billRequested: boolean;
  waiterCalled: boolean;
};

const STATUS: Record<string, string> = {
  NEW: "Sent to the kitchen",
  PREPARING: "Being prepared",
  SERVED: "Served",
};

const fetcher = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(r)));

export default function OrderClient({ code }: { code: string }) {
  const { data, mutate, error } = useSWR<Data>(`/api/t/${code}`, fetcher, { refreshInterval: 6000 });
  const [cart, setCart] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 5000);
    return () => clearTimeout(t);
  }, [msg]);

  const money = useCallback(
    (c: number) => formatMoney(c, data?.restaurant.currency ?? "PKR"),
    [data?.restaurant.currency],
  );
  const categories = useMemo(() => {
    const m = new Map<string, Data["menu"]>();
    for (const i of data?.menu ?? []) m.set(i.category, [...(m.get(i.category) ?? []), i]);
    return [...m.entries()];
  }, [data?.menu]);
  const lines = Object.entries(cart).filter(([, q]) => q > 0);
  const cartCents = lines.reduce(
    (n, [id, q]) => n + (data?.menu.find((i) => i.id === id)?.priceCents ?? 0) * q,
    0,
  );
  const cartCount = lines.reduce((n, [, q]) => n + q, 0);

  function change(id: string, d: number) {
    setCart((c) => ({ ...c, [id]: Math.max(0, Math.min(20, (c[id] ?? 0) + d)) }));
  }

  async function place() {
    setBusy(true);
    const res = await apiFetch(`/api/t/${code}/orders`, "POST", {
      items: lines.map(([id, qty]) => ({ id, qty })),
      note: note || undefined,
    });
    setBusy(false);
    if (!res.ok) return setMsg({ kind: "err", text: res.error });
    setCart({});
    setNote("");
    setMsg({ kind: "ok", text: "Order sent to the kitchen." });
    void mutate();
  }

  async function service(type: "BILL" | "WAITER") {
    setBusy(true);
    const res = await apiFetch(`/api/t/${code}/service`, "POST", { type });
    setBusy(false);
    if (!res.ok) return setMsg({ kind: "err", text: res.error });
    setMsg({ kind: "ok", text: type === "BILL" ? "The bill is on its way." : "A waiter is coming." });
    void mutate();
  }

  if (error) {
    return (
      <main className="flex flex-1 items-center justify-center p-6 text-center">
        <p className="text-gray-11">This table code isn&apos;t working. Please ask a waiter.</p>
      </main>
    );
  }
  if (!data) return <main className="flex-1 p-6 text-gray-11">Loading the menu…</main>;

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 pt-5 pb-40">
      <p className="text-xs font-bold tracking-[0.18em] text-tangerine-11 uppercase">
        Table {data.table.name}
      </p>
      <h1 className="text-2xl font-black tracking-tight uppercase">{data.restaurant.name}</h1>

      {msg && (
        <p
          role="status"
          className={cn(
            "mt-3 rounded-xl p-3 text-sm font-semibold",
            msg.kind === "ok" ? "bg-success-3 text-success-11" : "bg-danger-3 text-danger-11",
          )}
        >
          {msg.text}
        </p>
      )}

      {data.orders.length > 0 && (
        <section aria-label="Your orders" className="mt-4 rounded-2xl bg-panel p-4 ring-1 ring-gray-5">
          <h2 className="mb-2 font-bold">Your table so far</h2>
          <ul className="space-y-2 text-sm">
            {data.orders.map((o) => (
              <li key={o.id} className="flex justify-between gap-3">
                <span>{o.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}</span>
                <span className="shrink-0 font-semibold text-brand-11">{STATUS[o.status] ?? o.status}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 flex justify-between border-t border-gray-5 pt-2 font-bold">
            <span>Total</span>
            <span>{money(data.totalCents)}</span>
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              disabled={busy || data.billRequested}
              onClick={() => service("BILL")}
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-tangerine-9 px-3 text-sm font-bold text-on-tangerine hover:bg-tangerine-10 disabled:opacity-60"
            >
              <Receipt className="size-4" /> {data.billRequested ? "Bill requested" : "Ask for the bill"}
            </button>
            <button
              disabled={busy || data.waiterCalled}
              onClick={() => service("WAITER")}
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold ring-1 ring-gray-7 hover:bg-gray-3 disabled:opacity-60"
            >
              <BellRing className="size-4" /> {data.waiterCalled ? "Waiter called" : "Call a waiter"}
            </button>
          </div>
        </section>
      )}

      {categories.map(([cat, items]) => (
        <section key={cat} className="mt-6">
          <h2 className="mb-2 text-sm font-bold tracking-wide text-gray-11 uppercase">{cat}</h2>
          <ul className="space-y-2">
            {items.map((i) => {
              const q = cart[i.id] ?? 0;
              return (
                <li
                  key={i.id}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl bg-panel p-3 ring-1 ring-gray-5",
                    !i.available && "opacity-55",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{i.name}</p>
                    {i.description && <p className="text-sm text-gray-11">{i.description}</p>}
                    <p className="text-sm font-bold text-brand-11">
                      {i.available ? money(i.priceCents) : "Sold out"}
                    </p>
                  </div>
                  {i.available && (
                    <div className="flex items-center gap-1">
                      {q > 0 && (
                        <>
                          <button
                            aria-label={`One less ${i.name}`}
                            onClick={() => change(i.id, -1)}
                            className="flex size-10 items-center justify-center rounded-full ring-1 ring-gray-7"
                          >
                            <Minus className="size-4" />
                          </button>
                          <span className="w-6 text-center font-bold">{q}</span>
                        </>
                      )}
                      <button
                        aria-label={`Add ${i.name}`}
                        onClick={() => change(i.id, 1)}
                        className="flex size-10 items-center justify-center rounded-full bg-brand-9 text-white"
                      >
                        <Plus className="size-4" />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {cartCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-gray-5 bg-panel p-3 shadow-lg">
          <div className="mx-auto max-w-xl space-y-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              placeholder="Anything we should know? (no onions, less spicy…)"
              aria-label="Note for the kitchen"
              className="min-h-10 w-full rounded-xl border border-gray-7 bg-field px-3 text-sm"
            />
            <button
              disabled={busy}
              onClick={place}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-9 font-bold text-white hover:bg-brand-10 disabled:opacity-60"
            >
              <ShoppingBag className="size-5" /> Place order · {cartCount} item{cartCount > 1 ? "s" : ""} ·{" "}
              {money(cartCents)}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
