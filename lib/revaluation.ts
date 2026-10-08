import "server-only";
import { prisma } from "./prisma";
import { num, round2 } from "./money";
import { formatDate } from "./format";
import { replaceEntry, removeEntry } from "./ledger";
import { ensureSystemAccount } from "./fx";
import { lockMessage, openFrom } from "./period-lock";

type Business = { id: string; lockedThrough: Date | null };

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
export const revaluationSourceId = (accountId: string, date: Date) => `${accountId}:${dayKey(date)}`;

// The most recent saved rate for a currency on or before a day (base units per one foreign unit), if there is one.
export async function rateOn(businessId: string, currency: string, date: Date): Promise<number | null> {
  const row = await prisma.exchangeRate.findFirst({ where: { businessId, currency, date: { lte: date } }, orderBy: { date: "desc" } });
  return row ? num(row.rate) : null;
}

// Where each foreign-currency money account stands at the end of a day: what it holds in its own currency, what the
// books carry it at, and what it is worth at a given rate. Earlier revaluation entries stay in the book value; the
// entry for this same day is left out so posting it again replaces it rather than stacking.
export async function foreignAccountPositions(businessId: string, date: Date) {
  const cutoff = openFrom(date);
  const accounts = await prisma.account.findMany({
    where: { businessId, currency: { not: null }, moneyKind: { not: null }, isArchived: false },
    orderBy: { code: "asc" },
  });
  return Promise.all(
    accounts.map(async (account) => {
      const own = revaluationSourceId(account.id, date);
      const [foreign, book, saved, existing] = await Promise.all([
        prisma.journalLine.aggregate({ where: { accountId: account.id, entry: { date: { lt: cutoff } } }, _sum: { foreignAmount: true } }),
        prisma.journalLine.aggregate({
          where: { accountId: account.id, entry: { date: { lt: cutoff }, NOT: { sourceType: "FX_REVALUATION", sourceId: own } } },
          _sum: { debit: true, credit: true },
        }),
        rateOn(businessId, account.currency!, date),
        prisma.journalEntry.findFirst({ where: { sourceType: "FX_REVALUATION", sourceId: own }, select: { id: true } }),
      ]);
      return {
        account,
        currency: account.currency!,
        foreignBalance: round2(num(foreign._sum.foreignAmount)),
        bookBalance: round2(num(book._sum.debit) - num(book._sum.credit)),
        savedRate: saved,
        alreadyPosted: !!existing,
      };
    })
  );
}

// Brings a foreign-currency account's book value to what its balance is worth at the given rate, booking the
// difference as an exchange gain or loss. Posting again for the same day replaces the earlier entry.
export async function postRevaluation(
  business: Business,
  accountId: string,
  date: Date,
  rate: number
): Promise<{ error: string } | { difference: number }> {
  const locked = lockMessage(business, date);
  if (locked) return { error: locked };
  const position = (await foreignAccountPositions(business.id, date)).find((p) => p.account.id === accountId);
  if (!position) return { error: "That is not a foreign-currency account" };

  const target = round2(position.foreignBalance * rate);
  const difference = round2(target - position.bookBalance);
  const sourceId = revaluationSourceId(accountId, date);
  if (Math.abs(difference) < 0.005) {
    await removeEntry("FX_REVALUATION", sourceId);
    return { difference: 0 };
  }
  const fxAccountId = await ensureSystemAccount(business.id, "FX_GAIN_LOSS");
  await replaceEntry(business.id, "FX_REVALUATION", sourceId, {
    date,
    memo: `Revalue ${position.account.name} to ${position.currency} ${position.foreignBalance.toFixed(2)} at ${rate} (${formatDate(date)})`,
    lines:
      difference > 0
        ? [{ accountId, debit: difference }, { accountId: fxAccountId, credit: difference }]
        : [{ accountId, credit: -difference }, { accountId: fxAccountId, debit: -difference }],
  });
  await prisma.exchangeRate.upsert({
    where: { businessId_currency_date: { businessId: business.id, currency: position.currency, date } },
    create: { businessId: business.id, currency: position.currency, date, rate },
    update: { rate },
  });
  return { difference };
}
