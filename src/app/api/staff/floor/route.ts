import { NextResponse } from "next/server";
import { requireStaff, isErrorResponse } from "@/lib/staffApi";
import { getFloor } from "@/lib/reservations/floor";

export const dynamic = "force-dynamic";

/** The live floor: every table's status and estimate, arrivals, the queue. */
export async function GET() {
  const session = await requireStaff();
  if (isErrorResponse(session)) return session;
  return NextResponse.json(await getFloor(session.restaurant.id));
}
