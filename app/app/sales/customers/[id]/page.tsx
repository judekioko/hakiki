import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { businessContext } from "@/lib/form-options";
import { INVOICE_DISPLAY, invoiceState } from "@/lib/sales";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/bits";
import { CustomerForm } from "@/components/module-forms";

export const metadata = { title: "Customer" };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { business } = await requireBusiness();
  const { id } = await params;
  const customer = await prisma.customer.findFirst({
    where: { id, businessId: business.id },
    include: {
      salesInvoices: { include: { allocations: { select: { amount: true } }, creditAllocations: { select: { amount: true } } }, orderBy: { issueDate: "desc" } },
      receipts: { orderBy: { receivedAt: "desc" }, take: 20 },
    },
  });
  if (!customer) notFound();
  const { fmt, taxIdLabel } = businessContext(business);
  const states = customer.salesInvoices.map((inv) => ({ inv, state: invoiceState(inv) }));
  const owed = states.filter((s) => s.state.status !== "DRAFT" && s.state.status !== "VOID").reduce((s, x) => s + Math.max(0, x.state.balance), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={customer.name}
        description={`Owes you ${fmt(owed)}`}
        action={
          <div className="flex gap-2">
            <LinkButton href={`/app/sales/customers/${customer.id}/statement`} variant="secondary">
              Statement
            </LinkButton>
            <LinkButton href={`/app/sales/invoices/new?customer=${customer.id}`}>New invoice</LinkButton>
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Invoices</CardTitle>
            </CardHeader>
            <CardBody>
              {states.length === 0 ? (
                <p className="text-sm text-slate-500">No invoices yet.</p>
              ) : (
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Number</Th>
                      <Th>Date</Th>
                      <Th className="text-right">Total</Th>
                      <Th className="text-right">Balance</Th>
                      <Th>Status</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {states.map(({ inv, state }) => (
                      <Tr key={inv.id}>
                        <Td>
                          <Link href={`/app/sales/invoices/${inv.id}`} className="font-medium hover:underline">
                            {inv.number}
                          </Link>
                        </Td>
                        <Td>{formatDate(inv.issueDate)}</Td>
                        <Td className="text-right">{fmt(state.total)}</Td>
                        <Td className="text-right">{fmt(state.balance)}</Td>
                        <Td>
                          <Badge tone={INVOICE_DISPLAY[state.status].tone}>{INVOICE_DISPLAY[state.status].label}</Badge>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Money received</CardTitle>
            </CardHeader>
            <CardBody>
              {customer.receipts.length === 0 ? (
                <p className="text-sm text-slate-500">None yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {customer.receipts.map((r) => (
                    <li key={r.id} className="flex justify-between py-2">
                      <Link href={`/app/sales/receipts/${r.id}`} className="hover:underline">
                        {formatDate(r.receivedAt)} {r.reference ? `· ${r.reference}` : ""}
                      </Link>
                      <span>{fmt(num(r.amount))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <CustomerForm
              mode="edit"
              customerId={customer.id}
              taxIdLabel={taxIdLabel}
              defaults={{ name: customer.name, taxId: customer.taxId, phone: customer.phone, email: customer.email, address: customer.address }}
            />
            {customer.aliases.length > 0 ? (
              <p className="text-xs text-slate-500">Names on statements: {customer.aliases.join(" · ")}</p>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
