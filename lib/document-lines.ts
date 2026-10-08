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

export type PricedLineFx = PricedLine & {
  foreignUnitPrice: number;
  foreignLineTotal: number;
  foreignTaxAmount: number;
};

// Prices entered in a foreign currency. Each line is priced and taxed in that currency first, so the customer sees
// exact figures, then converted line by line to the business currency for the books.
export async function priceLinesFx(
  businessId: string,
  lines: LineInput[],
  side: "sale" | "purchase",
  fallbackAccountId: string,
  chargeTax: boolean,
  rate: number
): Promise<{ lines?: PricedLineFx[]; error?: string }> {
  const foreign = await priceLines(businessId, lines, side, fallbackAccountId, chargeTax);
  if (foreign.error) return { error: foreign.error };
  return {
    lines: foreign.lines!.map((l) => ({
      ...l,
      foreignUnitPrice: l.unitPrice,
      foreignLineTotal: l.lineTotal,
      foreignTaxAmount: l.taxAmount,
      unitPrice: round2(l.unitPrice * rate),
      lineTotal: round2(l.lineTotal * rate),
      taxAmount: round2(l.taxAmount * rate),
    })),
  };
}

export function totalsFx(lines: PricedLineFx[]) {
  const base = totals(lines);
  const foreignSubtotal = round2(lines.reduce((s, l) => s + l.foreignLineTotal, 0));
  const foreignTaxTotal = round2(lines.reduce((s, l) => s + l.foreignTaxAmount, 0));
  return { ...base, foreignSubtotal, foreignTaxTotal, foreignTotal: round2(foreignSubtotal + foreignTaxTotal) };
}

export function totals(lines: PricedLine[]) {
  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const taxTotal = round2(lines.reduce((s, l) => s + l.taxAmount, 0));
  return { subtotal, taxTotal, total: round2(subtotal + taxTotal) };
}

export async function nextDocumentNumber(businessId: string, prefix: string) {
  const where = { businessId, number: { startsWith: prefix } };
  const select = { number: true };
  const latest =
    prefix === "CN-" || prefix === "FX-"
      ? await prisma.creditNote.findMany({ where, select })
      : prefix === "QUO-"
        ? await prisma.quotation.findMany({ where, select })
        : prefix === "PO-"
          ? await prisma.purchaseOrder.findMany({ where, select })
          : prefix === "GRN-"
            ? await prisma.goodsReceipt.findMany({ where, select })
            : await prisma.salesInvoice.findMany({ where, select });
  const max = latest.reduce((m, r) => Math.max(m, Number(r.number.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}
