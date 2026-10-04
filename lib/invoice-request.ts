import "server-only";
import { prisma } from "./prisma";
import { formatDate, formatMoney } from "./format";
import { countryPack, taxInvoiceLabel } from "./countries";
import { loadPayments } from "./coverage";

export async function buildInvoiceRequestMessage(businessId: string, supplierId: string) {
  const [business, supplier, rows] = await Promise.all([
    prisma.business.findUniqueOrThrow({ where: { id: businessId } }),
    prisma.supplier.findFirstOrThrow({ where: { id: supplierId, businessId } }),
    loadPayments(businessId, undefined, { supplierId }),
  ]);
  const missing = rows.filter((r) => r.unbacked > 0).sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());
  const lines = missing.map(
    (r) => `• ${formatDate(r.paidAt)} — ${formatMoney(r.unbacked, business.currency)}${r.reference ? ` (ref ${r.reference})` : ""}`
  );
  const pack = countryPack(business.country);
  const label = taxInvoiceLabel(business.country);
  const buyer = business.kraPin ? `${business.name} (${pack.taxIdLabel} ${business.kraPin})` : business.name;
  const text = [
    `Hello ${supplier.name},`,
    ``,
    `This is ${buyer}. Please send us ${label}s for these payments:`,
    ...lines,
    ``,
    business.country === "KE" ? "KRA now requires an eTIMS invoice for every business expense. Thank you!" : "We need them for our tax records. Thank you!",
  ].join("\n");
  return { supplier, missing, text };
}
