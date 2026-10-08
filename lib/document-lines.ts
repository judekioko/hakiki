import "server-only";
import { prisma } from "./prisma";
import { round2 } from "./money";
import type { LineInput } from "./validators";

export type PricedLine = {
  itemId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRateId: string | null;
  taxRate: number;
  accountId: string;
  lineTotal: number;
  taxAmount: number;
  position: number;
};

// Prices are entered excluding tax. Tax rates, items and accounts are checked against the business.
export async function priceLines(
  businessId: string,
  lines: LineInput[],
  side: "sale" | "purchase",
  fallbackAccountId: string,
  chargeTax: boolean
): Promise<{ lines?: PricedLine[]; error?: string }> {
  const [rates, items, accounts] = await Promise.all([
    prisma.taxRate.findMany({ where: { businessId } }),
    prisma.item.findMany({ where: { businessId } }),
    prisma.account.findMany({ where: { businessId }, select: { id: true, type: true, moneyKind: true } }),
  ]);
  const priced: PricedLine[] = [];

  for (const [index, line] of lines.entries()) {
    const item = line.itemId ? items.find((i) => i.id === line.itemId) : undefined;
    if (line.itemId && !item) return { error: `Line ${index + 1}: item not found` };
    const rate = line.taxRateId ? rates.find((r) => r.id === line.taxRateId) : undefined;
    if (line.taxRateId && !rate) return { error: `Line ${index + 1}: tax rate not found` };

    const itemAccount = side === "sale" ? item?.incomeAccountId : item?.expenseAccountId;
    const accountId = line.accountId || itemAccount || fallbackAccountId;
    const account = accounts.find((a) => a.id === accountId);
    if (!account || account.moneyKind) return { error: `Line ${index + 1}: choose a valid account` };

    const taxRate = chargeTax && rate ? Number(rate.rate) : 0;
    const lineTotal = round2(line.quantity * line.unitPrice);
    priced.push({
      itemId: item?.id ?? null,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxRateId: chargeTax ? (rate?.id ?? null) : null,
      taxRate,
      accountId,
      lineTotal,
      taxAmount: round2((lineTotal * taxRate) / 100),
      position: index,
    });
  }
  return { lines: priced };
}

export function totals(lines: PricedLine[]) {
  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const taxTotal = round2(lines.reduce((s, l) => s + l.taxAmount, 0));
  return { subtotal, taxTotal, total: round2(subtotal + taxTotal) };
}

export async function nextDocumentNumber(businessId: string, prefix: string) {
  const where = { businessId, number: { startsWith: prefix } };
  const latest =
    prefix === "CN-"
      ? await prisma.creditNote.findMany({ where, select: { number: true } })
      : await prisma.salesInvoice.findMany({ where, select: { number: true } });
  const max = latest.reduce((m, r) => Math.max(m, Number(r.number.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}
