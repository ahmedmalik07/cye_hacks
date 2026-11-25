import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import ManageBooking from "@/components/reserve/ManageBooking";

export const dynamic = "force-dynamic";

// The manage link is a key: keep it out of search engines and referrers.
export const metadata: Metadata = {
  title: "Your booking",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Params = { params: Promise<{ slug: string; token: string }> };

export default async function BookingPage({ params }: Params) {
  const { slug, token } = await params;
  const restaurant = await prisma.restaurant.findUnique({
    where: { slug },
    select: { name: true, slug: true, logoUrl: true, timeZone: true },
  });
  if (!restaurant) notFound();
  return <ManageBooking restaurant={restaurant} token={token} />;
}
