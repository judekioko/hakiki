import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { businessContext } from "@/lib/form-options";
import { invoiceState } from "@/lib/sales";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/bits";
import { CustomerForm } from "@/components/module-forms";

export const metadata = { title: "Customers" };

export default async function CustomersPage() {
  const { business } = await requireBusiness();
  const { fmt, taxIdLabel } = businessContext(business);
  const customers = await prisma.customer.findMany({
    where: { businessId: business.id },
    orderBy: { name: "asc" },
    include: { salesInvoices: { include: { allocations: { select: { amount: true } } } } },
  });
  const rows = customers.map((c) => {
    const states = c.salesInvoices.map((i) => invoiceState(i)).filter((s) => s.status !== "DRAFT" && s.status !== "VOID");
    return {
      c,
      owed: states.reduce((s, x) => s + Math.max(0, x.balance), 0),
      overdue: states.filter((s) => s.status === "OVERDUE").reduce((s, x) => s + x.balance, 0),
      invoiced: states.reduce((s, x) => s + x.total, 0),
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Customers" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {rows.length === 0 ? (
            <EmptyState title="No customers yet">
              <p>Add one here, or type a new name when creating an invoice.</p>
            </EmptyState>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Customer</Th>
                  <Th className="text-right">Invoiced</Th>
                  <Th className="text-right">Owes you</Th>
                  <Th className="text-right">Overdue</Th>
                </Tr>
              </Thead>
              <Tbody>
                {rows.map(({ c, owed, overdue, invoiced }) => (
                  <Tr key={c.id}>
                    <Td>
                      <Link href={`/app/sales/customers/${c.id}`} className="font-medium text-slate-900 hover:underline">
                        {c.name}
                      </Link>
                      <p className="text-xs text-slate-500">{[c.phone, c.email].filter(Boolean).join(" · ")}</p>
                    </Td>
                    <Td className="whitespace-nowrap text-right">{fmt(invoiced)}</Td>
                    <Td className="whitespace-nowrap text-right">{owed > 0 ? fmt(owed) : "—"}</Td>
                    <Td className="whitespace-nowrap text-right">{overdue > 0 ? <span className="text-rose-700">{fmt(overdue)}</span> : "—"}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Add a customer</CardTitle>
          </CardHeader>
          <CardBody>
            <CustomerForm mode="create" taxIdLabel={taxIdLabel} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
