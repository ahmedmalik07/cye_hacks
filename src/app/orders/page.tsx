import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireStaffPage } from "@/lib/auth";
import { Wordmark } from "@/components/Brand";
import OrdersBoard from "./OrdersBoard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Orders · Mezbaan" };

export default async function OrdersPage() {
  const session = await requireStaffPage();
  return (
    <div className="flex min-h-screen flex-1 flex-col bg-background">
      <header className="border-b border-gray-5 bg-panel">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Link
            href="/floor"
            aria-label="Back to the host screen"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-3 hover:bg-gray-4"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <Wordmark className="text-lg" />
          <span className="truncate text-sm text-gray-11">{session.restaurant.name} · Orders</span>
        </div>
      </header>
      <OrdersBoard />
    </div>
  );
}
