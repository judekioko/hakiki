import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { toDateInput } from "@/lib/format";
import { businessContext, categoryAccountOptions, itemOptions, taxRateOptions } from "@/lib/form-options";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { InvoiceForm } from "@/components/forms";

export const metadata = { title: "Add bill" };

export default async function NewBillPage() {
  const { business } = await requireBusiness();
  const ctx = businessContext(business);
  const [suppliers, categories, items, taxRates] = await Promise.all([
    prisma.supplier.findMany({ where: { businessId: business.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    categoryAccountOptions(business.id),
    itemOptions(business.id),
    taxRateOptions(business.id),
  ]);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Add a supplier bill"
        description={`Record a supplier's ${ctx.taxInvoiceLabel}. Hakiki matches it to the payment that settled it.`}
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
          />
        </CardBody>
      </Card>
    </div>
  );
}
