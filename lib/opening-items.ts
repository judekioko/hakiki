import "server-only";
import { prisma } from "./prisma";
import { round2 } from "./money";
import { accountIdsByKey, postBill, postSalesInvoice } from "./ledger";
import { lockMessage } from "./period-lock";

type Business = { id: string; lockedThrough: Date | null };
export type OpeningResult = { error: string } | { number: string };

// An unpaid customer invoice from before Hakiki: a normal sent invoice, so receipts, statements, ageing and
// reminders all work on it, but it credits opening balance equity instead of sales.
export async function createOpeningInvoice(
  business: Business,
  customer: { id: string },
  input: { reference: string; amount: number; issue: Date; due: Date }
): Promise<OpeningResult> {
  const locked = lockMessage(business, input.issue);
  if (locked) return { error: locked };
  const reference = input.reference.toUpperCase();
  const number = `OB-${reference}`;
  if (await prisma.salesInvoice.findUnique({ where: { businessId_number: { businessId: business.id, number } } })) {
    return { error: `${number} has already been entered` };
  }
  const keys = await accountIdsByKey(business.id);
  const amount = round2(input.amount);
  const invoice = await prisma.salesInvoice.create({
    data: {
      businessId: business.id,
      customerId: customer.id,
      number,
      status: "SENT",
      isOpening: true,
      issueDate: input.issue,
      dueDate: input.due,
      reference,
      notes: "Balance brought forward from before Hakiki",
      subtotal: amount,
      taxTotal: 0,
      total: amount,
      lines: {
        create: [
          {
            description: `Balance brought forward: invoice ${reference}`,
            quantity: 1,
            unitPrice: amount,
            accountId: keys.OPENING_BALANCE,
            lineTotal: amount,
            taxAmount: 0,
          },
        ],
      },
    },
  });
  await postSalesInvoice(invoice.id);
  return { number };
}

// An unpaid supplier bill from before Hakiki: owes the supplier, against opening balance equity rather than expense.
export async function createOpeningBill(
  business: Business,
  supplier: { id: string; name: string; kraPin: string | null },
  input: { reference: string; amount: number; issue: Date; due: Date }
): Promise<OpeningResult> {
  const locked = lockMessage(business, input.issue);
  if (locked) return { error: locked };
  const invoiceNumber = `OB-${input.reference.toUpperCase()}`;
  if (await prisma.invoice.findUnique({ where: { businessId_invoiceNumber: { businessId: business.id, invoiceNumber } } })) {
    return { error: `${invoiceNumber} has already been entered` };
  }
  const keys = await accountIdsByKey(business.id);
  const bill = await prisma.invoice.create({
    data: {
      businessId: business.id,
      supplierId: supplier.id,
      supplierName: supplier.name,
      supplierPin: supplier.kraPin,
      invoiceNumber,
      invoiceDate: input.issue,
      dueDate: input.due,
      totalAmount: round2(input.amount),
      vatAmount: 0,
      description: "Balance brought forward from before Hakiki",
      categoryAccountId: keys.OPENING_BALANCE,
      // Already tax-reported in an earlier period, so it is not something to chase an invoice for.
      status: "VERIFIED",
      isOpening: true,
    },
  });
  await postBill(bill.id);
  return { number: invoiceNumber };
}
