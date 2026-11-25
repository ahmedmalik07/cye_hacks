"use client";

import { useState } from "react";
import { Copy, ExternalLink } from "lucide-react";

/** The guest-facing booking and waiting-list links, ready to share. */
export default function CopyLinks({
  bookingPath,
  waitlistPath,
}: {
  bookingPath: string;
  waitlistPath: string;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function copy(path: string) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      setCopied(path);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Couldn't copy. Long-press the link to copy it instead.");
    }
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {[
        {
          path: bookingPath,
          title: "Booking link",
          hint: "Put it on Instagram, Google Maps and your WhatsApp status.",
        },
        { path: waitlistPath, title: "Waiting-list link", hint: "Print it as a QR at the door." },
      ].map((l) => (
        <div
          key={l.path}
          className="flex items-center gap-3 rounded-2xl bg-panel p-3 ring-1 ring-gray-5"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-gray-12">{l.title}</p>
            <p className="truncate text-xs text-gray-11">{l.hint}</p>
          </div>
          <button
            onClick={() => copy(l.path)}
            className="flex min-h-10 items-center gap-1 rounded-lg px-3 text-xs font-semibold text-gray-12 ring-1 ring-gray-6 hover:bg-gray-3"
          >
            <Copy className="size-3.5" /> {copied === l.path ? "Copied" : "Copy"}
          </button>
          <a
            href={l.path}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${l.title.toLowerCase()}`}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-12 ring-1 ring-gray-6 hover:bg-gray-3"
          >
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      ))}
      {error && (
        <p role="alert" className="text-sm text-danger-11 md:col-span-2">
          {error}
        </p>
      )}
    </div>
  );
}
