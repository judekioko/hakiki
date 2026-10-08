import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { businessContext } from "@/lib/form-options";
import { formatDate } from "@/lib/format";
import { num } from "@/lib/money";
import { QUOTE_DISPLAY, quoteStatus } from "@/lib/quotations";
import { PageHeader } from "@/components/page-header";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState, FilterTabs, LinkButton } from "@/components/bits";

export const metadata = { title: "Quotations" };

const FILTERS = [
  { value: "open", label: "Open", match: (s: string) => s === "DRAFT" || s === "SENT" || s === "ACCEPTED" },
  { value: "INVOICED", label: "Invoiced", match: (s: string) => s === "INVOICED" },
  { value: "closed", label: "Declined / expired", match: (s: string) => s === "DECLINED" || s === "EXPIRED" },
  { value: "all", label: "All", match: () => true },
];

export default async function QuotationsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { business } = await requireBusiness();
  const { fmt } = businessContext(business);
  const { status: statusParam } = await searchParams;
  const filter = FILTERS.find((f) => f.value === statusParam) ?? FILTERS[0];

  const quotes = await prisma.quotation.findMany({
    where: { businessId: business.id },
    include: { customer: { select: { name: true } } },
    orderBy: [{ issueDate: "desc" }, { number: "desc" }],
  });
  const rows = quotes.map((q) => ({ q, status: quoteStatus(q) }));
  const shown = rows.filter((r) => filter.match(r.status));
  const pipeline = rows.filter((r) => r.status === "SENT" || r.status === "ACCEPTED").reduce((s, r) => s + num(r.q.total), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Quotations"
        description={`${fmt(pipeline)} quoted and waiting for a decision`}
        action={<LinkButton href="/app/sales/quotations/new">New quotation</LinkButton>}
      />
      <FilterTabs
        basePath="/app/sales/quotations"
        current={filter.value}
        options={FILTERS.map((f) => ({ value: f.value, label: f.label, count: rows.filter((r) => f.match(r.status)).length }))}
      />
      {shown.length === 0 ? (
        <EmptyState title={quotes.length === 0 ? "No quotations yet" : "Nothing in this view"}>
          {quotes.length === 0 ? <p>Send a customer a quotation first. When they accept, turn it into an invoice in one click.</p> : null}
        </EmptyState>
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>Number</Th>
              <Th>Customer</Th>
              <Th>Date</Th>
              <Th>Valid until</Th>
              <Th className="text-right">Total</Th>
              <Th>Status</Th>
            </Tr>
          </Thead>
          <Tbody>
            {shown.map(({ q, status }) => (
              <Tr key={q.id}>
                <Td>
                  <Link href={`/app/sales/quotations/${q.id}`} className="font-medium text-slate-900 hover:underline">
                    {q.number}
                  </Link>
                </Td>
                <Td>{q.customer.name}</Td>
                <Td className="whitespace-nowrap">{formatDate(q.issueDate)}</Td>
                <Td className="whitespace-nowrap">{formatDate(q.expiryDate)}</Td>
                <Td className="whitespace-nowrap text-right">{fmt(num(q.total))}</Td>
                <Td>
                  <Badge tone={QUOTE_DISPLAY[status].tone}>{QUOTE_DISPLAY[status].label}</Badge>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </div>
  );
}
