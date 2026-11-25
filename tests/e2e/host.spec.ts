import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const url = process.env.E2E_DATABASE_URL;
if (
  !url ||
  !["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
  !/qa|test/i.test(new URL(url).pathname)
) {
  throw new Error("E2E_DATABASE_URL must explicitly point at a local QA/test database.");
}
const db = new PrismaClient({ datasources: { db: { url } } });
test.afterAll(() => db.$disconnect());

const PASSWORD = "LocalRestaurant2026!";
const TZ = "Asia/Karachi";

function localKey(d: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

async function seedRestaurant(page: Page) {
  const suffix = Date.now().toString(36);
  const restaurant = await db.restaurant.create({
    data: {
      name: `Host QA ${suffix}`,
      slug: `host-qa-${suffix}`,
      currency: "PKR",
      timeZone: TZ,
      bookingOpensAt: "00:00",
      bookingClosesAt: "23:30",
    },
  });
  const email = `host-${suffix}@qa.mezbaan.test`;
  await db.staffUser.create({
    data: {
      restaurantId: restaurant.id,
      name: "QA Host",
      email,
      passwordHash: bcrypt.hashSync(PASSWORD, 10),
      role: "OWNER",
    },
  });
  const layout = [
    { name: "T1", seats: 2, minParty: 1, area: "Main hall" },
    { name: "T2", seats: 4, minParty: 1, area: "Main hall" },
    { name: "T3", seats: 4, minParty: 1, area: "Main hall", joinGroup: "A" },
    { name: "T4", seats: 4, minParty: 1, area: "Main hall", joinGroup: "A" },
    { name: "F1", seats: 8, minParty: 4, area: "Family hall" },
  ];
  const tables: Record<string, string> = {};
  for (const [i, t] of layout.entries()) {
    const row = await db.table.create({
      data: { restaurantId: restaurant.id, sortOrder: i, ...t },
    });
    tables[t.name] = row.id;
  }
  const login = await page.request.post("/api/auth/login", { data: { email, password: PASSWORD } });
  expect(login.ok(), await login.text()).toBeTruthy();
  return { restaurant, tables, suffix };
}

test("the host seats a booking, a walk-in and a pushed-together group, and edits a booking", async ({
  page,
}) => {
  const { restaurant, tables } = await seedRestaurant(page);
  const restaurantId = restaurant.id;

  // A returning guest with an allergy, booked for later today by phone.
  const startAt = new Date(Date.now() + 45 * 60_000);
  const made = await page.request.post("/api/staff/reservations", {
    data: {
      customerName: "Rabia Saeed",
      customerPhone: "0301 2345678",
      partySize: 3,
      startAt: startAt.toISOString(),
      tags: ["Birthday"],
      source: "PHONE",
    },
  });
  expect(made.ok(), await made.text()).toBeTruthy();
  const { id: bookingId } = await made.json();
  const guest = await db.guest.findFirstOrThrow({
    where: { restaurantId, phone: "+923012345678" },
  });
  // A previous visit, so she is a returning guest.
  const before = new Date(Date.now() - 10 * 86_400_000);
  await db.reservation.create({
    data: {
      restaurantId,
      guestId: guest.id,
      customerName: "Rabia Saeed",
      partySize: 2,
      startAt: before,
      endAt: new Date(before.getTime() + 90 * 60_000),
      status: "COMPLETED",
      seatedAt: before,
    },
  });
  const patched = await page.request.patch(`/api/staff/guests/${guest.id}`, {
    data: { allergies: "Peanuts", vip: true },
  });
  expect(patched.ok(), await patched.text()).toBeTruthy();

  await page.goto("/floor");
  const row = page.getByRole("listitem").filter({ hasText: "Rabia Saeed" });
  await expect(row).toBeVisible();
  for (const badge of ["VIP", "Allergy", "2nd visit", "Birthday"]) {
    await expect(row.getByText(badge, { exact: true })).toBeVisible();
  }

  // Seat the booking: pick a guest, tap a green table, confirm.
  await row.getByRole("button", { name: "Seat", exact: true }).click();
  const bar = page.getByRole("region", { name: "Choose a table" });
  await expect(bar).toContainText("Rabia Saeed ×3");
  // Her planned table is pre-picked; choose T2 instead.
  const planned = await db.reservationTable.findFirstOrThrow({
    where: { reservationId: bookingId, active: true },
    include: { table: true },
  });
  if (planned.table.name !== "T2") {
    await page.locator(`[data-table="${planned.table.name}"]:visible`).first().click();
    await page.locator('[data-table="T2"]:visible').first().click();
  }
  await bar.getByRole("button", { name: /^Seat$/ }).click();
  await expect(page.getByRole("status")).toContainText("Rabia Saeed seated at T2");
  await expect
    .poll(async () => (await db.reservation.findUniqueOrThrow({ where: { id: bookingId } })).status)
    .toBe("SEATED");

  // A walk-in of two: tap 2, tap the suggested table.
  await page.getByRole("button", { name: /Walk-in/ }).click();
  const walkin = page.getByRole("dialog", { name: "Walk-in" });
  await walkin.getByRole("button", { name: "2", exact: true }).click();
  await walkin.getByRole("button", { name: /^T1/ }).click();
  await expect(page.getByRole("status")).toContainText("Seated 2 at T1");
  await expect
    .poll(() =>
      db.tableSession.count({ where: { tableId: tables.T1, leftAt: null, partySize: 2 } }),
    )
    .toBe(1);

  // A family of seven: no single free table fits, so push T3 and T4 together.
  await page.getByRole("button", { name: /Walk-in/ }).click();
  await walkin.getByRole("button", { name: "7", exact: true }).click();
  await walkin.getByRole("button", { name: /Pick on floor/ }).click();
  await page.locator('[data-table="T3"]:visible').first().click();
  await expect(bar).toContainText("4 of 7 seats");
  await page.locator('[data-table="T4"]:visible').first().click();
  await bar.getByRole("button", { name: /^Seat$/ }).click();
  await expect(page.getByRole("status")).toContainText("Seated 7 at T3 + T4");
  await expect
    .poll(() =>
      db.tableSession.count({
        // Pushed-together tables share one party, counted on the first table.
        where: { tableId: { in: [tables.T3, tables.T4] }, leftAt: null },
      }),
    )
    .toBe(2);

  // Tomorrow's phone booking, found by search and edited in place.
  const tomorrow = localKey(new Date(Date.now() + 86_400_000));
  const later = await page.request.post("/api/staff/reservations", {
    data: {
      customerName: "Kamran Javed",
      partySize: 2,
      date: tomorrow,
      time: "20:00",
      source: "PHONE",
    },
  });
  expect(later.ok(), await later.text()).toBeTruthy();
  const { id: laterId } = await later.json();
  await page.getByPlaceholder(/Find a booking/).fill("Kamran");
  await page.getByRole("button", { name: /Kamran Javed ×2/ }).click();
  const panel = page.getByRole("complementary", { name: "Booking" });
  await expect(panel).toContainText("Kamran Javed");
  await panel.getByRole("button", { name: "More guests" }).first().click();
  await panel.getByRole("button", { name: "More guests" }).first().click();
  await panel.getByRole("button", { name: "Anniversary" }).click();
  await panel.getByLabel(/Staff note/).fill("Regular's brother");
  await panel.getByRole("button", { name: /Save and re-check tables/ }).click();
  await expect(page.getByRole("status")).toContainText("Booking updated");
  await expect
    .poll(async () => {
      const r = await db.reservation.findUniqueOrThrow({ where: { id: laterId } });
      return `${r.partySize}|${r.tags.join(",")}|${r.staffNote}`;
    })
    .toBe("4|Anniversary|Regular's brother");
});

test("closed days, pacing and the phone layout", async ({ page }) => {
  const { restaurant, suffix } = await seedRestaurant(page);
  const inTwoDays = localKey(new Date(Date.now() + 2 * 86_400_000));

  // A closed day refuses staff bookings too, and says why.
  const closed = await page.request.post("/api/admin/reservations/closures", {
    data: { date: inTwoDays, reason: "Eid" },
  });
  expect(closed.ok(), await closed.text()).toBeTruthy();
  const refused = await page.request.post("/api/staff/reservations", {
    data: { customerName: "Nadia", partySize: 2, date: inTwoDays, time: "20:00", source: "PHONE" },
  });
  expect(refused.status()).toBe(400);
  expect((await refused.json()).error).toBe("Closed that day: Eid.");

  // Pacing: at most 4 guests may start in one online slot.
  const saved = await page.request.patch("/api/admin/reservations/settings", {
    data: { policy: { bookingMaxCoversPerSlot: 4, bookingLeadMins: 0 } },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  const tomorrow = localKey(new Date(Date.now() + 86_400_000));
  const book = (name: string, phone: string, party: number) =>
    page.request.post(`/api/r/${restaurant.slug}/reservations`, {
      data: {
        customerName: name,
        customerPhone: phone,
        adults: party,
        // Karachi has no daylight saving: always UTC+5.
        startAt: `${tomorrow}T20:00:00+05:00`,
      },
    });
  const first = await book("Guest One", "0302 0000001", 3);
  expect(first.ok(), await first.text()).toBeTruthy();
  const second = await book("Guest Two", "0302 0000002", 2);
  expect(second.status()).toBe(409);
  expect((await second.json()).code).toBe("PACING");

  // Every host view fits a 360px phone without sideways scrolling.
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/floor");
  await expect(page.getByRole("button", { name: /Walk-in/ })).toBeVisible();
  for (const tab of ["Floor", "Timeline", "Guests"]) {
    await page.getByRole("tab", { name: tab }).click();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${tab} view scrolls sideways (${suffix})`).toBeLessThanOrEqual(0);
  }
});

test("the room: drag a waiting family onto a table, and play the night forward", async ({
  page,
}) => {
  const { restaurant, tables } = await seedRestaurant(page);

  const queued = await page.request.post("/api/staff/waitlist", {
    data: { customerName: "Sadia Noor", partySize: 4 },
  });
  expect(queued.ok(), await queued.text()).toBeTruthy();
  const booked = await page.request.post("/api/staff/reservations", {
    data: {
      customerName: "Faisal Mir",
      partySize: 2,
      startAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      tableIds: [tables.T1],
      source: "PHONE",
    },
  });
  expect(booked.ok(), await booked.text()).toBeTruthy();

  await page.goto("/floor");
  // The room is drawn: tables with a chair per seat.
  const room = page.getByRole("group", { name: "Family hall room" });
  await expect(room).toBeVisible();
  await expect(page.locator('[data-table="F1"]')).toHaveAttribute("aria-label", /F1, 8 seats/);

  // Drag the waiting family from the list onto F1.
  await page.getByRole("tab", { name: /Waiting/ }).click();
  const grip = page.getByRole("img", { name: "Drag Sadia Noor ×4 onto a table" });
  const from = (await grip.boundingBox())!;
  const to = (await page.locator('[data-table="F1"]').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByRole("status")).toContainText("Sadia Noor seated at F1");
  await expect
    .poll(
      async () =>
        (await db.waitlistEntry.findFirstOrThrow({ where: { restaurantId: restaurant.id } }))
          .status,
    )
    .toBe("SEATED");

  // Slide an hour ahead: Faisal's booking is at T1 then, and the summary counts both parties.
  await page.getByRole("slider", { name: /later tonight/ }).fill("5");
  await expect(page.getByText(/if the night goes as booked/)).toBeVisible();
  await expect(page.locator('[data-table="T1"]')).toHaveAttribute(
    "aria-label",
    /Booked for Faisal Mir/,
  );
  await page.getByRole("button", { name: "Back to now" }).click();
  await expect(page.locator('[data-table="T1"]')).toHaveAttribute("aria-label", /Available/);
});

test("no double booking: guests racing for the last table, exactly one wins", async ({ page }) => {
  const { restaurant, tables } = await seedRestaurant(page);
  // Only the family table can take six; leave it the only option.
  for (const id of [tables.T1, tables.T2, tables.T3, tables.T4]) {
    await db.table.update({ where: { id }, data: { reservable: false } });
  }
  await db.restaurant.update({
    where: { id: restaurant.id },
    data: { bookingLeadMins: 0, onlineTablesPct: 100 },
  });
  const tomorrow = localKey(new Date(Date.now() + 86_400_000));
  // Earlier tests booked from this address too; start the per-IP limit afresh.
  await db.rateLimitHit.deleteMany({ where: { key: { startsWith: "reserve" } } });
  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      page.request.post(`/api/r/${restaurant.slug}/reservations`, {
        data: {
          customerName: `Racer ${i}`,
          customerPhone: `0303 00000${10 + i}`,
          adults: 6,
          startAt: `${tomorrow}T20:00:00+05:00`,
        },
      }),
    ),
  );
  const ok = results.filter((r) => r.ok());
  expect(ok.length).toBe(1);
  for (const r of results.filter((r) => !r.ok())) expect(r.status()).toBe(409);
  expect(
    await db.reservationTable.count({ where: { tableId: tables.F1, active: true } }),
  ).toBe(1);
});

test("a table's night by hand: seat, order, bill, paid, left, cleaned", async ({ page }) => {
  const { tables } = await seedRestaurant(page);
  const act = (data: Record<string, unknown>) =>
    page.request.post(`/api/staff/floor/tables/${tables.T2}`, { data });
  const status = async () => {
    const floor = await (await page.request.get("/api/staff/floor")).json();
    return floor.tables.find((t: { id: string }) => t.id === tables.T2).status as string;
  };

  expect((await act({ action: "SEAT", partySize: 3 })).ok()).toBeTruthy();
  expect(await status()).toBe("OCCUPIED");
  expect((await act({ action: "ORDERED" })).ok()).toBeTruthy();
  expect((await act({ action: "BILL" })).ok()).toBeTruthy();
  expect(await status()).toBe("BILL");
  expect((await act({ action: "PAID", billCents: 850000 })).ok()).toBeTruthy();
  expect((await act({ action: "LEFT" })).ok()).toBeTruthy();
  expect(await status()).toBe("CLEANING");
  expect((await act({ action: "CLEANED" })).ok()).toBeTruthy();
  expect(await status()).toBe("READY");

  const meal = await db.tableSession.findFirstOrThrow({ where: { tableId: tables.T2 } });
  expect(meal.revenueCents).toBe(850000);
  expect(meal.firstOrderAt && meal.billRequestedAt && meal.paidAt && meal.cleanedAt).toBeTruthy();
});

test("staff sign in from the login page and reach the host screen", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const restaurant = await db.restaurant.create({
    data: { name: `Login QA ${suffix}`, slug: `login-qa-${suffix}`, timeZone: TZ },
  });
  const email = `login-${suffix}@qa.mezbaan.test`;
  await db.staffUser.create({
    data: {
      restaurantId: restaurant.id,
      name: "QA Login",
      email,
      passwordHash: bcrypt.hashSync(PASSWORD, 10),
      role: "HOST",
    },
  });
  await page.goto("/floor");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText(/don.t match/)).toBeVisible();
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/floor$/);
  await expect(page.getByRole("button", { name: /Walk-in/ })).toBeVisible();
  // A host can't open the owner screens.
  await page.goto("/admin/reservations/settings");
  await expect(page).toHaveURL(/\/floor$/);
});
