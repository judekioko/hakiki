import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num, round2 } from "@/lib/money";
import { formatDate, formatNumber, moneyFormatter } from "@/lib/format";
import { settleBillExchangeDifference } from "@/lib/actions/fx";
import { businessContext } from "@/lib/form-options";
import { INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE } from "@/lib/invoice-status";
import { deleteInvoice, setInvoiceStatus } from "@/lib/actions/invoices";
import { unlinkAllocation } from "@/lib/actions/matching";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/forms";

export const metadata = { title: "Bill" };

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { business } = await requireBusiness();
  const { fmt, taxInvoiceLabel, taxIdLabel } = businessContext(business);
  const { id } = await params;
  const invoice = await prisma.invoice.findFirst({
    where: { id, businessId: business.id },
    select: {
      id: true,
      invoiceNumber: true,
      supplierName: true,
      supplierPin: true,
      supplierId: true,
      invoiceDate: true,
      totalAmount: true,
      vatAmount: true,
      currency: true,
      exchangeRate: true,
      foreignTotalAmount: true,
      foreignVatAmount: true,
      description: true,
      status: true,
      fileName: true,
      fileType: true,
      dueDate: true,
      lines: { orderBy: { position: "asc" } },
      allocations: { include: { payment: true } },
      creditAllocations: { include: { credit: true } },
    },
  });
  if (!invoice) notFound();

  const total = num(invoice.totalAmount);
  const matched = round2(invoice.allocations.reduce((s, a) => s + num(a.amount), 0));
  const credited = round2(invoice.creditAllocations.reduce((s, a) => s + num(a.amount), 0));
  const fileUrl = `/app/invoices/${invoice.id}/file`;
  const dfmt = invoice.currency ? moneyFormatter(invoice.currency) : fmt;
  const remaining = round2(total - matched - credited);

  return (
    <div className="space-y-6">
      <PageHeader
        title={invoice.supplierName}
        description={`${taxInvoiceLabel} ${invoice.invoiceNumber} · ${formatDate(invoice.invoiceDate)}`}
        action={<Badge tone={INVOICE_STATUS_TONE[invoice.status]}>{INVOICE_STATUS_LABEL[invoice.status]}</Badge>}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardBody className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-slate-500">Total incl. VAT</p>
                <p className="text-lg font-semibold">{dfmt(invoice.currency && invoice.foreignTotalAmount !== null ? num(invoice.foreignTotalAmount) : total)}</p>
                {invoice.currency && invoice.exchangeRate ? (
                  <p className="text-xs text-slate-400">
                    {fmt(total)} at 1 {invoice.currency} = {formatNumber(num(invoice.exchangeRate), 4)}
                  </p>
                ) : null}
              </div>
              <div>
                <p className="text-xs text-slate-500">VAT</p>
                <p className="text-lg font-semibold">{dfmt(invoice.currency && invoice.foreignVatAmount !== null ? num(invoice.foreignVatAmount) : num(invoice.vatAmount))}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Matched to payments</p>
                <p className="text-lg font-semibold text-teal-700">{fmt(matched)}</p>
              </div>
              {credited > 0 ? (
                <div>
                  <p className="text-xs text-slate-500">Credited by supplier</p>
                  <p className="text-lg font-semibold text-teal-700">{fmt(credited)}</p>
                </div>
              ) : null}
              <div className="text-sm sm:col-span-3">
                <p>
                  <span className="text-slate-400">Supplier {taxIdLabel}: </span>
                  {invoice.supplierPin ?? "not recorded"}
                  {invoice.supplierId ? (
                    <>
                      {" · "}
                      <Link href={`/app/suppliers/${invoice.supplierId}`} className="text-teal-700 hover:underline">
                        View supplier
                      </Link>
                    </>
                  ) : null}
                </p>
                {invoice.description ? (
                  <p className="mt-1">
                    <span className="text-slate-400">For: </span>
                    {invoice.description}
                  </p>
                ) : null}
                {invoice.dueDate ? (
                  <p className="mt-1">
                    <span className="text-slate-400">Due: </span>
                    {formatDate(invoice.dueDate)}
                  </p>
                ) : null}
              </div>
            </CardBody>
          </Card>

          {invoice.lines.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Lines</CardTitle>
              </CardHeader>
              <CardBody>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="py-2">Description</th>
                      <th className="py-2 text-right">Qty</th>
                      <th className="py-2 text-right">Unit price</th>
                      <th className="py-2 text-right">Tax</th>
                      <th className="py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.lines.map((l) => (
                      <tr key={l.id} className="border-b border-slate-100">
                        <td className="py-1.5">{l.description}</td>
                        <td className="py-1.5 text-right">{num(l.quantity)}</td>
                        <td className="py-1.5 text-right">{dfmt(num(invoice.currency && l.foreignUnitPrice !== null ? l.foreignUnitPrice : l.unitPrice))}</td>
                        <td className="py-1.5 text-right">{num(l.taxRate)}%</td>
                        <td className="py-1.5 text-right">{dfmt(num(invoice.currency && l.foreignLineTotal !== null ? l.foreignLineTotal : l.lineTotal))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Payments that settled this bill</CardTitle>
            </CardHeader>
            <CardBody>
              {invoice.allocations.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Not matched yet. Open the payment it belongs to and link it, or use Auto-match on the Payments page.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {invoice.allocations.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <div>
                        <Link href={`/app/payments/${a.paymentId}`} className="font-medium text-slate-900 hover:underline">
                          {a.payment.counterparty}
                        </Link>
                        <p className="text-xs text-slate-500">
                          {formatDate(a.payment.paidAt)}
                          {a.payment.reference ? ` · ${a.payment.reference}` : ""} · paid {fmt(num(a.payment.amount))}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-medium">{fmt(num(a.amount))}</span>
                        <form action={unlinkAllocation}>
                          <input type="hidden" name="allocationId" value={a.id} />
                          <SubmitButton variant="ghost" size="sm" pendingText="...">
                            Unlink
                          </SubmitButton>
                        </form>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {invoice.creditAllocations.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Supplier credit notes</CardTitle>
              </CardHeader>
              <CardBody>
                <ul className="divide-y divide-slate-100 text-sm">
                  {invoice.creditAllocations.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                      <Link href={`/app/supplier-credits/${a.creditId}`} className="hover:underline">
                        {a.credit.number} · {formatDate(a.credit.creditDate)}
                      </Link>
                      <span>-{fmt(num(a.amount))}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}

          {invoice.fileName ? (
            <Card>
              <CardHeader className="flex items-center justify-between">
                <CardTitle>Original invoice</CardTitle>
                <a href={fileUrl} target="_blank" rel="noreferrer" className="text-sm text-teal-700 hover:underline">
                  Open in new tab
                </a>
              </CardHeader>
              <CardBody>
                {invoice.fileType?.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={fileUrl} alt={`Invoice ${invoice.invoiceNumber}`} className="max-h-[600px] rounded border border-slate-200" />
                ) : (
                  <p className="text-sm text-slate-600">{invoice.fileName}</p>
                )}
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          {invoice.currency && invoice.supplierId && matched > 0 && remaining > 0.01 ? (
            <Card>
              <CardHeader>
                <CardTitle>Exchange difference</CardTitle>
              </CardHeader>
              <CardBody className="space-y-2 text-sm text-slate-600">
                <p>
                  This bill is in {invoice.currency}. If you have paid the supplier everything in {invoice.currency}, the {fmt(remaining)} still
                  showing as owed is the exchange rate moving between the bill and your payments.
                </p>
                <form action={settleBillExchangeDifference}>
                  <input type="hidden" name="billId" value={invoice.id} />
                  <SubmitButton variant="secondary" size="sm" pendingText="Clearing...">
                    Clear {fmt(remaining)} as exchange gain
                  </SubmitButton>
                </form>
              </CardBody>
            </Card>
          ) : null}
          <Link
            href={`/app/supplier-credits/new?bill=${invoice.id}`}
            className="block rounded-md border border-slate-300 bg-white px-3 py-2 text-center text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Record a supplier credit note
          </Link>
          <Card>
            <CardHeader>
              <CardTitle>Check it is genuine</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3 text-sm text-slate-600">
              <p>
                Look up the invoice number with KRA&apos;s invoice checker on{" "}
                <a href="https://itax.kra.go.ke" target="_blank" rel="noreferrer" className="text-teal-700 underline">
                  iTax
                </a>{" "}
                or by scanning the QR code on the invoice. An invoice KRA cannot find will not support the expense.
              </p>
              <div className="flex flex-wrap gap-2">
                {invoice.status !== "VERIFIED" ? (
                  <form action={setInvoiceStatus}>
                    <input type="hidden" name="invoiceId" value={invoice.id} />
                    <input type="hidden" name="status" value="VERIFIED" />
                    <SubmitButton size="sm">Mark as checked</SubmitButton>
                  </form>
                ) : null}
                {invoice.status !== "REJECTED" ? (
                  <form action={setInvoiceStatus}>
                    <input type="hidden" name="invoiceId" value={invoice.id} />
                    <input type="hidden" name="status" value="REJECTED" />
                    <SubmitButton size="sm" variant="secondary">
                      Mark as invalid
                    </SubmitButton>
                  </form>
                ) : (
                  <form action={setInvoiceStatus}>
                    <input type="hidden" name="invoiceId" value={invoice.id} />
                    <input type="hidden" name="status" value="UNVERIFIED" />
                    <SubmitButton size="sm" variant="secondary">
                      Undo invalid
                    </SubmitButton>
                  </form>
                )}
              </div>
              <p className="text-xs text-slate-500">Marking an invoice invalid unlinks it from its payments.</p>
            </CardBody>
          </Card>

          <form action={deleteInvoice}>
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <SubmitButton variant="ghost" size="sm" pendingText="Deleting...">
              Delete this bill
            </SubmitButton>
          </form>
        </div>
      </div>
    </div>
  );
}
