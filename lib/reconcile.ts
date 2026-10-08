import "server-only";
import { prisma } from "./prisma";
import { num, round2 } from "./money";
import { openFrom } from "./period-lock";

// Reconciliation works on the ledger lines of a money account (bank, mobile money or cash). Debits are money in,
// credits are money out. Imported statements become payments and receipts, which post those lines.

// A foreign-currency account is reconciled in its own currency: what counts is the amount in that currency, not the
// converted amount in the books.
export function lineMovement(line: { debit: unknown; credit: unknown; foreignAmount?: unknown }, foreign: boolean) {
  return foreign ? num(line.foreignAmount as never) : num(line.debit as never) - num(line.credit as never);
}

export function clearedBalance(opening: number, lines: { debit: unknown; credit: unknown; foreignAmount?: unknown }[], foreign = false) {
  return round2(opening + lines.reduce((s, l) => s + lineMovement(l, foreign), 0));
}

export async function previousReconciliation(accountId: string, before?: Date) {
  return prisma.reconciliation.findFirst({
    where: { accountId, status: "COMPLETED", ...(before ? { statementDate: { lt: before } } : {}) },
    orderBy: { statementDate: "desc" },
  });
}

// Lines that could appear on this statement: not cleared in another reconciliation and dated on or before it.
export async function candidateLines(reconciliation: { id: string; businessId: string; accountId: string; statementDate: Date }) {
  const account = await prisma.account.findUnique({ where: { id: reconciliation.accountId }, select: { currency: true } });
  return prisma.journalLine.findMany({
    where: {
      accountId: reconciliation.accountId,
      entry: {
        businessId: reconciliation.businessId,
        date: { lt: openFrom(reconciliation.statementDate) },
        // Revaluations only restate the books' value of a foreign balance: the bank never sees them.
        ...(account?.currency ? { NOT: { sourceType: "FX_REVALUATION" as const } } : {}),
      },
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
      const [last, inProgress, uncleared, totals, foreignTotal] = await Promise.all([
        previousReconciliation(account.id),
        prisma.reconciliation.findFirst({ where: { accountId: account.id, status: "IN_PROGRESS" } }),
        prisma.journalLine.count({
          where: { accountId: account.id, reconciliationId: null, ...(account.currency ? { entry: { NOT: { sourceType: "FX_REVALUATION" as const } } } : {}) },
        }),
        prisma.journalLine.aggregate({ where: { accountId: account.id }, _sum: { debit: true, credit: true } }),
        prisma.journalLine.aggregate({ where: { accountId: account.id }, _sum: { foreignAmount: true } }),
      ]);
      return {
        account,
        last,
        inProgress,
        uncleared,
        // For a foreign-currency account the balance in its own currency; otherwise the business-currency balance.
        ledgerBalance: account.currency ? round2(num(foreignTotal._sum.foreignAmount)) : round2(num(totals._sum.debit) - num(totals._sum.credit)),
      };
    })
  );
}
