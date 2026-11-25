import { cn } from "@/lib/utils";

/** Mezbaan's mark: a table seen from above, with the host's tangerine seat. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("h-8 w-8", className)}>
      <rect width="32" height="32" rx="8" fill="var(--brand-9)" />
      <circle cx="16" cy="16" r="6.5" fill="var(--sand)" />
      <circle cx="16" cy="5.5" r="2.6" fill="var(--tangerine-9)" />
      <circle cx="16" cy="26.5" r="2.6" fill="var(--sand)" />
      <circle cx="5.5" cy="16" r="2.6" fill="var(--sand)" />
      <circle cx="26.5" cy="16" r="2.6" fill="var(--sand)" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <LogoMark className="h-7 w-7" />
      <span>
        Mez<span className="text-brand-11">baan</span>
      </span>
    </span>
  );
}
