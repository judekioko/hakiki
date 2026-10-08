import "server-only";
import { prisma } from "./prisma";
import { num, round2 } from "./money";
import { openFrom } from "./period-lock";

// Reconciliation works on the ledger lines of a money account (bank, mobile money or cash). Debits are money in,
// credits are money out. Imported statements become payments and receipts, which post those lines.

export function clearedBalance(opening: number, lines: { debit: unknown; credit: unknown }[]) {
  return round2(opening + lines.reduce((s, l) => s + num(l.debit as never) - num(l.credit as never), 0));
}

export async function previousReconciliation(accountId: string, before?: Date) {
  return prisma.reconciliation.findFirst({
    where: { accountId, status: "COMPLETED", ...(before ? { statementDate: { lt: before } } : {}) },
    orderBy: { statementDate: "desc" },
  });
}

// Lines that could appear on this statement: not cleared in another reconciliation and dated on or before it.
export async function candidateLines(reconciliation: { id: string; businessId: string; accountId: string; statementDate: Date }) {
  return prisma.journalLine.findMany({
    where: {
      accountId: reconciliation.accountId,
      entry: { businessId: reconciliation.businessId, date: { lt: openFrom(reconciliation.statementDate) } },
      OR: [{ reconciliationId: null }, { reconciliationId: reconciliation.id }],
    },
    include: { entry: { select: { date: true, memo: true, sourceType: true, sourceId: true } } },
    orderBy: [{ entry: { date: "asc" } }, { id: "asc" }],
  });
}

export async function reconciliationOverview(businessId: string) {
  const accounts = await prisma.account.findMany({
    where: { businessId, moneyKind: { not: null }, isArchived: false },
    orderBy: { code: "asc" },
  });
  return Promise.all(
    accounts.map(async (account) => {
      const [last, inProgress, uncleared, totals] = await Promise.all([
        previousReconciliation(account.id),
        prisma.reconciliation.findFirst({ where: { accountId: account.id, status: "IN_PROGRESS" } }),
        prisma.journalLine.count({ where: { accountId: account.id, reconciliationId: null } }),
        prisma.journalLine.aggregate({ where: { accountId: account.id }, _sum: { debit: true, credit: true } }),
      ]);
      return {
        account,
        last,
        inProgress,
        uncleared,
        ledgerBalance: round2(num(totals._sum.debit) - num(totals._sum.credit)),
      };
    })
  );
}
