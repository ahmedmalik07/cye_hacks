"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin/reservations", label: "Overview" },
  { href: "/admin/reservations/guests", label: "Guests" },
  { href: "/admin/reservations/tables", label: "Tables" },
  { href: "/admin/reservations/menu", label: "Menu" },
  { href: "/admin/reservations/qr", label: "QR codes" },
  { href: "/admin/reservations/floor-plan", label: "Floor plan" },
  { href: "/admin/reservations/insights", label: "Insights" },
  { href: "/admin/reservations/settings", label: "Hours & rules" },
];

export default function ReservationTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Reservations"
      className="flex max-w-full gap-1 overflow-x-auto rounded-full bg-panel p-1 ring-1 ring-gray-5 sm:inline-flex"
    >
      {TABS.map((t) => {
        const active =
          t.href === "/admin/reservations" ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-10 flex-1 items-center justify-center rounded-full px-4 text-sm font-semibold whitespace-nowrap transition",
              active ? "bg-brand-9 text-white" : "text-gray-11 hover:text-gray-12",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
