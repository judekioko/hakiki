import Link from "next/link";
import { requireBusiness } from "@/lib/business";
import { loadPayments, type PaymentRow } from "@/lib/coverage";
import { financialYear, parseYear, yearOptions } from "@/lib/periods";
import { formatDate, formatKes } from "@/lib/format";
import { EXEMPT_REASONS } from "@/lib/exemptions";
import { bulkMarkExempt } from "@/lib/actions/payments";
import { PageHeader } from "@/components/page-header";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EmptyState, FilterTabs, LinkButton, StatusBadge, YearPicker } from "@/components/bits";
import { AutoMatchButton, SubmitButton } from "@/components/forms";

export const metadata = { title: "Payments" };

const FILTERS: { value: string; label: string; test: (r: PaymentRow) => boolean }[] = [
  { value: "missing", label: "Needs invoice", test: (r) => r.status === "MISSING" || r.status === "PARTIAL" },
  { value: "backed", label: "Backed", test: (r) => r.status === "BACKED" },
  { value: "exempt", label: "Not needed", test: (r) => r.status === "EXEMPT" },
  { value: "all", label: "All", test: () => true },
];

const SOURCE_LABEL = { MPESA: "M-Pesa", BANK: "Bank", CASH: "Cash", OTHER: "Other" } as const;

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; status?: string; q?: string }>;
}) {
  const { business } = await requireBusiness();
  const params = await searchParams;
  const year = parseYear(params.year, business.yearEndMonth);
  const period = financialYear(year, business.yearEndMonth);
  const status = FILTERS.some((f) => f.value === params.status) ? params.status! : "missing";
  const q = params.q?.trim() ?? "";

  const all = await loadPayments(business.id, period);
  const searched = q
    ? all.filter((r) =>
        [r.counterparty, r.reference, r.details, r.supplierName].some((v) => v?.toLowerCase().includes(q.toLowerCase()))
      )
    : all;
  const filter = FILTERS.find((f) => f.value === status)!;
  const rows = searched.filter(filter.test);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Payments"
        description={`Money paid out in ${period.label}. Each one needs an eTIMS invoice unless it is marked as not needed.`}
        action={
          <div className="flex flex-wrap items-start gap-2">
            <AutoMatchButton />
            <LinkButton href="/app/payments/new" variant="secondary">
              Add payment
            </LinkButton>
            <LinkButton href="/app/payments/import">Import statement</LinkButton>
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterTabs
          basePath="/app/payments"
          current={status}
          extra={{ year: String(year), q }}
          options={FILTERS.map((f) => ({ value: f.value, label: f.label, count: searched.filter(f.test).length }))}
        />
        <div className="flex items-center gap-3">
          <form className="flex gap-2" action="/app/payments">
            <input type="hidden" name="year" value={year} />
            <input type="hidden" name="status" value={status} />
            <Input name="q" defaultValue={q} placeholder="Search name or reference" className="w-56" />
          </form>
          <YearPicker years={yearOptions(business.yearEndMonth)} current={year} basePath="/app/payments" extra={{ status, q }} />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState title={all.length === 0 ? "No payments yet" : "Nothing here"}>
          {all.length === 0 ? (
            <p>
              <Link href="/app/payments/import" className="text-teal-700 underline">
                Import an M-Pesa or bank statement
              </Link>{" "}
              to get started.
            </p>
          ) : status === "missing" ? (
            <p>Every payment in this view is backed or marked as not needing an invoice.</p>
          ) : null}
        </EmptyState>
      ) : (
        <form action={bulkMarkExempt} className="space-y-3">
          <Table>
            <Thead>
              <Tr>
                <Th className="w-8">
                  <span className="sr-only">Select</span>
                </Th>
                <Th>Date</Th>
                <Th>Paid to</Th>
                <Th className="text-right">Amount</Th>
                <Th className="text-right">Unbacked</Th>
                <Th>Status</Th>
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    {r.status !== "EXEMPT" ? (
                      <input type="checkbox" name="paymentIds" value={r.id} aria-label={`Select ${r.counterparty}`} />
                    ) : null}
                  </Td>
                  <Td className="whitespace-nowrap">{formatDate(r.paidAt)}</Td>
                  <Td>
                    <Link href={`/app/payments/${r.id}`} className="font-medium text-slate-900 hover:underline">
                      {r.supplierName ?? r.counterparty}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {SOURCE_LABEL[r.source]}
                      {r.reference ? ` · ${r.reference}` : ""}
                      {r.supplierName && r.supplierName.toUpperCase() !== r.counterparty.toUpperCase()
                        ? ` · ${r.counterparty}`
                        : ""}
                    </p>
                  </Td>
                  <Td className="whitespace-nowrap text-right">{formatKes(r.amount)}</Td>
                  <Td className="whitespace-nowrap text-right">
                    {r.unbacked > 0 ? <span className="text-rose-700">{formatKes(r.unbacked)}</span> : "—"}
                  </Td>
                  <Td className="whitespace-nowrap">
                    <StatusBadge status={r.status} />
                    {r.invoiceRequestedAt && r.unbacked > 0 ? (
                      <p className="mt-0.5 text-[11px] text-slate-500">Requested {formatDate(r.invoiceRequestedAt)}</p>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
          {status !== "exempt" ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-slate-600">Mark selected as not needing an invoice:</span>
                <Select name="exemptReason" className="w-auto" defaultValue="INTEREST_BANK_CHARGES">
                  {EXEMPT_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </Select>
                <SubmitButton variant="secondary" size="sm">
                  Apply
                </SubmitButton>
              </div>
            </div>
          ) : null}
        </form>
      )}
    </div>
  );
}
