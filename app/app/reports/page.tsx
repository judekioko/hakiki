import Link from "next/link";
import { requireBusiness } from "@/lib/business";
import { businessContext } from "@/lib/form-options";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const { business } = await requireBusiness();
  const { pack, taxInvoiceLabel } = businessContext(business);
  const reports = [
    { href: "/app/reports/profit-and-loss", title: "Profit & loss", body: "Income, cost of sales and expenses for any period." },
    { href: "/app/reports/balance-sheet", title: "Balance sheet", body: "What the business owns and owes on a date." },
    { href: "/app/reports/cash-flow", title: "Cash flow", body: "Where your cash came from and where it went, by operating, investing and financing." },
    { href: "/app/reports/vat", title: `${pack.vatName} summary`, body: `Output ${pack.vatName} on sales less input ${pack.vatName} on purchases.` },
    { href: "/app/reports/aged-receivables", title: "Aged receivables", body: "Who owes you, and for how long." },
    { href: "/app/reports/aged-payables", title: "Aged payables", body: "Which suppliers you owe, and for how long." },
    { href: "/app/reports/trial-balance", title: "Trial balance", body: "Debit and credit totals for every account." },
    { href: "/app/report", title: `${taxInvoiceLabel} backing report`, body: "Payments with and without a supplier tax invoice, for your tax return." },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Reports" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((r) => (
          <Link key={r.href} href={r.href} className="rounded-lg border border-slate-200 bg-white p-5 hover:border-teal-600 hover:shadow-sm">
            <h2 className="font-semibold text-slate-900">{r.title}</h2>
            <p className="mt-1 text-sm text-slate-500">{r.body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
