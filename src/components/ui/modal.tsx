"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A centred dialog over a dimmed page. Escape or a click outside closes it,
 * focus moves inside on open and returns to where it was on close.
 */
export function Modal({
  onClose,
  children,
  maxWidthClassName = "max-w-lg",
  className,
  ariaLabel,
}: {
  onClose: () => void;
  children: ReactNode;
  maxWidthClassName?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-gray-12/40 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        className={cn(
          "max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-gray-6 bg-panel p-5 shadow-xl outline-none sm:rounded-2xl",
          maxWidthClassName,
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function ModalHeader({ title, onClose }: { title: ReactNode; onClose: () => void }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <h2 className="text-lg font-semibold text-gray-12">{title}</h2>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="-mr-1 rounded-lg p-1.5 text-gray-11 hover:bg-gray-3"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}
