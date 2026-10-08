import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num, round2 } from "@/lib/money";
import { currencyDigits, formatDate, formatNumber } from "@/lib/format";
import { businessContext } from "@/lib/form-options";
import { creditState } from "@/lib/credit-notes";
import { settledAmount } from "@/lib/sales";
import {
  applyCreditToInvoice,
  deleteDraftCreditNote,
  issueCreditNote,
  removeCreditAllocation,
  voidCreditNote,
} from "@/lib/actions/credit-notes";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { LinkButton } from "@/components/bits";
import { ShareCard } from "@/components/share-card";
import { PrintButton } from "@/components/print-button";
import { SubmitButton } from "@/components/forms";

export const metadata = { title: "Credit note" };

export default async function CreditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { business } = await requireBusiness();
  const { id } = await params;
  const note = await prisma.creditNote.findFirst({
    where: { id, businessId: business.id },
    include: {
      customer: true,
      lines: { orderBy: { position: "asc" } },
      allocations: { include: { invoice: true } },
    },
  });
  if (!note) notFound();

  const { fmt, pack } = businessContext(business);
  const state = creditState(note);
  const dp = currencyDigits(business.currency);
  const original = note.invoiceId ? await prisma.salesInvoice.findUnique({ where: { id: note.invoiceId } }) : null;

  // Invoices this customer still owes on, which the unused credit can be taken off.
  const openInvoices =
    state.unused > 0.01
      ? (
          await prisma.salesInvoice.findMany({
            where: { businessId: business.id, customerId: note.customerId, status: "SENT" },
            include: { allocations: { select: { amount: true } }, creditAllocations: { select: { amount: true } } },
            orderBy: { issueDate: "asc" },
          })
        )
          .map((inv) => ({ id: inv.id, number: inv.number, open: round2(num(inv.total) - settledAmount(inv)) }))
          .filter((inv) => inv.open > 0.01)
      : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <Link href="/app/sales/credit-notes" className="text-sm text-slate-500 hover:underline">
            ← Credit notes
          </Link>
          <Badge tone={state.display.tone}>{state.display.label}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {note.status === "DRAFT" ? (
            <>
              <LinkButton href={`/app/sales/credit-notes/${note.id}/edit`} variant="secondary">
                Edit
              </LinkButton>
              <form action={issueCreditNote}>
                <input type="hidden" name="creditNoteId" value={note.id} />
                <SubmitButton>Issue credit note</SubmitButton>
              </form>
            </>
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
              <p className="text-2xl font-bold tracking-tight text-slate-900">CREDIT NOTE</p>
              <p className="font-mono text-sm">{note.number}</p>
              <p className="mt-2 text-sm text-slate-600">Date: {formatDate(note.issueDate)}</p>
              {original ? (
                <p className="text-sm text-slate-600">
                  Against invoice{" "}
                  <Link href={`/app/sales/invoices/${original.id}`} className="hover:underline">
                    {original.number}
                  </Link>
                </p>
              ) : null}
            </div>
          </header>

          <section className="py-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Credit to</p>
            <Link href={`/app/sales/customers/${note.customerId}`} className="font-semibold text-slate-900 hover:underline">
              {note.customer.name}
            </Link>
            {note.customer.taxId ? (
              <p className="text-sm text-slate-600">
                {pack.taxIdLabel}: {note.customer.taxId}
              </p>
            ) : null}
            {note.reason ? <p className="text-sm text-slate-600">Reason: {note.reason}</p> : null}
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
              {note.lines.map((l) => (
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
              <dd>{fmt(num(note.subtotal))}</dd>
            </div>
            {business.vatRegistered ? (
              <div className="flex justify-between">
                <dt className="text-slate-500">{pack.vatName}</dt>
                <dd>{fmt(num(note.taxTotal))}</dd>
              </div>
            ) : null}
            <div className="flex justify-between border-t border-slate-300 pt-1 text-base font-bold">
              <dt>Total credit</dt>
              <dd>{fmt(state.total)}</dd>
            </div>
          </dl>
        </article>

        <aside className="space-y-6 print:hidden">
          {note.status === "ISSUED" ? (
            <ShareCard kind="credit-note" id={note.id} business={business} customer={note.customer} number={note.number} amount={state.total} />
          ) : null}
          {state.unused > 0.01 && openInvoices.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Apply to an invoice</CardTitle>
              </CardHeader>
              <CardBody>
                <form action={applyCreditToInvoice} className="flex gap-2">
                  <input type="hidden" name="creditNoteId" value={note.id} />
                  <Select name="invoiceId" aria-label="Invoice">
                    {openInvoices.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.number} · owes {fmt(inv.open)}
                      </option>
                    ))}
                  </Select>
                  <SubmitButton variant="secondary" size="sm">
                    Apply
                  </SubmitButton>
                </form>
                <p className="mt-2 text-xs text-slate-500">{fmt(state.unused)} of this credit is still unused.</p>
              </CardBody>
            </Card>
          ) : null}

          {note.allocations.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Applied to</CardTitle>
              </CardHeader>
              <CardBody>
                <ul className="divide-y divide-slate-100 text-sm">
                  {note.allocations.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                      <Link href={`/app/sales/invoices/${a.invoiceId}`} className="hover:underline">
                        {a.invoice.number}
                      </Link>
                      <span className="flex items-center gap-2">
                        {fmt(num(a.amount))}
                        <form action={removeCreditAllocation}>
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

          <div className="flex flex-wrap gap-2">
            {note.status === "DRAFT" ? (
              <form action={deleteDraftCreditNote}>
                <input type="hidden" name="creditNoteId" value={note.id} />
                <SubmitButton variant="ghost" size="sm">
                  Delete draft
                </SubmitButton>
              </form>
            ) : note.status === "ISSUED" ? (
              <form action={voidCreditNote}>
                <input type="hidden" name="creditNoteId" value={note.id} />
                <SubmitButton variant="ghost" size="sm" pendingText="Voiding...">
                  Void credit note
                </SubmitButton>
              </form>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
