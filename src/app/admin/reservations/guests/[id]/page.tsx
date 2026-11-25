import { getStaffSession, ADMIN_ROLES } from "@/lib/auth";
import GuestProfile from "@/components/admin/reservations/GuestProfile";

export const dynamic = "force-dynamic";

export default async function GuestPage({ params }: { params: Promise<{ id: string }> }) {
  const session = (await getStaffSession())!;
  const { id } = await params;
  return (
    <GuestProfile
      id={id}
      currency={session.restaurant.currency}
      timeZone={session.restaurant.timeZone}
      canForget={ADMIN_ROLES.includes(session.user.role)}
    />
  );
}
