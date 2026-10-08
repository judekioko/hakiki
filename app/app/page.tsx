import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { runDueRecurring } from "@/lib/recurring";
import { accountBalances, agedPayables, agedReceivables, profitAndLoss } from "@/lib/reports";
import { currentFinancialYear, financialYear } from "@/lib/periods";
import { businessContext } from "@/lib/form-options";
import { loadPayments } from "@/lib/coverage";
import { stockLevels } from "@/lib/inventory";
import { num, round2 } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { LinkButton } from "@/components/bits";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { business } = await requireBusiness();
  // Recurring invoices that have fallen due are issued when someone opens the app.
  await runDueRecurring(business.id);
  const { fmt, taxInvoiceLabel } = businessContext(business);
  const period = financialYear(currentFinancialYear(business.yearEndMonth), business.yearEndMonth);

  const [balances, pnl, receivables, payables, drafts, unmatchedIn, payments, stock, monthly] = await Promise.all([
    accountBalances(business.id),
    profitAndLoss(business.id, period.start, period.end),
    agedReceivables(business.id),
    agedPayables(business.id),
    prisma.salesInvoice.count({ where: { businessId: business.id, status: "DRAFT" } }),
    prisma.receipt.count({ where: { businessId: business.id, allocations: { none: {} }, categoryAccountId: null, customerId: null } }),
    loadPayments(business.id, period),
    stockLevels(business.id),
    monthlyIncomeExpense(business.id, period.start, period.end),
  ]);

  const moneyAccounts = balances.filter((b) => b.moneyKind);
  const cash = round2(moneyAccounts.reduce((s, b) => s + b.balance, 0));
  const owedToYou = round2(receivables.reduce((s, r) => s + r.total, 0));
  const overdue = round2(receivables.reduce((s, r) => s + r.total - r.buckets[0], 0));
  const youOwe = round2(payables.reduce((s, r) => s + r.total, 0));
  const missingInvoices = payments.filter((p) => p.status === "MISSING" || p.status === "PARTIAL").length;
  const lowStock = stock.filter((s) => s.reorderLevel !== null && s.onHand <= s.reorderLevel);
  const monthMax = Math.max(1, ...monthly.flatMap((m) => [m.income, m.expense]));

  const todo = [
    drafts > 0 && { href: "/app/sales/invoices?status=DRAFT", text: `${drafts} draft invoice${drafts === 1 ? "" : "s"} not sent yet` },
    overdue > 0 && { href: "/app/reports/aged-receivables", text: `${fmt(overdue)} overdue from customers` },
    unmatchedIn > 0 && { href: "/app/sales/receipts?filter=unmatched", text: `${unmatchedIn} payment${unmatchedIn === 1 ? "" : "s"} received not matched to a customer` },
    missingInvoices > 0 && { href: "/app/expense-check", text: `${missingInvoices} payment${missingInvoices === 1 ? "" : "s"} out without a supplier ${taxInvoiceLabel}` },
    lowStock.length > 0 && { href: "/app/items", text: `${lowStock.length} item${lowStock.length === 1 ? "" : "s"} at or below reorder level` },
  ].filter((t): t is { href: string; text: string } => !!t);

  return (
    <div className="space-y-6">
      <PageHeader
        title={business.name}
        description={`${period.label} so far`}
        action={
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/app/payments/import" variant="secondary">
              Import statement
            </LinkButton>
            <LinkButton href="/app/invoices/new" variant="secondary">
              Record bill
            </LinkButton>
            <LinkButton href="/app/sales/invoices/new">New invoice</LinkButton>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Cash & bank" value={fmt(cash)} hint={`${moneyAccounts.length} accounts`} />
        <StatCard label="Owed to you" value={fmt(owedToYou)} hint={overdue > 0 ? `${fmt(overdue)} overdue` : "Nothing overdue"} />
        <StatCard label="You owe suppliers" value={fmt(youOwe)} hint="Unpaid bills" />
        <StatCard
          label="Net profit this year"
          value={fmt(pnl.netProfit)}
          hint={`Income ${fmt(pnl.totalIncome)} · Costs ${fmt(round2(pnl.totalCostOfSales + pnl.totalExpenses))}`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Income and expenses by month</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="flex h-48 items-end gap-2">
              {monthly.map((m) => (
                <div key={m.label} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex h-40 w-full items-end justify-center gap-0.5">
                    <div
                      className="w-1/2 rounded-t bg-teal-600"
                      style={{ height: `${(m.income / monthMax) * 100}%` }}
                      title={`Income ${fmt(m.income)}`}
                    />
                    <div
                      className="w-1/2 rounded-t bg-amber-400"
                      style={{ height: `${(m.expense / monthMax) * 100}%` }}
                      title={`Expenses ${fmt(m.expense)}`}
                    />
                  </div>
                  <span className="text-[11px] text-slate-500">{m.label}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-teal-600" />
                Income
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-amber-400" />
                Expenses incl. cost of sales
              </span>
            </div>
          </CardBody>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Needs attention</CardTitle>
            </CardHeader>
            <CardBody>
              {todo.length === 0 ? (
                <p className="text-sm text-slate-500">All caught up.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {todo.map((t) => (
                    <li key={t.href}>
                      <Link href={t.href} className="text-slate-800 hover:text-teal-700 hover:underline">
                        {t.text} →
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Money accounts</CardTitle>
            </CardHeader>
            <CardBody>
              <ul className="divide-y divide-slate-100 text-sm">
                {moneyAccounts.map((a) => (
                  <li key={a.id} className="flex justify-between py-2">
                    <Link href={`/app/accounts/${a.id}`} className="text-slate-800 hover:underline">
                      {a.name}
                    </Link>
                    <span className={a.balance < 0 ? "font-medium text-rose-700" : "font-medium"}>{fmt(a.balance)}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

async function monthlyIncomeExpense(businessId: string, from: Date, to: Date) {
  const lines = await prisma.journalLine.findMany({
    where: { entry: { businessId, date: { gte: from, lt: to } }, account: { type: { in: ["INCOME", "EXPENSE"] } } },
    select: { debit: true, credit: true, account: { select: { type: true } }, entry: { select: { date: true } } },
  });
  const EAT = 3 * 60 * 60 * 1000;
  const start = new Date(from.getTime() + EAT);
  const months: { label: string; income: number; expense: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    months.push({ label: d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" }), income: 0, expense: 0 });
  }
  for (const line of lines) {
    const local = new Date(line.entry.date.getTime() + EAT);
    const index = (local.getUTCFullYear() - start.getUTCFullYear()) * 12 + local.getUTCMonth() - start.getUTCMonth();
    const month = months[index];
    if (!month) continue;
    if (line.account.type === "INCOME") month.income += num(line.credit) - num(line.debit);
    else month.expense += num(line.debit) - num(line.credit);
  }
  return months.map((m) => ({ ...m, income: Math.max(0, round2(m.income)), expense: Math.max(0, round2(m.expense)) }));
}
