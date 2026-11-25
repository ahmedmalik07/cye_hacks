import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/security";

const schema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });

// Compared against when the email is unknown, so both paths take as long.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

export async function POST(req: Request) {
  if (!(await rateLimit(`login:${clientIp(req)}`, 30, 10 * 60_000))) {
    return NextResponse.json({ error: "Too many attempts. Wait a few minutes." }, { status: 429 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  const staff = await prisma.staffUser.findUnique({ where: { email: parsed.data.email } });
  const ok = await bcrypt.compare(parsed.data.password, staff?.passwordHash ?? DUMMY_HASH);
  if (!staff || !staff.active || !ok) {
    return NextResponse.json({ error: "That email and password don't match." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true, role: staff.role });
  res.cookies.set(SESSION_COOKIE, createSessionToken(staff.id), sessionCookieOptions(req));
  return res;
}
