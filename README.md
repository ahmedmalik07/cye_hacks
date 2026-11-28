# Mezbaan: the smart host stand

**Capital Youth Expo 2026 · Innovation Sprint · Track: Open Innovation**

Mezbaan (Urdu for "host") is the screen at a restaurant's door. It shows the
live room, takes bookings that can never clash, runs a waiting list on the
guest's own phone, learns how long tables take to turn, and puts no-show
tables back on sale by itself.

All code in this repository was written during the Innovation Sprint build
window (17 to 28 November 2026).

- **Live site:** https://dishly.wyibe.com
- **Demo video (2 min):** _add the video link here_
- **Slides:** _add the deck link here_

## The problem

Family restaurants in Pakistan run Friday nights on a register and a pen.
The host can't see which tables are about to free up, so families are told
"45 minutes" and walk away. Phone bookings get written twice for the same
table. A family that doesn't show holds a table for an hour while walk-ins
are turned away. Generic booking widgets know bookings, not the floor.

## What Mezbaan does

| For | What |
|---|---|
| The host at the door | One screen (`/floor`): the room drawn from above with every table's state, the night's bookings, the waiting list. Pick a guest, tap a table, seated. Walk-in in two taps. |
| Guests | Book online with a WhatsApp number, no account or app (`/r/{slug}/reserve`). Join the waiting list from a QR at the door and wait in the car (`/r/{slug}/waitlist`). A private link to confirm, run late or cancel. At the table, scan its QR to order, ask for the bill or call a waiter (`/t/{code}`). |
| The kitchen and floor staff | An orders board (`/orders`): new orders, preparing, served, and tables asking for the bill or a waiter. |
| The owner | Tables, menu, printable table QR codes, floor plan, hours and closures, pacing, the guest book (VIPs, allergies, visits, no-shows), and Insights: covers, turn times, no-shows, revenue recovered from released tables. |

What makes it more than a booking form:

1. **Double booking is impossible, not just unlikely.** Every table a booking
   holds is a time range in Postgres, guarded by an exclusion constraint
   (`btree_gist`). Two guests confirming the last table at the same moment:
   exactly one wins, the other is offered the next times. An end-to-end test
   races five bookings for one table to prove it.
2. **It learns your turn times.** From the restaurant's own finished meals it
   learns, per party size, how long a table takes from seated, ordered, bill
   and paid. Each table gets an honest "free around 9:10 (9:02 to 9:20)" with
   a confidence level, which tightens as the meal moves along.
3. **Allocation that thinks like a host.** Best-fit tables, keeps big tables
   for big parties, pushes tables together for a family of nine, holds back a
   share for walk-ins, and respects kitchen pacing per time slot.
4. **No-shows go back on sale.** Reminder before, grace period after, then the
   table is released and offered to the waiting list automatically.
5. **WhatsApp-first.** Confirmations, reminders and "your table is ready" go
   through the WhatsApp Cloud API when configured, or wait as one-tap
   `wa.me` messages the host sends from their own phone (free, works on day one).
6. **QR ordering that drives the floor.** A guest's first order marks the table
   occupied and "ordered"; asking for the bill turns the tile to Bill; the
   kitchen marking orders served moves the table to Eating; Paid with no typed
   total uses what was ordered. No staff typing, so the turn-time estimates
   keep learning.
7. **CCTV occupancy.** An on-site camera box posts per-table occupancy counts
   (never images) with a per-restaurant key the owner issues and can revoke.
   The host sees "the camera has seen this table empty"; it can close a paid
   table by itself only if the owner switches that on, and never seats anyone.
   `scripts/cctv-demo.ts` plays the camera box for demos.

How it all fits together: [`docs/DESIGN.md`](docs/DESIGN.md) (engine,
algorithm, data model, limits) and [`docs/HOST_SCREEN.md`](docs/HOST_SCREEN.md)
(the host screen).

## Demo credentials

After seeding (see below), the demo restaurant is **Saffron Courtyard**, a
fictional 14-table Islamabad family restaurant with 40 days of history and a
busy evening in progress.

| Role | Email | Password |
|---|---|---|
| Owner (everything) | `owner@mezbaan.demo` | `demo1234` |
| Host (host screen only) | `host@mezbaan.demo` | `demo1234` |

The sign-in page also has one-tap Owner and Host demo buttons.
Guest pages: `/r/saffron-courtyard/reserve` and `/r/saffron-courtyard/waitlist`.

The seeded evening is relative to the time you seed it, so re-run the seed
shortly before a demo.

## Run it locally

Needs Node 20+ and Postgres 14+ with the `btree_gist` extension (it ships
with standard Postgres, Neon, Supabase and Render).

```bash
npm ci
cp .env.example .env            # set DATABASE_URL; AUTH_SECRET for production
npx prisma migrate deploy       # creates tables and the no-overlap constraint
npm run db:seed                 # demo restaurant, staff, history, tonight
npm run dev                     # http://localhost:3000
```

## Tests

```bash
npm test                        # 62 unit tests: allocation, estimates, policy, room projection
npm run typecheck && npm run lint
```

End-to-end (Playwright, against a running server and a local test database):

```bash
createdb mezbaan_test
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/mezbaan_test npx prisma migrate deploy
npm run build
AUTH_SECRET=$(openssl rand -hex 32) DATABASE_URL=postgresql://postgres@127.0.0.1:5432/mezbaan_test npx next start -p 3100 &
E2E_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/mezbaan_test npm run test:e2e
```

The nine e2e tests cover: seating a booking, a walk-in and a pushed-together
group; closed days, pacing and the 360 px phone layout; dragging a waiting
family onto a table and playing the night forward; five guests racing for
one table; a table's full cycle by hand; staff sign-in and role checks; security (401s, cross-site writes refused, CSP); a guest ordering by QR and the floor following; the CCTV feed and its key.
GitHub Actions runs all of it on every push (`.github/workflows/ci.yml`).

## Deploy

Render (web service) + Neon (Postgres), both free tiers. Step by step in
[`docs/DEPLOY.md`](docs/DEPLOY.md); `render.yaml` is the blueprint.

## Project layout

```
prisma/schema.prisma            data model
prisma/migrations/              SQL, including the exclusion constraint
prisma/seed.ts                  demo restaurant
src/lib/reservations/           the engine: allocate, policy, predict, floorState,
                                waitlist, service, sweep, messages, insights, project
src/lib/{auth,jobs,bus}.ts      staff sign-in, job queue, live revision
src/components/host/            host screen: room, timeline, lists, booking panel
src/components/floor/           table dialogs and tiles
src/components/reserve/         guest booking, manage booking, waiting list
src/components/admin/           tables, floor plan editor, rules, guest book
src/app/                        pages and API routes
tests/e2e/                      Playwright
```

## Libraries, services and tools used (full disclosure)

Every external library, API and service, as the rules require.

**Runtime libraries (npm)**

| Package | Version | License | Used for |
|---|---|---|---|
| qrcode | 1.5.4 | MIT | Drawing the printable table QR codes |
| next | 16.4.6 | MIT | Web framework: pages, API routes, server rendering |
| react, react-dom | 19.2.4 | MIT | UI |
| @prisma/client, prisma | 6.19.3 | Apache-2.0 | Database client, schema and migrations |
| zod | 4.6.6 | MIT | Validating every API request body |
| swr | 2.4.2 | MIT | Client-side data fetching and refresh |
| bcryptjs | 3.0.3 | BSD-3-Clause | Hashing staff passwords |
| nanoid | 5.1.16 | MIT | Booking codes and manage-link tokens |
| lucide-react | 0.460.0 | ISC | Icons |
| clsx, tailwind-merge | 2.1.1, 3.6.0 | MIT | Joining CSS class names |

**Development and test tools**

| Package | Version | License | Used for |
|---|---|---|---|
| tailwindcss, @tailwindcss/postcss | 4.3.2 | MIT | Styling |
| typescript | 5.9.3 | Apache-2.0 | Types |
| vitest | 4.1.12 | MIT | Unit tests |
| @playwright/test | 1.63.0 | Apache-2.0 | End-to-end browser tests |
| eslint, eslint-config-next | 9.39.4, 16.4.6 | MIT | Linting |
| tsx | 4.23.0 | MIT | Running the seed script |
| @types/node, @types/react, @types/react-dom | | MIT | Type definitions |

**Database features:** PostgreSQL with the `btree_gist` extension (part of
standard PostgreSQL contrib) for the no-overlap exclusion constraint.

**External APIs (optional, off by default)**

| API | Used for | Without it |
|---|---|---|
| WhatsApp Cloud API (Meta, `graph.facebook.com`) | Sending booking confirmations, reminders and table-ready messages | Messages queue on the host screen as `wa.me` links staff send from their own WhatsApp |

No other third-party API is called. No analytics, no tracking, no AI model
API at runtime: the turn-time estimates are plain statistics (percentiles)
computed from the restaurant's own data.

**Hosting (for the live demo):** Render (web service) and Neon (Postgres).

**Fonts and assets:** system font stack; icons from Lucide; the logo is drawn
in SVG in `src/components/Brand.tsx`. No stock images.

**AI assistance:** AI coding assistants (Claude Code) were used while
building, as the rules allow.

## License

MIT
