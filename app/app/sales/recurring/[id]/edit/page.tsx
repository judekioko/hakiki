import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num } from "@/lib/money";
import { toDateInput } from "@/lib/format";
import { categoryAccountOptions, itemOptions, taxRateOptions } from "@/lib/form-options";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { RecurringForm } from "@/components/module-forms";

export const metadata = { title: "Edit recurring invoice" };

export default async function EditRecurringPage({ params }: { params: Promise<{ id: string }> }) {
  const { business } = await requireBusiness();
  const { id } = await params;
  const rec = await prisma.recurringInvoice.findFirst({
    where: { id, businessId: business.id },
    include: { lines: { orderBy: { position: "asc" } }, customer: { select: { name: true } } },
  });
  if (!rec) notFound();

  const [customers, items, taxRates, accounts] = await Promise.all([
    prisma.customer.findMany({ where: { businessId: business.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    itemOptions(business.id),
    taxRateOptions(business.id),
    categoryAccountOptions(business.id),
  ]);

  // Quarterly is stored as every 3 months.
  const quarterly = rec.frequency === "MONTHLY" && rec.interval % 3 === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Edit recurring invoice for ${rec.customer.name}`}
        description="Changing the first invoice date or how often it repeats restarts the schedule from the new start date."
      />
      <Card>
        <CardBody>
          <RecurringForm
            recurringId={rec.id}
            customers={customers}
            items={items}
            taxRates={taxRates}
            accounts={accounts}
            chargeTax={business.vatRegistered}
            currency={business.currency}
            defaults={{
              customerId: rec.customerId,
              frequency: quarterly ? "QUARTERLY" : rec.frequency,
              interval: quarterly ? rec.interval / 3 : rec.interval,
              startDate: toDateInput(rec.startDate),
              endDate: rec.endDate ? toDateInput(rec.endDate) : undefined,
              dueDays: rec.dueDays,
              autoSend: rec.autoSend,
              reference: rec.reference,
              notes: rec.notes,
              lines: rec.lines.map((l) => ({
                itemId: l.itemId ?? "",
                description: l.description,
                quantity: String(num(l.quantity)),
                unitPrice: String(num(l.unitPrice)),
                taxRateId: l.taxRateId ?? "",
                accountId: l.accountId ?? "",
              })),
            }}
          />
        </CardBody>
      </Card>
    </div>
  );
}
