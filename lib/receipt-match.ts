import "server-only";
import { prisma } from "./prisma";
import { AMOUNT_TOLERANCE, num, round2 } from "./money";
import { nameSimilarity, normaliseAlias } from "./matching";
import { postReceipt } from "./ledger";
import { settledAmount } from "./sales";
import { isLocked } from "./period-lock";

export async function openSalesInvoices(businessId: string) {
  const invoices = await prisma.salesInvoice.findMany({
    where: { businessId, status: "SENT" },
    include: { allocations: { select: { amount: true } }, creditAllocations: { select: { amount: true } }, customer: { select: { id: true, name: true, aliases: true } } },
    orderBy: { issueDate: "asc" },
  });
  return invoices
    .map((inv) => ({
      id: inv.id,
      number: inv.number,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      total: num(inv.total),
      customer: inv.customer,
      open: round2(num(inv.total) - settledAmount(inv)),
    }))
    .filter((inv) => inv.open > 0.01);
}

// Applies money received to an open sales invoice when the amount matches exactly and the payer is the customer
// (or the invoice number appears in the payment details, as with paybill account numbers).
export async function runReceiptAutoMatch(businessId: string): Promise<number> {
  const [allReceipts, invoices, business] = await Promise.all([
    prisma.receipt.findMany({
      where: { businessId, allocations: { none: {} }, categoryAccountId: null },
      orderBy: { receivedAt: "asc" },
    }),
    openSalesInvoices(businessId),
    prisma.business.findUnique({ where: { id: businessId }, select: { lockedThrough: true } }),
  ]);
  // Money received in a closed period can no longer be changed, so it is never matched automatically.
  const receipts = allReceipts.filter((r) => !isLocked({ lockedThrough: business?.lockedThrough ?? null }, r.receivedAt));
  let linked = 0;

  for (const receipt of receipts) {
    const amount = num(receipt.amount);
    const text = `${receipt.details ?? ""} ${receipt.reference ?? ""}`.toUpperCase();
    const candidates = invoices.filter((inv) => {
      if (inv.open <= 0.01 || Math.abs(inv.open - amount) > AMOUNT_TOLERANCE) return false;
      if (text.includes(inv.number.toUpperCase())) return true;
      if (receipt.customerId) return receipt.customerId === inv.customer.id;
      return (
        inv.customer.aliases.includes(normaliseAlias(receipt.payer)) || nameSimilarity(receipt.payer, inv.customer.name) >= 0.5
      );
    });
    if (candidates.length !== 1) continue;
    const invoice = candidates[0];

    await prisma.receiptAllocation.create({ data: { receiptId: receipt.id, invoiceId: invoice.id, amount: invoice.open } });
    if (!receipt.customerId) {
      await prisma.receipt.update({ where: { id: receipt.id }, data: { customerId: invoice.customer.id } });
    }
    await postReceipt(receipt.id);
    invoice.open = 0;
    linked++;
  }
  return linked;
}
