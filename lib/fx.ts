import "server-only";
import { prisma } from "./prisma";
import { num, round2 } from "./money";

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
  ACCUM_DEPRECIATION: { code: 1590, name: "Accumulated depreciation", type: "ASSET" },
  DEPRECIATION_EXPENSE: { code: 6850, name: "Depreciation", type: "EXPENSE" },
  ASSET_DISPOSAL: { code: 7200, name: "Gain or loss on sale of assets", type: "EXPENSE" },
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

// An amount typed against a money account. For a business-currency account it is the amount. For a foreign-currency
// account it is in that currency, and is converted at the rate given: `amount` is what the books hold.
export function convertForAccount(
  account: { currency: string | null },
  entered: number,
  rateInput: FormDataEntryValue | null,
  baseCurrency: string
): { error: string } | { amount: number; foreignAmount: number | null; exchangeRate: number | null } {
  if (!account.currency) return { amount: entered, foreignAmount: null, exchangeRate: null };
  const rate = Number(rateInput);
  if (!Number.isFinite(rate) || rate <= 0) {
    return { error: `This account is in ${account.currency}. Enter the exchange rate: how many ${baseCurrency} one ${account.currency} is worth` };
  }
  return { amount: round2(entered * rate), foreignAmount: entered, exchangeRate: rate };
}
