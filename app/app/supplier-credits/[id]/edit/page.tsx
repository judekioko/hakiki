import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num } from "@/lib/money";
import { toDateInput } from "@/lib/format";
import { categoryAccountOptions, itemOptions, taxRateOptions } from "@/lib/form-options";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { SupplierCreditForm } from "@/components/module-forms";

export const metadata = { title: "Edit supplier credit note" };

export default async function EditSupplierCreditPage({ params }: { params: Promise<{ id: string }> }) {
  const { business } = await requireBusiness();
  const { id } = await params;
  const credit = await prisma.supplierCredit.findFirst({
    where: { id, businessId: business.id },
    include: { lines: { orderBy: { position: "asc" } } },
  });
  if (!credit) notFound();
  if (credit.status !== "DRAFT") redirect(`/app/supplier-credits/${id}`);

  const [suppliers, bills, items, taxRates, accounts] = await Promise.all([
    prisma.supplier.findMany({ where: { businessId: business.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.invoice.findMany({
      where: { businessId: business.id, supplierId: { not: null } },
      orderBy: { invoiceDate: "desc" },
      select: { id: true, invoiceNumber: true, supplierId: true },
    }),
    itemOptions(business.id),
    taxRateOptions(business.id),
    categoryAccountOptions(business.id),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title={`Edit ${credit.number}`} />
      <Card>
        <CardBody>
          <SupplierCreditForm
            creditId={credit.id}
            suppliers={suppliers}
            bills={bills.map((b) => ({ id: b.id, number: b.invoiceNumber, supplierId: b.supplierId! }))}
            items={items}
            taxRates={taxRates}
            accounts={accounts}
            currency={business.currency}
            defaults={{
              supplierId: credit.supplierId,
              billId: credit.billId ?? undefined,
              number: credit.number,
              creditDate: toDateInput(credit.creditDate),
              reason: credit.reason,
              returnStock: credit.returnStock,
              lines: credit.lines.map((l) => ({
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
