import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs before every page and API call:
 *
 * 1. Cross-site request check. A browser always sends `Origin` on a
 *    cross-site write; if it names a different host than the one being
 *    called, the write is refused. This backs up the SameSite=Lax cookie.
 *    Non-browser clients (the CCTV edge box, the cron caller) send no
 *    `Origin` and authenticate with their own bearer secret.
 * 2. A per-request Content-Security-Policy with a script nonce, so an
 *    injected inline script cannot run.
 */
const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function proxy(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const origin = request.headers.get("origin");
  if (UNSAFE.has(request.method) && origin && origin !== "null") {
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {}
    if (originHost !== host) {
      return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
    }
  } else if (UNSAFE.has(request.method) && origin === "null") {
    return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV !== "production";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // React sets inline style attributes for the drawn room; scripts stay strict.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
