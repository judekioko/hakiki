import "server-only";
import { prisma } from "./prisma";
import { num } from "./money";

// The most recent saved rate for each currency, as base-currency units per one unit of the foreign currency.
export async function latestRates(businessId: string): Promise<Record<string, number>> {
  const rows = await prisma.exchangeRate.findMany({ where: { businessId }, orderBy: { date: "desc" } });
  const rates: Record<string, number> = {};
  for (const r of rows) rates[r.currency] ??= num(r.rate);
  return rates;
}

// Exchange gains and losses live in one expense account (a negative balance is a net gain). Businesses created before
// foreign currencies existed do not have it yet, so it is created on first use.
export async function ensureFxAccount(businessId: string): Promise<string> {
  const existing = await prisma.account.findFirst({ where: { businessId, systemKey: "FX_GAIN_LOSS" } });
  if (existing) return existing.id;
  let code = 7100;
  while (await prisma.account.findFirst({ where: { businessId, code: String(code) } })) code += 10;
  const created = await prisma.account.create({
    data: { businessId, code: String(code), name: "Exchange gains and losses", type: "EXPENSE", systemKey: "FX_GAIN_LOSS" },
  });
  return created.id;
}
