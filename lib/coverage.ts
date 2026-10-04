import "server-only";
import { prisma } from "./prisma";
import { AMOUNT_TOLERANCE, num, round2 } from "./money";
import type { Period } from "./periods";
import type { ExemptReason, PaymentSource } from "./generated/prisma/client";

export type PaymentStatus = "BACKED" | "PARTIAL" | "MISSING" | "EXEMPT";

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  BACKED: "Backed",
  PARTIAL: "Partly backed",
  MISSING: "No invoice",
  EXEMPT: "Not needed",
};

export const PAYMENT_STATUS_TONE = {
  BACKED: "teal",
  PARTIAL: "amber",
  MISSING: "rose",
  EXEMPT: "slate",
} as const;

export function paymentStatus(amount: number, allocated: number, exemptReason: ExemptReason | null): PaymentStatus {
  if (exemptReason) return "EXEMPT";
  if (allocated >= amount - AMOUNT_TOLERANCE) return "BACKED";
  if (allocated > 0) return "PARTIAL";
  return "MISSING";
}

export type PaymentRow = {
  id: string;
  source: PaymentSource;
  reference: string | null;
  paidAt: Date;
  amount: number;
  allocated: number;
  unbacked: number;
  counterparty: string;
  details: string | null;
  supplierId: string | null;
  supplierName: string | null;
  exemptReason: ExemptReason | null;
  invoiceRequestedAt: Date | null;
  status: PaymentStatus;
};

export async function loadPayments(businessId: string, period?: Period, extraWhere: { supplierId?: string } = {}) {
  const payments = await prisma.payment.findMany({
    where: {
      businessId,
      ...extraWhere,
      ...(period ? { paidAt: { gte: period.start, lt: period.end } } : {}),
    },
    include: { allocations: { select: { amount: true } }, supplier: { select: { name: true } } },
    orderBy: { paidAt: "desc" },
  });

  return payments.map((p): PaymentRow => {
    const amount = num(p.amount);
    const allocated = round2(p.allocations.reduce((sum, a) => sum + num(a.amount), 0));
    const status = paymentStatus(amount, allocated, p.exemptReason);
    return {
      id: p.id,
      source: p.source,
      reference: p.reference,
      paidAt: p.paidAt,
      amount,
      allocated,
      unbacked: status === "EXEMPT" || status === "BACKED" ? 0 : round2(amount - allocated),
      counterparty: p.counterparty,
      details: p.details,
      supplierId: p.supplierId,
      supplierName: p.supplier?.name ?? null,
      exemptReason: p.exemptReason,
      invoiceRequestedAt: p.invoiceRequestedAt,
      status,
    };
  });
}

export type CoverageSummary = {
  totalPaid: number;
  backed: number;
  exempt: number;
  unbacked: number;
  needsInvoice: number;
  coveragePercent: number;
  taxAtRisk: number;
  missingCount: number;
  paymentCount: number;
};

export function summarise(rows: PaymentRow[], incomeTaxRate: number): CoverageSummary {
  let totalPaid = 0;
  let exempt = 0;
  let unbacked = 0;
  let missingCount = 0;
  for (const row of rows) {
    totalPaid += row.amount;
    if (row.status === "EXEMPT") exempt += row.amount;
    unbacked += row.unbacked;
    if (row.status === "MISSING" || row.status === "PARTIAL") missingCount++;
  }
  const needsInvoice = totalPaid - exempt;
  const backed = needsInvoice - unbacked;
  return {
    totalPaid: round2(totalPaid),
    backed: round2(backed),
    exempt: round2(exempt),
    unbacked: round2(unbacked),
    needsInvoice: round2(needsInvoice),
    coveragePercent: needsInvoice > 0 ? (backed / needsInvoice) * 100 : 100,
    taxAtRisk: Math.round((unbacked * incomeTaxRate) / 100),
    missingCount,
    paymentCount: rows.length,
  };
}

// Biggest gaps grouped by supplier (or by statement name when no supplier is linked yet).
export function gapsByPayee(rows: PaymentRow[], limit = 8) {
  const groups = new Map<string, { key: string; name: string; supplierId: string | null; unbacked: number; count: number }>();
  for (const row of rows) {
    if (row.unbacked <= 0) continue;
    const key = row.supplierId ?? `name:${row.counterparty.toUpperCase()}`;
    const group = groups.get(key) ?? {
      key,
      name: row.supplierName ?? row.counterparty,
      supplierId: row.supplierId,
      unbacked: 0,
      count: 0,
    };
    group.unbacked += row.unbacked;
    group.count++;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.unbacked - a.unbacked).slice(0, limit);
}

export function monthlyBreakdown(rows: PaymentRow[], period: Period) {
  const months: { label: string; backed: number; unbacked: number; exempt: number }[] = [];
  const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
  const localStart = new Date(period.start.getTime() + EAT_OFFSET_MS);
  const cursor = new Date(localStart);
  const localEnd = new Date(period.end.getTime() + EAT_OFFSET_MS);
  while (cursor < localEnd) {
    months.push({
      label: cursor.toLocaleString("en-GB", { month: "short", timeZone: "UTC" }),
      backed: 0,
      unbacked: 0,
      exempt: 0,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  for (const row of rows) {
    // Bucket by the Nairobi calendar month (UTC+3).
    const local = new Date(row.paidAt.getTime() + EAT_OFFSET_MS);
    const index =
      (local.getUTCFullYear() - localStart.getUTCFullYear()) * 12 +
      (local.getUTCMonth() - localStart.getUTCMonth());
    const month = months[index];
    if (!month) continue;
    if (row.status === "EXEMPT") month.exempt += row.amount;
    else {
      month.unbacked += row.unbacked;
      month.backed += row.amount - row.unbacked;
    }
  }
  return months;
}
