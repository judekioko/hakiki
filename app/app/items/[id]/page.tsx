import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num } from "@/lib/money";
import { formatDate, formatNumber, toDateInput } from "@/lib/format";
import { businessContext, categoryAccountOptions, taxRateOptions } from "@/lib/form-options";
import { stockLevels } from "@/lib/inventory";
import { archiveItem } from "@/lib/actions/items";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { SubmitButton } from "@/components/forms";
import { ItemForm, StockAdjustForm } from "@/components/module-forms";

export const metadata = { title: "Item" };

const SOURCE_LABEL: Record<string, string> = {
  BILL: "Purchase",
  SALES_INVOICE: "Sale",
  STOCK_ADJUSTMENT: "Adjustment",
};

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { business } = await requireBusiness();
  const { id } = await params;
  const item = await prisma.item.findFirst({
    where: { id, businessId: business.id },
    include: { movements: { orderBy: { date: "desc" }, take: 50 } },
  });
  if (!item) notFound();
  const { fmt } = businessContext(business);
  const [taxRates, accounts, stock] = await Promise.all([
    taxRateOptions(business.id),
    categoryAccountOptions(business.id),
    item.kind === "INVENTORY" ? stockLevels(business.id) : Promise.resolve([]),
  ]);
  const level = stock.find((s) => s.id === item.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title={item.name}
        description={
          level
            ? `${formatNumber(level.onHand, level.onHand % 1 ? 2 : 0)} ${item.unit ?? "units"} on hand · worth ${fmt(level.value)}`
            : "Not tracked in stock"
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {item.kind === "INVENTORY" ? (
            <Card>
              <CardHeader>
                <CardTitle>Stock movements</CardTitle>
              </CardHeader>
              <CardBody>
                {item.movements.length === 0 ? (
                  <p className="text-sm text-slate-500">No movements yet. Add opening stock, or record a bill with this item.</p>
                ) : (
                  <Table>
                    <Thead>
                      <Tr>
                        <Th>Date</Th>
                        <Th>Type</Th>
                        <Th>Note</Th>
                        <Th className="text-right">Qty</Th>
                        <Th className="text-right">Unit cost</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {item.movements.map((m) => (
                        <Tr key={m.id}>
                          <Td className="whitespace-nowrap">{formatDate(m.date)}</Td>
                          <Td>{SOURCE_LABEL[m.sourceType] ?? m.sourceType}</Td>
                          <Td className="text-xs text-slate-500">{m.note}</Td>
                          <Td className={`text-right ${num(m.quantity) < 0 ? "text-rose-700" : "text-teal-700"}`}>
                            {num(m.quantity) > 0 ? "+" : ""}
                            {formatNumber(num(m.quantity), num(m.quantity) % 1 ? 2 : 0)}
                          </Td>
                          <Td className="text-right">{fmt(num(m.unitCost))}</Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                )}
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardBody>
              <ItemForm
                mode="edit"
                itemId={item.id}
                taxRates={taxRates}
                accounts={accounts}
                defaults={{
                  name: item.name,
                  sku: item.sku,
                  kind: item.kind,
                  unit: item.unit,
                  salePrice: num(item.salePrice),
                  purchasePrice: num(item.purchasePrice),
                  taxRateId: item.taxRateId,
                  incomeAccountId: item.incomeAccountId,
                  expenseAccountId: item.expenseAccountId,
                  reorderLevel: item.reorderLevel === null ? null : num(item.reorderLevel),
                }}
              />
            </CardBody>
          </Card>
        </div>
        <div className="space-y-6">
          {item.kind === "INVENTORY" ? (
            <Card>
              <CardHeader>
                <CardTitle>Adjust stock</CardTitle>
              </CardHeader>
              <CardBody>
                <StockAdjustForm itemId={item.id} today={toDateInput(new Date())} hasStock={item.movements.length > 0} />
              </CardBody>
            </Card>
          ) : null}
          <form action={archiveItem}>
            <input type="hidden" name="itemId" value={item.id} />
            <input type="hidden" name="archived" value={item.isArchived ? "false" : "true"} />
            <SubmitButton variant="ghost" size="sm">
              {item.isArchived ? "Restore item" : "Archive item"}
            </SubmitButton>
          </form>
        </div>
      </div>
    </div>
  );
}
