import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num } from "@/lib/money";
import { currencyDigits, formatDate, formatNumber, toDateInput } from "@/lib/format";
import { businessContext, moneyAccountOptions } from "@/lib/form-options";
import { INVOICE_DISPLAY, invoiceState } from "@/lib/sales";
import {
  deleteDraftInvoice,
  markInvoiceSent,
  removeReceiptAllocation,
  setTaxInvoiceNumber,
  voidInvoice,
} from "@/lib/actions/sales";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { LinkButton } from "@/components/bits";
import { PrintButton } from "@/components/print-button";
import { SubmitButton } from "@/components/forms";
import { ReceiptForm } from "@/components/module-forms";

export const metadata = { title: "Invoice" };

export default async function SalesInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { business } = await requireBusiness();
  const { id } = await params;
  const invoice = await prisma.salesInvoice.findFirst({
    where: { id, businessId: business.id },
    include: {
      customer: true,
      lines: { orderBy: { position: "asc" } },
      allocations: { include: { receipt: true } },
      creditAllocations: { include: { creditNote: true } },
      recurringInvoice: { select: { id: true } },
    },
  });
  if (!invoice) notFound();

  const { fmt, pack } = businessContext(business);
  const state = invoiceState(invoice);
  const moneyAccounts = await moneyAccountOptions(business.id);
  const display = INVOICE_DISPLAY[state.status];
  const dp = currencyDigits(business.currency);
  const taxSystem = pack.taxInvoiceSystem;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <Link href="/app/sales/invoices" className="text-sm text-slate-500 hover:underline">
            ← Invoices
          </Link>
          <Badge tone={display.tone}>{display.label}</Badge>
          {invoice.isOpening ? <Badge tone="amber">Opening balance</Badge> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {invoice.status !== "VOID" && !invoice.isOpening ? (
            <LinkButton href={`/app/sales/invoices/${invoice.id}/edit`} variant="secondary">
              Edit
            </LinkButton>
          ) : null}
          {invoice.status === "DRAFT" ? (
            <form action={markInvoiceSent}>
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <SubmitButton>Mark as sent</SubmitButton>
            </form>
          ) : null}
          {invoice.status === "SENT" ? (
            <LinkButton href={`/app/sales/credit-notes/new?invoice=${invoice.id}`} variant="secondary">
              Issue credit note
            </LinkButton>
          ) : null}
          <PrintButton />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <article className="rounded-lg border border-slate-200 bg-white p-6 sm:p-8 lg:col-span-2 print:col-span-3 print:border-0 print:p-0">
          <header className="flex flex-wrap justify-between gap-6 border-b border-slate-200 pb-6">
            <div>
              <h1 className="text-xl font-bold text-slate-900">{business.name}</h1>
              {business.address ? <p className="text-sm text-slate-600">{business.address}</p> : null}
              <p className="text-sm text-slate-600">{[business.phone, business.email].filter(Boolean).join(" · ")}</p>
              {business.kraPin ? (
                <p className="text-sm text-slate-600">
                  {pack.taxIdLabel}: {business.kraPin}
                </p>
              ) : null}
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold tracking-tight text-slate-900">{business.vatRegistered ? "TAX INVOICE" : "INVOICE"}</p>
              <p className="font-mono text-sm">{invoice.number}</p>
              <p className="mt-2 text-sm text-slate-600">Date: {formatDate(invoice.issueDate)}</p>
              <p className="text-sm text-slate-600">Due: {formatDate(invoice.dueDate)}</p>
              {invoice.taxInvoiceNumber ? (
                <p className="text-sm text-slate-600">
                  {taxSystem ?? "Tax invoice"} no: {invoice.taxInvoiceNumber}
                </p>
              ) : null}
            </div>
          </header>

          <section className="py-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Bill to</p>
            <Link href={`/app/sales/customers/${invoice.customerId}`} className="font-semibold text-slate-900 hover:underline">
              {invoice.customer.name}
            </Link>
            {invoice.customer.address ? <p className="text-sm text-slate-600">{invoice.customer.address}</p> : null}
            {invoice.customer.taxId ? (
              <p className="text-sm text-slate-600">
                {pack.taxIdLabel}: {invoice.customer.taxId}
              </p>
            ) : null}
            {invoice.reference ? <p className="text-sm text-slate-600">Ref: {invoice.reference}</p> : null}
            {invoice.recurringInvoice ? (
              <p className="text-xs text-slate-400 print:hidden">
                Issued by a <Link href={`/app/sales/recurring/${invoice.recurringInvoice.id}`} className="hover:underline">recurring schedule</Link>
              </p>
            ) : null}
          </section>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2">Description</th>
                <th className="py-2 text-right">Qty</th>
                <th className="py-2 text-right">Price</th>
                {business.vatRegistered ? <th className="py-2 text-right">Tax</th> : null}
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l) => (
                <tr key={l.id} className="border-b border-slate-100">
                  <td className="py-2">{l.description}</td>
                  <td className="py-2 text-right">{formatNumber(num(l.quantity), num(l.quantity) % 1 ? 2 : 0)}</td>
                  <td className="py-2 text-right">{formatNumber(num(l.unitPrice), dp)}</td>
                  {business.vatRegistered ? <td className="py-2 text-right">{num(l.taxRate)}%</td> : null}
                  <td className="py-2 text-right">{formatNumber(num(l.lineTotal), dp)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="ml-auto mt-4 w-full max-w-xs space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Subtotal</dt>
              <dd>{fmt(num(invoice.subtotal))}</dd>
            </div>
            {business.vatRegistered ? (
              <div className="flex justify-between">
                <dt className="text-slate-500">{pack.vatName}</dt>
                <dd>{fmt(num(invoice.taxTotal))}</dd>
              </div>
            ) : null}
            <div className="flex justify-between border-t border-slate-300 pt-1 text-base font-bold">
              <dt>Total</dt>
              <dd>{fmt(state.total)}</dd>
            </div>
            {state.paid > 0 ? (
              <>
                <div className="flex justify-between text-slate-600">
                  <dt>{invoice.creditAllocations.length > 0 ? "Paid & credited" : "Paid"}</dt>
                  <dd>-{fmt(state.paid)}</dd>
                </div>
                <div className="flex justify-between font-semibold">
                  <dt>Balance due</dt>
                  <dd>{fmt(state.balance)}</dd>
                </div>
              </>
            ) : null}
          </dl>

          {invoice.notes ? <p className="mt-6 text-sm text-slate-600">{invoice.notes}</p> : null}
          {business.invoiceFooter ? (
            <p className="mt-6 border-t border-slate-200 pt-4 text-sm text-slate-600">{business.invoiceFooter}</p>
          ) : null}
        </article>

        <aside className="space-y-6 print:hidden">
          {invoice.status === "SENT" && state.balance > 0.01 ? (
            <Card>
              <CardHeader>
                <CardTitle>Record a payment</CardTitle>
              </CardHeader>
              <CardBody>
                <ReceiptForm
                  moneyAccounts={moneyAccounts}
                  today={toDateInput(new Date())}
                  invoiceId={invoice.id}
                  customerId={invoice.customerId}
                  defaultAmount={state.balance}
                  defaultPayer={invoice.customer.name}
                />
              </CardBody>
            </Card>
          ) : null}

          {invoice.allocations.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Payments</CardTitle>
              </CardHeader>
              <CardBody>
                <ul className="divide-y divide-slate-100 text-sm">
                  {invoice.allocations.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                      <Link href={`/app/sales/receipts/${a.receiptId}`} className="hover:underline">
                        {formatDate(a.receipt.receivedAt)}
                        {a.receipt.reference ? ` · ${a.receipt.reference}` : ""}
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

          {invoice.creditAllocations.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Credit notes</CardTitle>
              </CardHeader>
              <CardBody>
                <ul className="divide-y divide-slate-100 text-sm">
                  {invoice.creditAllocations.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                      <Link href={`/app/sales/credit-notes/${a.creditNoteId}`} className="hover:underline">
                        {a.creditNote.number}
                      </Link>
                      <span>-{fmt(num(a.amount))}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}

          {taxSystem && invoice.status !== "VOID" ? (
            <Card>
              <CardHeader>
                <CardTitle>{taxSystem} registration</CardTitle>
              </CardHeader>
              <CardBody className="space-y-2 text-sm text-slate-600">
                <p>
                  Hakiki does not connect to {taxSystem} yet. Issue the invoice on {taxSystem}, then save its number here so
                  it prints on the invoice.
                </p>
                <form action={setTaxInvoiceNumber} className="flex gap-2">
                  <input type="hidden" name="invoiceId" value={invoice.id} />
                  <Input name="taxInvoiceNumber" defaultValue={invoice.taxInvoiceNumber ?? ""} aria-label={`${taxSystem} number`} className="uppercase" />
                  <SubmitButton variant="secondary" size="sm">
                    Save
                  </SubmitButton>
                </form>
              </CardBody>
            </Card>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {invoice.status === "DRAFT" ? (
              <form action={deleteDraftInvoice}>
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <SubmitButton variant="ghost" size="sm">
                  Delete draft
                </SubmitButton>
              </form>
            ) : invoice.status === "SENT" ? (
              <form action={voidInvoice}>
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <SubmitButton variant="ghost" size="sm" pendingText="Voiding...">
                  Void invoice
                </SubmitButton>
              </form>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
