import { requireStaffPage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseFixtures } from "@/lib/reservations/layout";
import FloorPlanEditor from "@/components/admin/reservations/FloorPlanEditor";

export const dynamic = "force-dynamic";

export default async function FloorPlanPage() {
  const session = await requireStaffPage({ admin: true });
  const tables = await prisma.table.findMany({
    where: { restaurantId: session.restaurant.id, active: true },
    select: {
      id: true,
      name: true,
      seats: true,
      area: true,
      sortOrder: true,
      planX: true,
      planY: true,
      planW: true,
      planH: true,
      shape: true,
    },
  });
  const room = await prisma.restaurant.findUnique({
    where: { id: session.restaurant.id },
    select: { floorFixtures: true },
  });
  const byName = new Intl.Collator(undefined, { numeric: true });
  tables.sort(
    (a, b) =>
      byName.compare(a.area, b.area) || a.sortOrder - b.sortOrder || byName.compare(a.name, b.name),
  );
  return (
    <FloorPlanEditor
      fixtures={parseFixtures(room?.floorFixtures)}
      tables={tables.map((t) => ({
        id: t.id,
        name: t.name,
        seats: t.seats,
        area: t.area,
        shape: t.shape,
        plan:
          t.planX != null && t.planY != null
            ? { x: t.planX, y: t.planY, w: t.planW ?? 90, h: t.planH ?? 90 }
            : null,
      }))}
    />
  );
}
