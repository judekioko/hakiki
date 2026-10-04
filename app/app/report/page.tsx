import { requireBusiness } from "@/lib/business";
import { loadPayments, summarise } from "@/lib/coverage";
import { financialYear, parseYear, yearOptions } from "@/lib/periods";
import { formatDate, formatKes, formatPercent } from "@/lib/format";
import { num, round2 } from "@/lib/money";
import { EXEMPT_LABEL } from "@/lib/exemptions";
import { APP_NAME } from "@/lib/brand";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { LinkButton, YearPicker } from "@/components/bits";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Year-end report" };

export default async function ReportPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { business } = await requireBusiness();
  const { year: yearParam } = await searchParams;
  const year = parseYear(yearParam, business.yearEndMonth);
  const period = financialYear(year, business.yearEndMonth);
  const taxRate = num(business.incomeTaxRate);
  const rows = await loadPayments(business.id, period);
  const summary = summarise(rows, taxRate);
  const missing = rows.filter((r) => r.unbacked > 0).sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());

  const exemptByReason = new Map<string, number>();
  for (const r of rows) {
    if (r.exemptReason) exemptByReason.set(r.exemptReason, (exemptByReason.get(r.exemptReason) ?? 0) + r.amount);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <YearPicker years={yearOptions(business.yearEndMonth)} current={year} basePath="/app/report" />
        <div className="flex gap-2">
          <LinkButton href={`/app/report/export?year=${year}`} variant="secondary">
            Download CSV
          </LinkButton>
          <PrintButton />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6 print:border-0 print:p-0">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-xl font-bold">{business.name}</h1>
            <p className="text-sm text-slate-500">{business.kraPin ? `KRA PIN ${business.kraPin}` : "KRA PIN not recorded"}</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold">eTIMS expense backing report · {period.label}</p>
            <p className="text-slate-500">
              {formatDate(period.start)} – {formatDate(new Date(period.end.getTime() - 24 * 60 * 60 * 1000))}
            </p>
            <p className="text-xs text-slate-400">Prepared {formatDate(new Date())} with {APP_NAME}</p>
          </div>
        </div>

        <dl className="grid gap-4 py-5 sm:grid-cols-3">
          {[
            ["Total paid out", formatKes(summary.totalPaid)],
            ["Not needing an eTIMS invoice", formatKes(summary.exempt)],
            ["Needing an eTIMS invoice", formatKes(summary.needsInvoice)],
            ["Backed by eTIMS invoices", `${formatKes(summary.backed)} (${formatPercent(summary.coveragePercent)})`],
            ["Not backed", formatKes(summary.unbacked)],
            [`Estimated tax at ${taxRate}%`, formatKes(summary.taxAtRisk)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-slate-500">{label}</dt>
              <dd className="font-semibold">{value}</dd>
            </div>
          ))}
        </dl>

        {exemptByReason.size > 0 ? (
          <section className="border-t border-slate-200 py-5">
            <h2 className="mb-3 font-semibold">Payments marked as not needing an invoice</h2>
            <ul className="grid gap-1 text-sm sm:grid-cols-2">
              {[...exemptByReason.entries()].map(([reason, amount]) => (
                <li key={reason} className="flex justify-between gap-3">
                  <span>{EXEMPT_LABEL[reason as keyof typeof EXEMPT_LABEL]}</span>
                  <span>{formatKes(round2(amount))}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="border-t border-slate-200 pt-5">
          <h2 className="mb-3 font-semibold">Payments without an eTIMS invoice ({missing.length})</h2>
          {missing.length === 0 ? (
            <p className="text-sm text-slate-500">None. Every payment that needs an invoice is backed.</p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Date</Th>
                  <Th>Paid to</Th>
                  <Th>Reference</Th>
                  <Th className="text-right">Paid</Th>
                  <Th className="text-right">Not backed</Th>
                </Tr>
              </Thead>
              <Tbody>
                {missing.map((r) => (
                  <Tr key={r.id}>
                    <Td className="whitespace-nowrap">{formatDate(r.paidAt)}</Td>
                    <Td>{r.supplierName ?? r.counterparty}</Td>
                    <Td className="text-xs">{r.reference ?? "—"}</Td>
                    <Td className="whitespace-nowrap text-right">{formatKes(r.amount)}</Td>
                    <Td className="whitespace-nowrap text-right">{formatKes(r.unbacked)}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </section>

        <p className="mt-6 text-xs text-slate-400">
          Prepared from payment records and invoices entered by the business. Tax at risk is an estimate assuming each
          unbacked amount is disallowed. It is not a tax computation.
        </p>
      </div>
    </div>
  );
}
