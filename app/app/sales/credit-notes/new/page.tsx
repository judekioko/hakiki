import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num } from "@/lib/money";
import { toDateInput } from "@/lib/format";
import { categoryAccountOptions, itemOptions, taxRateOptions } from "@/lib/form-options";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { CreditNoteForm } from "@/components/module-forms";

export const metadata = { title: "New credit note" };

export default async function NewCreditNotePage({ searchParams }: { searchParams: Promise<{ invoice?: string; customer?: string }> }) {
  const { business } = await requireBusiness();
  const params = await searchParams;
  const [customers, invoices, items, taxRates, accounts] = await Promise.all([
    prisma.customer.findMany({ where: { businessId: business.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.salesInvoice.findMany({
      where: { businessId: business.id, status: "SENT" },
      orderBy: { issueDate: "desc" },
      select: { id: true, number: true, customerId: true },
    }),
    itemOptions(business.id),
    taxRateOptions(business.id),
    categoryAccountOptions(business.id),
  ]);

  // Starting from an invoice copies its lines, so crediting the whole invoice is a single click on Save.
  const source = params.invoice
    ? await prisma.salesInvoice.findFirst({
        where: { id: params.invoice, businessId: business.id, status: "SENT" },
        include: { lines: { orderBy: { position: "asc" } } },
      })
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="New credit note"
        description={source ? `Crediting invoice ${source.number}. Remove or reduce lines to credit only part of it.` : "Prices are entered excluding tax."}
      />
      <Card>
        <CardBody>
          <CreditNoteForm
            customers={customers}
            invoices={invoices}
            items={items}
            taxRates={taxRates}
            accounts={accounts}
            chargeTax={business.vatRegistered}
            currency={business.currency}
            defaults={{
              customerId: source?.customerId ?? params.customer,
              invoiceId: source?.id,
              issueDate: toDateInput(new Date()),
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
