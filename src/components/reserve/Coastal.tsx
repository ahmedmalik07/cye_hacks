import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared pieces of the guest booking pages, all in the Navy / Sand /
 * Tangerine palette (globals.css).
 */

export function CoastalShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main className={cn("flex min-h-dvh flex-1 flex-col bg-background", className)}>
      {children}
    </main>
  );
}

/**
 * Sand sky, a tangerine sun setting into navy waves: the restaurant's name
 * set big and heavy over it. Pure SVG, no image request, no motion.
 */
export function WaveHeader({
  eyebrow,
  title,
  logoUrl,
  compact = false,
  art,
  children,
}: {
  eyebrow?: string;
  title: string;
  logoUrl?: string | null;
  compact?: boolean;
  /** Decorative layer to the right of the title (e.g. the 3D table). */
  art?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="relative overflow-hidden bg-sand text-gray-12 dark:bg-gray-3">
      <svg
        aria-hidden="true"
        viewBox="0 0 400 160"
        preserveAspectRatio="xMidYMax slice"
        className={cn("absolute inset-x-0 bottom-0 w-full", compact ? "h-16" : "h-28")}
      >
        <circle cx="300" cy="104" r="44" className="fill-tangerine-9" />
        <path
          d="M0 104 C 50 88, 90 120, 140 104 S 230 88, 280 104 S 360 120, 400 100 L400 160 L0 160Z"
          className="fill-brand-9 dark:fill-brand-5"
        />
        <path
          d="M0 128 C 60 114, 100 142, 160 126 S 260 112, 310 128 S 370 140, 400 124 L400 160 L0 160Z"
          className="fill-brand-10 opacity-90 dark:fill-brand-4"
        />
        <path
          d="M30 118 h18 M200 116 h26 M120 140 h14 M330 138 h22"
          className="stroke-white/40"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      {art}
      <div
        className={cn(
          "relative mx-auto flex w-full max-w-md flex-col px-5",
          compact ? "pt-5 pb-20" : "pt-8 pb-32",
        )}
      >
        <div className="flex items-center gap-2">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-8 w-8 rounded-lg object-cover" />
          ) : (
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-tangerine-9" />
          )}
          {eyebrow && (
            <p className="text-xs font-bold tracking-[0.18em] text-gray-12 uppercase">{eyebrow}</p>
          )}
        </div>
        <h1
          className={cn(
            "mt-3 leading-[0.9] font-black tracking-tight text-balance text-gray-12 uppercase",
            compact ? "text-3xl" : "text-5xl",
          )}
        >
          {title}
        </h1>
        {children}
      </div>
    </header>
  );
}

/** "Booking 1/3" header with a segmented progress bar, as in the booking flow. */
export function StepHeader({
  step,
  total,
  title,
  subtitle,
  onClose,
}: {
  step: number;
  total: number;
  title: string;
  subtitle: string;
  onClose?: () => void;
}) {
  return (
    <div className="bg-panel px-5 pt-4 pb-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-bold text-gray-12">
            {title} {step}/{total}
          </p>
          <p className="text-sm text-gray-11">{subtitle}</p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close booking"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-3 text-gray-12 hover:bg-gray-4"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      <div className="mt-3 flex gap-1.5" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              i < step ? "bg-brand-9" : "bg-gray-5",
            )}
          />
        ))}
      </div>
    </div>
  );
}

/** Rounded white card used for each block of a step. */
export function Panel({
  title,
  children,
  className,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl bg-panel p-4 shadow-sm ring-1 ring-gray-5", className)}>
      {title && <h2 className="mb-3 text-sm font-bold text-gray-12">{title}</h2>}
      {children}
    </section>
  );
}
