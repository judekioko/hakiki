import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num } from "@/lib/money";
import { toDateInput } from "@/lib/format";
import { categoryAccountOptions, itemOptions, taxRateOptions } from "@/lib/form-options";
import { latestRates } from "@/lib/fx";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { SalesInvoiceForm } from "@/components/module-forms";

export const metadata = { title: "Edit invoice" };

export default async function EditSalesInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { business } = await requireBusiness();
  const { id } = await params;
  const invoice = await prisma.salesInvoice.findFirst({
    where: { id, businessId: business.id },
    include: { lines: { orderBy: { position: "asc" } } },
  });
  if (!invoice) notFound();
  if (invoice.status === "VOID" || invoice.isOpening) redirect(`/app/sales/invoices/${id}`);

  const [customers, items, taxRates, accounts, rates] = await Promise.all([
    prisma.customer.findMany({ where: { businessId: business.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    itemOptions(business.id),
    taxRateOptions(business.id),
    categoryAccountOptions(business.id),
    latestRates(business.id),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title={`Edit ${invoice.number}`} description="Saving rebuilds the invoice's entries in your books." />
      <Card>
        <CardBody>
          <SalesInvoiceForm
            invoiceId={invoice.id}
            status={invoice.status}
            customers={customers}
            items={items}
            taxRates={taxRates}
            accounts={accounts}
            chargeTax={business.vatRegistered}
            currency={business.currency}
            rates={rates}
            defaults={{
              currency: invoice.currency,
              exchangeRate: invoice.exchangeRate ? num(invoice.exchangeRate) : null,
              customerId: invoice.customerId,
              issueDate: toDateInput(invoice.issueDate),
              dueDate: toDateInput(invoice.dueDate),
              reference: invoice.reference,
              notes: invoice.notes,
              lines: invoice.lines.map((l) => ({
                itemId: l.itemId ?? "",
                description: l.description,
                quantity: String(num(l.quantity)),
                unitPrice: String(num(invoice.currency && l.foreignUnitPrice !== null ? l.foreignUnitPrice : l.unitPrice)),
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
