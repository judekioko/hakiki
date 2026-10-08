import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { businessContext } from "@/lib/form-options";
import { formatDate } from "@/lib/format";
import { creditState } from "@/lib/credit-notes";
import { PageHeader } from "@/components/page-header";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState, LinkButton } from "@/components/bits";

export const metadata = { title: "Supplier credit notes" };

export default async function SupplierCreditsPage() {
  const { business } = await requireBusiness();
  const { fmt } = businessContext(business);
  const credits = await prisma.supplierCredit.findMany({
    where: { businessId: business.id },
    include: { supplier: { select: { name: true } }, allocations: { select: { amount: true } } },
    orderBy: [{ creditDate: "desc" }, { number: "desc" }],
  });
  const rows = credits.map((c) => ({ c, state: creditState(c) }));
  const unused = rows.reduce((s, r) => s + r.state.unused, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Supplier credit notes"
        description={`${fmt(unused)} of supplier credit not yet taken off a bill`}
        action={<LinkButton href="/app/supplier-credits/new">Record credit note</LinkButton>}
      />
      {rows.length === 0 ? (
        <EmptyState title="No supplier credit notes yet">
          <p>Record a credit note when a supplier takes goods back or corrects a bill. It reduces what you owe and the tax you claimed.</p>
        </EmptyState>
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>Credit note no.</Th>
              <Th>Supplier</Th>
              <Th>Date</Th>
              <Th>Reason</Th>
              <Th className="text-right">Total</Th>
              <Th className="text-right">Unused</Th>
              <Th>Status</Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map(({ c, state }) => (
              <Tr key={c.id}>
                <Td>
                  <Link href={`/app/supplier-credits/${c.id}`} className="font-medium text-slate-900 hover:underline">
                    {c.number}
                  </Link>
                </Td>
                <Td>{c.supplier.name}</Td>
                <Td className="whitespace-nowrap">{formatDate(c.creditDate)}</Td>
                <Td>{c.isFx ? "Exchange difference" : (c.reason ?? "—")}</Td>
                <Td className="whitespace-nowrap text-right">{fmt(state.total)}</Td>
                <Td className="whitespace-nowrap text-right">{c.status === "ISSUED" ? fmt(state.unused) : "—"}</Td>
                <Td>
                  <Badge tone={state.display.tone}>{c.status === "ISSUED" && state.unused > 0.01 ? "Recorded" : state.display.label}</Badge>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </div>
  );
}
