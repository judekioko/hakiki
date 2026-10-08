import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { toDateInput } from "@/lib/format";
import { categoryAccountOptions, itemOptions, taxRateOptions } from "@/lib/form-options";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { RecurringForm } from "@/components/module-forms";

export const metadata = { title: "New recurring invoice" };

export default async function NewRecurringPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const { business } = await requireBusiness();
  const { customer } = await searchParams;
  const [customers, items, taxRates, accounts] = await Promise.all([
    prisma.customer.findMany({ where: { businessId: business.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    itemOptions(business.id),
    taxRateOptions(business.id),
    categoryAccountOptions(business.id),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="New recurring invoice"
        description="Prices are entered excluding tax. Each invoice is priced fresh when it is issued, so later price and tax changes apply."
      />
      <Card>
        <CardBody>
          <RecurringForm
            customers={customers}
            items={items}
            taxRates={taxRates}
            accounts={accounts}
            chargeTax={business.vatRegistered}
            currency={business.currency}
            defaults={{
              customerId: customer,
              frequency: "MONTHLY",
              interval: 1,
              startDate: toDateInput(new Date()),
              dueDays: 14,
              autoSend: false,
            }}
          />
        </CardBody>
      </Card>
    </div>
  );
}
