import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { toDateInput } from "@/lib/format";
import { categoryAccountOptions, itemOptions, taxRateOptions } from "@/lib/form-options";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { SalesInvoiceForm } from "@/components/module-forms";

export const metadata = { title: "New invoice" };

export default async function NewSalesInvoicePage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const { business } = await requireBusiness();
  const { customer } = await searchParams;
  const [customers, items, taxRates, accounts] = await Promise.all([
    prisma.customer.findMany({ where: { businessId: business.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    itemOptions(business.id),
    taxRateOptions(business.id),
    categoryAccountOptions(business.id),
  ]);
  const today = new Date();
  const due = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);

  return (
    <div className="space-y-6">
      <PageHeader title="New invoice" description="Prices are entered excluding tax." />
      <Card>
        <CardBody>
          <SalesInvoiceForm
            customers={customers}
            items={items}
            taxRates={taxRates}
            accounts={accounts}
            chargeTax={business.vatRegistered}
            currency={business.currency}
            defaults={{ customerId: customer, issueDate: toDateInput(today), dueDate: toDateInput(due) }}
          />
        </CardBody>
      </Card>
    </div>
  );
}
