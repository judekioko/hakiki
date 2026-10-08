import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { formatDate, formatMoney, toDateInput } from "@/lib/format";
import { businessContext } from "@/lib/form-options";
import { toWhatsAppNumber } from "@/lib/kra";
import { todayInNairobi } from "@/lib/recurrence";
import { customerStatement, openInvoicesFor } from "@/lib/statements";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Customer statement" };

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = /^\d{4}-\d{2}-\d{2}$/;

function parseDay(value: string | undefined): Date | null {
  if (!value || !isoDay.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default async function StatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { business } = await requireBusiness();
  const { id } = await params;
  const query = await searchParams;
  const customer = await prisma.customer.findFirst({ where: { id, businessId: business.id } });
  if (!customer) notFound();

  const today = todayInNairobi();
  const to = parseDay(query.to) ?? today;
  const from = parseDay(query.from) ?? new Date(to.getTime() - 90 * DAY_MS);
  if (from.getTime() > to.getTime()) notFound();

  const { fmt, pack } = businessContext(business);
  const [statement, outstanding] = await Promise.all([
    customerStatement(business.id, customer.id, from, to),
    openInvoicesFor(business.id, customer.id),
  ]);
  const unapplied = Math.round((outstanding.total - statement.owedToday) * 100) / 100;

  // Presets for the common ranges.
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const lastMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const lastMonthEnd = new Date(monthStart.getTime() - DAY_MS);
  const presets = [
    { label: "Last 30 days", from: new Date(today.getTime() - 30 * DAY_MS), to: today },
    { label: "This month", from: monthStart, to: today },
    { label: "Last month", from: lastMonthStart, to: lastMonthEnd },
    { label: "Last 12 months", from: new Date(Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), today.getUTCDate())), to: today },
  ];
  const base = `/app/sales/customers/${customer.id}/statement`;

  // Ready-made messages so the statement can be sent over WhatsApp or email.
  const lines = [
    `Hello ${customer.name},`,
    ``,
    `Your statement from ${business.name} for ${formatDate(from)} to ${formatDate(to)}:`,
    `Balance owing: ${formatMoney(Math.max(0, statement.closing), business.currency)}`,
    ...(outstanding.overdue > 0 ? [`Of which overdue: ${formatMoney(outstanding.overdue, business.currency)}`] : []),
    ``,
    ...outstanding.open.slice(0, 10).map(
      (i) => `• ${i.number} — ${formatMoney(i.balance, business.currency)}, due ${formatDate(i.dueDate)}${i.daysOverdue > 0 ? ` (${i.daysOverdue} days overdue)` : ""}`
    ),
    ...(outstanding.open.length > 10 ? [`• and ${outstanding.open.length - 10} more`] : []),
    ``,
    `Thank you.`,
  ];
  const message = lines.join("\n");
  const phone = toWhatsAppNumber(customer.phone);
  const whatsapp = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : null;
  const mailto = customer.email
    ? `mailto:${customer.email}?subject=${encodeURIComponent(`Statement from ${business.name}`)}&body=${encodeURIComponent(message)}`
    : null;

  return (
    <div className="space-y-6">
      <div className="space-y-3 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={`/app/sales/customers/${customer.id}`} className="text-sm text-slate-500 hover:underline">
            ← {customer.name}
          </Link>
          <div className="flex flex-wrap gap-2">
            {whatsapp ? (
              <a href={whatsapp} target="_blank" rel="noreferrer" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Send on WhatsApp
              </a>
            ) : null}
            {mailto ? (
              <a href={mailto} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Send by email
              </a>
            ) : null}
            <PrintButton />
          </div>
        </div>
        {!whatsapp && !mailto ? (
          <p className="text-xs text-slate-500">Add a phone number or email to this customer to send the statement from here.</p>
        ) : null}
        <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3">
          <label className="text-xs text-slate-500">
            From
            <Input name="from" type="date" defaultValue={toDateInput(from)} className="mt-1" />
          </label>
          <label className="text-xs text-slate-500">
            To
            <Input name="to" type="date" defaultValue={toDateInput(to)} className="mt-1" />
          </label>
          <Button type="submit" variant="secondary" size="sm">
            Show
          </Button>
          <div className="flex flex-wrap gap-3 text-sm">
            {presets.map((p) => (
              <Link key={p.label} href={`${base}?from=${toDateInput(p.from)}&to=${toDateInput(p.to)}`} className="text-teal-700 hover:underline">
                {p.label}
              </Link>
            ))}
          </div>
        </form>
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
            <p className="text-2xl font-bold tracking-tight text-slate-900">STATEMENT</p>
            <p className="mt-2 text-sm text-slate-600">
              {formatDate(from)} to {formatDate(to)}
            </p>
            <p className="text-sm text-slate-600">Printed {formatDate(new Date())}</p>
          </div>
        </header>

        <section className="flex flex-wrap items-end justify-between gap-4 py-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Statement for</p>
            <p className="font-semibold text-slate-900">{customer.name}</p>
            {customer.address ? <p className="text-sm text-slate-600">{customer.address}</p> : null}
            {customer.taxId ? (
              <p className="text-sm text-slate-600">
                {pack.taxIdLabel}: {customer.taxId}
              </p>
            ) : null}
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-slate-400">Balance owing at {formatDate(to)}</p>
            <p className="text-2xl font-bold text-slate-900">{fmt(statement.closing)}</p>
          </div>
        </section>

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
              <td className="py-2">{formatDate(from)}</td>
              <td className="py-2" colSpan={3}>
                Balance brought forward
              </td>
              <td className="py-2 text-right">{fmt(statement.opening)}</td>
            </tr>
            {statement.rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-slate-500">
                  No activity in this period.
                </td>
              </tr>
            ) : (
              statement.rows.map((r, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="whitespace-nowrap py-2">{formatDate(r.date)}</td>
                  <td className="py-2">
                    <Link href={r.href} className="hover:underline print:no-underline">
                      {r.label}
                    </Link>
                    {r.detail ? <span className="block text-xs text-slate-500">{r.detail}</span> : null}
                  </td>
                  <td className="py-2 text-right">{r.debit ? fmt(r.debit) : ""}</td>
                  <td className="py-2 text-right">{r.credit ? fmt(r.credit) : ""}</td>
                  <td className="py-2 text-right">{fmt(r.balance)}</td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300 font-bold">
              <td className="py-2" colSpan={4}>
                Balance owing
              </td>
              <td className="py-2 text-right">{fmt(statement.closing)}</td>
            </tr>
          </tfoot>
        </table>

        {outstanding.open.length > 0 ? (
          <section className="mt-8 space-y-3">
            <h2 className="text-sm font-semibold text-slate-700">Unpaid invoices as at today</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-300 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2">Invoice</th>
                  <th className="py-2">Date</th>
                  <th className="py-2">Due</th>
                  <th className="py-2 text-right">Total</th>
                  <th className="py-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {outstanding.open.map((i) => (
                  <tr key={i.id} className="border-b border-slate-100">
                    <td className="py-1.5">{i.number}</td>
                    <td className="py-1.5">{formatDate(i.issueDate)}</td>
                    <td className={`py-1.5 ${i.daysOverdue > 0 ? "text-rose-700" : ""}`}>
                      {formatDate(i.dueDate)}
                      {i.daysOverdue > 0 ? ` (${i.daysOverdue} days overdue)` : ""}
                    </td>
                    <td className="py-1.5 text-right">{fmt(i.total)}</td>
                    <td className="py-1.5 text-right">{fmt(i.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {unapplied > 0.01 ? (
              <p className="text-xs text-slate-500">
                The customer also has {fmt(unapplied)} in payments or credit notes not yet applied to an invoice, which is why the balance
                owing above can be lower than the total of the unpaid invoices.
              </p>
            ) : null}
            <div className="grid grid-cols-5 gap-2 rounded-md bg-slate-50 p-3 text-center text-xs">
              {outstanding.bucketLabels.map((label, i) => (
                <div key={label}>
                  <p className="text-slate-500">{label}</p>
                  <p className={`font-semibold ${i > 0 && outstanding.buckets[i] > 0 ? "text-rose-700" : "text-slate-900"}`}>{fmt(outstanding.buckets[i])}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {business.invoiceFooter ? (
          <p className="mt-8 border-t border-slate-200 pt-4 text-sm text-slate-600">{business.invoiceFooter}</p>
        ) : null}
      </article>
    </div>
  );
}
