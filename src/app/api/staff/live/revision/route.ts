import { NextResponse } from "next/server";
import { requireStaff, isErrorResponse } from "@/lib/staffApi";
import { currentRevision } from "@/lib/bus";

/** The floor's revision number, for screens that poll instead of streaming. */
export async function GET() {
  const session = await requireStaff();
  if (isErrorResponse(session)) return session;
  return NextResponse.json({ rev: await currentRevision(session.restaurant.id) });
}
