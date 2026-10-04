import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { loadPayments } from "@/lib/coverage";
import { formatKes } from "@/lib/format";
import { round2 } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/bits";
import { SupplierForm } from "@/components/forms";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  const { business } = await requireBusiness();
  const [suppliers, rows] = await Promise.all([
    prisma.supplier.findMany({
      where: { businessId: business.id },
      orderBy: { name: "asc" },
      include: { _count: { select: { invoices: true } } },
    }),
    loadPayments(business.id),
  ]);

  const totals = new Map<string, { paid: number; unbacked: number }>();
  for (const r of rows) {
    if (!r.supplierId) continue;
    const t = totals.get(r.supplierId) ?? { paid: 0, unbacked: 0 };
    t.paid += r.amount;
    t.unbacked += r.unbacked;
    totals.set(r.supplierId, t);
  }
  const sorted = [...suppliers].sort(
    (a, b) => (totals.get(b.id)?.unbacked ?? 0) - (totals.get(a.id)?.unbacked ?? 0)
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Suppliers" description="Who you pay, and who still owes you eTIMS invoices (all years)." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {sorted.length === 0 ? (
            <EmptyState title="No suppliers yet">
              <p>Suppliers are created when you add invoices or link payments. You can also add one here.</p>
            </EmptyState>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Supplier</Th>
                  <Th>KRA PIN</Th>
                  <Th className="text-right">Paid</Th>
                  <Th className="text-right">Missing invoices</Th>
                </Tr>
              </Thead>
              <Tbody>
                {sorted.map((s) => {
                  const t = totals.get(s.id);
                  return (
                    <Tr key={s.id}>
                      <Td>
                        <Link href={`/app/suppliers/${s.id}`} className="font-medium text-slate-900 hover:underline">
                          {s.name}
                        </Link>
                        <p className="text-xs text-slate-500">{s._count.invoices} invoices</p>
                      </Td>
                      <Td className="font-mono text-xs">{s.kraPin ?? "—"}</Td>
                      <Td className="whitespace-nowrap text-right">{formatKes(round2(t?.paid ?? 0))}</Td>
                      <Td className="whitespace-nowrap text-right">
                        {t && t.unbacked > 0 ? <span className="text-rose-700">{formatKes(round2(t.unbacked))}</span> : "—"}
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          )}
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Add a supplier</CardTitle>
          </CardHeader>
          <CardBody>
            <SupplierForm mode="create" />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
