"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { audit } from "@/lib/audit";
import { num, round2 } from "@/lib/money";
import { ensureFxAccount } from "@/lib/fx";
import { postCreditNote, postSupplierCredit } from "@/lib/ledger";
import { nextDocumentNumber } from "@/lib/document-lines";
import { lockMessage } from "@/lib/period-lock";
import { blockedWithMessage } from "@/lib/lock-guard";
import { settledAmount } from "@/lib/sales";
import { todayInNairobi } from "@/lib/recurrence";

// A foreign-currency invoice is booked at the rate on the day it was issued. Customers pay in the business currency
// at whatever the rate is when they pay, so a little can be left over on the invoice once the customer has paid in
// full in their own currency. This writes that remainder off as an exchange loss. It is recorded as an exchange
// difference credit note, so it shows up, can be voided, and is part of the audit trail like any other entry.
export async function settleInvoiceExchangeDifference(formData: FormData) {
  const { business } = await requireBusiness();
  if (business.role === "STAFF") return;
  const invoice = await prisma.salesInvoice.findFirst({
    where: { id: String(formData.get("invoiceId")), businessId: business.id, status: "SENT", currency: { not: null } },
    include: { allocations: { select: { amount: true } }, creditAllocations: { select: { amount: true } } },
  });
  if (!invoice) return;
  // Only what is left after the customer has paid something: never the whole invoice by accident.
  const balance = round2(num(invoice.total) - settledAmount(invoice));
  if (balance <= 0.01 || invoice.allocations.length === 0) return;

  const today = todayInNairobi();
  if (await blockedWithMessage(lockMessage(business, today))) return;

  const fxAccountId = await ensureFxAccount(business.id);
  const note = await prisma.creditNote.create({
    data: {
      businessId: business.id,
      customerId: invoice.customerId,
      invoiceId: invoice.id,
      number: await nextDocumentNumber(business.id, "FX-"),
      issueDate: today,
      status: "ISSUED",
      isFx: true,
      reason: `Exchange difference on invoice ${invoice.number}`,
      subtotal: balance,
      taxTotal: 0,
      total: balance,
      lines: { create: [{ description: "Exchange difference", quantity: 1, unitPrice: balance, accountId: fxAccountId, lineTotal: balance, taxAmount: 0 }] },
    },
  });
  await postCreditNote(note.id);
  await prisma.creditAllocation.create({ data: { creditNoteId: note.id, invoiceId: invoice.id, amount: balance } });
  await audit(business.id, "CREATE", "CREDIT_NOTE", note.id, `Wrote off ${balance.toFixed(2)} exchange difference on invoice ${invoice.number}`);
  revalidatePath("/app", "layout");
}

// The supplier side: a foreign-currency bill paid in full in its own currency can leave a small base-currency amount
// owing (or overpaid). The remaining amount is cleared as an exchange gain.
export async function settleBillExchangeDifference(formData: FormData) {
  const { business } = await requireBusiness();
  if (business.role === "STAFF") return;
  const bill = await prisma.invoice.findFirst({
    where: { id: String(formData.get("billId")), businessId: business.id, currency: { not: null }, supplierId: { not: null } },
    include: { allocations: { select: { amount: true } }, creditAllocations: { select: { amount: true } } },
  });
  if (!bill || !bill.supplierId) return;
  const settled = [...bill.allocations, ...bill.creditAllocations].reduce((s, a) => s + num(a.amount), 0);
  const balance = round2(num(bill.totalAmount) - settled);
  if (balance <= 0.01 || bill.allocations.length === 0) return;

  const today = todayInNairobi();
  if (await blockedWithMessage(lockMessage(business, today))) return;

  const fxAccountId = await ensureFxAccount(business.id);
  const existing = await prisma.supplierCredit.count({ where: { businessId: business.id, number: { startsWith: `FX-${bill.invoiceNumber}` } } });
  const credit = await prisma.supplierCredit.create({
    data: {
      businessId: business.id,
      supplierId: bill.supplierId,
      billId: bill.id,
      number: `FX-${bill.invoiceNumber}${existing ? `-${existing + 1}` : ""}`,
      creditDate: today,
      status: "ISSUED",
      isFx: true,
      reason: `Exchange difference on bill ${bill.invoiceNumber}`,
      subtotal: balance,
      taxTotal: 0,
      total: balance,
      lines: { create: [{ description: "Exchange difference", quantity: 1, unitPrice: balance, accountId: fxAccountId, lineTotal: balance, taxAmount: 0 }] },
    },
  });
  await postSupplierCredit(credit.id);
  await prisma.supplierCreditAllocation.create({ data: { creditId: credit.id, billId: bill.id, amount: balance } });
  await audit(business.id, "CREATE", "SUPPLIER_CREDIT", credit.id, `Cleared ${balance.toFixed(2)} exchange difference on bill ${bill.invoiceNumber}`);
  revalidatePath("/app", "layout");
}
