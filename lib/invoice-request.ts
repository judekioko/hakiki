import "server-only";
import { prisma } from "./prisma";
import { formatDate, formatKes } from "./format";
import { loadPayments } from "./coverage";

export async function buildInvoiceRequestMessage(businessId: string, supplierId: string) {
  const [business, supplier, rows] = await Promise.all([
    prisma.business.findUniqueOrThrow({ where: { id: businessId } }),
    prisma.supplier.findFirstOrThrow({ where: { id: supplierId, businessId } }),
    loadPayments(businessId, undefined, { supplierId }),
  ]);
  const missing = rows.filter((r) => r.unbacked > 0).sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());
  const lines = missing.map(
    (r) => `• ${formatDate(r.paidAt)} — ${formatKes(r.unbacked)}${r.reference ? ` (ref ${r.reference})` : ""}`
  );
  const buyer = business.kraPin ? `${business.name} (KRA PIN ${business.kraPin})` : business.name;
  const text = [
    `Hello ${supplier.name},`,
    ``,
    `This is ${buyer}. Please send us eTIMS invoices for these payments:`,
    ...lines,
    ``,
    `KRA now requires an eTIMS invoice for every business expense. Thank you!`,
  ].join("\n");
  return { supplier, missing, text };
}
