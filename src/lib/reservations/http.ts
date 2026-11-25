import { NextResponse } from "next/server";
import { prisma } from "../db";
import type { Failure } from "./service";

/** A service failure as the JSON every reservation route returns. */
export function failureResponse(f: Failure) {
  return NextResponse.json(
    { error: f.error, code: f.code, ...(f.alternatives ? { alternatives: f.alternatives } : {}) },
    { status: f.status },
  );
}

export function badRequest(error = "Check the details and try again.") {
  return NextResponse.json({ error }, { status: 400 });
}

/**
 * The restaurant behind a public booking link. `trading` is false when the
 * restaurant has switched online reservations off: existing bookings stay
 * visible and cancellable, but no new ones are taken.
 */
export async function publicRestaurant(slug: string) {
  const restaurant = await prisma.restaurant.findUnique({ where: { slug } });
  if (!restaurant) return null;
  return { restaurant, trading: restaurant.reservationsEnabled };
}

export function notFound(what = "Restaurant not found.") {
  return NextResponse.json({ error: what }, { status: 404 });
}
