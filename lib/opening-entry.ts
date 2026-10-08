import "server-only";
import { prisma } from "./prisma";
import { num, round2 } from "./money";
import { formatDate } from "./format";
import { accountIdsByKey, replaceEntry } from "./ledger";
import { lockMessage, reconciledMessage } from "./period-lock";
import { OPENING_EXCLUDED_KEYS, debitNatured } from "./opening-balances";

type Business = { id: string; lockedThrough: Date | null };

// Why opening balances cannot be saved as at this date right now, or null.
export async function openingEntryBlocked(business: Business, date: Date): Promise<string | null> {
  if (date.getTime() > Date.now()) return "The opening balance date cannot be in the future";
  return lockMessage(business, date) ?? (await reconciledMessage("OPENING_BALANCE", business.id));
}

// The balances already saved, each on its account's normal side (a minus sign means the opposite side).
export async function savedOpeningAmounts(businessId: string): Promise<Map<string, number>> {
  const entry = await prisma.journalEntry.findFirst({
    where: { businessId, sourceType: "OPENING_BALANCE", sourceId: businessId },
    include: { lines: { include: { account: { select: { type: true, systemKey: true } } } } },
  });
  const amounts = new Map<string, number>();
  for (const line of entry?.lines ?? []) {
    if (line.account.systemKey === "OPENING_BALANCE") continue;
    const net = round2(num(line.debit) - num(line.credit));
    amounts.set(line.accountId, round2((amounts.get(line.accountId) ?? 0) + (debitNatured(line.account.type) ? net : -net)));
  }
  return amounts;
}

// One journal entry holds every opening account balance, with whatever is needed to make it balance booked to
// opening balance equity. Saving replaces the whole entry, so `entered` must be the complete set of balances.
export async function saveOpeningAccounts(
  business: Business,
  date: Date,
  entered: { accountId: string; amount: number }[]
): Promise<{ error: string } | { count: number; plug: number }> {
  const blocked = await openingEntryBlocked(business, date);
  if (blocked) return { error: blocked };

  const nonZero = entered.filter((b) => Math.abs(b.amount) >= 0.005);
  const keys = await accountIdsByKey(business.id);
  const excluded = new Set<string>(OPENING_EXCLUDED_KEYS.map((k) => keys[k]));
  const accounts = await prisma.account.findMany({
    where: { businessId: business.id, id: { in: nonZero.map((e) => e.accountId) } },
    select: { id: true, name: true, type: true, currency: true },
  });
  const foreign = accounts.find((a) => a.currency);
  if (foreign) return { error: `${foreign.name} is in ${foreign.currency}. Enter its opening balance in the foreign-currency section of the Opening balances page.` };
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const lines: { accountId: string; debit?: number; credit?: number; description?: string }[] = [];
  let debits = 0;
  let credits = 0;
  for (const e of nonZero) {
    const account = byId.get(e.accountId);
    if (!account || excluded.has(account.id)) return { error: "One of the accounts cannot take an opening balance here" };
    // Amounts are entered on each account's normal side; a negative amount is the opposite side.
    const debit = debitNatured(account.type) ? e.amount > 0 : e.amount < 0;
    const amount = round2(Math.abs(e.amount));
    lines.push(debit ? { accountId: account.id, debit: amount } : { accountId: account.id, credit: amount });
    if (debit) debits = round2(debits + amount);
    else credits = round2(credits + amount);
  }
  // Customer and supplier balances, stock and the rest are booked separately, but they all sit against the same
  // opening balance equity account, so the figure here only plugs the accounts entered on this form.
  const plug = round2(debits - credits);
  if (plug !== 0) {
    lines.push({
      accountId: keys.OPENING_BALANCE,
      ...(plug > 0 ? { credit: plug } : { debit: -plug }),
      description: "Opening balance equity (balancing figure)",
    });
  }

  await replaceEntry(business.id, "OPENING_BALANCE", business.id, {
    date,
    memo: `Opening balances as at ${formatDate(date)}`,
    lines,
  });
  await prisma.business.update({ where: { id: business.id }, data: { openingDate: date } });
  return { count: nonZero.length, plug };
}
