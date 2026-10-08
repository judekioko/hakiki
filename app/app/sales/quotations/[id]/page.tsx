import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num } from "@/lib/money";
import { currencyDigits, formatDate, formatNumber } from "@/lib/format";
import { businessContext } from "@/lib/form-options";
import { QUOTE_DISPLAY, quoteStatus } from "@/lib/quotations";
import { convertQuotation, deleteQuotation, setQuotationStatus } from "@/lib/actions/quotations";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/bits";
import { ShareCard } from "@/components/share-card";
import { PrintButton } from "@/components/print-button";
import { SubmitButton } from "@/components/forms";

export const metadata = { title: "Quotation" };

function StatusButton({ id, status, children, variant }: { id: string; status: string; children: React.ReactNode; variant?: "secondary" | "ghost" }) {
  return (
    <form action={setQuotationStatus}>
      <input type="hidden" name="quotationId" value={id} />
      <input type="hidden" name="status" value={status} />
      <SubmitButton variant={variant ?? "secondary"} size="sm">
        {children}
      </SubmitButton>
    </form>
  );
}

export default async function QuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const { business } = await requireBusiness();
  const { id } = await params;
  const quote = await prisma.quotation.findFirst({
    where: { id, businessId: business.id },
    include: { customer: true, lines: { orderBy: { position: "asc" } } },
  });
  if (!quote) notFound();

  const { fmt, pack } = businessContext(business);
  const status = quoteStatus(quote);
  const display = QUOTE_DISPLAY[status];
  const dp = currencyDigits(business.currency);
  const invoice = quote.invoiceId ? await prisma.salesInvoice.findUnique({ where: { id: quote.invoiceId }, select: { id: true, number: true } }) : null;
  const canConvert = quote.status !== "INVOICED" && quote.status !== "DECLINED";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <Link href="/app/sales/quotations" className="text-sm text-slate-500 hover:underline">
            ← Quotations
          </Link>
          <Badge tone={display.tone}>{display.label}</Badge>
          {invoice ? (
            <Link href={`/app/sales/invoices/${invoice.id}`} className="text-sm text-teal-700 hover:underline">
              Invoice {invoice.number}
            </Link>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {quote.status !== "INVOICED" ? (
            <LinkButton href={`/app/sales/quotations/${quote.id}/edit`} variant="secondary">
              Edit
            </LinkButton>
          ) : null}
          {quote.status === "DRAFT" ? <StatusButton id={quote.id} status="SENT">Mark as sent</StatusButton> : null}
          {quote.status === "SENT" ? (
            <>
              <StatusButton id={quote.id} status="ACCEPTED">Customer accepted</StatusButton>
              <StatusButton id={quote.id} status="DECLINED">Declined</StatusButton>
            </>
          ) : null}
          {canConvert ? (
            <form action={convertQuotation}>
              <input type="hidden" name="quotationId" value={quote.id} />
              <SubmitButton pendingText="Creating invoice...">Convert to invoice</SubmitButton>
            </form>
          ) : null}
          <PrintButton />
        </div>
      </div>

      <article className="max-w-3xl rounded-lg border border-slate-200 bg-white p-6 sm:p-8 print:max-w-none print:border-0 print:p-0">
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
            <p className="text-2xl font-bold tracking-tight text-slate-900">QUOTATION</p>
            <p className="font-mono text-sm">{quote.number}</p>
            <p className="mt-2 text-sm text-slate-600">Date: {formatDate(quote.issueDate)}</p>
            <p className="text-sm text-slate-600">Valid until: {formatDate(quote.expiryDate)}</p>
          </div>
        </header>

        <section className="py-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Prepared for</p>
          <Link href={`/app/sales/customers/${quote.customerId}`} className="font-semibold text-slate-900 hover:underline">
            {quote.customer.name}
          </Link>
          {quote.customer.address ? <p className="text-sm text-slate-600">{quote.customer.address}</p> : null}
          {quote.customer.taxId ? (
            <p className="text-sm text-slate-600">
              {pack.taxIdLabel}: {quote.customer.taxId}
            </p>
          ) : null}
          {quote.reference ? <p className="text-sm text-slate-600">Ref: {quote.reference}</p> : null}
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
            {quote.lines.map((l) => (
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
            <dd>{fmt(num(quote.subtotal))}</dd>
          </div>
          {business.vatRegistered ? (
            <div className="flex justify-between">
              <dt className="text-slate-500">{pack.vatName}</dt>
              <dd>{fmt(num(quote.taxTotal))}</dd>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-slate-300 pt-1 text-base font-bold">
            <dt>Total</dt>
            <dd>{fmt(num(quote.total))}</dd>
          </div>
        </dl>

        {quote.notes ? <p className="mt-6 text-sm text-slate-600">{quote.notes}</p> : null}
        {business.invoiceFooter ? (
          <p className="mt-6 border-t border-slate-200 pt-4 text-sm text-slate-600">{business.invoiceFooter}</p>
        ) : null}
      </article>

      {quote.status !== "DRAFT" ? (
        <div className="max-w-md">
          <ShareCard kind="quotation" id={quote.id} business={business} customer={quote.customer} number={quote.number} amount={num(quote.total)} />
        </div>
      ) : null}

      {quote.status !== "INVOICED" ? (
        <form action={deleteQuotation} className="print:hidden">
          <input type="hidden" name="quotationId" value={quote.id} />
          <SubmitButton variant="ghost" size="sm">
            Delete quotation
          </SubmitButton>
        </form>
      ) : null}
    </div>
  );
}
