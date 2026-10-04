import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num, round2 } from "@/lib/money";
import { paymentStatus } from "@/lib/coverage";
import { suggestInvoices } from "@/lib/matching";
import { openInvoices } from "@/lib/auto-match";
import { formatDate, toDateInput } from "@/lib/format";
import { businessContext, categoryAccountOptions } from "@/lib/form-options";
import { accountIdsByKey, defaultPaymentCategoryKey } from "@/lib/ledger";
import { AccountSelect } from "@/components/form-kit";
import { EXEMPT_LABEL, EXEMPT_REASONS, EXEMPTION_DISCLAIMER } from "@/lib/exemptions";
import { clearExempt, deletePayment, markExempt, setPaymentCategory } from "@/lib/actions/payments";
import { linkPaymentToInvoice, unlinkAllocation } from "@/lib/actions/matching";
import { linkPaymentToSupplier } from "@/lib/actions/suppliers";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/bits";
import { InvoiceForm, SubmitButton, SupplierForm } from "@/components/forms";

export const metadata = { title: "Payment" };

export default async function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { business } = await requireBusiness();
  const { id } = await params;
  const payment = await prisma.payment.findFirst({
    where: { id, businessId: business.id },
    include: { supplier: true, allocations: { include: { invoice: true } } },
  });
  if (!payment) notFound();
  const ctx = businessContext(business);
  const fmt = ctx.fmt;

  const amount = num(payment.amount);
  const allocated = round2(payment.allocations.reduce((s, a) => s + num(a.amount), 0));
  const remaining = round2(amount - allocated);
  const status = paymentStatus(amount, allocated, payment.exemptReason);

  const [suppliers, candidates, categories, keys, moneyAccount, payRuns] = await Promise.all([
    prisma.supplier.findMany({ where: { businessId: business.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    status === "EXEMPT" || remaining <= 0 ? Promise.resolve([]) : openInvoices(business.id),
    categoryAccountOptions(business.id),
    accountIdsByKey(business.id),
    payment.moneyAccountId ? prisma.account.findUnique({ where: { id: payment.moneyAccountId } }) : null,
    prisma.payRun.count({ where: { businessId: business.id } }),
  ]);
  const effectiveCategory = payment.categoryAccountId ?? keys[defaultPaymentCategoryKey(payment.exemptReason, payRuns > 0)];
  const categoryName = categories.find((c) => c.id === effectiveCategory);
  const suggestions = suggestInvoices(
    { id: payment.id, paidAt: payment.paidAt, remaining, counterparty: payment.counterparty, supplierId: payment.supplierId },
    candidates.filter((c) => !payment.allocations.some((a) => a.invoiceId === c.id))
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={payment.supplier?.name ?? payment.counterparty}
        description={`Paid from ${moneyAccount?.name ?? payment.source} on ${formatDate(payment.paidAt)}${payment.reference ? ` · ${payment.reference}` : ""}`}
        action={<StatusBadge status={status} />}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardBody className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-slate-500">Amount paid</p>
                <p className="text-lg font-semibold">{fmt(amount)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Matched to bills</p>
                <p className="text-lg font-semibold text-teal-700">{fmt(allocated)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Still needs a {ctx.taxInvoiceLabel}</p>
                <p className="text-lg font-semibold text-rose-700">{status === "EXEMPT" ? "—" : fmt(Math.max(0, remaining))}</p>
              </div>
              {payment.details ? (
                <p className="text-sm text-slate-600 sm:col-span-3">
                  <span className="text-slate-400">Statement details: </span>
                  {payment.details}
                </p>
              ) : null}
            </CardBody>
          </Card>

          {payment.allocations.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Linked bills</CardTitle>
              </CardHeader>
              <CardBody>
                <ul className="divide-y divide-slate-100">
                  {payment.allocations.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <div>
                        <Link href={`/app/invoices/${a.invoiceId}`} className="font-medium text-slate-900 hover:underline">
                          {a.invoice.invoiceNumber}
                        </Link>
                        <p className="text-xs text-slate-500">
                          {a.invoice.supplierName} · {formatDate(a.invoice.invoiceDate)} · invoice total {fmt(num(a.invoice.totalAmount))}
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
              </CardBody>
            </Card>
          ) : null}

          {status !== "EXEMPT" && remaining > 0 ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Suggested bills</CardTitle>
                </CardHeader>
                <CardBody>
                  {suggestions.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      No invoice on file looks like it belongs to this payment. Add it below, or ask the supplier for it.
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {suggestions.map(({ invoice, match }) => (
                        <li key={invoice.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                          <div>
                            <Link href={`/app/invoices/${invoice.id}`} className="font-medium text-slate-900 hover:underline">
                              {invoice.supplierName}
                            </Link>
                            <p className="text-xs text-slate-500">
                              {formatDate(invoice.invoiceDate)} · {fmt(invoice.remaining)} open
                            </p>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {match.reasons.map((r) => (
                                <Badge key={r}>{r}</Badge>
                              ))}
                            </div>
                          </div>
                          <form action={linkPaymentToInvoice}>
                            <input type="hidden" name="paymentId" value={payment.id} />
                            <input type="hidden" name="invoiceId" value={invoice.id} />
                            <SubmitButton size="sm" pendingText="Linking...">
                              Link
                            </SubmitButton>
                          </form>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Add the supplier bill for this payment</CardTitle>
                </CardHeader>
                <CardBody>
                  <InvoiceForm
                    suppliers={suppliers}
                    paymentId={payment.id}
                    today={toDateInput(new Date())}
                    taxIdLabel={ctx.taxIdLabel}
                    taxInvoiceLabel={ctx.taxInvoiceLabel}
                    categories={categories}
                    defaults={{
                      supplierId: payment.supplierId ?? undefined,
                      supplierName: payment.supplierId ? "" : payment.counterparty,
                      amount: remaining,
                      date: toDateInput(payment.paidAt),
                    }}
                  />
                </CardBody>
              </Card>
            </>
          ) : null}
        </div>

        <div className="space-y-6">
          {remaining > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Booked to</CardTitle>
              </CardHeader>
              <CardBody className="space-y-3">
                <p className="text-sm text-slate-600">
                  {allocated > 0 ? "The part not matched to a bill" : "This payment"} is booked to{" "}
                  <strong>{categoryName ? `${categoryName.code} · ${categoryName.name}` : "Uncategorised expense"}</strong>.
                </p>
                <form action={setPaymentCategory} className="space-y-2">
                  <input type="hidden" name="paymentId" value={payment.id} />
                  <AccountSelect name="categoryAccountId" accounts={categories} defaultValue={payment.categoryAccountId ?? ""} placeholder="Automatic" />
                  <SubmitButton variant="secondary" size="sm">
                    Change category
                  </SubmitButton>
                </form>
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Supplier</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              {payment.supplier ? (
                <div className="text-sm">
                  <Link href={`/app/suppliers/${payment.supplier.id}`} className="font-medium text-slate-900 hover:underline">
                    {payment.supplier.name}
                  </Link>
                  <p className="text-xs text-slate-500">{payment.supplier.kraPin ?? `No ${ctx.taxIdLabel} saved`}</p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-slate-600">
                    Link <strong>{payment.counterparty}</strong> to a supplier. Future payments with this name will link
                    automatically.
                  </p>
                  {suppliers.length > 0 ? (
                    <form action={linkPaymentToSupplier} className="flex gap-2">
                      <input type="hidden" name="paymentId" value={payment.id} />
                      <Select name="supplierId" aria-label="Supplier">
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </Select>
                      <SubmitButton variant="secondary" size="sm">
                        Link
                      </SubmitButton>
                    </form>
                  ) : null}
                  <details className="text-sm">
                    <summary className="cursor-pointer font-medium text-teal-700">Create a new supplier</summary>
                    <div className="mt-3">
                      <SupplierForm mode="create" taxIdLabel={ctx.taxIdLabel} paymentId={payment.id} defaults={{ name: payment.counterparty, kraPin: null, phone: null }} />
                    </div>
                  </details>
                </>
              )}
            </CardBody>
          </Card>

          {status !== "BACKED" ? (
          <Card>
            <CardHeader>
              <CardTitle>Doesn&apos;t need an invoice?</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              {payment.exemptReason ? (
                <>
                  <p className="text-sm">
                    Marked as <strong>{EXEMPT_LABEL[payment.exemptReason]}</strong>
                    {payment.exemptNote ? `: ${payment.exemptNote}` : ""}
                  </p>
                  <form action={clearExempt}>
                    <input type="hidden" name="paymentId" value={payment.id} />
                    <SubmitButton variant="secondary" size="sm">
                      Undo
                    </SubmitButton>
                  </form>
                </>
              ) : (
                <form action={markExempt} className="space-y-3">
                  <input type="hidden" name="paymentId" value={payment.id} />
                  <Select name="exemptReason" aria-label="Reason">
                    {EXEMPT_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </Select>
                  <Input name="exemptNote" placeholder="Note (optional)" />
                  <SubmitButton variant="secondary" size="sm">
                    Mark as not needed
                  </SubmitButton>
                </form>
              )}
              <p className="text-xs text-slate-500">{EXEMPTION_DISCLAIMER}</p>
            </CardBody>
          </Card>
          ) : null}

          <form action={deletePayment}>
            <input type="hidden" name="paymentId" value={payment.id} />
            <SubmitButton variant="ghost" size="sm" pendingText="Deleting...">
              Delete this payment
            </SubmitButton>
          </form>
        </div>
      </div>
    </div>
  );
}
