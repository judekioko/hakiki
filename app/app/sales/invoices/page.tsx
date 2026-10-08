import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { runDueRecurring } from "@/lib/recurring";
import { businessContext } from "@/lib/form-options";
import { formatDate } from "@/lib/format";
import { INVOICE_DISPLAY, invoiceState, type InvoiceDisplayStatus } from "@/lib/sales";
import { PageHeader } from "@/components/page-header";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState, FilterTabs, LinkButton } from "@/components/bits";

export const metadata = { title: "Invoices" };

const FILTERS: { value: string; label: string; match: (s: InvoiceDisplayStatus) => boolean }[] = [
  { value: "open", label: "Unpaid", match: (s) => s === "UNPAID" || s === "PARTIAL" || s === "OVERDUE" },
  { value: "OVERDUE", label: "Overdue", match: (s) => s === "OVERDUE" },
  { value: "DRAFT", label: "Drafts", match: (s) => s === "DRAFT" },
  { value: "PAID", label: "Paid", match: (s) => s === "PAID" },
  { value: "all", label: "All", match: () => true },
];

export default async function SalesInvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { business } = await requireBusiness();
  // Recurring invoices that have fallen due are issued when someone opens the app.
  await runDueRecurring(business.id);
  const { fmt } = businessContext(business);
  const { status: statusParam } = await searchParams;
  const filter = FILTERS.find((f) => f.value === statusParam) ?? FILTERS[4];

  const invoices = await prisma.salesInvoice.findMany({
    where: { businessId: business.id },
    include: { customer: { select: { name: true } }, allocations: { select: { amount: true } }, creditAllocations: { select: { amount: true } } },
    orderBy: [{ issueDate: "desc" }, { number: "desc" }],
  });
  const rows = invoices.map((inv) => ({ inv, state: invoiceState(inv) }));
  const shown = rows.filter((r) => filter.match(r.state.status));
  const outstanding = rows.filter((r) => r.state.status !== "DRAFT" && r.state.status !== "VOID").reduce((s, r) => s + Math.max(0, r.state.balance), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Invoices"
        description={`${fmt(outstanding)} outstanding from customers`}
        action={<LinkButton href="/app/sales/invoices/new">New invoice</LinkButton>}
      />
      <FilterTabs
        basePath="/app/sales/invoices"
        current={filter.value}
        options={FILTERS.map((f) => ({ value: f.value, label: f.label, count: rows.filter((r) => f.match(r.state.status)).length }))}
      />
      {shown.length === 0 ? (
        <EmptyState title={invoices.length === 0 ? "No invoices yet" : "Nothing in this view"}>
          {invoices.length === 0 ? <p>Create your first invoice. Payments that arrive by mobile money or bank are matched to it automatically.</p> : null}
        </EmptyState>
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>Number</Th>
              <Th>Customer</Th>
              <Th>Date</Th>
              <Th>Due</Th>
              <Th className="text-right">Total</Th>
              <Th className="text-right">Balance</Th>
              <Th>Status</Th>
            </Tr>
          </Thead>
          <Tbody>
            {shown.map(({ inv, state }) => (
              <Tr key={inv.id}>
                <Td>
                  <Link href={`/app/sales/invoices/${inv.id}`} className="font-medium text-slate-900 hover:underline">
                    {inv.number}
                  </Link>
                </Td>
                <Td>{inv.customer.name}</Td>
                <Td className="whitespace-nowrap">{formatDate(inv.issueDate)}</Td>
                <Td className="whitespace-nowrap">{formatDate(inv.dueDate)}</Td>
                <Td className="whitespace-nowrap text-right">{fmt(state.total)}</Td>
                <Td className="whitespace-nowrap text-right">{state.status === "VOID" ? "—" : fmt(state.balance)}</Td>
                <Td>
                  <Badge tone={INVOICE_DISPLAY[state.status].tone}>{INVOICE_DISPLAY[state.status].label}</Badge>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </div>
  );
}
