import Link from "next/link";
import {
  CalendarCheck,
  Clock4,
  LayoutGrid,
  ShieldCheck,
  Smartphone,
  UsersRound,
} from "lucide-react";
import { Wordmark } from "@/components/Brand";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const FEATURES = [
  {
    icon: LayoutGrid,
    title: "The live room, drawn",
    body: "Every table on one screen: free, seated, bill, cleaning, reserved. Drag a party onto a table to seat them.",
  },
  {
    icon: ShieldCheck,
    title: "Double booking is impossible",
    body: "Postgres itself refuses two overlapping bookings on one table. Two guests clicking at once: exactly one wins.",
  },
  {
    icon: Clock4,
    title: "It learns your turn times",
    body: "From your own meals, it estimates when each table frees up, so quotes at the door are honest.",
  },
  {
    icon: UsersRound,
    title: "A waiting list from the phone",
    body: "Guests scan a QR at the door, wait in their car, and get a WhatsApp when their table is ready.",
  },
  {
    icon: CalendarCheck,
    title: "No-shows go back on sale",
    body: "A reminder before, a grace period after, then the table is released to walk-ins automatically.",
  },
  {
    icon: Smartphone,
    title: "No app, no account",
    body: "Guests book with a WhatsApp number. Their link is the key to confirm, run late or cancel.",
  },
];

export default async function Home() {
  const demo = await prisma.restaurant
    .findFirst({ orderBy: { createdAt: "asc" }, select: { slug: true, name: true } })
    .catch(() => null);
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
        <Wordmark className="text-xl text-gray-12" />
        <Link
          href="/login"
          className="flex min-h-10 items-center rounded-xl bg-brand-9 px-4 text-sm font-bold text-white hover:bg-brand-10"
        >
          Staff sign in
        </Link>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16">
        <section className="grid items-center gap-8 py-10 md:grid-cols-[1.2fr_1fr] md:py-16">
          <div>
            <p className="text-xs font-bold tracking-[0.18em] text-tangerine-11 uppercase">
              The smart host stand
            </p>
            <h1 className="mt-2 text-4xl leading-tight font-black tracking-tight text-gray-12 md:text-5xl">
              Fill every table. Turn away nobody you could have seated.
            </h1>
            <p className="mt-4 max-w-xl text-lg text-gray-11">
              Restaurants in Pakistan still run Friday nights on a register and a pen. Mezbaan
              gives the person at the door a live view of the room, bookings that can&apos;t
              clash, a waiting list on the guest&apos;s phone, and no-shows that release
              themselves.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/login"
                className="flex min-h-12 items-center rounded-xl bg-tangerine-9 px-5 font-bold text-on-tangerine hover:bg-tangerine-10"
              >
                Open the host screen
              </Link>
              {demo && (
                <Link
                  href={`/r/${demo.slug}/reserve`}
                  className="flex min-h-12 items-center rounded-xl px-5 font-semibold text-gray-12 ring-1 ring-gray-7 hover:bg-gray-3"
                >
                  Book a table as a guest
                </Link>
              )}
            </div>
            {demo && (
              <p className="mt-3 text-sm text-gray-11">
                Demo restaurant: {demo.name}. Try the{" "}
                <Link
                  href={`/r/${demo.slug}/waitlist`}
                  className="font-semibold text-brand-11 underline"
                >
                  waiting list
                </Link>{" "}
                too.
              </p>
            )}
          </div>
          <div aria-hidden="true" className="rounded-3xl bg-panel p-5 shadow-sm ring-1 ring-gray-5">
            <div className="grid grid-cols-4 gap-2">
              {[
                ["T-01", "bg-success-3 ring-success-7", "Free"],
                ["T-02", "bg-tangerine-3 ring-tangerine-7", "42m"],
                ["T-03", "bg-tangerine-9 ring-tangerine-10 text-on-tangerine", "Bill"],
                ["T-04", "bg-brand-3 ring-brand-7", "8:30"],
                ["F-01", "bg-tangerine-3 ring-tangerine-7", "1h 05"],
                ["F-02", "bg-gray-4 ring-gray-7", "Clean"],
                ["F-03", "bg-success-3 ring-success-9", "Ready"],
                ["R-01", "bg-brand-3 ring-brand-7", "9:00"],
              ].map(([name, tone, line]) => (
                <div key={name} className={`rounded-xl p-2 text-center ring-1 ${tone}`}>
                  <p className="text-sm font-black">{name}</p>
                  <p className="text-xs font-semibold opacity-80">{line}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-xl bg-gray-2 p-3 text-sm ring-1 ring-gray-5">
              <p className="font-semibold">Next free for 6: F-01 at ~9:10 pm</p>
              <p className="text-gray-11">3 parties waiting · quote 25 to 35 min</p>
            </div>
          </div>
        </section>

        <section aria-labelledby="features" className="py-6">
          <h2 id="features" className="sr-only">
            What it does
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl bg-panel p-5 ring-1 ring-gray-5">
                <f.icon className="size-6 text-tangerine-11" />
                <h3 className="mt-3 font-bold text-gray-12">{f.title}</h3>
                <p className="mt-1 text-sm text-gray-11">{f.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-gray-5 py-6 text-center text-sm text-gray-11">
        Mezbaan · built for Capital Youth Expo 2026, Innovation Sprint (Open Innovation track)
      </footer>
    </div>
  );
}
