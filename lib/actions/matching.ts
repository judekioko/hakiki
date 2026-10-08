"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { assertDocumentOpen } from "@/lib/period-lock";
import { num, round2 } from "@/lib/money";
import { learnAlias } from "@/lib/suppliers";
import { runAutoMatch } from "@/lib/auto-match";
import { postPayment } from "@/lib/ledger";

export type MatchActionState = { error?: string; success?: string };

// Links a payment to an invoice for whatever amount both still have open.
export async function linkPaymentToInvoice(formData: FormData) {
  const { business } = await requireBusiness();
  const paymentId = String(formData.get("paymentId"));
  const invoiceId = String(formData.get("invoiceId"));

  const [payment, invoice] = await Promise.all([
    prisma.payment.findFirst({ where: { id: paymentId, businessId: business.id }, include: { allocations: true } }),
    prisma.invoice.findFirst({ where: { id: invoiceId, businessId: business.id }, include: { allocations: true, creditAllocations: true } }),
  ]);
  if (!payment || !invoice) throw new Error("Payment or invoice not found");
  if (payment.allocations.some((a) => a.invoiceId === invoice.id)) return;
  await assertDocumentOpen(business, "payment", payment.id);

  const paymentOpen = num(payment.amount) - payment.allocations.reduce((s, a) => s + num(a.amount), 0);
  const invoiceOpen =
    num(invoice.totalAmount) -
    invoice.allocations.reduce((s, a) => s + num(a.amount), 0) -
    invoice.creditAllocations.reduce((s, a) => s + num(a.amount), 0);
  const amount = round2(Math.min(paymentOpen, invoiceOpen));
  if (amount <= 0) throw new Error("Nothing left to allocate on this payment or invoice");

  await prisma.allocation.create({ data: { paymentId, invoiceId, amount } });

  // Teach the supplier this statement name so future imports link automatically.
  if (invoice.supplierId) {
    if (!payment.supplierId) {
      await prisma.payment.update({ where: { id: paymentId }, data: { supplierId: invoice.supplierId } });
    }
    await learnAlias(business.id, invoice.supplierId, payment.counterparty);
  }
  await postPayment(paymentId);
  revalidatePath("/app", "layout");
}

export async function unlinkAllocation(formData: FormData) {
  const { business } = await requireBusiness();
  const allocation = await prisma.allocation.findFirst({
    where: { id: String(formData.get("allocationId")), payment: { businessId: business.id } },
  });
  if (!allocation) return;
  await assertDocumentOpen(business, "payment", allocation.paymentId);
  await prisma.allocation.delete({ where: { id: allocation.id } });
  await postPayment(allocation.paymentId);
  revalidatePath("/app", "layout");
}

export async function autoMatchAction(): Promise<MatchActionState> {
  const { business } = await requireBusiness();
  const linked = await runAutoMatch(business.id);
  revalidatePath("/app", "layout");
  return linked
    ? { success: `Matched ${linked} payment${linked === 1 ? "" : "s"} to invoices` }
    : { success: "No new confident matches. Open a payment to see suggestions." };
}
