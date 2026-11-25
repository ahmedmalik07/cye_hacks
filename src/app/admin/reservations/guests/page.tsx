import GuestBook from "@/components/admin/reservations/GuestBook";
import { requireStaffPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function GuestsPage() {
  await requireStaffPage({ admin: true });
  return <GuestBook />;
}
