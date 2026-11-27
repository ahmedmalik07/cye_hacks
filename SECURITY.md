# Security

How Mezbaan is protected, what is deliberately public, and what is not
claimed. Written honestly: nothing here is "unhackable", and nothing that
ships to a browser can be kept secret.

## Reporting a problem

Open a private security advisory on this GitHub repository, or contact the
maintainers directly. Please don't file public issues for vulnerabilities.

## What the code enforces

| Area | Protection |
|---|---|
| Sign-in | bcrypt password hashes; signed (HMAC-SHA256), http-only, SameSite=Lax cookie, `Secure` over HTTPS; constant-time comparisons; unknown emails cost the same time as wrong passwords; limited per address and per account |
| Sessions | The staff row is re-read on every request, so deactivating an account ends its access at once. `AUTH_SECRET` (32+ chars) is mandatory in production; the app refuses to sign cookies without it |
| Authorisation | Every staff and admin API route calls `requireStaff(roles)`; every row lookup is scoped by the caller's `restaurantId`, so one restaurant can never read or change another's data. Admin pages re-check the role themselves (layouts don't re-run on client navigation) |
| Cross-site requests | `src/proxy.ts` refuses writes whose `Origin` names another host, on top of SameSite=Lax |
| Browser hardening | Per-request CSP with a script nonce (no inline script without it), `frame-ancestors 'none'`, `object-src 'none'`, HSTS, nosniff, same-origin referrer policy, COOP, no `X-Powered-By`, no browser source maps |
| Input | Every request body is validated with zod, with length and range limits |
| SQL | Prisma everywhere; the few raw queries are tagged templates (parameterised), never string-built |
| Abuse limits | Postgres-backed rate limits on login, booking, waiting list, availability, manage links, camera feed; limits survive restarts and span instances |
| Guest links | Booking and waiting-list links carry a 32-character random token; lookups are rate limited and scoped to the restaurant slug |
| Machine access | `/api/cron/tick` needs `CRON_SECRET` in production; the camera endpoint needs a per-restaurant key, stored only as a SHA-256 hash and shown once; both answer 404 or 401 without leaking which part was wrong |
| Double booking | A Postgres exclusion constraint, not application code, so it holds under concurrency and against bugs |
| Privacy | Phone numbers cleared from old bookings, inactive guest profiles removed, "forget this guest" on request, CCTV sends counts only |
| Dependencies | `npm audit` is part of CI and fails on high severity; Dependabot is enabled; the lockfile is committed and CI uses `npm ci` |

Covered by tests: `src/lib/auth.test.ts` and the "security" and race tests in
`tests/e2e/host.spec.ts`.

## Secrets

Nothing secret is committed; `.env` is git-ignored and `.env.example` lists
names only. If a secret is ever committed, deleting it from the files does
not revoke it: rotate it at the provider immediately, then clean history.
Secrets used: `DATABASE_URL`, `AUTH_SECRET`, `CRON_SECRET`, and optionally
`WHATSAPP_TOKEN`. Only `NEXT_PUBLIC_APP_URL` (a public address) is exposed to
the browser.

## What is public on purpose

This repository is public for the hackathon, so the source is open by design.
The protection that matters sits in the running service, not in secrecy of
the code: authentication, tenant scoping, rate limits, the database
constraint and server-side secrets. The turn-time estimates and allocation
run on the server; the browser only receives their results.

## Known limits

- Rate limiting trusts the last `X-Forwarded-For` entry, correct behind
  Render/Vercel/Fly style proxies; on a different topology, review `clientIp`.
- The demo sign-in buttons (and the shared demo password) are shown unless
  `SHOW_DEMO_LOGIN=0`. Turn them off, and re-seed or delete the demo staff,
  on any real deployment.
- The CSP allows inline styles (React inline style attributes draw the room).
  Scripts are strict.
- No two-factor sign-in, password reset or audit-log viewer yet.
- Obfuscating JavaScript that ships to browsers slows reading it but does not
  make it secret, and is not a security control.
