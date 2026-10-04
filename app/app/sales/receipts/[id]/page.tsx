import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num, round2 } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { businessContext, categoryAccountOptions } from "@/lib/form-options";
import { openSalesInvoices } from "@/lib/receipt-match";
import { nameSimilarity } from "@/lib/matching";
import {
  applyReceiptToInvoice,
  deleteReceipt,
  removeReceiptAllocation,
  setReceiptCategory,
  setReceiptCustomer,
} from "@/lib/actions/sales";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { AccountSelect } from "@/components/form-kit";
import { SubmitButton } from "@/components/forms";

export const metadata = { title: "Money received" };

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { business } = await requireBusiness();
  const { id } = await params;
  const receipt = await prisma.receipt.findFirst({
    where: { id, businessId: business.id },
    include: { customer: true, allocations: { include: { invoice: true } } },
  });
  if (!receipt) notFound();
  const { fmt } = businessContext(business);

  const amount = num(receipt.amount);
  const applied = round2(receipt.allocations.reduce((s, a) => s + num(a.amount), 0));
  const open = round2(amount - applied);

  const [invoices, customers, categories, moneyAccount] = await Promise.all([
    open > 0 ? openSalesInvoices(business.id) : Promise.resolve([]),
    prisma.customer.findMany({ where: { businessId: business.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    categoryAccountOptions(business.id),
    receipt.moneyAccountId ? prisma.account.findUnique({ where: { id: receipt.moneyAccountId } }) : null,
  ]);
  // Best candidates first: same customer, then same amount, then similar name.
  const candidates = invoices
    .filter((inv) => !receipt.allocations.some((a) => a.invoiceId === inv.id))
    .map((inv) => ({
      inv,
      score:
        (receipt.customerId === inv.customer.id ? 3 : 0) +
        (Math.abs(inv.open - open) <= 1 ? 2 : 0) +
        nameSimilarity(receipt.payer, inv.customer.name),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${fmt(amount)} from ${receipt.customer?.name ?? receipt.payer}`}
        description={`Into ${moneyAccount?.name ?? receipt.source} on ${formatDate(receipt.receivedAt)}${receipt.reference ? ` · ${receipt.reference}` : ""}`}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {receipt.details ? (
            <p className="text-sm text-slate-600">
              <span className="text-slate-400">Statement details: </span>
              {receipt.details}
            </p>
          ) : null}

          {receipt.allocations.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Applied to invoices</CardTitle>
              </CardHeader>
              <CardBody>
                <ul className="divide-y divide-slate-100 text-sm">
                  {receipt.allocations.map((a) => (
                    <li key={a.id} className="flex items-center justify-between py-2">
                      <Link href={`/app/sales/invoices/${a.invoiceId}`} className="font-medium hover:underline">
                        {a.invoice.number}
                      </Link>
                      <span className="flex items-center gap-2">
                        {fmt(num(a.amount))}
                        <form action={removeReceiptAllocation}>
                          <input type="hidden" name="allocationId" value={a.id} />
                          <SubmitButton variant="ghost" size="sm" pendingText="...">
                            Unlink
                          </SubmitButton>
                        </form>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}

          {open > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Apply {fmt(open)} to an invoice</CardTitle>
              </CardHeader>
              <CardBody>
                {candidates.length === 0 ? (
                  <p className="text-sm text-slate-500">No unpaid invoices. Categorise this money instead, or create the invoice first.</p>
                ) : (
                  <ul className="divide-y divide-slate-100 text-sm">
                    {candidates.map(({ inv }) => (
                      <li key={inv.id} className="flex items-center justify-between gap-3 py-2">
                        <div>
                          <Link href={`/app/sales/invoices/${inv.id}`} className="font-medium hover:underline">
                            {inv.number} · {inv.customer.name}
                          </Link>
                          <p className="text-xs text-slate-500">
                            Due {formatDate(inv.dueDate)} · {fmt(inv.open)} open
                          </p>
                        </div>
                        <form action={applyReceiptToInvoice}>
                          <input type="hidden" name="receiptId" value={receipt.id} />
                          <input type="hidden" name="invoiceId" value={inv.id} />
                          <SubmitButton size="sm">Apply</SubmitButton>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              {receipt.customer ? (
                <Link href={`/app/sales/customers/${receipt.customer.id}`} className="font-medium hover:underline">
                  {receipt.customer.name}
                </Link>
              ) : (
                <p className="text-slate-600">Not linked to a customer.</p>
              )}
              {customers.length > 0 ? (
                <form action={setReceiptCustomer} className="flex gap-2">
                  <input type="hidden" name="receiptId" value={receipt.id} />
                  <Select name="customerId" aria-label="Customer" defaultValue={receipt.customerId ?? undefined}>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                  <SubmitButton variant="secondary" size="sm">
                    Link
                  </SubmitButton>
                </form>
              ) : null}
              <p className="text-xs text-slate-500">Future money from “{receipt.payer}” will be linked to this customer automatically.</p>
            </CardBody>
          </Card>

          {open > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Not for an invoice?</CardTitle>
              </CardHeader>
              <CardBody className="space-y-2 text-sm">
                <p className="text-slate-600">Book the unapplied amount to an account, e.g. other income, a loan received or owner&apos;s capital.</p>
                <form action={setReceiptCategory} className="space-y-2">
                  <input type="hidden" name="receiptId" value={receipt.id} />
                  <AccountSelect
                    name="categoryAccountId"
                    accounts={categories}
                    defaultValue={receipt.categoryAccountId ?? ""}
                    placeholder={receipt.customerId ? "Customer credit (default)" : "Unallocated (default)"}
                  />
                  <SubmitButton variant="secondary" size="sm">
                    Save
                  </SubmitButton>
                </form>
              </CardBody>
            </Card>
          ) : null}

          <form action={deleteReceipt}>
            <input type="hidden" name="receiptId" value={receipt.id} />
            <SubmitButton variant="ghost" size="sm" pendingText="Deleting...">
              Delete this record
            </SubmitButton>
          </form>
        </div>
      </div>
    </div>
  );
}
