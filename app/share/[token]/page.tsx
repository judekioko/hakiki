import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { countryPack } from "@/lib/countries";
import { currencyDigits, formatDate, formatMoney, formatNumber } from "@/lib/format";
import { num } from "@/lib/money";
import { invoiceState } from "@/lib/sales";
import { verifyShareToken } from "@/lib/share";
import { customerStatement, openInvoicesFor } from "@/lib/statements";
import { todayInNairobi } from "@/lib/recurrence";
import { PrintButton } from "@/components/print-button";

// Public page behind a signed link: shows one document to the customer, read-only and printable. It is not part
// of the signed-in app, so nothing here links back into it.
export const metadata = { title: "Document", robots: { index: false, follow: false } };

type Line = { id: string; description: string; quantity: unknown; unitPrice: unknown; taxRate: unknown; lineTotal: unknown };

export default async function SharedDocumentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await verifyShareToken(token);
  if (!link) notFound();

  const business = await prisma.business.findUnique({ where: { id: link.businessId } });
  if (!business) notFound();
  const pack = countryPack(business.country);
  const money = (n: number) => formatMoney(n, business.currency);
  const dp = currencyDigits(business.currency);

  let title = "";
  let number = "";
  let dates: string[] = [];
  let partyLabel = "Bill to";
  let party: { name: string; address: string | null; taxId: string | null } | null = null;
  let lines: Line[] = [];
  let totals: { label: string; value: string; strong?: boolean }[] = [];
  let notes: string | null = null;
  let statement: Awaited<ReturnType<typeof customerStatement>> | null = null;
  let outstanding: Awaited<ReturnType<typeof openInvoicesFor>> | null = null;
  let range = "";

  if (link.kind === "invoice") {
    const doc = await prisma.salesInvoice.findFirst({
      where: { id: link.id, businessId: business.id, status: { not: "DRAFT" } },
      include: {
        customer: true,
        lines: { orderBy: { position: "asc" } },
        allocations: { select: { amount: true } },
        creditAllocations: { select: { amount: true } },
      },
    });
    if (!doc) notFound();
    const state = invoiceState(doc);
    title = doc.status === "VOID" ? "VOID INVOICE" : business.vatRegistered ? "TAX INVOICE" : "INVOICE";
    number = doc.number;
    dates = [`Date: ${formatDate(doc.issueDate)}`, `Due: ${formatDate(doc.dueDate)}`, ...(doc.taxInvoiceNumber ? [`${pack.taxInvoiceSystem ?? "Tax invoice"} no: ${doc.taxInvoiceNumber}`] : [])];
    party = doc.customer;
    lines = doc.lines;
    notes = doc.notes;
    totals = [{ label: "Subtotal", value: money(num(doc.subtotal)) }];
    if (business.vatRegistered) totals.push({ label: pack.vatName, value: money(num(doc.taxTotal)) });
    totals.push({ label: "Total", value: money(state.total), strong: true });
    if (state.paid > 0) {
      totals.push({ label: "Paid & credited", value: `-${money(state.paid)}` });
      totals.push({ label: state.balance <= 0.01 ? "Paid in full" : "Balance due", value: money(Math.max(0, state.balance)), strong: true });
    }
  } else if (link.kind === "quotation") {
    const doc = await prisma.quotation.findFirst({ where: { id: link.id, businessId: business.id, status: { not: "DRAFT" } }, include: { customer: true, lines: { orderBy: { position: "asc" } } } });
    if (!doc) notFound();
    title = "QUOTATION";
    number = doc.number;
    dates = [`Date: ${formatDate(doc.issueDate)}`, `Valid until: ${formatDate(doc.expiryDate)}`];
    partyLabel = "Prepared for";
    party = doc.customer;
    lines = doc.lines;
    notes = doc.notes;
    totals = [{ label: "Subtotal", value: money(num(doc.subtotal)) }];
    if (business.vatRegistered) totals.push({ label: pack.vatName, value: money(num(doc.taxTotal)) });
    totals.push({ label: "Total", value: money(num(doc.total)), strong: true });
  } else if (link.kind === "credit-note") {
    const doc = await prisma.creditNote.findFirst({ where: { id: link.id, businessId: business.id, status: "ISSUED" }, include: { customer: true, lines: { orderBy: { position: "asc" } } } });
    if (!doc) notFound();
    title = "CREDIT NOTE";
    number = doc.number;
    dates = [`Date: ${formatDate(doc.issueDate)}`];
    partyLabel = "Credit to";
    party = doc.customer;
    lines = doc.lines;
    notes = doc.reason ? `Reason: ${doc.reason}` : null;
    totals = [{ label: "Subtotal", value: money(num(doc.subtotal)) }];
    if (business.vatRegistered) totals.push({ label: pack.vatName, value: money(num(doc.taxTotal)) });
    totals.push({ label: "Total credit", value: money(num(doc.total)), strong: true });
  } else {
    const customer = await prisma.customer.findFirst({ where: { id: link.id, businessId: business.id } });
    if (!customer) notFound();
    const today = todayInNairobi();
    const from = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
    title = "STATEMENT";
    partyLabel = "Statement for";
    party = customer;
    [statement, outstanding] = await Promise.all([customerStatement(business.id, customer.id, from, today), openInvoicesFor(business.id, customer.id)]);
    range = `${formatDate(from)} to ${formatDate(today)}`;
    dates = [range];
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 print:bg-white print:p-0">
      <div className="mx-auto max-w-3xl">
        <div className="mb-3 flex justify-end print:hidden">
          <PrintButton />
        </div>
        <article className="rounded-lg border border-slate-200 bg-white p-6 sm:p-8 print:border-0 print:p-0">
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
              <p className="text-2xl font-bold tracking-tight text-slate-900">{title}</p>
              {number ? <p className="font-mono text-sm">{number}</p> : null}
              {dates.map((d) => (
                <p key={d} className="text-sm text-slate-600">
                  {d}
                </p>
              ))}
            </div>
          </header>

          {party ? (
            <section className="py-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{partyLabel}</p>
              <p className="font-semibold text-slate-900">{party.name}</p>
              {party.address ? <p className="text-sm text-slate-600">{party.address}</p> : null}
              {party.taxId ? (
                <p className="text-sm text-slate-600">
                  {pack.taxIdLabel}: {party.taxId}
                </p>
              ) : null}
            </section>
          ) : null}

          {statement && outstanding ? (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-300 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2">Date</th>
                    <th className="py-2">Details</th>
                    <th className="py-2 text-right">Charges</th>
                    <th className="py-2 text-right">Payments & credits</th>
                    <th className="py-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-100 text-slate-500">
                    <td className="py-2" colSpan={4}>
                      Balance brought forward
                    </td>
                    <td className="py-2 text-right">{money(statement.opening)}</td>
                  </tr>
                  {statement.rows.map((r, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="whitespace-nowrap py-2">{formatDate(r.date)}</td>
                      <td className="py-2">{r.label}</td>
                      <td className="py-2 text-right">{r.debit ? money(r.debit) : ""}</td>
                      <td className="py-2 text-right">{r.credit ? money(r.credit) : ""}</td>
                      <td className="py-2 text-right">{money(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 font-bold">
                    <td className="py-2" colSpan={4}>
                      Balance owing
                    </td>
                    <td className="py-2 text-right">{money(statement.closing)}</td>
                  </tr>
                </tfoot>
              </table>
              {outstanding.open.length > 0 ? (
                <section className="mt-8 space-y-2">
                  <h2 className="text-sm font-semibold text-slate-700">Unpaid invoices</h2>
                  <ul className="divide-y divide-slate-100 text-sm">
                    {outstanding.open.map((i) => (
                      <li key={i.id} className="flex justify-between py-1.5">
                        <span>
                          {i.number} · due {formatDate(i.dueDate)}
                          {i.daysOverdue > 0 ? <span className="text-rose-700"> ({i.daysOverdue} days overdue)</span> : null}
                        </span>
                        <span>{money(i.balance)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          ) : (
            <>
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
                  {lines.map((l) => (
                    <tr key={l.id} className="border-b border-slate-100">
                      <td className="py-2">{l.description}</td>
                      <td className="py-2 text-right">{formatNumber(num(l.quantity as never), num(l.quantity as never) % 1 ? 2 : 0)}</td>
                      <td className="py-2 text-right">{formatNumber(num(l.unitPrice as never), dp)}</td>
                      {business.vatRegistered ? <td className="py-2 text-right">{num(l.taxRate as never)}%</td> : null}
                      <td className="py-2 text-right">{formatNumber(num(l.lineTotal as never), dp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="ml-auto mt-4 w-full max-w-xs space-y-1 text-sm">
                {totals.map((t) => (
                  <div key={t.label} className={`flex justify-between ${t.strong ? "border-t border-slate-300 pt-1 text-base font-bold" : ""}`}>
                    <dt className={t.strong ? "" : "text-slate-500"}>{t.label}</dt>
                    <dd>{t.value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}

          {notes ? <p className="mt-6 text-sm text-slate-600">{notes}</p> : null}
          {business.invoiceFooter ? <p className="mt-6 border-t border-slate-200 pt-4 text-sm text-slate-600">{business.invoiceFooter}</p> : null}
        </article>
        <p className="mt-4 text-center text-xs text-slate-400 print:hidden">Prepared with Hakiki</p>
      </div>
    </main>
  );
}
