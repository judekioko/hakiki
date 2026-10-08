import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num } from "@/lib/money";
import { toDateInput } from "@/lib/format";
import { categoryAccountOptions, itemOptions, taxRateOptions } from "@/lib/form-options";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { SupplierCreditForm } from "@/components/module-forms";

export const metadata = { title: "Record supplier credit note" };

export default async function NewSupplierCreditPage({ searchParams }: { searchParams: Promise<{ bill?: string; supplier?: string }> }) {
  const { business } = await requireBusiness();
  const params = await searchParams;
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

  // Starting from a bill copies its lines, so crediting the whole bill is a single click on Save.
  const source = params.bill
    ? await prisma.invoice.findFirst({
        where: { id: params.bill, businessId: business.id },
        include: { lines: { orderBy: { position: "asc" } } },
      })
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Record supplier credit note"
        description={
          source
            ? `Crediting bill ${source.invoiceNumber}. Remove or reduce lines to credit only part of it.`
            : "Enter it as the supplier issued it. Prices are excluding tax."
        }
      />
      <Card>
        <CardBody>
          <SupplierCreditForm
            suppliers={suppliers}
            bills={bills.map((b) => ({ id: b.id, number: b.invoiceNumber, supplierId: b.supplierId! }))}
            items={items}
            taxRates={taxRates}
            accounts={accounts}
            currency={business.currency}
            defaults={{
              supplierId: source?.supplierId ?? params.supplier,
              billId: source?.id,
              creditDate: toDateInput(new Date()),
              lines: source?.lines.map((l) => ({
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
