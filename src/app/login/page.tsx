import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/auth";
import { Wordmark } from "@/components/Brand";
import LoginForm from "./LoginForm";

export const metadata: Metadata = { title: "Sign in · Mezbaan" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getStaffSession()) redirect("/floor");
  const demo = process.env.SHOW_DEMO_LOGIN !== "0";
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <Wordmark className="text-2xl text-gray-12" />
        <div className="rounded-2xl bg-panel p-6 shadow-sm ring-1 ring-gray-5">
          <h1 className="mb-1 text-xl font-bold">Staff sign in</h1>
          <p className="mb-5 text-sm text-gray-11">The host screen, bookings and guest book.</p>
          <LoginForm demo={demo} />
        </div>
      </div>
    </main>
  );
}
