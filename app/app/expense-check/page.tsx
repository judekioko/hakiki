import Link from "next/link";
import { requireBusiness } from "@/lib/business";
import { gapsByPayee, loadPayments, monthlyBreakdown, summarise } from "@/lib/coverage";
import { financialYear, parseYear, yearOptions } from "@/lib/periods";
import { formatNumber, formatPercent } from "@/lib/format";
import { businessContext } from "@/lib/form-options";
import { num } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, LinkButton, YearPicker } from "@/components/bits";
import { AutoMatchButton } from "@/components/forms";

export const metadata = { title: "Tax invoice check" };

export default async function ExpenseCheckPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { business } = await requireBusiness();
  const { year: yearParam } = await searchParams;
  const year = parseYear(yearParam, business.yearEndMonth);
  const period = financialYear(year, business.yearEndMonth);
  const taxRate = num(business.incomeTaxRate);
  const { fmt, taxInvoiceLabel } = businessContext(business);

  const rows = await loadPayments(business.id, period);
  const summary = summarise(rows, taxRate);
  const gaps = gapsByPayee(rows);
  const months = monthlyBreakdown(rows, period);
  const monthMax = Math.max(1, ...months.map((m) => m.backed + m.unbacked + m.exempt));

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${period.label} tax invoice check`}
        description={`How much of what you paid out is backed by a supplier ${taxInvoiceLabel}.`}
        action={<YearPicker years={yearOptions(business.yearEndMonth)} current={year} basePath="/app/expense-check" />}
      />

      {rows.length === 0 ? (
        <EmptyState title={`No payments recorded for ${period.label} yet`}>
          <p>Start by importing an M-Pesa or bank statement. Hakiki only looks at money paid out.</p>
          <div className="mt-4 flex justify-center gap-2">
            <LinkButton href="/app/payments/import">Import a statement</LinkButton>
            <LinkButton href="/app/payments/new" variant="secondary">
              Add a cash payment
            </LinkButton>
          </div>
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Paid out" value={fmt(summary.totalPaid)} hint={`${summary.paymentCount} payments`} />
            <StatCard
              label={`Backed by ${taxInvoiceLabel}s`}
              value={formatPercent(summary.coveragePercent)}
              hint={`${fmt(summary.backed)} of ${fmt(summary.needsInvoice)} that needs an invoice`}
            />
            <StatCard
              label="Missing invoices"
              value={fmt(summary.unbacked)}
              hint={`${summary.missingCount} payment${summary.missingCount === 1 ? "" : "s"} to chase`}
            />
            <StatCard
              label="Estimated tax at risk"
              value={fmt(summary.taxAtRisk)}
              hint={`Missing × ${taxRate}% income tax`}
            />
          </div>

          <div className="h-3 w-full overflow-hidden rounded-full bg-rose-200" aria-hidden>
            <div className="h-full bg-teal-600" style={{ width: `${Math.min(100, summary.coveragePercent)}%` }} />
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader className="flex items-center justify-between">
                <CardTitle>Biggest gaps</CardTitle>
                <AutoMatchButton />
              </CardHeader>
              <CardBody>
                {gaps.length === 0 ? (
                  <p className="text-sm text-slate-500">Every payment that needs an invoice has one. Nice work.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {gaps.map((g) => (
                      <li key={g.key} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          {g.supplierId ? (
                            <Link href={`/app/suppliers/${g.supplierId}`} className="font-medium text-slate-900 hover:underline">
                              {g.name}
                            </Link>
                          ) : (
                            <Link
                              href={`/app/payments?${new URLSearchParams({ q: g.name, status: "missing", year: String(year) })}`}
                              className="font-medium text-slate-900 hover:underline"
                            >
                              {g.name}
                            </Link>
                          )}
                          <p className="text-xs text-slate-500">
                            {g.count} payment{g.count === 1 ? "" : "s"}
                            {g.supplierId ? "" : " · not linked to a supplier yet"}
                          </p>
                        </div>
                        <span className="shrink-0 font-semibold text-rose-700">{fmt(g.unbacked)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>By month</CardTitle>
              </CardHeader>
              <CardBody className="space-y-2">
                {months.map((m) => {
                  const total = m.backed + m.unbacked + m.exempt;
                  return (
                    <div key={m.label} className="flex items-center gap-3 text-xs">
                      <span className="w-8 text-slate-500">{m.label}</span>
                      <div className="flex h-3 flex-1 overflow-hidden rounded bg-slate-100">
                        <div className="bg-teal-600" style={{ width: `${(m.backed / monthMax) * 100}%` }} />
                        <div className="bg-rose-400" style={{ width: `${(m.unbacked / monthMax) * 100}%` }} />
                        <div className="bg-slate-300" style={{ width: `${(m.exempt / monthMax) * 100}%` }} />
                      </div>
                      <span className="w-20 text-right text-slate-600">{total ? formatNumber(total, 0) : "—"}</span>
                    </div>
                  );
                })}
                <div className="flex flex-wrap gap-3 pt-2 text-xs text-slate-500">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-teal-600" />Backed</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-rose-400" />Missing</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-slate-300" />Not needed</span>
                </div>
              </CardBody>
            </Card>
          </div>
        </>
      )}

      <p className="text-xs text-slate-500">
        {business.country === "KE" ? "From the 2026 year of income, expenses claimed in a Kenyan return must be backed by an eTIMS invoice. " : ""}The estimate
        above assumes each missing invoice means the expense is disallowed at your tax rate. It is a guide, not tax
        advice.
      </p>
    </div>
  );
}
