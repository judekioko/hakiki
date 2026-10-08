import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num } from "@/lib/money";
import { toDateInput } from "@/lib/format";
import { categoryAccountOptions, itemOptions, taxRateOptions } from "@/lib/form-options";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { PurchaseOrderForm } from "@/components/module-forms";

export const metadata = { title: "Edit purchase order" };

export default async function EditPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { business } = await requireBusiness();
  const { id } = await params;
  const order = await prisma.purchaseOrder.findFirst({
    where: { id, businessId: business.id },
    include: { lines: { orderBy: { position: "asc" } }, _count: { select: { receipts: true, bills: true } } },
  });
  if (!order) notFound();
  if (order.status === "CLOSED" || order.status === "CANCELLED" || order._count.receipts + order._count.bills > 0) {
    redirect(`/app/purchase-orders/${id}`);
  }

  const [suppliers, items, taxRates, accounts] = await Promise.all([
    prisma.supplier.findMany({ where: { businessId: business.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    itemOptions(business.id),
    taxRateOptions(business.id),
    categoryAccountOptions(business.id),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title={`Edit ${order.number}`} />
      <Card>
        <CardBody>
          <PurchaseOrderForm
            orderId={order.id}
            status={order.status}
            suppliers={suppliers}
            items={items}
            taxRates={taxRates}
            accounts={accounts}
            currency={business.currency}
            defaults={{
              supplierId: order.supplierId,
              orderDate: toDateInput(order.orderDate),
              expectedDate: order.expectedDate ? toDateInput(order.expectedDate) : undefined,
              reference: order.reference,
              notes: order.notes,
              lines: order.lines.map((l) => ({
                itemId: l.itemId ?? "",
                description: l.description,
                quantity: String(num(l.quantity)),
                unitPrice: String(num(l.unitPrice)),
                taxRateId: l.taxRateId ?? "",
                accountId: l.accountId,
              })),
            }}
          />
        </CardBody>
      </Card>
    </div>
  );
}
