import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { StaffRole } from "@prisma/client";
import { prisma } from "./db";

/**
 * Staff sign-in: email and password, then a signed, http-only cookie holding
 * the staff id and an expiry. No session table: the signature is the proof,
 * and every request re-reads the staff row, so a deactivated account is out
 * at once.
 */
export const SESSION_COOKIE = "mz_session";
const SESSION_DAYS = 14;

export const ADMIN_ROLES: StaffRole[] = ["OWNER", "MANAGER"];

function secret() {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must be set (32+ characters) in production.");
  }
  return "local-development-secret-not-for-production-use";
}

function sign(value: string) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export function createSessionToken(staffId: string, now = Date.now()) {
  const value = `${staffId}.${now + SESSION_DAYS * 86_400_000}`;
  return `${value}.${sign(value)}`;
}

export function readSessionToken(token: string | undefined, now = Date.now()): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [staffId, exp, mac] = parts;
  const expected = Buffer.from(sign(`${staffId}.${exp}`));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (!(Number(exp) > now)) return null;
  return staffId;
}

/** Secure whenever the site is reached over HTTPS (directly or behind the host's proxy). */
export function sessionCookieOptions(req: Request) {
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: proto === "https",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  };
}

export type StaffSession = NonNullable<Awaited<ReturnType<typeof getStaffSession>>>;

/** The signed-in staff member and their restaurant, or null. */
export async function getStaffSession() {
  const jar = await cookies();
  const staffId = readSessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!staffId) return null;
  const staff = await prisma.staffUser.findUnique({
    where: { id: staffId },
    include: { restaurant: true },
  });
  if (!staff || !staff.active) return null;
  const { restaurant, passwordHash: _hash, ...user } = staff;
  void _hash;
  return { user, restaurant };
}

/**
 * For server components. Layouts do not re-run on every client navigation,
 * so each protected page checks for itself instead of trusting its layout.
 */
export async function requireStaffPage(opts: { admin?: boolean } = {}) {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  if (opts.admin && !ADMIN_ROLES.includes(session.user.role)) redirect("/floor");
  return session;
}
