import { getStaffSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { POLICY_SELECT, parseWeekHours } from "@/lib/reservations/policy";
import { zonedDateKey } from "@/lib/zonedTime";
import HoursAndClosures from "@/components/admin/reservations/HoursAndClosures";
import { whatsappApiConfigured } from "@/lib/reservations/messages";
import ReservationSettings from "@/components/admin/reservations/ReservationSettings";

export const dynamic = "force-dynamic";

export default async function ReservationSettingsPage() {
  const session = (await getStaffSession())!;
  const [restaurant, tables] = await Promise.all([
    prisma.restaurant.findUnique({
      where: { id: session.restaurant.id },
      select: { ...POLICY_SELECT, edgeKeyHash: true },
    }),
    prisma.table.findMany({
      where: { restaurantId: session.restaurant.id, active: true },
      select: {
        id: true,
        name: true,
        seats: true,
        minParty: true,
        area: true,
        joinGroup: true,
        reservable: true,
        sortOrder: true,
      },
    }),
  ]);
  const { edgeKeyHash, timeZone, bookingWeekHours, bookingMaxCoversPerSlot, ...policy } =
    restaurant!;
  const today = zonedDateKey(new Date(), timeZone);
  const closures = await prisma.bookingClosure.findMany({
    where: { restaurantId: session.restaurant.id, date: { gte: today } },
    orderBy: { date: "asc" },
    select: { id: true, date: true, reason: true, onlineOnly: true },
  });
  const byName = new Intl.Collator(undefined, { numeric: true });
  return (
    <div className="space-y-4">
      <HoursAndClosures
        defaults={{ opensAt: policy.bookingOpensAt, closesAt: policy.bookingClosesAt }}
        week={parseWeekHours(bookingWeekHours)}
        maxCovers={bookingMaxCoversPerSlot}
        closures={closures}
        today={today}
      />
      <ReservationSettings
        policy={policy}
        tables={tables.sort(
          (a, b) =>
            byName.compare(a.area, b.area) ||
            a.sortOrder - b.sortOrder ||
            byName.compare(a.name, b.name),
        )}
        isOwner={session.user.role === "OWNER"}
        hasEdgeKey={!!edgeKeyHash}
        whatsappApi={whatsappApiConfigured()}
      />
    </div>
  );
}
