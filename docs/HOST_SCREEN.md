# The host screen

What the person at the door sees and does, and why it is laid out that way.
The engine underneath is in [`DESIGN.md`](./DESIGN.md).

## 1. Design principles for the host screen

1. **One screen for the door.** `/floor` is the host workspace for every role.
   Floor plan, timeline and list are three views of the same night. Managers
   use the same screen plus the rules pages.
2. **Pick a guest, then tap a table.** Selecting a booking or a waiting
   party lights up the tables that fit (green), dims the ones that don't, and
   one tap seats them there. This is how every good host stand works and it
   needs no drag and drop, which is unreliable on cheap Android phones.
3. **The next action is always one big button.** Arriving booking: *Seat*.
   Seated table with bill asked: *Guests left*. Dirty table: *Cleaned*.
   Rare actions (no-show, cancel, edit) are one level down.
4. **Who is this guest?** Every row shows badges: VIP, 4th visit, allergy,
   no-showed before, birthday. Tapping opens the profile.
5. **Thumb first.** 44 px minimum targets, bottom action bar on phones, no
   sideways scrolling, works at 360 px wide.
6. **Never lie about free.** Confirmed free versus estimated free stays
   visible.

## 2. What ships

### Host workspace (`/floor`)
- Top bar: date (today by default, any day for the book), search (name,
  phone digits, booking code), *Walk-in*, *Booking*, *Waitlist*.
- **Floor view**: the room as laid out by the manager (round/square/long
  tables at their positions, per area). Restaurants that haven't drawn
  their room get a tidy automatic layout. Live status colours, party, time
  seated, "free ~9:40" estimates, the next booking.
- **Timeline view**: tables down the side grouped by area, time across,
  covers per hour at the top, a "now" line. The window always covers every
  booking that day. Tap a bar to open it; tap an empty slot to book that
  table at that time.
- **List view**: Upcoming / Seated / Waitlist / Finished with counts, the
  next action on each row, guest badges.
- **Booking panel**: guest card (visits, no-shows, last visit, spend, tags,
  allergies, notes), and the booking itself: time, party, tables, occasion
  tags, guest note, staff-only note. Edit any of it; time and party changes
  go through the allocator so they can't double-book. Actions: Seat (choose
  table), Arrived, Move, No-show, Cancel, WhatsApp the guest.
- **Walk-in**: party size buttons 1 to 12+, best tables suggested, one tap to
  seat. If nothing is free, one tap adds them to the waitlist with an ETA.
- **Assign mode** for bookings and waiting parties, as above.
- Phone layout: views as tabs, panels as bottom sheets.

### The room (visual floor)
The floor view draws each area from above, the way a host sees it:
- the floor and walls, plus the entrance, windows, counter, kitchen,
  washroom, pillars and plants the manager places in the editor;
- every table in its real shape, with a chair per seat;
- guests sitting in the chairs once a party is seated, plates once they've
  ordered, and a bill slip when they ask for the bill;
- a bar along each table filling as the meal goes on, turning red when they
  overstay;
- placard text for held tables ("Ayesha ×5, 11:00").

**Drag to seat:** grab a guest in the list by the handle and drop them on a
table. One table that fits seats them at once; a smaller one asks for a
second to push together.

**Time slider:** play the room forward up to four hours in 15-minute steps.
Tables show who will probably still be eating (from the turn-time
estimate), which bookings will be sitting or due, and what's free, with a
summary of guests in and tables free. Expected guests are drawn faintly,
because it is an estimate. The logic is `src/lib/reservations/project.ts`,
tested on its own.

Cards remain one tap away for anyone who prefers tiles. On phones the room
scrolls inside its frame and zooms with + and −.

### Guests (CRM)
- `Guest` per restaurant, keyed by WhatsApp number. Created when a booking or
  waitlist entry has a number; staff can add one by hand.
- Visits, no-shows, cancellations, last visit and spend are counted from
  real bookings and table sessions, not stored counters, so they can't drift.
- Tags (VIP, Regular, Family, Corporate, Influencer, Do not seat by window…),
  allergies, birthday, internal notes, marketing consent.
- Admin pages: searchable list and a profile with full history.
- Privacy: profiles are kept while the guest keeps visiting and removed after
  12 months without a booking. "Forget this guest" erases the profile and the
  number on all their bookings on request. Booking pages say so.

### Rules
- **Per-weekday hours** (first and last seating, or closed) over the default.
- **Closures**: a date closed fully (Eid, renovation) or closed to online
  booking only (private event, staff still book).
- **Pacing**: maximum covers starting in one slot online. Staff can override.
- Online party limit keeps its message; larger parties are asked to call.

### Tables (`/admin/reservations/tables`)
- Add, rename and retire tables. A table with guests or future bookings
  can't be retired until they're moved.

### Floor plan editor (`/admin/reservations/floor-plan`)
- Per area canvas; drag tables, change shape (round, square, long) and size,
  snap to grid; mouse and touch. Saves positions; status colours come from
  the live floor.

## 3. Later phases

| Phase | Scope | Why later |
|---|---|---|
| Deposits and no-show fees | Safepay/Raast hold for parties ≥ 8 or peak nights | needs the payment gateway live |
| Interactive WhatsApp buttons | confirm/late/cancel inside the chat | Meta template approval |
| Server sections and covers per waiter | assign tables to waiters, balance covers | needs staff shifts |
| Marketing | birthday offers, win-back of lapsed guests | needs consent flow and templates |
| Google Reserve, Instagram "Book" button | discovery | partner approval |
| Urdu host screen | | translation pass across the app |
| Shared tables, bar seating by seat | | rare in family restaurants |

## 4. How we'll know it works

- Time to seat a walk-in at the door: under 5 seconds, 2 taps.
- Time to change a booking's time or size: under 15 seconds, no cancel/rebook.
- Share of tables closed with "Guests left" ≥ 90% (feeds estimates).
- Repeat-guest share visible in Insights within the first month.
- No horizontal scroll at 360 px on any host view (e2e checks it).
