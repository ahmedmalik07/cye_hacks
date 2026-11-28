import { requireStaffPage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import MenuManager from "@/components/admin/reservations/MenuManager";

export const dynamic = "force-dynamic";

export default async function MenuPage() {
  const session = await requireStaffPage({ admin: true });
  const items = await prisma.menuItem.findMany({
    where: { restaurantId: session.restaurant.id },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
    select: { id: true, name: true, description: true, priceCents: true, category: true, available: true },
  });
  return <MenuManager items={items} currency={session.restaurant.currency} />;
}
