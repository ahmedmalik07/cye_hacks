import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { WaitlistStatus } from "@/components/reserve/Waitlist";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your place in the queue",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Params = { params: Promise<{ slug: string; token: string }> };

export default async function WaitlistStatusPage({ params }: Params) {
  const { slug, token } = await params;
  const restaurant = await prisma.restaurant.findUnique({
    where: { slug },
    select: { name: true, slug: true, logoUrl: true, timeZone: true },
  });
  if (!restaurant) notFound();
  return <WaitlistStatus restaurant={restaurant} token={token} />;
}
