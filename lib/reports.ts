import "server-only";
import { prisma } from "./prisma";
import { num, round2 } from "./money";
import type { AccountType } from "./generated/prisma/client";
import { settledAmount } from "./sales";

export type AccountBalance = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  systemKey: string | null;
  moneyKind: string | null;
  debit: number;
  credit: number;
  // Positive in the account's normal direction: debit for assets/expenses, credit for the rest.
  balance: number;
};

const DEBIT_NORMAL: AccountType[] = ["ASSET", "EXPENSE"];

export async function accountBalances(businessId: string, range: { from?: Date; to?: Date } = {}): Promise<AccountBalance[]> {
  const [accounts, sums] = await Promise.all([
    prisma.account.findMany({ where: { businessId }, orderBy: { code: "asc" } }),
    prisma.journalLine.groupBy({
      by: ["accountId"],
      where: {
        entry: {
          businessId,
          date: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lt: range.to } : {}) },
        },
      },
      _sum: { debit: true, credit: true },
    }),
  ]);
  const byId = new Map(sums.map((s) => [s.accountId, s._sum]));
  return accounts.map((a) => {
    const debit = num(byId.get(a.id)?.debit);
    const credit = num(byId.get(a.id)?.credit);
    return {
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      systemKey: a.systemKey,
      moneyKind: a.moneyKind,
      debit: round2(debit),
      credit: round2(credit),
      balance: round2(DEBIT_NORMAL.includes(a.type) ? debit - credit : credit - debit),
    };
  });
}

export async function profitAndLoss(businessId: string, from: Date, to: Date) {
  const balances = await accountBalances(businessId, { from, to });
  const income = balances.filter((b) => b.type === "INCOME" && b.balance !== 0);
  const costOfSales = balances.filter((b) => b.type === "EXPENSE" && (b.systemKey === "COGS" || b.systemKey === "STOCK_ADJUSTMENTS") && b.balance !== 0);
  const expenses = balances.filter((b) => b.type === "EXPENSE" && !costOfSales.includes(b) && b.balance !== 0);
  const totalIncome = round2(income.reduce((s, b) => s + b.balance, 0));
  const totalCostOfSales = round2(costOfSales.reduce((s, b) => s + b.balance, 0));
  const totalExpenses = round2(expenses.reduce((s, b) => s + b.balance, 0));
  const grossProfit = round2(totalIncome - totalCostOfSales);
  return {
    income,
    costOfSales,
    expenses,
    totalIncome,
    totalCostOfSales,
    grossProfit,
    totalExpenses,
    netProfit: round2(grossProfit - totalExpenses),
  };
}

// Balance sheet at the end of the day before `asAt` (exclusive). Profit not yet closed to retained earnings is
// shown as a separate equity line so the sheet always balances.
export async function balanceSheet(businessId: string, asAt: Date) {
  const balances = await accountBalances(businessId, { to: asAt });
  const pick = (type: AccountType) => balances.filter((b) => b.type === type && b.balance !== 0);
  const assets = pick("ASSET");
  const liabilities = pick("LIABILITY");
  const equity = pick("EQUITY");
  const profitToDate = round2(
    balances.filter((b) => b.type === "INCOME").reduce((s, b) => s + b.balance, 0) -
      balances.filter((b) => b.type === "EXPENSE").reduce((s, b) => s + b.balance, 0)
  );
  const totalAssets = round2(assets.reduce((s, b) => s + b.balance, 0));
  const totalLiabilities = round2(liabilities.reduce((s, b) => s + b.balance, 0));
  const totalEquity = round2(equity.reduce((s, b) => s + b.balance, 0) + profitToDate);
  return { assets, liabilities, equity, profitToDate, totalAssets, totalLiabilities, totalEquity };
}

export async function vatSummary(businessId: string, from: Date, to: Date) {
  const balances = await accountBalances(businessId, { from, to });
  const output = balances.find((b) => b.systemKey === "VAT_OUT")?.balance ?? 0;
  const input = balances.find((b) => b.systemKey === "VAT_IN")?.balance ?? 0;
  const [sales, bills] = await Promise.all([
    prisma.salesInvoice.aggregate({
      where: { businessId, status: "SENT", issueDate: { gte: from, lt: to } },
      _sum: { subtotal: true, taxTotal: true, total: true },
      _count: true,
    }),
    prisma.invoice.aggregate({
      where: { businessId, invoiceDate: { gte: from, lt: to } },
      _sum: { totalAmount: true, vatAmount: true },
      _count: true,
    }),
  ]);
  return {
    output,
    input,
    net: round2(output - input),
    salesNet: num(sales._sum.subtotal),
    salesCount: sales._count,
    purchasesTotal: num(bills._sum.totalAmount),
    purchasesVat: num(bills._sum.vatAmount),
    purchasesCount: bills._count,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const AGING_BUCKETS = ["Current", "1–30 days", "31–60 days", "61–90 days", "Over 90 days"] as const;

function bucketFor(dueDate: Date, today: Date): number {
  const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / DAY_MS);
  if (daysOverdue <= 0) return 0;
  if (daysOverdue <= 30) return 1;
  if (daysOverdue <= 60) return 2;
  if (daysOverdue <= 90) return 3;
  return 4;
}

type AgingRow = { id: string; name: string; buckets: number[]; total: number };

function addToAging(rows: Map<string, AgingRow>, id: string, name: string, bucket: number, amount: number) {
  const row = rows.get(id) ?? { id, name, buckets: [0, 0, 0, 0, 0], total: 0 };
  row.buckets[bucket] = round2(row.buckets[bucket] + amount);
  row.total = round2(row.total + amount);
  rows.set(id, row);
}

export async function agedReceivables(businessId: string, today = new Date()) {
  const invoices = await prisma.salesInvoice.findMany({
    where: { businessId, status: "SENT" },
    include: {
      customer: { select: { id: true, name: true } },
      allocations: { select: { amount: true } },
      creditAllocations: { select: { amount: true } },
    },
  });
  const rows = new Map<string, AgingRow>();
  for (const inv of invoices) {
    const open = round2(num(inv.total) - settledAmount(inv));
    if (open <= 0.01) continue;
    addToAging(rows, inv.customer.id, inv.customer.name, bucketFor(inv.dueDate, today), open);
  }
  return [...rows.values()].sort((a, b) => b.total - a.total);
}

export async function agedPayables(businessId: string, today = new Date()) {
  const bills = await prisma.invoice.findMany({
    where: { businessId },
    include: { allocations: { select: { amount: true } }, creditAllocations: { select: { amount: true } } },
  });
  const rows = new Map<string, AgingRow>();
  for (const bill of bills) {
    const credited = bill.creditAllocations.reduce((s, a) => s + num(a.amount), 0);
    const open = round2(num(bill.totalAmount) - bill.allocations.reduce((s, a) => s + num(a.amount), 0) - credited);
    if (open <= 0.01) continue;
    const due = bill.dueDate ?? bill.invoiceDate;
    addToAging(rows, bill.supplierId ?? `name:${bill.supplierName}`, bill.supplierName, bucketFor(due, today), open);
  }
  return [...rows.values()].sort((a, b) => b.total - a.total);
}
