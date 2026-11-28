import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { tableByCode } from "@/lib/ordering";
import OrderClient from "./OrderClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Order at your table", robots: { index: false } };

/** The page behind the QR code on a table. No account, no app. */
export default async function TablePage({ params }: { params: Promise<{ code: string }> }) {
  const table = await tableByCode((await params).code);
  if (!table) notFound();
  return <OrderClient code={(await params).code} />;
}
