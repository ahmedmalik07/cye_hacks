import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { WaitlistJoin } from "@/components/reserve/Waitlist";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const r = await prisma.restaurant.findUnique({ where: { slug }, select: { name: true } });
  return { title: r ? `Waiting list · ${r.name}` : "Waiting list" };
}

export default async function WaitlistPage({ params }: Params) {
  const { slug } = await params;
  const restaurant = await prisma.restaurant.findUnique({
    where: { slug },
    select: { name: true, slug: true, logoUrl: true, timeZone: true },
  });
  if (!restaurant) notFound();
  return <WaitlistJoin restaurant={restaurant} />;
}
