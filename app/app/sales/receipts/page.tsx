import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num, round2 } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { businessContext } from "@/lib/form-options";
import { PageHeader } from "@/components/page-header";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState, FilterTabs, LinkButton } from "@/components/bits";

export const metadata = { title: "Money received" };

export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { business } = await requireBusiness();
  const { fmt } = businessContext(business);
  const { filter = "all" } = await searchParams;

  const receipts = await prisma.receipt.findMany({
    where: { businessId: business.id },
    include: { customer: { select: { name: true } }, allocations: { select: { amount: true } } },
    orderBy: { receivedAt: "desc" },
    take: 500,
  });
  const rows = receipts.map((r) => {
    const applied = round2(r.allocations.reduce((s, a) => s + num(a.amount), 0));
    const matched = applied > 0 || r.categoryAccountId !== null || r.customerId !== null;
    return { r, applied, matched };
  });
  const shown = filter === "unmatched" ? rows.filter((x) => !x.matched) : rows;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Money received"
        description="Customer payments and other money coming in, from imported statements or entered by hand."
        action={
          <div className="flex gap-2">
            <LinkButton href="/app/payments/import" variant="secondary">
              Import statement
            </LinkButton>
            <LinkButton href="/app/sales/receipts/new">Record money received</LinkButton>
          </div>
        }
      />
      <FilterTabs
        basePath="/app/sales/receipts"
        current={filter === "unmatched" ? "unmatched" : "all"}
        options={[
          { value: "unmatched", label: "Needs matching", count: rows.filter((x) => !x.matched).length },
          { value: "all", label: "All", count: rows.length },
        ]}
      />
      {shown.length === 0 ? (
        <EmptyState title="Nothing here yet">
          <p>Import a statement with money received, or record a payment against an invoice.</p>
        </EmptyState>
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>Date</Th>
              <Th>From</Th>
              <Th>Reference</Th>
              <Th className="text-right">Amount</Th>
              <Th>Status</Th>
            </Tr>
          </Thead>
          <Tbody>
            {shown.map(({ r, applied, matched }) => (
              <Tr key={r.id}>
                <Td className="whitespace-nowrap">{formatDate(r.receivedAt)}</Td>
                <Td>
                  <Link href={`/app/sales/receipts/${r.id}`} className="font-medium text-slate-900 hover:underline">
                    {r.customer?.name ?? r.payer}
                  </Link>
                </Td>
                <Td className="text-xs text-slate-500">{r.reference ?? "—"}</Td>
                <Td className="whitespace-nowrap text-right">{fmt(num(r.amount))}</Td>
                <Td>
                  {applied >= num(r.amount) - 0.01 ? (
                    <Badge tone="teal">Applied to invoices</Badge>
                  ) : applied > 0 ? (
                    <Badge tone="amber">Partly applied</Badge>
                  ) : r.categoryAccountId ? (
                    <Badge>Categorised</Badge>
                  ) : matched ? (
                    <Badge tone="amber">Customer credit</Badge>
                  ) : (
                    <Badge tone="rose">Needs matching</Badge>
                  )}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </div>
  );
}
