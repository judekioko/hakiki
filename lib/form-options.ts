import "server-only";
import { prisma } from "./prisma";
import { num } from "./money";
import { COUNTRIES, countryPack, taxInvoiceLabel } from "./countries";
import { moneyFormatter } from "./format";

export async function moneyAccountOptions(businessId: string) {
  const accounts = await prisma.account.findMany({
    where: { businessId, moneyKind: { not: null }, isArchived: false },
    orderBy: { code: "asc" },
  });
  return accounts.map((a) => ({ id: a.id, name: a.name, kind: a.moneyKind! }));
}

// Accounts a transaction can be categorised to (everything except the money accounts themselves).
export async function categoryAccountOptions(businessId: string) {
  const accounts = await prisma.account.findMany({
    where: { businessId, moneyKind: null, isArchived: false },
    orderBy: { code: "asc" },
  });
  return accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type as string }));
}

export async function allAccountOptions(businessId: string) {
  const accounts = await prisma.account.findMany({ where: { businessId, isArchived: false }, orderBy: { code: "asc" } });
  return accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type as string }));
}

export async function taxRateOptions(businessId: string) {
  const rates = await prisma.taxRate.findMany({ where: { businessId, isArchived: false }, orderBy: { rate: "desc" } });
  return rates.map((r) => ({ id: r.id, name: r.name, rate: num(r.rate), isDefault: r.isDefault }));
}

export async function itemOptions(businessId: string) {
  const items = await prisma.item.findMany({ where: { businessId, isArchived: false }, orderBy: { name: "asc" } });
  return items.map((i) => ({
    id: i.id,
    name: i.name,
    kind: i.kind as string,
    salePrice: num(i.salePrice),
    purchasePrice: num(i.purchasePrice),
    taxRateId: i.taxRateId,
    incomeAccountId: i.incomeAccountId,
    expenseAccountId: i.expenseAccountId,
  }));
}

export function countryOptions() {
  return COUNTRIES.map((c) => ({ code: c.code, name: c.name, currency: c.currency, taxIdLabel: c.taxIdLabel }));
}

// Country-dependent wording and money formatting for a business.
export function businessContext(business: { country: string; currency: string }) {
  const pack = countryPack(business.country);
  return {
    pack,
    fmt: moneyFormatter(business.currency),
    taxIdLabel: pack.taxIdLabel,
    taxInvoiceLabel: taxInvoiceLabel(business.country),
  };
}
