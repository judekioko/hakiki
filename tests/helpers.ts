import "dotenv/config";
import { prisma } from "../lib/prisma";
import { ensureBooks } from "../lib/books";

// The database tests need a scratch business each, created and removed by the test itself, so they can run against
// the local development database without touching its data. They refuse to run against anything that is not local.
export function assertLocalDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    throw new Error("The tests create and delete data, so they only run against a local database (localhost or 127.0.0.1).");
  }
}

export async function scratchBusiness(options: { vatRegistered?: boolean } = {}) {
  assertLocalDatabase();
  const business = await prisma.business.create({
    data: { name: `Test business ${Date.now()}-${Math.round(Math.random() * 1e6)}`, country: "KE", currency: "KES", vatRegistered: options.vatRegistered ?? true },
  });
  await ensureBooks(business);
  return prisma.business.findUniqueOrThrow({ where: { id: business.id } });
}

// Everything hangs off the business, so deleting it removes the lot.
export async function dropBusiness(businessId: string) {
  await prisma.business.delete({ where: { id: businessId } }).catch(() => {});
}

export async function accountByKey(businessId: string, systemKey: string) {
  return prisma.account.findFirstOrThrow({ where: { businessId, systemKey } });
}

export async function accountByName(businessId: string, name: string) {
  return prisma.account.findFirstOrThrow({ where: { businessId, name } });
}

// Debits minus credits on one account (positive = debit balance).
export async function balanceOf(accountId: string) {
  const sums = await prisma.journalLine.aggregate({ where: { accountId }, _sum: { debit: true, credit: true } });
  return Math.round((Number(sums._sum.debit ?? 0) - Number(sums._sum.credit ?? 0)) * 100) / 100;
}

// The books must always balance: every journal entry, and the business as a whole.
export async function bookTotals(businessId: string) {
  const sums = await prisma.journalLine.aggregate({ where: { entry: { businessId } }, _sum: { debit: true, credit: true } });
  const debit = Math.round(Number(sums._sum.debit ?? 0) * 100) / 100;
  const credit = Math.round(Number(sums._sum.credit ?? 0) * 100) / 100;
  return { debit, credit, balanced: Math.abs(debit - credit) < 0.005 };
}

export async function unbalancedEntries(businessId: string) {
  const entries = await prisma.journalEntry.findMany({ where: { businessId }, include: { lines: true } });
  return entries.filter((e) => Math.abs(e.lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0)) > 0.005);
}

export const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
