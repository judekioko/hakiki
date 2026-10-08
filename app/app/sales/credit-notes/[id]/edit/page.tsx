import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num } from "@/lib/money";
import { toDateInput } from "@/lib/format";
import { categoryAccountOptions, itemOptions, taxRateOptions } from "@/lib/form-options";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { CreditNoteForm } from "@/components/module-forms";

export const metadata = { title: "Edit credit note" };

export default async function EditCreditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { business } = await requireBusiness();
  const { id } = await params;
  const note = await prisma.creditNote.findFirst({
    where: { id, businessId: business.id },
    include: { lines: { orderBy: { position: "asc" } } },
  });
  if (!note) notFound();
  if (note.status !== "DRAFT") redirect(`/app/sales/credit-notes/${id}`);

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

  return (
    <div className="space-y-6">
      <PageHeader title={`Edit ${note.number}`} />
      <Card>
        <CardBody>
          <CreditNoteForm
            creditNoteId={note.id}
            customers={customers}
            invoices={invoices}
            items={items}
            taxRates={taxRates}
            accounts={accounts}
            chargeTax={business.vatRegistered}
            currency={business.currency}
            defaults={{
              customerId: note.customerId,
              invoiceId: note.invoiceId ?? undefined,
              issueDate: toDateInput(note.issueDate),
              reason: note.reason,
              restock: note.restock,
              lines: note.lines.map((l) => ({
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
