import QRCode from "qrcode";
import { requireStaffPage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { appOrigin } from "@/lib/reservations/messages";

export const dynamic = "force-dynamic";

/** One printable QR per table, plus the one for the waiting list at the door. */
export default async function QrPage() {
  const session = await requireStaffPage({ admin: true });
  const tables = await prisma.table.findMany({
    where: { restaurantId: session.restaurant.id, active: true },
    select: { id: true, name: true, code: true, area: true },
  });
  const byName = new Intl.Collator(undefined, { numeric: true });
  tables.sort((a, b) => byName.compare(a.area, b.area) || byName.compare(a.name, b.name));
  const origin = appOrigin();
  const make = (url: string) => QRCode.toDataURL(url, { margin: 1, width: 360, errorCorrectionLevel: "M" });
  const cards = await Promise.all([
    ...tables.map(async (t) => ({
      key: t.id,
      title: t.name,
      sub: `Scan to order · ${t.area}`,
      url: `${origin}/t/${t.code}`,
      img: await make(`${origin}/t/${t.code}`),
    })),
  ]);
  const waitUrl = `${origin}/r/${session.restaurant.slug}/waitlist`;
  cards.unshift({
    key: "waitlist",
    title: "Waiting list",
    sub: "Scan to join the queue",
    url: waitUrl,
    img: await make(waitUrl),
  });
  return (
    <section className="space-y-4">
      <div className="rounded-2xl bg-panel p-5 ring-1 ring-gray-5 print:hidden">
        <h2 className="text-lg font-bold">QR codes</h2>
        <p className="text-sm text-gray-11">
          Print this page (Ctrl+P) and put each code on its table. The code is private to the
          table: it only lets a guest order for that table. Links use {origin}; set{" "}
          <code>NEXT_PUBLIC_APP_URL</code> to your live address before printing.
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3">
        {cards.map((c) => (
          <li key={c.key} className="break-inside-avoid rounded-2xl bg-white p-3 text-center ring-1 ring-gray-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.img} alt={`QR code for ${c.title}`} className="mx-auto w-full max-w-[180px]" />
            <p className="mt-1 text-xl font-black text-[#13296e]">{c.title}</p>
            <p className="text-xs text-gray-11">{c.sub}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
