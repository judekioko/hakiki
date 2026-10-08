import "server-only";
import { prisma } from "./prisma";
import { num, round2 } from "./money";
import { formatMoney } from "./format";
import { agedReceivables, agedPayables, profitAndLoss } from "./reports";
import { cashFlow } from "./cash-flow";
import { financialYear, currentFinancialYear } from "./periods";
import { stockLevels } from "./inventory";
import { orderSummaries } from "./purchase-orders";
import { quoteStatus } from "./quotations";

const EAT = 3 * 60 * 60 * 1000;

// Nairobi midnight on the first day of the month `offset` months from now.
function monthStart(offset: number, now = new Date()): Date {
  const local = new Date(now.getTime() + EAT);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + offset, 1) - EAT);
}

export type Insight = { text: string; tone: "good" | "warn" | "info"; href?: string };

function change(now: number, before: number): number | null {
  if (before <= 0) return null;
  return Math.round(((now - before) / before) * 100);
}

// Plain-language observations for the dashboard, each tied to a real figure in the books.
export async function businessInsights(business: { id: string; currency: string; yearEndMonth: number }, cashNow: number) {
  const money = (n: number) => formatMoney(n, business.currency);
  const thisStart = monthStart(0);
  const nextStart = monthStart(1);
  const lastStart = monthStart(-1);
  const threeBack = monthStart(-3);
  const fy = financialYear(currentFinancialYear(business.yearEndMonth), business.yearEndMonth);

  const [thisMonth, lastMonth, quarterFlow, receivables, payables, bestSellers, stock, quotes, orders] = await Promise.all([
    profitAndLoss(business.id, thisStart, nextStart),
    profitAndLoss(business.id, lastStart, thisStart),
    cashFlow(business.id, threeBack, thisStart),
    agedReceivables(business.id),
    agedPayables(business.id),
    prisma.salesInvoiceLine.groupBy({
      by: ["description"],
      where: { invoice: { businessId: business.id, status: "SENT", isOpening: false, issueDate: { gte: fy.start, lt: fy.end } } },
      _sum: { lineTotal: true },
      orderBy: { _sum: { lineTotal: "desc" } },
      take: 1,
    }),
    stockLevels(business.id),
    prisma.quotation.findMany({ where: { businessId: business.id, status: { in: ["SENT", "ACCEPTED"] } }, select: { status: true, expiryDate: true, total: true } }),
    orderSummaries(business.id),
  ]);

  const costsNow = round2(thisMonth.totalCostOfSales + thisMonth.totalExpenses);
  const costsBefore = round2(lastMonth.totalCostOfSales + lastMonth.totalExpenses);
  const salesChange = change(thisMonth.totalIncome, lastMonth.totalIncome);
  const costChange = change(costsNow, costsBefore);

  const insights: Insight[] = [];
  if (salesChange !== null) {
    insights.push({
      tone: salesChange >= 0 ? "good" : "warn",
      text: `Sales this month are ${money(thisMonth.totalIncome)}, ${salesChange >= 0 ? "up" : "down"} ${Math.abs(salesChange)}% on last month.`,
      href: "/app/reports/profit-and-loss",
    });
  }
  if (costChange !== null && Math.abs(costChange) >= 5) {
    insights.push({
      tone: costChange > 0 ? "warn" : "good",
      text: `Your costs ${costChange > 0 ? "increased" : "fell"} ${Math.abs(costChange)}% on last month (${money(costsNow)} so far this month).`,
      href: "/app/reports/profit-and-loss",
    });
  }
  const biggestCost = [...thisMonth.expenses].sort((a, b) => b.balance - a.balance)[0];
  if (biggestCost && biggestCost.balance > 0) {
    insights.push({ tone: "info", text: `Biggest expense this month: ${biggestCost.name}, ${money(biggestCost.balance)}.`, href: `/app/accounts/${biggestCost.id}` });
  }
  const topDebtor = receivables[0];
  if (topDebtor && topDebtor.total > 0) {
    const overdue = round2(topDebtor.total - topDebtor.buckets[0]);
    insights.push({
      tone: overdue > 0 ? "warn" : "info",
      text: `${topDebtor.name} owes you ${money(topDebtor.total)}${overdue > 0 ? `, ${money(overdue)} of it overdue` : ""}.`,
      href: "/app/sales/reminders",
    });
  }
  const best = bestSellers[0];
  if (best && num(best._sum.lineTotal) > 0) {
    insights.push({ tone: "info", text: `Best seller this year: ${best.description}, ${money(num(best._sum.lineTotal))} before tax.`, href: "/app/sales/invoices" });
  }

  // Runway: how long the money lasts if the last three months of day-to-day cash flow continue.
  const monthlyOperating = round2(quarterFlow.totals.operating / 3);
  if (monthlyOperating < 0 && cashNow > 0) {
    const days = Math.round((cashNow / -monthlyOperating) * 30);
    if (days < 365) {
      insights.push({
        tone: days < 90 ? "warn" : "info",
        text: `Day-to-day operations used ${money(-monthlyOperating)} of cash a month over the last 3 months. At that rate your ${money(cashNow)} lasts about ${days} days.`,
        href: "/app/reports/cash-flow",
      });
    }
  } else if (monthlyOperating > 0) {
    insights.push({ tone: "good", text: `Day-to-day operations brought in ${money(monthlyOperating)} of cash a month over the last 3 months.`, href: "/app/reports/cash-flow" });
  }

  const overduePayables = round2(payables.reduce((s, r) => s + r.total - r.buckets[0], 0));
  if (overduePayables > 0) {
    insights.push({ tone: "warn", text: `You have ${money(overduePayables)} of supplier bills past their due date.`, href: "/app/reports/aged-payables" });
  }

  const stockValue = round2(stock.reduce((s, i) => s + i.value, 0));
  const grni = await prisma.journalLine.aggregate({ where: { account: { businessId: business.id, systemKey: "GRNI" } }, _sum: { debit: true, credit: true } });
  const awaitingBills = round2(num(grni._sum.credit) - num(grni._sum.debit));
  if (awaitingBills > 0.5) {
    insights.push({ tone: "info", text: `${money(awaitingBills)} of stock has been delivered and is waiting for the supplier bill.`, href: "/app/purchase-orders" });
  }
  const openQuotes = quotes.filter((q) => quoteStatus(q) !== "EXPIRED");
  const lateOrders = orders.filter(
    (o) => (o.status === "ORDERED" || o.status === "PART_RECEIVED") && o.order.expectedDate && o.order.expectedDate.getTime() < Date.now() - 24 * 60 * 60 * 1000
  );
  if (lateOrders.length > 0) {
    insights.push({
      tone: "warn",
      text: `${lateOrders.length} purchase order${lateOrders.length === 1 ? " is" : "s are"} past the expected delivery date.`,
      href: "/app/purchase-orders",
    });
  }

  return {
    insights,
    salesThisMonth: thisMonth.totalIncome,
    salesChange,
    stockValue,
    openQuotes: { count: openQuotes.length, value: round2(openQuotes.reduce((s, q) => s + num(q.total), 0)) },
    onOrder: round2(orders.filter((o) => o.status === "ORDERED" || o.status === "PART_RECEIVED").reduce((s, o) => s + num(o.order.total), 0)),
    lateOrders: lateOrders.length,
  };
}
