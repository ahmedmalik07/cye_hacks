# Pitch kit: demo video and slide deck

Judging is 25% each: Innovation & Creativity, Technical Execution &
Functionality, Real-World Impact & Viability, Presentation / UI-UX / Pitch.
Every slide and every second of the video below is aimed at one of them.

## Demo video (max 2:00)

Record at 1920×1080 with the browser zoomed to 110%. Re-seed the demo
database 10 minutes before recording. Voice-over is the right column; keep
it this short.

| Time | Screen | Say |
|---|---|---|
| 0:00 to 0:12 | A real register and pen at a restaurant door (photo), then cut to the Mezbaan landing page | "Friday night, Islamabad. The host has a register, a pen and a queue of families. Nobody knows which table frees up next." |
| 0:12 to 0:30 | Sign in as Host (one tap). The room appears: tables in green, tangerine, navy, grey | "This is Mezbaan. The whole room, live. Green is free, tangerine is eating, the solid one asked for the bill, navy is reserved, grey is being cleaned." |
| 0:30 to 0:45 | Tap a tangerine table: the "free around 9:10, from when they ordered" estimate | "Every table knows roughly when it frees up. Mezbaan learned that from this restaurant's own meals, and it gets sharper as the meal moves along." |
| 0:45 to 1:00 | Walk-in: tap 7, Pick on floor, tap two tables, Seat | "A family of seven walks in. No table fits, so the host pushes two together. Two taps." |
| 1:00 to 1:20 | Phone frame: guest joins the waiting list from the QR page; back on the host screen, drag them onto a table | "Busy? Guests join the waiting list from their phone and wait in the car. When a table is ready, they get a WhatsApp." |
| 1:20 to 1:35 | Guest booking page on a phone, pick time, confirm, code appears | "Online booking needs a WhatsApp number, nothing else. And two people can never get the same table: the database itself refuses it." |
| 1:35 to 1:50 | Drag the time slider forward on the room; then Insights page | "Slide forward to see tonight before it happens. And the owner sees what no-shows cost and what Mezbaan won back." |
| 1:50 to 2:00 | Landing page with the live URL | "Mezbaan. Fill every table. Try it at [URL]." |

## Slide deck (10 slides, 20 minute presentation)

Leave about 12 minutes for slides and 6 for a live demo, then Q&A.

1. **Title.** Mezbaan: the smart host stand. Track: Open Innovation. Team
   names. One photo of a crowded restaurant door.
2. **The problem** (Impact). The register and pen. Three pains with a face on
   each: families walk away from a "45 minute" guess; two bookings on one
   table; a no-show holds a table for an hour on the busiest night.
3. **Who it's for** (Viability). Small and medium family restaurants in
   Pakistani cities: 10 to 40 tables, a host who is often a waiter, guests
   who live on WhatsApp. Why existing tools miss them: built for the West,
   app or account required, they know bookings but not the floor.
4. **The product in one screen** (UI/UX). Screenshot of the host screen with
   four callouts: the room, arrivals, waiting list, needs-attention.
5. **Live demo** (Functionality). Switch to the browser. Script: walk-in of
   7 pushed together; guest joins waiting list on a phone and is dragged to a
   table; online booking on a phone; time slider; Insights.
6. **What's new here** (Innovation). (a) No double booking guaranteed by the
   database, not by hope. (b) Turn-time estimates learned from the
   restaurant's own meals, with honest ranges and confidence. (c) A waiting
   list that lives on the guest's phone. (d) No-shows released and re-sold
   automatically. (e) Optional CCTV occupancy with no images leaving the
   building.
7. **How it works** (Technical). Architecture diagram: Next.js app, Postgres
   with the exclusion constraint, job queue for reminders and sweeps, live
   updates over server-sent events, WhatsApp. One code snippet: the
   `EXCLUDE USING gist` line. Test numbers: 57 unit tests, 6 end-to-end
   tests including five guests racing for one table, CI on every push.
8. **Impact in rupees** (Viability). For a 14-table restaurant at PKR 2,400
   a guest: two released no-show tables re-sold a week ≈ PKR 19,000 a week;
   families kept by the waiting list instead of walking; one extra turn on a
   Friday is 4 covers. Against a PKR 9,500 monthly price.
9. **Business model and rollout.** Monthly subscription per restaurant;
   free WhatsApp mode means no setup cost. Pilot with 3 Islamabad
   restaurants in December, then Rawalpindi and Lahore. Roadmap: deposits
   for large parties (Raast), Urdu host screen, interactive WhatsApp buttons.
10. **Close.** "Fill every table." Live URL, GitHub URL, QR code to the guest
    booking page so judges can book a table on their own phones.

## Q&A: likely questions and short answers

- **What if the internet drops?** The host screen keeps the last state and
  refetches on reconnect; bookings already made are in the database and in
  the guest's WhatsApp.
- **How accurate are the estimates?** They come with a range and a confidence
  level, and say "still learning" until a restaurant has enough meals. A table
  past its estimate is flagged, never shown as free.
- **Why not AI?** The estimates are percentiles of the restaurant's own data:
  explainable, cheap, and good with little history. A learned model is on the
  roadmap once a restaurant has thousands of meals.
- **Privacy?** Guest numbers are kept per restaurant, phone numbers are cleared
  from old bookings, and guests can be forgotten on request. CCTV sends counts,
  never images.
- **What stops a competitor copying it?** The floor data each restaurant builds
  up (turn times, guest history) makes Mezbaan better the longer it runs there.
