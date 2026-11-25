"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/apiFetch";

const field =
  "min-h-11 w-full rounded-xl border border-gray-7 bg-field px-3 text-gray-12 placeholder:text-gray-9";

export default function LoginForm({ demo }: { demo: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(e: string, p: string) {
    setBusy(true);
    setError(null);
    const res = await apiFetch("/api/auth/login", "POST", { email: e, password: p });
    if (!res.ok) {
      setBusy(false);
      setError(res.error);
      return;
    }
    router.replace("/floor");
    router.refresh();
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(ev) => {
        ev.preventDefault();
        void signIn(email, password);
      }}
    >
      <label className="block text-sm font-semibold">
        Email
        <input
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(ev) => setEmail(ev.target.value)}
          className={`${field} mt-1`}
        />
      </label>
      <label className="block text-sm font-semibold">
        Password
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(ev) => setPassword(ev.target.value)}
          className={`${field} mt-1`}
        />
      </label>
      {error && (
        <p role="alert" className="rounded-xl bg-danger-3 p-2.5 text-sm text-danger-11">
          {error}
        </p>
      )}
      <button
        disabled={busy}
        className="min-h-11 w-full rounded-xl bg-brand-9 font-bold text-white hover:bg-brand-10 disabled:opacity-50"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
      {demo && (
        <div className="border-t border-gray-5 pt-3">
          <p className="mb-2 text-xs font-semibold tracking-wide text-gray-11 uppercase">
            Demo restaurant
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => signIn("owner@mezbaan.demo", "demo1234")}
              className="min-h-10 rounded-xl text-sm font-semibold ring-1 ring-gray-6 hover:bg-gray-3"
            >
              Owner
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => signIn("host@mezbaan.demo", "demo1234")}
              className="min-h-10 rounded-xl text-sm font-semibold ring-1 ring-gray-6 hover:bg-gray-3"
            >
              Host
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
