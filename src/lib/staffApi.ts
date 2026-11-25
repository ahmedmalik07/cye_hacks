import { NextResponse } from "next/server";
import type { StaffRole } from "@prisma/client";
import { getStaffSession, type StaffSession } from "./auth";

export function isErrorResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse;
}

/** The staff session for an API route, or the 401/403 to return instead. */
export async function requireStaff(roles?: StaffRole[]): Promise<StaffSession | NextResponse> {
  const session = await getStaffSession();
  if (!session) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (roles && !roles.includes(session.user.role)) {
    return NextResponse.json({ error: "Your role can't do that." }, { status: 403 });
  }
  return session;
}

/**
 * Find one row the caller must scope by restaurant, or a 404. Pass the model
 * delegate and a where clause that includes the restaurant id.
 */
export async function scopedFindOrNotFound<T>(
  model: { findFirst: (args: never) => Promise<T | null> },
  args: unknown,
  message = "Not found.",
): Promise<T | NextResponse> {
  const row = await model.findFirst(args as never);
  return row ?? NextResponse.json({ error: message }, { status: 404 });
}
