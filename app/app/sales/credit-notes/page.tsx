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

export const metadata = { title: "Credit notes" };

export default async function CreditNotesPage() {
  const { business } = await requireBusiness();
  const { fmt } = businessContext(business);
  const notes = await prisma.creditNote.findMany({
    where: { businessId: business.id },
    include: { customer: { select: { name: true } }, allocations: { select: { amount: true } } },
    orderBy: [{ issueDate: "desc" }, { number: "desc" }],
  });
  const rows = notes.map((n) => ({ n, state: creditState(n) }));
  const unused = rows.reduce((s, r) => s + r.state.unused, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Credit notes"
        description={`${fmt(unused)} of credit not yet applied to an invoice`}
        action={<LinkButton href="/app/sales/credit-notes/new">New credit note</LinkButton>}
      />
      {rows.length === 0 ? (
        <EmptyState title="No credit notes yet">
          <p>Issue a credit note when a customer returns goods or you correct an invoice. It reverses the sale and the tax in your books.</p>
        </EmptyState>
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>Number</Th>
              <Th>Customer</Th>
              <Th>Date</Th>
              <Th>Reason</Th>
              <Th className="text-right">Total</Th>
              <Th className="text-right">Unused</Th>
              <Th>Status</Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map(({ n, state }) => (
              <Tr key={n.id}>
                <Td>
                  <Link href={`/app/sales/credit-notes/${n.id}`} className="font-medium text-slate-900 hover:underline">
                    {n.number}
                  </Link>
                </Td>
                <Td>{n.customer.name}</Td>
                <Td className="whitespace-nowrap">{formatDate(n.issueDate)}</Td>
                <Td>{n.isFx ? "Exchange difference" : (n.reason ?? "—")}</Td>
                <Td className="whitespace-nowrap text-right">{fmt(state.total)}</Td>
                <Td className="whitespace-nowrap text-right">{n.status === "ISSUED" ? fmt(state.unused) : "—"}</Td>
                <Td>
                  <Badge tone={state.display.tone}>{state.display.label}</Badge>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </div>
  );
}
