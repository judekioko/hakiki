import "server-only";
import { prisma } from "./prisma";
import { num, round2 } from "./money";
import { postPayment } from "./ledger";
import { isLocked } from "./period-lock";
import { isConfidentMatch, scoreMatch, type MatchInvoice, type MatchPayment } from "./matching";

// Payments that still need invoice backing, with what is left unallocated.
export async function openPayments(businessId: string): Promise<MatchPayment[]> {
  const [payments, business] = await Promise.all([
    prisma.payment.findMany({
      where: { businessId, exemptReason: null },
      include: { allocations: { select: { amount: true } } },
    }),
    prisma.business.findUnique({ where: { id: businessId }, select: { lockedThrough: true } }),
  ]);
  // Payments in a closed period can no longer be changed, so they are never matched automatically.
  return payments
    .filter((p) => !isLocked({ lockedThrough: business?.lockedThrough ?? null }, p.paidAt))
    .map((p) => ({
      id: p.id,
      paidAt: p.paidAt,
      counterparty: p.counterparty,
      supplierId: p.supplierId,
      remaining: round2(num(p.amount) - p.allocations.reduce((s, a) => s + num(a.amount), 0)),
    }))
    .filter((p) => p.remaining > 0);
}

// Invoices that are not yet fully paid against, with what is left unallocated.
export async function openInvoices(businessId: string): Promise<MatchInvoice[]> {
  const invoices = await prisma.invoice.findMany({
    where: { businessId, status: { not: "REJECTED" } },
    include: { allocations: { select: { amount: true } }, supplier: { select: { aliases: true } } },
  });
  return invoices
    .map((i) => ({
      id: i.id,
      invoiceDate: i.invoiceDate,
      supplierName: i.supplierName,
      supplierId: i.supplierId,
      supplierAliases: i.supplier?.aliases ?? [],
      remaining: round2(num(i.totalAmount) - i.allocations.reduce((s, a) => s + num(a.amount), 0)),
    }))
    .filter((i) => i.remaining > 0);
}

// Links payments to invoices where there is exactly one clear match. Returns how many were linked.
export async function runAutoMatch(businessId: string): Promise<number> {
  const [payments, invoices] = await Promise.all([openPayments(businessId), openInvoices(businessId)]);
  let linked = 0;

  for (const payment of payments) {
    const ranked = invoices
      .map((invoice) => ({ invoice, match: scoreMatch(payment, invoice) }))
      .filter((r) => r.match !== null)
      .sort((a, b) => b.match!.score - a.match!.score);
    const [best, runnerUp] = ranked;
    if (!best || !isConfidentMatch(best.match!, runnerUp?.match ?? undefined)) continue;

    const amount = round2(Math.min(payment.remaining, best.invoice.remaining));
    await prisma.allocation.create({
      data: { paymentId: payment.id, invoiceId: best.invoice.id, amount },
    });
    if (!payment.supplierId && best.invoice.supplierId) {
      await prisma.payment.update({ where: { id: payment.id }, data: { supplierId: best.invoice.supplierId } });
    }
    await postPayment(payment.id);
    best.invoice.remaining = round2(best.invoice.remaining - amount);
    linked++;
  }
  return linked;
}
