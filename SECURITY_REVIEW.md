# Security review (cye_hacks / Mezbaan)

Scope: this repository, on branch `security-hardening`, reviewed 25 Nov 2026.
Nothing was pushed, deployed or published. Every change is a normal git
commit and can be reverted with `git revert`.

## Security map

- **Stack:** Next.js 16 (App Router), React 19, Prisma 6 on Postgres, Tailwind.
- **Public surface:** landing page; guest pages `/r/{slug}/reserve`, `/booking/{token}`,
  `/waitlist`; their `/api/r/{slug}/...` routes (no sign-in, rate limited).
- **Staff surface:** `/floor`, `/admin/*`, `/api/staff/*`, `/api/admin/*` (signed cookie, roles).
- **Machine surface:** `/api/cron/tick` (bearer secret), `/api/edge/occupancy` (per-restaurant key).
- **Where the valuable logic runs:** `src/lib/reservations/*` on the server. The browser
  receives results; only the pure time-slider projection (`project.ts`) and a few helpers ship in the client bundle.

## Findings

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | `npm audit`: 4 high advisories (Prisma's transitive `effect`, `deepmerge-ts`, `@prisma/config`) | High | Fixed: pinned patched versions via `overrides`; audit reports 0 |
| 2 | No cross-site write check beyond SameSite=Lax | Medium | Fixed: `src/proxy.ts` refuses writes whose Origin differs from the host |
| 3 | No Content-Security-Policy | Medium | Fixed: per-request CSP with script nonce, `frame-ancestors 'none'`, `object-src 'none'` |
| 4 | Admin pages relied on their layout for sign-in (layouts do not re-run on client navigation) | Medium | Fixed: every protected page calls `requireStaffPage` |
| 5 | Login limited per address only; one account could be hammered from many addresses | Medium | Fixed: also limited per account |
| 6 | Camera endpoint limited per restaurant id before the key check, so a stranger could use up a restaurant's quota | Low | Fixed: per-address limit first, per-restaurant after key check |
| 7 | No HSTS, COOP; `X-Powered-By` sent; browser source maps not explicitly off | Low | Fixed |
| 8 | CI did not audit dependencies; no update bot | Low | Fixed: `npm audit` step, Dependabot |
| 9 | Demo sign-in buttons and shared demo password shown by default | Low (by design for the demo) | Open: set `SHOW_DEMO_LOGIN=0` and remove demo staff after judging |
| 10 | CSP allows inline styles | Low | Open: needed by React inline style attributes in the drawn room |
| 11 | Rate limits trust the last `X-Forwarded-For` entry | Info | Open: correct behind Render/Vercel; review on other topologies |
| 12 | No two-factor sign-in, password reset or audit-log viewer | Info | Open |

Checked and found fine: no committed secrets or `.env`; only `NEXT_PUBLIC_APP_URL`
is browser-visible; no source maps in the build (0 `.map` files in `.next/static`);
every row lookup in staff routes is scoped by `restaurantId` (no cross-restaurant access);
all raw SQL is parameterised tagged templates; all request bodies validated with zod;
no `dangerouslySetInnerHTML` or `eval`; no CORS headers (same-origin only);
cron and camera endpoints refuse callers without their secret; guest tokens are 32 random characters.

## IP protection

This repository must be public for the hackathon, so the source cannot be secret.
Protection that actually holds: server-side execution of the engine, secrets in
environment variables, tenant scoping, rate limits, and the database constraint.
Frontend obfuscation does not make shipped JavaScript secret and is not a security control.

## BLA (`bla-agents` 3.6.0)

Verified before use: npm registry lists version 3.6.0, MIT, maintainer `qybaihe`, repo
`qybaihe/bla`, Node `^22.23.4 || >=24`. Run on a scratch copy only; I did not run
`bla setup` (it edits other tools' configs), did not use `--apply` or `--in-place`,
and left prompt-injection directives (`--llm-directives`) off.

| Step | Result |
|---|---|
| `inspect-release` on `.next/static` | 0 findings, no source maps |
| `audit` | client bundle 98/100 "exposed" (true of any readable JS) |
| `protect --intensity balanced` into a separate folder | exposure 2/100; BLA's own estimate of attacker cost $1.08 to $400 (BLA's figures, not independently measured) |
| `verify` | all 5 BLA invariants pass |
| Our 7 e2e tests against the protected bundle | 7 of 7 pass; the structural checks above are not a substitute, these are |
| Size impact | client JS 873 KB to 7,603 KB raw; 263 KB to 1,486 KB gzipped (5.6x) |

**Recommendation: do not apply BLA to this app's production build.** The client bundle
holds UI code only (the engine is server-side), the repository is public anyway, and the
guests who book on phones over mobile data would download 5.6x more JavaScript. If you
want it for the private dishly product, preview at `stealth` or `balanced`, measure on a
real phone, and only then apply. `protect` writes to a separate folder; restore is
rebuilding.

## Verification

Typecheck, lint, 60 unit tests, production build, and 7 Playwright tests (including the
new security test: unauthenticated requests get 401, cross-site writes 403, hosts cannot
reach owner endpoints, CSP present, no `X-Powered-By`) all pass; `npm audit` shows 0
vulnerabilities. Page-load performance of the unprotected build is unchanged apart from
a small per-request proxy step.

## Files

Added: `src/proxy.ts`, `src/lib/auth.test.ts`, `SECURITY.md`, `SECURITY_REVIEW.md`,
`.github/dependabot.yml`. Modified: `package.json` and lockfile, `next.config.ts`,
`src/lib/auth.ts`, login and camera routes, the admin and host pages, `tests/e2e/host.spec.ts`,
`.github/workflows/ci.yml`.

## Before going live

Set `AUTH_SECRET`, `CRON_SECRET`, `DATABASE_URL` on the host; use `SHOW_DEMO_LOGIN=0` outside
the demo; rotate any secret that was ever pasted into chat or committed.
