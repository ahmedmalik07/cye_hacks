# How Mezbaan works

> The host screen, guest profiles, floor plan, per-day hours, closures and
> pacing are described in [`HOST_SCREEN.md`](./HOST_SCREEN.md). This document
> covers the engine underneath them.

How Mezbaan books tables, knows which ones are free, and fills them again, for
small and medium family restaurants in Pakistan. Everything below is built and
running, except where §7 and §9 say "next". Examples use the demo restaurant
(`npm run db:seed`): **Saffron Courtyard**, a fictional Islamabad family
restaurant with 14 tables.

| Area | Tables | Notes |
|---|---|---|
| Main hall | T-01, T-02 (2), T-03–T-06 (4), T-07 (2, walk-in only) | T-03/04/05 push together (group A) |
| Family hall | F-01, F-02 (6, min 3), F-03 (8, min 4), F-04, F-05 (4, group B), F-06 (10, min 6) | |
| Rooftop | R-01 (4) | |

The look is the Navy / Sand / Tangerine palette (`src/app/globals.css`): navy for commitments and primary actions, tangerine
(navy's complement) for anything that needs attention, sand for warmth.

---

## 1. The guest journey

No account, no app. A WhatsApp number is the identity; the link in each
message is the key.

1. **Find the link**: Instagram bio, Google Maps "Reserve", the restaurant's
   WhatsApp status, or a QR at the door (`/r/{slug}/reserve`).
2. **Date and time** (step 1/3). Today plus the next 13 days; 30-minute slots
   from first to last seating. Struck-through slots are full *for this party
   size*: availability is computed by the same allocator that confirms
   bookings, so a slot shown free will normally confirm.
3. **Who's coming** (2/3). Adults and children (children take seats), name,
   WhatsApp number (`0300 1234567` and every other local shape is normalised
   to `+923001234567`), optional note ("birthday, high chair"). If the
   party no longer fits the chosen time, the nearest times that do are
   offered inline.
4. **Choose your table** (3/3). Area tabs, then "Best table for 5: we'll seat
   you at F-01", or a table picked from the floor map (Free / Booked /
   Occupied / Wrong size). Never who booked, only that it's taken.
5. **Confirmed instantly** with a code (`MZ-A7B2Q`) and table, or, if someone
   took it a second earlier, "That table was just booked" plus the times that
   still have one. There is no unconfirmed "request" state.
6. **WhatsApp confirmation** with the manage link, then a **reminder** (2 h
   before by default). The link lets the guest:
   - **Confirm** they're coming (staff see "✓ coming");
   - **Run late** +15/30/45 min: within the grace period it's just noted;
     beyond it, the table is held longer *only if it's free that long*,
     otherwise the guest is told it's held until the original time + grace;
   - **Cancel**, which frees the table at once.
7. **At the door** the host taps *Seat*. If they never come, the table is
   released at time + grace (15 min) and the guest gets a polite "we missed
   you, join the waiting list" message.

**Fully booked?** `/r/{slug}/waitlist`: party size shows "about 25 min ·
1 party ahead" *before* joining; after joining, a live page shows the place
and estimate and turns into a tangerine "YOUR TABLE IS READY, come by 8:42"
the moment a table is offered.

## 2. Estimating and confirming availability

Two different things, kept visibly apart everywhere:

- **Confirmed free**: nobody is seated, or staff confirmed the guests left
  *and* the table was cleaned. Only confirmed-free tables are offered to the
  waiting list or a walk-in.
- **Estimated free**: when an occupied table will probably empty. Shown as
  "free ~2:08pm (2:00–2:16) · medium confidence, from when they ordered",
  always marked "Estimated, not confirmed".

**How the estimate works** (`src/lib/reservations/predict.ts`). It is
deliberately not a black box. From the restaurant's own last 60 days of
closed table sessions it learns, per party size (1–2, 3–4, 5–6, 7+), the
25th/50th/75th percentile of:

| Stage reached | Learned interval | Saffron Courtyard (seed data) |
|---|---|---|
| Seated | sit → leave | 65 / 84 / 100 / 114 min by size |
| Ordered | first order → leave | |
| Bill asked | bill → leave | ~15 min |
| Paid | paid → leave | ~8 min |
| Camera sees it empty ≥ 2 min | | ~2 min |
| Staff override | "+10 / −10 / +20 min" | exact |

A live table is anchored to the **latest** stage it has reached, so the
estimate tightens as the meal progresses: a family that just sat down is a
wide guess; one that has paid is minutes away. Confidence is high for bill
or paid, medium for ordered, low for just-seated, and one step lower while
the restaurant has fewer than six meals in a bucket ("still learning your
timings": the owner's planning time, 90 min by default, scaled by party
size, stands in). A table past its estimate is flagged red ("over by 25m")
instead of predicting the past.

**Where stage signals come from.** One tap each on the host screen; the
table dialog offers only the next sensible step:

| Signal | Source |
|---|---|
| Seated | Host taps Seat, drags a party onto a table, or seats a walk-in |
| Ordered | The guest's first QR order; or staff tap "Order placed" |
| Eating | All the table's orders marked served on the orders board; with none, 20 min after ordering |
| Bill requested | The guest's "Ask for the bill" button on the table QR page; or staff tap "Bill requested" |
| Paid | Staff tap "Paid"; the total is what was ordered unless staff type one |
| Left | Staff tap "Guests left"; or CCTV (only if the owner allows, §5) |
| Cleaned | Staff tap "Cleaning done": the only route back to bookable |

## 3. The allocation algorithm

`src/lib/reservations/allocate.ts`, pure and unit-tested; the booking
route, availability grid, waiting list and phone bookings all call it.

**Inputs:** tables (seats, minimum party, area, join group, bookable online),
existing holds, and for times in the next 4 hours the live floor (an
occupied table whose conservative ready time is after the start is not
free). A booking holds its tables for `[start, start + planned meal +
cleaning)`; the planned meal is the restaurant's learned median for that
party size, rounded up to 15 min.

**Rules:** a table is a candidate if it's free for the whole hold, has
enough seats, and the party meets its minimum (a 6-top isn't given to two;
staff can override). Online bookings may hold at most `onlineTablesPct` of
bookable tables at once (80% → 10 of 13 at Saffron Courtyard), so walk-ins and phone
regulars always have tables.

**Score, lowest wins:**

| Term | Weight | Why |
|---|---|---|
| Empty seats | ×10 | 2 guests at a 2-top, not a 6-top |
| Extra joined table | +30 each | pushing tables together is work |
| Joinable table used alone | +3 | keep group A free for the 9-person family |
| Wrong area | +25 | guest asked for the family hall |
| Stranded gap 15–60 min | +gap/6 | a 40-min hole nobody can book is lost money |
| Snug fit ≤ 15 min | −5 | start right after the last party leaves |

If no single table fits, it tries 2 then 3 tables from one join group
(Usman ×8 → F-04 + F-05). Results: `ok`, or `NO_FIT`, `TAKEN`,
`ONLINE_CAP`, `TOO_LARGE`, each with nearby times that would work.

**No double booking, guaranteed by the database, not by hope:**

1. Every write that changes who sits where takes a per-restaurant Postgres
   advisory lock, so allocation and insert happen one at a time;
2. `ReservationTable` carries an **exclusion constraint**:
   `EXCLUDE USING gist (tableId WITH =, tsrange(blockStart, blockEnd) WITH &&) WHERE (active)`.
   Even a buggy future code path cannot commit two overlapping holds;
3. `TableSession` allows one uncleaned session per table (partial unique
   index), so two staff can't seat the same table.

Tested with 8 concurrent confirms on one table (1 wins, 7 get "just taken")
and 30 concurrent parties (exactly 10 confirmed, the online cap), with zero
overlaps and Postgres rejecting a raw overlapping insert.

## 4. Data model and the table state machine

Schema: `prisma/schema.prisma`; the constraints Prisma cannot express are at
the end of the first migration.

| Model | Purpose |
|---|---|
| `Table` + seats, minParty, area, joinGroup, reservable, sortOrder, cctv* | seating facts; CCTV counts only |
| `Reservation` + endAt, source, code, manageToken, childCount, guestConfirmedAt, lateUntil, seatedAt, cancelledBy, releasedAt | the booking |
| `ReservationTable` (reservationId, tableId, blockStart, blockEnd, active) | each table held, with the exclusion constraint |
| `TableSession` (seatedAt, firstOrderAt, billRequestedAt, paidAt, leftAt, cleanedAt, freeAtOverride, revenueCents) | one party at one table; the history estimates learn from |
| `WaitlistEntry` (code, manageToken, status, quotedMins, respondBy, offeredTableIds) | the queue |
| `GuestMessage` (kind, toPhone, body, status QUEUED/SENT/MANUAL/FAILED) | every WhatsApp, for staff to see what was said |
| `Restaurant` + booking hours, slot, lead, max days/party, online share, planning meal, cleaning, grace, auto-release, reminder, hold, waitlist and CCTV switches | the policy |

**State machine** (`src/lib/reservations/floorState.ts`). The latest session
stores when each step happened; the status is derived from those and the
bookings, never stored, so it cannot drift:

```
            seat (walk-in, booking or waiting list)            
 AVAILABLE ──────────────────────────────────────────────► OCCUPIED
 READY  ───┘                                                  │ bill asked / paid
   ▲                                                          ▼
   │ cleaning done (staff only)                        BILL REQUESTED
   │                                                          │ guests left (staff,
 CLEANING ◄───────────────────────────────────────────────────┘  or camera if allowed)

 RESERVED overlays a free table from 30 min before a booking until it's
 seated or released at time + grace (or the guest's late time + grace).
 READY = cleaned in the last 15 minutes: "seat the next party here".
```

Booking states: `CONFIRMED → SEATED → COMPLETED`, or `CANCELLED` (guest or
staff), or `NO_SHOW` (staff, or the system at grace end). Waiting list:
`WAITING → NOTIFIED → SEATED`, or `CANCELLED` / `EXPIRED` (didn't arrive in
the reply window; the table goes to the next party).

## 5. Supporting pieces

- **Staff sign-in** (`src/lib/auth.ts`): email and password (bcrypt), then a
  signed, http-only cookie. Roles: Owner and Manager reach set-up; Host
  reaches the host screen.
- **Live screens** (`src/lib/bus.ts`, `useLiveRevision`): every change bumps
  a per-restaurant revision row; screens listen over Server-Sent Events
  (falling back to polling) and refetch when it moves.
- **Job queue** (`src/lib/jobs.ts`): confirmations, reminders (at start − 2 h)
  and the grace-period release (at start + grace + 1 min) are durable jobs in
  Postgres, claimed with `FOR UPDATE SKIP LOCKED`. `/api/cron/tick` runs them
  and re-sweeps every restaurant with something due; a long-lived server
  also ticks in-process every 30 s (`src/instrumentation.ts`).
- **QR ordering** (`src/lib/ordering.ts`, `/t/{code}`): each table has an
  unguessable code. The server prices every order from the menu (the phone
  only sends dish ids and quantities), opens the table's session if nobody
  seated it, and bumps the live revision. Orders keep the name and price they
  were placed at.
- **Switching online booking off** keeps existing bookings visible and
  cancellable but takes no new ones.
- **CCTV** (optional): an on-site edge box runs person detection locally and
  posts `{table, occupied, people, confidence}` to `/api/edge/occupancy`
  with a per-restaurant key (only its hash is stored). Readings older than
  2 min or below 0.6 confidence are ignored. They **suggest** ("Camera: T-04
  looks empty") and sharpen estimates; they close a paid table by themselves
  only when the owner turns that on, and **never seat anyone or mark a table
  clean**. No images ever leave the restaurant.

## 6. Technology

A deliberately small stack that runs on free tiers: Next.js 16 (route
handlers + server components), Postgres (Neon) via Prisma 6 with `btree_gist`
for the exclusion constraint, a Postgres job queue, SSE for live screens, SWR
on the client. WhatsApp: Meta Cloud API
(utility template, about PKR 1–3 per conversation in Pakistan) when
configured; otherwise free `wa.me` links staff tap from their own phone.
CCTV inference (later): an Intel N100 mini PC running an open-source person
detector on RTSP streams, on site.

## 7. MVP versus advanced AI

| Built now (works with zero hardware) | Next (adds accuracy, not dependency) |
|---|---|
| No-login booking with live availability and floor map | Per-weekday and per-daypart buckets (Friday dinner ≠ Tuesday lunch) |
| Allocation with joins, areas, online share, gap scoring | Gradient-boosted model on stage, party, daypart, items ordered, weather/holidays once ≥ 2,000 meals |
| Database-guaranteed no double booking | Overbooking by learned no-show rate per slot (off by default) |
| Stage-anchored estimates from the restaurant's own meals, with ranges and confidence | Interactive WhatsApp buttons (confirm/late/cancel from the chat) via webhook |
| WhatsApp confirmation, reminder, late/cancel link, auto release | Deposits for large parties or peak nights (Safepay/Raast) |
| Remote waiting list with simulated ETAs and auto offers | Edge CCTV occupancy box and camera-to-table zone mapping UI |
| Floor board, overrides, at-risk detection and "move booking" | Floor-plan editor (drag tables), table positions on the guest map |
| Insights: utilisation, meal length, no-shows, recovered revenue | Urdu interface and messages; Google Reserve integration |

## 8. Limitations and failure scenarios

| Scenario | What happens |
|---|---|
| Staff forget "Guests left" | The table stays Occupied and goes red "over by N min"; nearby bookings show *at risk* with a one-tap "move to a free table". Estimates ignore sessions over 6 h when learning. |
| Staff forget "Cleaning done" | Table stays Cleaning; it isn't offered to anyone. Deliberate: never seat a family at a dirty table. |
| A walk-in is seated on a table booked in an hour | The host is warned first; on "seat anyway" the booking is moved to another table that fits, or flagged "needs a table". |
| Families linger far beyond the estimate | Conservative (75th-percentile) ready times are used before promising a table for the next few hours; the at-risk alert fires. |
| WhatsApp API down or not configured | Messages wait on the board as "Open WhatsApp" buttons; the 4xx (bad number) case goes to staff, not into a retry loop. |
| Guest gives a wrong number | Booking stands; they can't get reminders. No OTP yet (cost); a per-number limit of 3 upcoming bookings and IP rate limits curb abuse. |
| Server or job runner restarts | Jobs are durable; releases and reminders run on time or within 5 min via the cron backstop; the board also sweeps when opened. |
| CCTV false "empty" (guests at the counter) | Needs 3 min of fresh, confident empty readings and a bill/payment first, and only if the owner enabled it; otherwise it's a suggestion. |
| Clock and time zones | All times are stored as instants and computed in the restaurant's zone (Asia/Karachi); slots past midnight belong to the evening they started. |
| Prediction with little history | Uses the owner's planning time, says "still learning", lowers confidence. |

**Privacy.** Guests' phone numbers are shown masked in lists
(`+92 300 ••• 4567`); the full number appears only on an opened booking so
the host can call or WhatsApp. Numbers come off bookings and messages after
90 days (counts kept for Insights). The guest profile (see
`RESERVATIONS_V2.md`) keeps the number while the guest keeps visiting and is
deleted after 12 months with no booking; "Forget this guest" erases it at
once on request. Manage and waitlist links
are 32-character random tokens, excluded from search engines and referrers.
The public map never shows who booked. CCTV frames never leave the restaurant.

## 9. Roadmap

| Weeks | Ship | Measure |
|---|---|---|
| 0 (done) | Everything in §7 left column, demo seed, tests | 470 unit tests green; concurrency test |
| 1–2 | Pilot at 2 Islamabad family restaurants (F-7, Blue Area); WhatsApp Cloud API template approval; staff training (15 min) | % tables closed with "Guests left" ≥ 90%; no-show rate baseline |
| 3–4 | Interactive WhatsApp buttons; weekday/daypart buckets; "Book again" link after the visit | Reminder confirm rate; estimate error (median |freeAt − leftAt|) |
| 5–8 | Urdu; floor-plan editor; deposits for parties ≥ 8 on Fri/Sat | No-show rate on deposit bookings |
| 9–12 | Edge CCTV pilot at one site, suggestions only | False-empty rate < 2% before enabling auto-close |
| 13+ | Learned model behind a flag, A/B against medians | Estimate error vs median baseline |

## 10. Why owners will pay for it

For a 14-table Islamabad family restaurant averaging PKR 2,400 a guest:

- **No-shows recovered.** At 8% no-shows on ~15 bookings a night, a table
  released at 15 min and re-sold through the queue twice a week is
  ~2 × 4 guests × 2,400 ≈ **PKR 19,000 a week**, against a PKR 9,500 monthly
  subscription.
- **Walk-aways recovered.** Families who would have left because "it's a
  45-minute wait" join a remote queue instead; Insights counts only the
  revenue traceable to waiting-list seatings, so the number is defensible.
- **Faster turns.** "Bill asked" and "Cleaning done" timestamps make dead
  minutes visible; one extra turn on a Friday night is 4 covers.
- **No double bookings, ever**, which is the complaint that loses regulars.

**Versus existing reservation tools** (generic booking widgets, phone
diaries, Google Sheets): those know bookings, not the floor. Mezbaan knows
when each table sat, ordered, asked for the bill, paid and was cleaned, and
that is exactly what turns "probably free around 9" into an honest, improving
estimate. It costs nothing extra to run, works on a host's phone, speaks
WhatsApp (how Pakistani families actually communicate), and never needs a
guest account.
