import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { financialYear, parseYear, yearOptions } from "@/lib/periods";
import { num, round2 } from "@/lib/money";
import { formatDate, formatKes } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE } from "@/lib/invoice-status";
import { EmptyState, LinkButton, YearPicker } from "@/components/bits";

export const metadata = { title: "eTIMS invoices" };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { business } = await requireBusiness();
  const { year: yearParam } = await searchParams;
  const year = parseYear(yearParam, business.yearEndMonth);
  const period = financialYear(year, business.yearEndMonth);

  const invoices = await prisma.invoice.findMany({
    where: { businessId: business.id, invoiceDate: { gte: period.start, lt: period.end } },
    include: { allocations: { select: { amount: true } } },
    orderBy: { invoiceDate: "desc" },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="eTIMS invoices"
        description="Invoices your suppliers issued to you. Each one can back one or more payments."
        action={<LinkButton href="/app/invoices/new">Add invoice</LinkButton>}
      />
      <YearPicker years={yearOptions(business.yearEndMonth)} current={year} basePath="/app/invoices" />

      {invoices.length === 0 ? (
        <EmptyState title={`No invoices dated in ${period.label}`}>
          <p>Add invoices as suppliers send them. A phone photo of the paper invoice is fine.</p>
        </EmptyState>
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>Date</Th>
              <Th>Supplier</Th>
              <Th>Invoice no.</Th>
              <Th className="text-right">Total</Th>
              <Th className="text-right">Matched to payments</Th>
              <Th>Status</Th>
            </Tr>
          </Thead>
          <Tbody>
            {invoices.map((inv) => {
              const total = num(inv.totalAmount);
              const matched = round2(inv.allocations.reduce((s, a) => s + num(a.amount), 0));
              return (
                <Tr key={inv.id}>
                  <Td className="whitespace-nowrap">{formatDate(inv.invoiceDate)}</Td>
                  <Td>
                    <Link href={`/app/invoices/${inv.id}`} className="font-medium text-slate-900 hover:underline">
                      {inv.supplierName}
                    </Link>
                  </Td>
                  <Td className="font-mono text-xs">{inv.invoiceNumber}</Td>
                  <Td className="whitespace-nowrap text-right">{formatKes(total)}</Td>
                  <Td className="whitespace-nowrap text-right">
                    {matched === 0 ? <span className="text-amber-700">Not matched</span> : formatKes(matched)}
                  </Td>
                  <Td>
                    <Badge tone={INVOICE_STATUS_TONE[inv.status]}>{INVOICE_STATUS_LABEL[inv.status]}</Badge>
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      )}
    </div>
  );
}
