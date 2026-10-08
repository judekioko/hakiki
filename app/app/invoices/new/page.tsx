import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num } from "@/lib/money";
import { toDateInput } from "@/lib/format";
import { businessContext, categoryAccountOptions, itemOptions, taxRateOptions } from "@/lib/form-options";
import { orderProgress } from "@/lib/purchase-orders";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { InvoiceForm } from "@/components/forms";

export const metadata = { title: "Add bill" };

export default async function NewBillPage({ searchParams }: { searchParams: Promise<{ po?: string }> }) {
  const { business } = await requireBusiness();
  const { po } = await searchParams;
  const ctx = businessContext(business);
  const [suppliers, categories, items, taxRates] = await Promise.all([
    prisma.supplier.findMany({ where: { businessId: business.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    categoryAccountOptions(business.id),
    itemOptions(business.id),
    taxRateOptions(business.id),
  ]);

  // Raising a bill from a purchase order: bill what has been received and not yet billed (or, if nothing has been
  // received yet, what is ordered and not yet billed).
  const order = po
    ? await prisma.purchaseOrder.findFirst({ where: { id: po, businessId: business.id, status: { in: ["ORDERED", "CLOSED"] } } })
    : null;
  let initialLines;
  if (order) {
    const { lines, progress } = await orderProgress(order.id);
    const anyReceived = progress.some((p) => p.received > 0);
    initialLines = lines
      .map((l) => {
        const p = progress.find((x) => x.id === l.id)!;
        const qty = Math.max(0, (anyReceived ? p.received : p.ordered) - p.billed);
        return {
          poLineId: l.id,
          itemId: l.itemId ?? "",
          description: l.description,
          quantity: String(Math.round(qty * 1000) / 1000),
          unitPrice: String(num(l.unitPrice)),
          taxRateId: l.taxRateId ?? "",
          accountId: l.accountId,
          qty,
        };
      })
      .filter((l) => l.qty > 0)
      .map(({ qty, ...line }) => {
        void qty;
        return line;
      });
  }
  const orderSupplier = order ? suppliers.find((s) => s.id === order.supplierId) : undefined;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title={order ? `Record the bill for ${order.number}` : "Add a supplier bill"}
        description={
          order
            ? "Quantities are filled in from what has been received and not yet billed. Check them against the supplier's invoice."
            : `Record a supplier's ${ctx.taxInvoiceLabel}. Hakiki matches it to the payment that settled it.`
        }
      />
      <Card>
        <CardBody>
          <InvoiceForm
            suppliers={suppliers}
            today={toDateInput(new Date())}
            taxIdLabel={ctx.taxIdLabel}
            taxInvoiceLabel={ctx.taxInvoiceLabel}
            categories={categories}
            items={items}
            taxRates={taxRates}
            allowLines
            purchaseOrderId={order?.id}
            initialLines={initialLines}
            defaults={
              order ? { supplierId: orderSupplier?.id, description: `Purchase order ${order.number}` } : undefined
            }
          />
        </CardBody>
      </Card>
    </div>
  );
}
