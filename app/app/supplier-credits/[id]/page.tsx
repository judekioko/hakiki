import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num, round2 } from "@/lib/money";
import { currencyDigits, formatDate, formatNumber } from "@/lib/format";
import { businessContext } from "@/lib/form-options";
import { creditState } from "@/lib/credit-notes";
import {
  applySupplierCreditToBill,
  deleteDraftSupplierCredit,
  issueSupplierCredit,
  removeSupplierCreditAllocation,
  voidSupplierCredit,
} from "@/lib/actions/supplier-credits";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { LinkButton } from "@/components/bits";
import { PrintButton } from "@/components/print-button";
import { SubmitButton } from "@/components/forms";

export const metadata = { title: "Supplier credit note" };

export default async function SupplierCreditPage({ params }: { params: Promise<{ id: string }> }) {
  const { business } = await requireBusiness();
  const { id } = await params;
  const credit = await prisma.supplierCredit.findFirst({
    where: { id, businessId: business.id },
    include: {
      supplier: true,
      bill: { select: { id: true, invoiceNumber: true } },
      lines: { orderBy: { position: "asc" } },
      allocations: { include: { bill: true } },
    },
  });
  if (!credit) notFound();

  const { fmt, pack } = businessContext(business);
  const state = creditState(credit);
  const dp = currencyDigits(business.currency);

  // Bills from this supplier that still have a balance the credit can be taken off.
  const openBills =
    state.unused > 0.01
      ? (
          await prisma.invoice.findMany({
            where: { businessId: business.id, supplierId: credit.supplierId },
            include: { allocations: { select: { amount: true } }, creditAllocations: { select: { amount: true } } },
            orderBy: { invoiceDate: "asc" },
          })
        )
          .map((b) => ({
            id: b.id,
            number: b.invoiceNumber,
            open: round2(
              num(b.totalAmount) - [...b.allocations, ...b.creditAllocations].reduce((s, a) => s + num(a.amount), 0)
            ),
          }))
          .filter((b) => b.open > 0.01)
      : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <Link href="/app/supplier-credits" className="text-sm text-slate-500 hover:underline">
            ← Supplier credit notes
          </Link>
          <Badge tone={state.display.tone}>{credit.status === "ISSUED" && state.unused > 0.01 ? "Recorded" : state.display.label}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {credit.status === "DRAFT" ? (
            <>
              <LinkButton href={`/app/supplier-credits/${credit.id}/edit`} variant="secondary">
                Edit
              </LinkButton>
              <form action={issueSupplierCredit}>
                <input type="hidden" name="creditId" value={credit.id} />
                <SubmitButton>Record credit note</SubmitButton>
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
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Credit from</p>
              <Link href={`/app/suppliers/${credit.supplierId}`} className="text-xl font-bold text-slate-900 hover:underline">
                {credit.supplier.name}
              </Link>
              {credit.supplier.kraPin ? (
                <p className="text-sm text-slate-600">
                  {pack.taxIdLabel}: {credit.supplier.kraPin}
                </p>
              ) : null}
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold tracking-tight text-slate-900">SUPPLIER CREDIT NOTE</p>
              <p className="font-mono text-sm">{credit.number}</p>
              <p className="mt-2 text-sm text-slate-600">Date: {formatDate(credit.creditDate)}</p>
              {credit.bill ? (
                <p className="text-sm text-slate-600">
                  Against bill{" "}
                  <Link href={`/app/invoices/${credit.bill.id}`} className="hover:underline">
                    {credit.bill.invoiceNumber}
                  </Link>
                </p>
              ) : null}
            </div>
          </header>

          {credit.reason ? <p className="pt-4 text-sm text-slate-600">Reason: {credit.reason}</p> : null}

          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2">Description</th>
                <th className="py-2 text-right">Qty</th>
                <th className="py-2 text-right">Price</th>
                <th className="py-2 text-right">Tax</th>
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {credit.lines.map((l) => (
                <tr key={l.id} className="border-b border-slate-100">
                  <td className="py-2">{l.description}</td>
                  <td className="py-2 text-right">{formatNumber(num(l.quantity), num(l.quantity) % 1 ? 2 : 0)}</td>
                  <td className="py-2 text-right">{formatNumber(num(l.unitPrice), dp)}</td>
                  <td className="py-2 text-right">{num(l.taxRate)}%</td>
                  <td className="py-2 text-right">{formatNumber(num(l.lineTotal), dp)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="ml-auto mt-4 w-full max-w-xs space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Subtotal</dt>
              <dd>{fmt(num(credit.subtotal))}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">{pack.vatName}</dt>
              <dd>{fmt(num(credit.taxTotal))}</dd>
            </div>
            <div className="flex justify-between border-t border-slate-300 pt-1 text-base font-bold">
              <dt>Total credit</dt>
              <dd>{fmt(state.total)}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-slate-400">
            {credit.returnStock ? "Returned stock items were taken out of stock." : "Recorded as a price adjustment; stock quantities are unchanged."}
          </p>
        </article>

        <aside className="space-y-6 print:hidden">
          {state.unused > 0.01 && openBills.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Take off a bill</CardTitle>
              </CardHeader>
              <CardBody>
                <form action={applySupplierCreditToBill} className="flex gap-2">
                  <input type="hidden" name="creditId" value={credit.id} />
                  <Select name="billId" aria-label="Bill">
                    {openBills.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.number} · owing {fmt(b.open)}
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
          ) : state.unused > 0.01 && credit.status === "ISSUED" ? (
            <Card>
              <CardBody className="text-sm text-slate-600">
                {fmt(state.unused)} of this credit is unused and the supplier has no bill with a balance to take it off. It stays as
                money the supplier owes you until you use it against a future bill or the supplier refunds it.
              </CardBody>
            </Card>
          ) : null}

          {credit.allocations.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Applied to</CardTitle>
              </CardHeader>
              <CardBody>
                <ul className="divide-y divide-slate-100 text-sm">
                  {credit.allocations.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                      <Link href={`/app/invoices/${a.billId}`} className="hover:underline">
                        {a.bill.invoiceNumber}
                      </Link>
                      <span className="flex items-center gap-2">
                        {fmt(num(a.amount))}
                        <form action={removeSupplierCreditAllocation}>
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
            {credit.status === "DRAFT" ? (
              <form action={deleteDraftSupplierCredit}>
                <input type="hidden" name="creditId" value={credit.id} />
                <SubmitButton variant="ghost" size="sm">
                  Delete draft
                </SubmitButton>
              </form>
            ) : credit.status === "ISSUED" ? (
              <form action={voidSupplierCredit}>
                <input type="hidden" name="creditId" value={credit.id} />
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
