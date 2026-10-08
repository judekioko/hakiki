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

// System accounts added after a business was created are made on first use, in the first free code from the one
// suggested.
const SYSTEM_ACCOUNTS = {
  FX_GAIN_LOSS: { code: 7100, name: "Exchange gains and losses", type: "EXPENSE" },
  GRNI: { code: 2150, name: "Goods received not invoiced", type: "LIABILITY" },
  PURCHASE_VARIANCE: { code: 5200, name: "Purchase price variance", type: "EXPENSE" },
} as const;

export async function ensureSystemAccount(businessId: string, key: keyof typeof SYSTEM_ACCOUNTS): Promise<string> {
  const existing = await prisma.account.findFirst({ where: { businessId, systemKey: key } });
  if (existing) return existing.id;
  const spec = SYSTEM_ACCOUNTS[key];
  let code = spec.code;
  while (await prisma.account.findFirst({ where: { businessId, code: String(code) } })) code += 1;
  const created = await prisma.account.create({
    data: { businessId, code: String(code), name: spec.name, type: spec.type, systemKey: key },
  });
  return created.id;
}

// Exchange gains and losses live in one expense account (a negative balance is a net gain).
export const ensureFxAccount = (businessId: string) => ensureSystemAccount(businessId, "FX_GAIN_LOSS");
