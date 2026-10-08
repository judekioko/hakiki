import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { toDateInput } from "@/lib/format";
import { categoryAccountOptions, itemOptions, taxRateOptions } from "@/lib/form-options";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { PurchaseOrderForm } from "@/components/module-forms";

export const metadata = { title: "New purchase order" };

export default async function NewPurchaseOrderPage({ searchParams }: { searchParams: Promise<{ supplier?: string }> }) {
  const { business } = await requireBusiness();
  const { supplier } = await searchParams;
  const [suppliers, items, taxRates, accounts] = await Promise.all([
    prisma.supplier.findMany({ where: { businessId: business.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    itemOptions(business.id),
    taxRateOptions(business.id),
    categoryAccountOptions(business.id),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="New purchase order"
        description="Prices are entered excluding tax. Nothing is posted to your books until the supplier bill is recorded."
      />
      <Card>
        <CardBody>
          <PurchaseOrderForm
            suppliers={suppliers}
            items={items}
            taxRates={taxRates}
            accounts={accounts}
            currency={business.currency}
            defaults={{ supplierId: supplier, orderDate: toDateInput(new Date()) }}
          />
        </CardBody>
      </Card>
    </div>
  );
}
