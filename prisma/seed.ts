/**
 * Demo data: "Saffron Courtyard", a fictional 14-table Islamabad family
 * restaurant with 40 days of meal history (so the estimates have something
 * to learn from) and a live evening: occupied tables at different stages, a
 * bill, a table being cleaned, bookings arriving and families waiting.
 *
 *   npm run db:seed
 *
 * Runs against localhost by default. To seed a hosted demo database, set
 * SEED_ALLOW_REMOTE=1. Safe to re-run: it rebuilds only the demo restaurant.
 */
import { PrismaClient } from "@prisma/client";
import { customAlphabet } from "nanoid";
import bcrypt from "bcryptjs";

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url) && process.env.SEED_ALLOW_REMOTE !== "1") {
  console.error("Refusing to seed: DATABASE_URL is not local. Set SEED_ALLOW_REMOTE=1 to seed a demo database.");
  process.exit(1);
}

export const DEMO_SLUG = "saffron-courtyard";
export const DEMO_PASSWORD = "demo1234";

const prisma = new PrismaClient();
const ref = customAlphabet("23456789ABCDEFGHJKLMNPQRSTUVWXYZ", 5);
const token = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", 32);
const MIN = 60_000;

// Deterministic randomness, so every run tells the same story.
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

const LAYOUT: {
  name: string;
  seats: number;
  minParty: number;
  area: string;
  joinGroup?: string;
  reservable?: boolean;
}[] = [
  { name: "T-01", seats: 2, minParty: 1, area: "Main hall" },
  { name: "T-02", seats: 2, minParty: 1, area: "Main hall" },
  { name: "T-03", seats: 4, minParty: 1, area: "Main hall", joinGroup: "A" },
  { name: "T-04", seats: 4, minParty: 1, area: "Main hall", joinGroup: "A" },
  { name: "T-05", seats: 4, minParty: 1, area: "Main hall", joinGroup: "A" },
  { name: "T-06", seats: 4, minParty: 1, area: "Main hall" },
  { name: "T-07", seats: 2, minParty: 1, area: "Main hall", reservable: false },
  { name: "F-01", seats: 6, minParty: 3, area: "Family hall" },
  { name: "F-02", seats: 6, minParty: 3, area: "Family hall" },
  { name: "F-03", seats: 8, minParty: 4, area: "Family hall" },
  { name: "F-04", seats: 4, minParty: 2, area: "Family hall", joinGroup: "B" },
  { name: "F-05", seats: 4, minParty: 2, area: "Family hall", joinGroup: "B" },
  { name: "F-06", seats: 10, minParty: 6, area: "Family hall" },
  { name: "R-01", seats: 4, minParty: 1, area: "Rooftop" },
];

const NAMES = [
  "Ayesha Khan",
  "Bilal Ahmed",
  "Fatima Malik",
  "Hamza Qureshi",
  "Sana Javed",
  "Usman Tariq",
  "Zainab Raza",
  "Ali Hassan",
  "Mehwish Iqbal",
  "Omar Farooq",
  "Hina Butt",
  "Saad Chaudhry",
];

async function main() {
  const r = await prisma.restaurant.upsert({
    where: { slug: DEMO_SLUG },
    create: { slug: DEMO_SLUG, name: "Saffron Courtyard" },
    update: {},
  });
  const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  for (const s of [
    { email: "owner@mezbaan.demo", name: "Ayesha (Owner)", role: "OWNER" as const },
    { email: "host@mezbaan.demo", name: "Bilal (Host)", role: "HOST" as const },
  ]) {
    await prisma.staffUser.upsert({
      where: { email: s.email },
      create: { ...s, passwordHash, restaurantId: r.id },
      update: { ...s, passwordHash, restaurantId: r.id, active: true },
    });
  }
  const now = Date.now();

  await prisma.restaurant.update({
    where: { id: r.id },
    data: {
      name: "Saffron Courtyard",
      currency: "PKR",
      timeZone: "Asia/Karachi",
      address: "F-7 Markaz, Islamabad",
      reservationsEnabled: true,
      bookingOpensAt: "12:00",
      bookingClosesAt: "23:30",
      bookingLeadMins: 30,
      defaultDiningMins: 90,
      cleaningMins: 10,
      graceMins: 15,
    },
  });

  // Rebuild the floor: wipe this restaurant's floor history and bookings.
  await prisma.guestMessage.deleteMany({ where: { restaurantId: r.id } });
  await prisma.tableSession.deleteMany({ where: { restaurantId: r.id } });
  await prisma.reservationTable.deleteMany({ where: { restaurantId: r.id } });
  await prisma.reservation.deleteMany({ where: { restaurantId: r.id } });
  await prisma.waitlistEntry.deleteMany({ where: { restaurantId: r.id } });
  await prisma.guest.deleteMany({ where: { restaurantId: r.id } });
  await prisma.job.deleteMany({});

  const existing = await prisma.table.findMany({
    where: { restaurantId: r.id },
    orderBy: { createdAt: "asc" },
  });
  const tables: Awaited<ReturnType<typeof prisma.table.create>>[] = [];
  for (let i = 0; i < LAYOUT.length; i++) {
    const l = LAYOUT[i];
    const data = {
      name: l.name,
      seats: l.seats,
      minParty: l.minParty,
      area: l.area,
      joinGroup: l.joinGroup ?? null,
      reservable: l.reservable ?? true,
      sortOrder: i,
      active: true,
      cctvOccupied: null,
      cctvSince: null,
      cctvSeenAt: null,
    };
    tables.push(
      existing[i]
        ? await prisma.table.update({ where: { id: existing[i].id }, data })
        : await prisma.table.create({ data: { ...data, restaurantId: r.id } }),
    );
  }
  for (const extra of existing.slice(LAYOUT.length)) {
    await prisma.table.update({ where: { id: extra.id }, data: { active: false } });
  }

  // ---- 40 days of history: lunch and dinner seatings, families stay longer ----
  const history = [];
  for (let day = 40; day >= 1; day--) {
    const base = new Date(now - day * 24 * 60 * MIN);
    base.setUTCHours(8, 0, 0, 0); // 13:00 Karachi
    const sittings = 10 + Math.floor(rand() * 8);
    for (let k = 0; k < sittings; k++) {
      const t = pick(tables.filter((x) => x.reservable));
      const party = Math.max(t.minParty, Math.min(t.seats, 1 + Math.floor(rand() * t.seats)));
      const dinner = rand() < 0.65;
      const seatedAt =
        base.getTime() + (dinner ? 6 * 60 : 0) * MIN + Math.floor(rand() * 180) * MIN;
      const meal =
        (party <= 2 ? 60 : party <= 4 ? 80 : party <= 6 ? 95 : 110) + Math.floor(rand() * 30) - 10;
      const left = seatedAt + meal * MIN;
      const bill = left - (12 + Math.floor(rand() * 8)) * MIN;
      history.push({
        restaurantId: r.id,
        tableId: t.id,
        source: pick(["WALK_IN", "WALK_IN", "RESERVATION"] as const),
        partySize: party,
        seatedAt: new Date(seatedAt),
        firstOrderAt: new Date(seatedAt + (6 + Math.floor(rand() * 8)) * MIN),
        billRequestedAt: new Date(bill),
        paidAt: new Date(bill + 5 * MIN),
        leftAt: new Date(left),
        cleanedAt: new Date(left + 8 * MIN),
        leftVia: "STAFF",
        revenueCents: party * (180000 + Math.floor(rand() * 120000)),
      });
    }
  }
  await prisma.tableSession.createMany({ data: history });

  // A month of bookings that turned out one way or another, for Insights.
  for (let i = 0; i < 70; i++) {
    const t = pick(tables.filter((x) => x.reservable));
    const startAt = new Date(now - (1 + Math.floor(rand() * 28)) * 24 * 60 * MIN);
    startAt.setUTCMinutes(0, 0, 0);
    const outcome = rand();
    const status = outcome < 0.78 ? "COMPLETED" : outcome < 0.88 ? "CANCELLED" : "NO_SHOW";
    await prisma.reservation.create({
      data: {
        restaurantId: r.id,
        customerName: pick(NAMES),
        partySize: Math.min(t.seats, 2 + Math.floor(rand() * 4)),
        startAt,
        endAt: new Date(startAt.getTime() + 90 * MIN),
        status,
        source: pick(["ONLINE", "ONLINE", "PHONE"] as const),
        code: `MZ-${ref()}`,
        manageToken: token(),
        tableId: t.id,
        guestConfirmedAt: rand() < 0.6 ? startAt : null,
        releasedAt: status === "NO_SHOW" ? new Date(startAt.getTime() + 15 * MIN) : null,
        cancelledBy: status === "CANCELLED" ? "GUEST" : status === "NO_SHOW" ? "SYSTEM" : null,
        tables: {
          create: {
            tableId: t.id,
            restaurantId: r.id,
            blockStart: startAt,
            blockEnd: new Date(startAt.getTime() + 100 * MIN),
            active: false,
          },
        },
      },
    });
  }

  // ---- The room, as the owner would draw it in the floor plan editor ----
  const PLAN: Record<string, [number, number, number, number, string]> = {
    "F-01": [130, 70, 150, 90, "RECT"],
    "F-02": [350, 70, 150, 90, "RECT"],
    "F-03": [130, 300, 190, 90, "RECT"],
    "F-04": [390, 300, 90, 90, "SQUARE"],
    "F-05": [490, 300, 90, 90, "SQUARE"],
    "F-06": [300, 470, 230, 100, "RECT"],
    "T-01": [150, 90, 70, 70, "ROUND"],
    "T-02": [270, 90, 70, 70, "ROUND"],
    "T-07": [390, 90, 70, 70, "ROUND"],
    "T-03": [140, 290, 90, 90, "SQUARE"],
    "T-04": [240, 290, 90, 90, "SQUARE"],
    "T-05": [340, 290, 90, 90, "SQUARE"],
    "T-06": [520, 290, 90, 90, "SQUARE"],
    "R-01": [170, 110, 110, 110, "ROUND"],
  };
  for (const t of tables) {
    const p = PLAN[t.name];
    if (!p) continue;
    await prisma.table.update({
      where: { id: t.id },
      data: { planX: p[0], planY: p[1], planW: p[2], planH: p[3], shape: p[4] },
    });
  }
  const fx = (
    id: string,
    area: string,
    kind: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ) => ({
    id,
    area,
    kind,
    x,
    y,
    w,
    h,
  });
  await prisma.restaurant.update({
    where: { id: r.id },
    data: {
      floorFixtures: [
        fx("fh-door", "Family hall", "DOOR", 4, 190, 12, 70),
        fx("fh-kitchen", "Family hall", "KITCHEN", 650, 40, 180, 130),
        fx("fh-wc", "Family hall", "WASHROOM", 700, 440, 120, 100),
        fx("fh-win", "Family hall", "WINDOW", 150, 4, 340, 10),
        fx("fh-plant1", "Family hall", "PLANT", 640, 320, 36, 36),
        fx("fh-plant2", "Family hall", "PLANT", 40, 560, 36, 36),
        fx("mh-door", "Main hall", "DOOR", 4, 180, 12, 70),
        fx("mh-counter", "Main hall", "COUNTER", 560, 70, 200, 60),
        fx("mh-win", "Main hall", "WINDOW", 130, 4, 330, 10),
        fx("mh-pillar", "Main hall", "PILLAR", 460, 200, 30, 30),
        fx("mh-wall", "Main hall", "WALL", 640, 180, 12, 220),
        fx("rt-door", "Rooftop", "DOOR", 4, 60, 12, 70),
        fx("rt-plant1", "Rooftop", "PLANT", 60, 260, 40, 40),
        fx("rt-plant2", "Rooftop", "PLANT", 360, 40, 40, 40),
        fx("rt-plant3", "Rooftop", "PLANT", 380, 270, 40, 40),
      ],
    },
  });

  // ---- Tonight, live ----
  const byName = (n: string) => tables.find((t) => t.name === n)!;
  const live = async (
    name: string,
    party: number,
    seatedMinsAgo: number,
    extra: Record<string, Date | null> = {},
  ) =>
    prisma.tableSession.create({
      data: {
        restaurantId: r.id,
        tableId: byName(name).id,
        source: "WALK_IN",
        partySize: party,
        seatedAt: new Date(now - seatedMinsAgo * MIN),
        firstOrderAt: new Date(now - (seatedMinsAgo - 8) * MIN),
        ...extra,
      },
    });
  await live("T-03", 4, 55);
  await live("T-06", 3, 20);
  await live("F-01", 6, 70, { billRequestedAt: new Date(now - 6 * MIN) });
  await live("F-03", 7, 35);
  await live("T-01", 2, 48, {
    billRequestedAt: new Date(now - 10 * MIN),
    paidAt: new Date(now - 4 * MIN),
  });
  await prisma.tableSession.create({
    data: {
      restaurantId: r.id,
      tableId: byName("T-02").id,
      partySize: 2,
      seatedAt: new Date(now - 75 * MIN),
      leftAt: new Date(now - 3 * MIN),
      leftVia: "STAFF",
    },
  });

  // Bookings later this evening, on 30-minute marks.
  const half = 30 * MIN;
  const at = (minsFromNow: number) => new Date(Math.ceil((now + minsFromNow * MIN) / half) * half);
  // Regulars have a history the host should see when they walk in.
  const PHONES: Record<string, string> = {
    "Ayesha Khan": "+923091116761",
    "Bilal Ahmed": "+923031119897",
    "Hamza Qureshi": "+923071118837",
    "Zainab Raza": "+923031113023",
    "Usman Tariq": "+923051111659",
  };
  const guestFor = async (name: string, extra: Record<string, unknown> = {}) =>
    prisma.guest.create({
      data: { restaurantId: r.id, name, phone: PHONES[name], ...extra },
    });
  const past = async (
    guestId: string,
    name: string,
    daysAgo: number,
    status: "COMPLETED" | "NO_SHOW" | "CANCELLED",
    party: number,
    tableName: string,
    note?: string,
  ) => {
    const t = byName(tableName);
    const startAt = new Date(now - daysAgo * 24 * 60 * MIN);
    startAt.setUTCMinutes(0, 0, 0);
    const res = await prisma.reservation.create({
      data: {
        restaurantId: r.id,
        guestId,
        customerName: name,
        partySize: party,
        startAt,
        endAt: new Date(startAt.getTime() + 90 * MIN),
        status,
        source: "ONLINE",
        code: `MZ-${ref()}`,
        manageToken: token(),
        tableId: t.id,
        seatedAt: status === "COMPLETED" ? startAt : null,
        cancelledBy: status === "CANCELLED" ? "GUEST" : status === "NO_SHOW" ? "SYSTEM" : null,
        staffNote: note ?? null,
        tables: {
          create: {
            tableId: t.id,
            restaurantId: r.id,
            blockStart: startAt,
            blockEnd: new Date(startAt.getTime() + 100 * MIN),
            active: false,
          },
        },
      },
    });
    if (status === "COMPLETED") {
      await prisma.tableSession.create({
        data: {
          restaurantId: r.id,
          tableId: t.id,
          source: "RESERVATION",
          reservationId: res.id,
          partySize: party,
          seatedAt: startAt,
          leftAt: new Date(startAt.getTime() + 85 * MIN),
          cleanedAt: new Date(startAt.getTime() + 95 * MIN),
          leftVia: "STAFF",
          revenueCents: party * (220000 + Math.floor(rand() * 80000)),
        },
      });
    }
  };
  const todayMMDD = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date(now))
    .replace("/", "-");
  const ayesha = await guestFor("Ayesha Khan", {
    vip: true,
    tags: ["Regular", "Family"],
    birthday: todayMMDD,
    notes: "Likes the family hall by the window. Always orders the mutton karahi.",
  });
  for (const [d, n] of [
    [9, 5],
    [23, 4],
    [41, 6],
    [60, 5],
  ] as const) {
    await past(ayesha.id, "Ayesha Khan", d, "COMPLETED", n, "F-02");
  }
  const bilal = await guestFor("Bilal Ahmed");
  const hamza = await guestFor("Hamza Qureshi");
  await past(hamza.id, "Hamza Qureshi", 12, "COMPLETED", 4, "T-05");
  await past(hamza.id, "Hamza Qureshi", 30, "NO_SHOW", 4, "T-03");
  const zainab = await guestFor("Zainab Raza", { allergies: "Peanuts (severe)", tags: ["Family"] });
  await past(zainab.id, "Zainab Raza", 18, "COMPLETED", 8, "F-06");
  const usman = await guestFor("Usman Tariq", { tags: ["Corporate"] });
  await past(
    usman.id,
    "Usman Tariq",
    5,
    "COMPLETED",
    6,
    "F-01",
    "Company dinner, bill to the office",
  );
  const guestIds: Record<string, string> = {
    "Ayesha Khan": ayesha.id,
    "Bilal Ahmed": bilal.id,
    "Hamza Qureshi": hamza.id,
    "Zainab Raza": zainab.id,
    "Usman Tariq": usman.id,
  };

  const book = async (
    name: string,
    party: number,
    start: Date,
    tablesFor: string[],
    extra: Record<string, unknown> = {},
  ) => {
    const end = new Date(start.getTime() + 90 * MIN);
    await prisma.reservation.create({
      data: {
        restaurantId: r.id,
        guestId: guestIds[name],
        customerName: name,
        customerPhone: PHONES[name],
        partySize: party,
        startAt: start,
        endAt: end,
        durationMins: 90,
        source: "ONLINE",
        code: `MZ-${ref()}`,
        manageToken: token(),
        tableId: byName(tablesFor[0]).id,
        ...extra,
        tables: {
          create: tablesFor.map((n) => ({
            tableId: byName(n).id,
            restaurantId: r.id,
            blockStart: start,
            blockEnd: new Date(end.getTime() + 10 * MIN),
          })),
        },
      },
    });
  };
  await book("Ayesha Khan", 5, at(20), ["F-02"], {
    guestConfirmedAt: new Date(),
    note: "Birthday, one high chair",
    tags: ["Birthday", "High chair"],
  });
  await book("Bilal Ahmed", 2, at(-10), ["T-04"]);
  await book("Hamza Qureshi", 4, at(50), ["T-03"]); // T-03 is busy: shows as at risk
  await book("Zainab Raza", 9, at(80), ["F-06"], { childCount: 3 });
  await book("Usman Tariq", 8, at(110), ["F-04", "F-05"]);

  await prisma.waitlistEntry.createMany({
    data: [
      {
        restaurantId: r.id,
        code: `WL-${ref()}`,
        manageToken: token(),
        customerName: "Omar Farooq",
        customerPhone: "+923001112233",
        partySize: 4,
        source: "DOOR",
        quotedMins: 25,
        createdAt: new Date(now - 18 * MIN),
      },
      {
        restaurantId: r.id,
        code: `WL-${ref()}`,
        manageToken: token(),
        customerName: "Hina Butt",
        customerPhone: "+923214445566",
        partySize: 2,
        source: "REMOTE",
        quotedMins: 15,
        createdAt: new Date(now - 7 * MIN),
      },
    ],
  });

  console.log(`Seeded ${tables.length} tables, ${history.length} past meals, tonight's floor.`);
  console.log(`Guest booking:  /r/${r.slug}/reserve`);
  console.log(`Waiting list:   /r/${r.slug}/waitlist`);
  console.log(`Host screen:    /floor   (owner@mezbaan.demo or host@mezbaan.demo / ${DEMO_PASSWORD})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
