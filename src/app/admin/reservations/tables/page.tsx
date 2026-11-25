import { getStaffSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import TableList from "@/components/admin/reservations/TableList";

export const dynamic = "force-dynamic";

export default async function TablesPage() {
  const session = (await getStaffSession())!;
  const tables = await prisma.table.findMany({
    where: { restaurantId: session.restaurant.id, active: true },
    select: { id: true, name: true, seats: true, area: true, sortOrder: true },
  });
  const byName = new Intl.Collator(undefined, { numeric: true });
  tables.sort((a, b) => byName.compare(a.area, b.area) || byName.compare(a.name, b.name));
  const areas = [...new Set(tables.map((t) => t.area))];
  return <TableList tables={tables} areas={areas.length ? areas : ["Main hall"]} />;
}
