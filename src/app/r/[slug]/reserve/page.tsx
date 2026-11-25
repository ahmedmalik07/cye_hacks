import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { bookableDates, policyFrom } from "@/lib/reservations/policy";
import BookingWizard from "@/components/reserve/BookingWizard";
import { CoastalShell, Panel, WaveHeader } from "@/components/reserve/Coastal";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const r = await prisma.restaurant.findUnique({ where: { slug }, select: { name: true } });
  return { title: r ? `Book a table · ${r.name}` : "Book a table" };
}

export default async function ReservePage({ params }: Params) {
  const { slug } = await params;
  const restaurant = await prisma.restaurant.findUnique({ where: { slug } });

  if (!restaurant) {
    return (
      <CoastalShell>
        <WaveHeader eyebrow="Mezbaan" title="Link not found" compact />
        <div className="relative z-10 mx-auto -mt-10 w-full max-w-md px-4">
          <Panel>
            <p className="text-sm text-gray-11">
              Double-check the link, or ask the restaurant for a fresh one.
            </p>
          </Panel>
        </div>
      </CoastalShell>
    );
  }

  const policy = policyFrom(restaurant);

  return (
    <BookingWizard
      restaurant={{
        name: restaurant.name,
        slug: restaurant.slug,
        logoUrl: restaurant.logoUrl,
        timeZone: policy.timeZone,
      }}
      dates={bookableDates(new Date(), policy).slice(0, 14)}
      enabled={policy.enabled}
      maxParty={policy.maxParty}
    />
  );
}
