import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { getStaffSession, ADMIN_ROLES } from "@/lib/auth";
import { Wordmark } from "@/components/Brand";

export const dynamic = "force-dynamic";

/** Owner and manager screens. Hosts go straight to the host screen. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  if (!ADMIN_ROLES.includes(session.user.role)) redirect("/floor");
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-gray-5 bg-panel">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link href="/" aria-label="Home">
            <Wordmark className="text-lg text-gray-12" />
          </Link>
          <span className="min-w-0 flex-1 truncate text-sm text-gray-11">
            {session.restaurant.name} · {session.user.name}
          </span>
          <form action="/api/auth/logout" method="post">
            <button
              className="flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-gray-11 hover:bg-gray-3"
              aria-label="Sign out"
            >
              <LogOut className="size-4" /> <span className="hidden sm:inline">Sign out</span>
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
