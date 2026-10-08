import Link from "next/link";
import { logoutAction } from "@/lib/actions/auth";
import { switchBusiness } from "@/lib/actions/businesses";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";

export type NavItem = { href: string; label: string };

const navSections: { title: string | null; items: NavItem[] }[] = [
  { title: null, items: [{ href: "/app", label: "Dashboard" }] },
  {
    title: "Sales",
    items: [
      { href: "/app/sales/quotations", label: "Quotations" },
      { href: "/app/sales/invoices", label: "Invoices" },
      { href: "/app/sales/recurring", label: "Recurring invoices" },
      { href: "/app/sales/credit-notes", label: "Credit notes" },
      { href: "/app/sales/reminders", label: "Payment reminders" },
      { href: "/app/sales/receipts", label: "Money received" },
      { href: "/app/sales/customers", label: "Customers" },
    ],
  },
  {
    title: "Purchases",
    items: [
      { href: "/app/purchase-orders", label: "Purchase orders" },
      { href: "/app/invoices", label: "Bills" },
      { href: "/app/supplier-credits", label: "Supplier credit notes" },
      { href: "/app/payments", label: "Money paid out" },
      { href: "/app/suppliers", label: "Suppliers" },
      { href: "/app/expense-check", label: "Tax invoice check" },
    ],
  },
  { title: "Stock", items: [{ href: "/app/items", label: "Products & services" }] },
  {
    title: "Payroll",
    items: [
      { href: "/app/payroll", label: "Pay runs" },
      { href: "/app/payroll/employees", label: "Employees" },
    ],
  },
  {
    title: "Accounting",
    items: [
      { href: "/app/reports", label: "Reports" },
      { href: "/app/accounts", label: "Chart of accounts" },
      { href: "/app/opening-balances", label: "Opening balances" },
      { href: "/app/import", label: "Import from CSV" },
      { href: "/app/journal", label: "Journal" },
      { href: "/app/transfers", label: "Transfers & exchange" },
      { href: "/app/revaluation", label: "Revalue currencies" },
      { href: "/app/reconcile", label: "Bank reconciliation" },
      { href: "/app/close-books", label: "Close the books" },
      { href: "/app/audit", label: "Audit trail" },
      { href: "/app/payments/import", label: "Import statement" },
    ],
  },
  {
    title: null,
    items: [
      { href: "/app/businesses", label: "Businesses" },
      { href: "/app/settings", label: "Settings" },
    ],
  },
];
const navItems = navSections.flatMap((s) => s.items);

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
        <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
          {navSections.map((section, i) => (
            <div key={section.title ?? i}>
              {section.title ? (
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{section.title}</p>
              ) : null}
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="block rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
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
