import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num } from "@/lib/money";
import { toDateInput } from "@/lib/format";
import { categoryAccountOptions, itemOptions, taxRateOptions } from "@/lib/form-options";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { QuotationForm } from "@/components/module-forms";

export const metadata = { title: "Edit quotation" };

export default async function EditQuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const { business } = await requireBusiness();
  const { id } = await params;
  const quote = await prisma.quotation.findFirst({
    where: { id, businessId: business.id },
    include: { lines: { orderBy: { position: "asc" } } },
  });
  if (!quote) notFound();
  if (quote.status === "INVOICED") redirect(`/app/sales/quotations/${id}`);

  const [customers, items, taxRates, accounts] = await Promise.all([
    prisma.customer.findMany({ where: { businessId: business.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    itemOptions(business.id),
    taxRateOptions(business.id),
    categoryAccountOptions(business.id),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title={`Edit ${quote.number}`} />
      <Card>
        <CardBody>
          <QuotationForm
            quotationId={quote.id}
            status={quote.status}
            customers={customers}
            items={items}
            taxRates={taxRates}
            accounts={accounts}
            chargeTax={business.vatRegistered}
            currency={business.currency}
            defaults={{
              customerId: quote.customerId,
              issueDate: toDateInput(quote.issueDate),
              expiryDate: toDateInput(quote.expiryDate),
              reference: quote.reference,
              notes: quote.notes,
              lines: quote.lines.map((l) => ({
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
