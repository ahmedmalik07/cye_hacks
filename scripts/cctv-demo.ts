/**
 * Pretends to be the on-site camera box, for demos and for trying the CCTV
 * feature without hardware. It posts occupancy readings to the app exactly as
 * a real edge box would (counts only, never images).
 *
 *   EDGE_URL=http://localhost:3000 EDGE_RESTAURANT_ID=... EDGE_KEY=... \
 *     npx tsx scripts/cctv-demo.ts T-01:empty F-03:3
 *
 * Each argument is TABLE:empty or TABLE:<people>. Get the restaurant id and
 * key under Admin, Tables & bookings, Hours & rules, Camera. Readings stay
 * fresh for two minutes, so re-run it (or add --loop) during a demo.
 */
const url = process.env.EDGE_URL ?? "http://localhost:3000";
const id = process.env.EDGE_RESTAURANT_ID;
const key = process.env.EDGE_KEY;
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const loop = process.argv.includes("--loop");
if (!id || !key || args.length === 0) {
  console.error("Set EDGE_RESTAURANT_ID and EDGE_KEY, and pass TABLE:empty or TABLE:<people> arguments.");
  process.exit(1);
}
const readings = args.map((a) => {
  const [table, state] = a.split(":");
  const people = state === "empty" ? 0 : Number(state);
  return { table, occupied: people > 0, people, confidence: 0.92 };
});

async function send() {
  const res = await fetch(`${url}/api/edge/occupancy`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "x-restaurant-id": id! },
    body: JSON.stringify({ readings }),
  });
  console.log(new Date().toLocaleTimeString(), res.status, await res.text());
}
await send();
while (loop) {
  await new Promise((r) => setTimeout(r, 60_000));
  await send();
}
export {};
