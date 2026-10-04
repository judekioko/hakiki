import Link from "next/link";
import { logoutAction } from "@/lib/actions/auth";
import { switchBusiness } from "@/lib/actions/businesses";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";

export type NavItem = { href: string; label: string };

const navItems: NavItem[] = [
  { href: "/app", label: "Overview" },
  { href: "/app/payments", label: "Payments" },
  { href: "/app/invoices", label: "eTIMS invoices" },
  { href: "/app/suppliers", label: "Suppliers" },
  { href: "/app/report", label: "Year-end report" },
  { href: "/app/businesses", label: "Businesses" },
  { href: "/app/settings", label: "Settings" },
];

export function DashboardShell({
  userName,
  businesses,
  activeBusinessId,
  children,
}: {
  userName: string;
  businesses: { id: string; name: string }[];
  activeBusinessId: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex print:hidden">
        <div className="border-b border-slate-200 px-5 py-4">
          <Logo />
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6 print:hidden">
          <div className="md:hidden">
            <Logo compact />
          </div>
          {businesses.length > 1 ? (
            <form action={switchBusiness} className="flex items-center gap-2">
              <label htmlFor="businessId" className="sr-only">
                Business
              </label>
              <select
                id="businessId"
                name="businessId"
                defaultValue={activeBusinessId ?? undefined}
                className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-800"
              >
                {businesses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="secondary" size="sm">
                Switch
              </Button>
            </form>
          ) : (
            <p className="text-sm font-semibold text-slate-800">{businesses[0]?.name}</p>
          )}
          <div className="ml-auto flex items-center gap-3">
            <p className="hidden text-sm text-slate-600 sm:block">{userName}</p>
            <form action={logoutAction}>
              <Button type="submit" variant="secondary" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 md:hidden print:hidden">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <main className="flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
