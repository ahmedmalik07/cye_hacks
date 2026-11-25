"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BellRing, Clock, Minus, Plus, Users } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { CoastalShell, Panel, WaveHeader } from "./Coastal";

type Restaurant = { name: string; slug: string; logoUrl: string | null; timeZone: string };
type Quote = { ahead: number; waitMins: number | null; fits: boolean; open: boolean };

const time = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));

/** Join the waiting list from anywhere: at the door, in the car, at home. */
export function WaitlistJoin({ restaurant }: { restaurant: Restaurant }) {
  const router = useRouter();
  const [party, setParty] = useState(2);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/r/${restaurant.slug}/waitlist?party=${party}`, {
        cache: "no-store",
      });
      if (live && res.ok) setQuote(await res.json());
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [party, restaurant.slug]);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await apiFetch<{ manageToken: string }>(
      `/api/r/${restaurant.slug}/waitlist`,
      "POST",
      {
        customerName: name.trim(),
        customerPhone: phone.trim(),
        partySize: party,
      },
    );
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push(`/r/${restaurant.slug}/waitlist/${res.data.manageToken}`);
  }

  return (
    <CoastalShell>
      <WaveHeader
        eyebrow="Waiting list"
        title={restaurant.name}
        logoUrl={restaurant.logoUrl}
        compact
      >
        <p className="mt-2 max-w-[16rem] text-sm font-medium text-gray-12">
          Wait wherever you like. We&apos;ll WhatsApp you the moment your table is ready.
        </p>
      </WaveHeader>
      <form
        onSubmit={join}
        className="relative z-10 mx-auto -mt-12 w-full max-w-md space-y-4 px-4 pb-12"
      >
        <Panel title="How many of you?">
          <div className="flex items-center justify-between rounded-xl bg-brand-9 px-2 py-1.5 text-white">
            <button
              type="button"
              aria-label="One fewer"
              disabled={party <= 1}
              onClick={() => setParty(party - 1)}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 disabled:opacity-40"
            >
              <Minus className="size-4" />
            </button>
            <span className="text-lg font-bold tabular-nums">{party}</span>
            <button
              type="button"
              aria-label="One more"
              disabled={party >= 30}
              onClick={() => setParty(party + 1)}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 disabled:opacity-40"
            >
              <Plus className="size-4" />
            </button>
          </div>
          <div className="mt-3 flex items-center gap-3 rounded-xl bg-tangerine-3 p-3 text-tangerine-12">
            <Clock className="size-5 shrink-0" />
            <p className="text-sm">
              {quote == null ? (
                "Checking the floor…"
              ) : !quote.fits ? (
                "No table fits a party this size today. Please call the restaurant."
              ) : quote.waitMins === 0 ? (
                <>
                  <strong>A table is free now.</strong> Join and come straight in.
                </>
              ) : (
                <>
                  About <strong>{quote.waitMins} min</strong>
                  {quote.ahead > 0
                    ? ` · ${quote.ahead} ${quote.ahead === 1 ? "party" : "parties"} ahead`
                    : ""}
                  <span className="block text-xs opacity-80">
                    An estimate from the tables right now, not a promise.
                  </span>
                </>
              )}
            </p>
          </div>
        </Panel>
        <Panel title="Your details">
          <div className="space-y-3">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              autoComplete="name"
              className="w-full rounded-xl border border-gray-6 px-4 py-3 text-base outline-none focus:ring-2 focus:ring-tangerine-6"
            />
            <input
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              type="tel"
              inputMode="tel"
              placeholder="WhatsApp number, e.g. 0300 1234567"
              autoComplete="tel"
              className="w-full rounded-xl border border-gray-6 px-4 py-3 text-base outline-none focus:ring-2 focus:ring-tangerine-6"
            />
          </div>
        </Panel>
        {error && (
          <p role="alert" className="rounded-xl bg-danger-3 p-3 text-sm text-danger-12">
            {error}
          </p>
        )}
        <button
          disabled={busy || !quote?.open || !quote.fits}
          className="flex min-h-12 w-full items-center justify-center rounded-full bg-brand-9 font-bold text-white hover:bg-brand-10 disabled:bg-gray-6 disabled:text-gray-11"
        >
          {busy
            ? "Adding you…"
            : quote && !quote.open
              ? "Waiting list closed"
              : "Join the waiting list"}
        </button>
        <p className="text-center text-sm text-gray-11">
          Coming another day?{" "}
          <Link
            href={`/r/${restaurant.slug}/reserve`}
            className="font-semibold text-brand-11 underline"
          >
            Book a table
          </Link>
        </p>
      </form>
    </CoastalShell>
  );
}

type Status = {
  code: string;
  status: "WAITING" | "NOTIFIED" | "SEATED" | "CANCELLED" | "EXPIRED";
  customerName: string;
  partySize: number;
  joinedAt: string;
  position: number | null;
  etaAt: string | null;
  respondBy: string | null;
  tables: string[];
};

/** The waiting party's own live page. Polls every 15 seconds. */
export function WaitlistStatus({ restaurant, token }: { restaurant: Restaurant; token: string }) {
  const url = `/api/r/${restaurant.slug}/waitlist/${token}`;
  const {
    data: s,
    error: loadError,
    mutate,
  } = useSWR<Status>(
    url,
    async (u: string) => {
      const res = await fetch(u, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    { refreshInterval: 15_000 },
  );
  const missing = !!loadError;
  const [leaving, setLeaving] = useState(false);
  // A clock for the countdown, ticking with the refresh.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  async function leave() {
    setLeaving(true);
    await apiFetch(url, "DELETE");
    setLeaving(false);
    await mutate();
  }

  const tz = restaurant.timeZone;
  const mins = s?.etaAt
    ? Math.max(0, Math.round((new Date(s.etaAt).getTime() - now) / 60_000))
    : null;

  return (
    <CoastalShell>
      <WaveHeader
        eyebrow="Waiting list"
        title={restaurant.name}
        logoUrl={restaurant.logoUrl}
        compact
      />
      <div className="relative z-10 mx-auto -mt-12 w-full max-w-md space-y-4 px-4 pb-12">
        {missing ? (
          <Panel>
            <p className="font-semibold text-gray-12">We couldn&apos;t find your place.</p>
            <Link
              href={`/r/${restaurant.slug}/waitlist`}
              className="mt-2 inline-block text-sm font-semibold text-brand-11 underline"
            >
              Join the waiting list
            </Link>
          </Panel>
        ) : !s ? (
          <Panel>
            <div className="h-28 animate-pulse rounded-xl bg-gray-3" />
          </Panel>
        ) : s.status === "NOTIFIED" ? (
          <section
            className="rounded-2xl bg-tangerine-9 p-5 text-on-tangerine shadow-sm"
            aria-live="assertive"
          >
            <BellRing className="size-8" />
            <p className="mt-2 text-2xl font-black uppercase">Your table is ready</p>
            <p className="mt-1 font-semibold">
              {s.tables.length ? `${s.tables.join(" + ")} · ` : ""}Please come to the host
              {s.respondBy ? ` by ${time(s.respondBy, tz)}` : ""}.
            </p>
            <p className="mt-3 font-mono text-sm font-bold">{s.code}</p>
          </section>
        ) : s.status === "WAITING" ? (
          <Panel>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs font-bold tracking-widest text-gray-11 uppercase">
                  Your place
                </p>
                <p className="text-6xl leading-none font-black text-gray-12 tabular-nums">
                  {s.position ?? "–"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold tracking-widest text-gray-11 uppercase">
                  Estimated
                </p>
                <p className="text-2xl font-black text-tangerine-11 tabular-nums">
                  {mins == null ? "–" : mins === 0 ? "Any minute" : `${mins} min`}
                </p>
                {s.etaAt && <p className="text-xs text-gray-11">around {time(s.etaAt, tz)}</p>}
              </div>
            </div>
            <p className="mt-4 flex items-center gap-2 text-sm text-gray-11">
              <Users className="size-4" /> {s.partySize} guests · joined {time(s.joinedAt, tz)} ·{" "}
              {s.code}
            </p>
            <p className="mt-2 text-xs text-gray-11">
              Estimated from how long tables are taking right now. It updates on its own; keep this
              page open or wait for our WhatsApp.
            </p>
          </Panel>
        ) : (
          <Panel>
            <p className="font-semibold text-gray-12">
              {s.status === "SEATED"
                ? "You've been seated. Enjoy your meal!"
                : s.status === "EXPIRED"
                  ? "We couldn't hold your table any longer."
                  : "You've left the waiting list."}
            </p>
            {s.status !== "SEATED" && (
              <Link
                href={`/r/${restaurant.slug}/waitlist`}
                className="mt-3 flex min-h-11 items-center justify-center rounded-full bg-brand-9 text-sm font-bold text-white"
              >
                Join again
              </Link>
            )}
          </Panel>
        )}
        {s && (s.status === "WAITING" || s.status === "NOTIFIED") && (
          <button
            type="button"
            onClick={leave}
            disabled={leaving}
            className="min-h-11 w-full rounded-full text-sm font-semibold text-danger-11"
          >
            {leaving ? "Leaving…" : "Leave the waiting list"}
          </button>
        )}
      </div>
    </CoastalShell>
  );
}
