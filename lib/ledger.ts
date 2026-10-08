import "server-only";
import { prisma } from "./prisma";
import { num, round2 } from "./money";
import { averageCost } from "./inventory";
import { PeriodLockedError, assertOpen, reconciledMessage } from "./period-lock";
import { orderLineValue } from "./grni";
import { ensureSystemAccount } from "./fx";
import type { ExemptReason, JournalSource, PaymentSource } from "./generated/prisma/client";

// Every document (sales invoice, bill, payment...) owns at most one journal entry.
// Whenever a document changes its entry is rebuilt from scratch, so the ledger never drifts from the documents.

type Line = { accountId: string; debit?: number; credit?: number; description?: string };

export async function accountIdsByKey(businessId: string): Promise<Record<string, string>> {
  const accounts = await prisma.account.findMany({
    where: { businessId, systemKey: { not: null } },
    select: { id: true, systemKey: true },
  });
  return Object.fromEntries(accounts.map((a) => [a.systemKey!, a.id]));
}

// Last line of defence for closed periods: no entry dated in one can be written, rewritten or deleted.
// It also protects lines already cleared in a completed bank reconciliation.
async function assertEntriesOpen(businessId: string, sourceType: JournalSource, sourceId: string, newDate?: Date) {
  const reconciled = await reconciledMessage(sourceType, sourceId);
  if (reconciled) throw new PeriodLockedError(reconciled);
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { lockedThrough: true } });
  if (!business?.lockedThrough) return;
  const existing = await prisma.journalEntry.findMany({ where: { sourceType, sourceId }, select: { date: true } });
  assertOpen(business, newDate, ...existing.map((e) => e.date));
}

export async function removeEntry(sourceType: JournalSource, sourceId: string) {
  const existing = await prisma.journalEntry.findFirst({ where: { sourceType, sourceId }, select: { businessId: true } });
  if (existing) await assertEntriesOpen(existing.businessId, sourceType, sourceId);
  await prisma.journalEntry.deleteMany({ where: { sourceType, sourceId } });
}

export async function replaceEntry(
  businessId: string,
  sourceType: JournalSource,
  sourceId: string,
  entry: { date: Date; memo: string; lines: Line[] }
) {
  // Merge lines per account and side, and drop zero amounts.
  const merged = new Map<string, { accountId: string; debit: number; credit: number; description?: string }>();
  for (const line of entry.lines) {
    const debit = round2(line.debit ?? 0);
    const credit = round2(line.credit ?? 0);
    if (debit === 0 && credit === 0) continue;
    const key = `${line.accountId}:${debit > 0 ? "D" : "C"}:${line.description ?? ""}`;
    const existing = merged.get(key) ?? { accountId: line.accountId, debit: 0, credit: 0, description: line.description };
    existing.debit = round2(existing.debit + debit);
    existing.credit = round2(existing.credit + credit);
    merged.set(key, existing);
  }
  const lines = [...merged.values()];
  await assertEntriesOpen(businessId, sourceType, sourceId, lines.length > 0 ? entry.date : undefined);
  const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(`Journal for ${sourceType} ${sourceId} does not balance (${totalDebit} vs ${totalCredit})`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.journalEntry.deleteMany({ where: { sourceType, sourceId } });
    if (lines.length === 0) return;
    await tx.journalEntry.create({
      data: {
        businessId,
        date: entry.date,
        memo: entry.memo,
        sourceType,
        sourceId,
        lines: { create: lines },
      },
    });
  });
}

const SOURCE_MONEY_KEY: Record<PaymentSource, string> = {
  MPESA: "MOBILE_MONEY",
  BANK: "BANK",
  CASH: "CASH",
  OTHER: "BANK",
};

export function moneyAccountFor(keys: Record<string, string>, moneyAccountId: string | null, source: PaymentSource) {
  return moneyAccountId ?? keys[SOURCE_MONEY_KEY[source]];
}

// Where money paid out lands when it is not settling a bill.
export function defaultPaymentCategoryKey(reason: ExemptReason | null, runsPayroll: boolean): string {
  switch (reason) {
    case "SALARIES":
      return runsPayroll ? "SALARIES_PAYABLE" : "SALARIES_EXPENSE";
    case "INTEREST_BANK_CHARGES":
      return "BANK_CHARGES";
    case "TAX_STATUTORY":
      return runsPayroll ? "PAYROLL_LIABILITIES" : "TAXES_LICENCES";
    case "OWN_TRANSFER":
      return "DRAWINGS";
    case "LOAN_REPAYMENT":
      return "LOANS";
    default:
      return "UNCATEGORISED_EXPENSE";
  }
}

export async function postPayment(paymentId: string) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { allocations: { select: { amount: true } }, business: { select: { _count: { select: { payRuns: true } } } } },
  });
  if (!payment) return removeEntry("PAYMENT", paymentId);

  const keys = await accountIdsByKey(payment.businessId);
  const amount = num(payment.amount);
  const allocated = Math.min(amount, round2(payment.allocations.reduce((s, a) => s + num(a.amount), 0)));
  const category =
    payment.categoryAccountId ?? keys[defaultPaymentCategoryKey(payment.exemptReason, payment.business._count.payRuns > 0)];

  await replaceEntry(payment.businessId, "PAYMENT", payment.id, {
    date: payment.paidAt,
    memo: `Paid ${payment.counterparty}${payment.reference ? ` (${payment.reference})` : ""}`,
    lines: [
      { accountId: keys.AP, debit: allocated },
      { accountId: category, debit: round2(amount - allocated) },
      { accountId: moneyAccountFor(keys, payment.moneyAccountId, payment.source), credit: amount },
    ],
  });
}

export async function postBill(invoiceId: string) {
  const bill = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { lines: { include: { item: true } }, business: { select: { vatRegistered: true } } },
  });
  if (!bill) {
    await prisma.stockMovement.deleteMany({ where: { sourceType: "BILL", sourceId: invoiceId } });
    return removeEntry("BILL", invoiceId);
  }

  const keys = await accountIdsByKey(bill.businessId);
  const claimVat = bill.business.vatRegistered;
  const total = num(bill.totalAmount);
  const lines: Line[] = [{ accountId: keys.AP, credit: total }];

  await prisma.stockMovement.deleteMany({ where: { sourceType: "BILL", sourceId: bill.id } });

  // Bills raised from a purchase order clear what was booked when the goods arrived (see postGoodsReceipt).
  const orderLines = bill.usesGrni
    ? await prisma.purchaseOrderLine.findMany({
        where: { id: { in: bill.lines.map((l) => l.purchaseOrderLineId).filter((id): id is string => !!id) } },
      })
    : [];
  const grniId = orderLines.length > 0 ? await ensureSystemAccount(bill.businessId, "GRNI") : null;
  const varianceId = orderLines.length > 0 ? await ensureSystemAccount(bill.businessId, "PURCHASE_VARIANCE") : null;

  if (bill.lines.length === 0) {
    const vat = claimVat ? num(bill.vatAmount) : 0;
    lines.push({ accountId: bill.categoryAccountId ?? keys.UNCATEGORISED_EXPENSE, debit: round2(total - vat) });
    lines.push({ accountId: keys.VAT_IN, debit: vat });
  } else {
    let vatTotal = 0;
    for (const line of bill.lines) {
      const net = num(line.lineTotal);
      const tax = num(line.taxAmount);
      const isStock = line.item?.kind === "INVENTORY";
      // Non-VAT-registered businesses cannot reclaim input VAT, so it becomes part of the cost.
      const cost = claimVat ? net : round2(net + tax);
      if (claimVat) vatTotal += tax;
      const orderLine = isStock && line.purchaseOrderLineId ? orderLines.find((o) => o.id === line.purchaseOrderLineId) : undefined;
      if (orderLine && grniId && varianceId) {
        // Stock came in (or will) with the delivery. The bill settles that accrual at the order price; whatever the
        // supplier charged above or below it is a price variance.
        const cleared = orderLineValue(orderLine, num(line.quantity), claimVat);
        lines.push({ accountId: grniId, debit: cleared });
        const variance = round2(cost - cleared);
        if (variance !== 0) lines.push(variance > 0 ? { accountId: varianceId, debit: variance } : { accountId: varianceId, credit: -variance });
        continue;
      }
      lines.push({ accountId: isStock ? keys.INVENTORY : line.accountId, debit: cost });
      if (isStock && line.itemId) {
        const qty = num(line.quantity);
        await prisma.stockMovement.create({
          data: {
            businessId: bill.businessId,
            itemId: line.itemId,
            date: bill.invoiceDate,
            quantity: qty,
            unitCost: qty > 0 ? cost / qty : 0,
            sourceType: "BILL",
            sourceId: bill.id,
            note: `Bill ${bill.invoiceNumber}`,
          },
        });
      }
    }
    lines.push({ accountId: keys.VAT_IN, debit: round2(vatTotal) });
    // Absorb rounding differences between the stated total and the line sum.
    const debits = round2(lines.reduce((s, l) => s + (l.debit ?? 0), 0));
    if (Math.abs(debits - total) > 0 && Math.abs(debits - total) <= 1) {
      lines.push(debits > total ? { accountId: keys.UNCATEGORISED_EXPENSE, credit: round2(debits - total) } : { accountId: keys.UNCATEGORISED_EXPENSE, debit: round2(total - debits) });
    }
  }

  await replaceEntry(bill.businessId, "BILL", bill.id, {
    date: bill.invoiceDate,
    memo: `Bill ${bill.invoiceNumber} from ${bill.supplierName}`,
    lines,
  });
}

export async function postSalesInvoice(invoiceId: string) {
  const invoice = await prisma.salesInvoice.findUnique({
    where: { id: invoiceId },
    include: { lines: { include: { item: true } }, customer: { select: { name: true } } },
  });
  await prisma.stockMovement.deleteMany({ where: { sourceType: "SALES_INVOICE", sourceId: invoiceId } });
  if (!invoice || invoice.status !== "SENT") return removeEntry("SALES_INVOICE", invoiceId);

  const keys = await accountIdsByKey(invoice.businessId);
  const lines: Line[] = [
    { accountId: keys.AR, debit: num(invoice.total) },
    { accountId: keys.VAT_OUT, credit: num(invoice.taxTotal) },
  ];
  for (const line of invoice.lines) {
    lines.push({ accountId: line.accountId, credit: num(line.lineTotal) });
    if (line.item?.kind === "INVENTORY" && line.itemId) {
      const qty = num(line.quantity);
      const unitCost = await averageCost(line.itemId);
      const cost = round2(unitCost * qty);
      await prisma.stockMovement.create({
        data: {
          businessId: invoice.businessId,
          itemId: line.itemId,
          date: invoice.issueDate,
          quantity: -qty,
          unitCost,
          sourceType: "SALES_INVOICE",
          sourceId: invoice.id,
          note: `Invoice ${invoice.number}`,
        },
      });
      lines.push({ accountId: keys.COGS, debit: cost }, { accountId: keys.INVENTORY, credit: cost });
    }
  }

  await replaceEntry(invoice.businessId, "SALES_INVOICE", invoice.id, {
    date: invoice.issueDate,
    memo: `Invoice ${invoice.number} to ${invoice.customer.name}`,
    lines,
  });
}

export async function postReceipt(receiptId: string) {
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    include: { allocations: { select: { amount: true } } },
  });
  if (!receipt) return removeEntry("RECEIPT", receiptId);

  const keys = await accountIdsByKey(receipt.businessId);
  const amount = num(receipt.amount);
  const allocated = Math.min(amount, round2(receipt.allocations.reduce((s, a) => s + num(a.amount), 0)));
  // Money from a known customer that is not yet applied sits on their account as a credit.
  const unappliedAccount =
    receipt.categoryAccountId ?? (receipt.customerId ? keys.AR : keys.UNALLOCATED_RECEIPTS);

  await replaceEntry(receipt.businessId, "RECEIPT", receipt.id, {
    date: receipt.receivedAt,
    memo: `Received from ${receipt.payer}${receipt.reference ? ` (${receipt.reference})` : ""}`,
    lines: [
      { accountId: moneyAccountFor(keys, receipt.moneyAccountId, receipt.source), debit: amount },
      { accountId: keys.AR, credit: allocated },
      { accountId: unappliedAccount, credit: round2(amount - allocated) },
    ],
  });
}

export async function postPayRun(payRunId: string) {
  const run = await prisma.payRun.findUnique({ where: { id: payRunId }, include: { payslips: true } });
  if (!run || run.status !== "APPROVED") return removeEntry("PAYRUN", payRunId);

  const keys = await accountIdsByKey(run.businessId);
  const sum = (field: "gross" | "incomeTax" | "employeeDeductions" | "employerContributions" | "net") =>
    round2(run.payslips.reduce((s, p) => s + num(p[field]), 0));
  const employer = sum("employerContributions");

  await replaceEntry(run.businessId, "PAYRUN", run.id, {
    date: run.payDate,
    memo: `Payroll for ${run.period}`,
    lines: [
      { accountId: keys.SALARIES_EXPENSE, debit: sum("gross") },
      { accountId: keys.PAYROLL_EXPENSE, debit: employer },
      { accountId: keys.PAYE_PAYABLE, credit: sum("incomeTax") },
      { accountId: keys.PAYROLL_LIABILITIES, credit: round2(sum("employeeDeductions") + employer) },
      { accountId: keys.SALARIES_PAYABLE, credit: sum("net") },
    ],
  });
}

export async function postCreditNote(creditNoteId: string) {
  const note = await prisma.creditNote.findUnique({
    where: { id: creditNoteId },
    include: { lines: { include: { item: true } }, customer: { select: { name: true } } },
  });
  await prisma.stockMovement.deleteMany({ where: { sourceType: "CREDIT_NOTE", sourceId: creditNoteId } });
  if (!note || note.status !== "ISSUED") return removeEntry("CREDIT_NOTE", creditNoteId);

  const keys = await accountIdsByKey(note.businessId);
  // The exact reverse of a sales invoice: take back the sale and the tax, reduce what the customer owes.
  const lines: Line[] = [
    { accountId: keys.AR, credit: num(note.total) },
    { accountId: keys.VAT_OUT, debit: num(note.taxTotal) },
  ];
  for (const line of note.lines) {
    lines.push({ accountId: line.accountId, debit: num(line.lineTotal) });
    if (note.restock && line.item?.kind === "INVENTORY" && line.itemId) {
      const qty = num(line.quantity);
      const unitCost = await averageCost(line.itemId);
      const cost = round2(unitCost * qty);
      await prisma.stockMovement.create({
        data: {
          businessId: note.businessId,
          itemId: line.itemId,
          date: note.issueDate,
          quantity: qty,
          unitCost,
          sourceType: "CREDIT_NOTE",
          sourceId: note.id,
          note: `Credit note ${note.number}`,
        },
      });
      lines.push({ accountId: keys.INVENTORY, debit: cost }, { accountId: keys.COGS, credit: cost });
    }
  }

  await replaceEntry(note.businessId, "CREDIT_NOTE", note.id, {
    date: note.issueDate,
    memo: `Credit note ${note.number} to ${note.customer.name}`,
    lines,
  });
}

export async function postSupplierCredit(creditId: string) {
  const credit = await prisma.supplierCredit.findUnique({
    where: { id: creditId },
    include: {
      lines: { include: { item: true } },
      supplier: { select: { name: true } },
      business: { select: { vatRegistered: true } },
    },
  });
  await prisma.stockMovement.deleteMany({ where: { sourceType: "SUPPLIER_CREDIT", sourceId: creditId } });
  if (!credit || credit.status !== "ISSUED") return removeEntry("SUPPLIER_CREDIT", creditId);

  const keys = await accountIdsByKey(credit.businessId);
  const claimVat = credit.business.vatRegistered;
  const total = num(credit.total);
  // The exact reverse of a bill: owe the supplier less, take back the cost and the input tax claimed.
  const lines: Line[] = [{ accountId: keys.AP, debit: total }];
  let vatTotal = 0;
  for (const line of credit.lines) {
    const net = num(line.lineTotal);
    const tax = num(line.taxAmount);
    // Non-VAT-registered businesses never claimed the input tax, so it comes back out of the cost.
    const cost = claimVat ? net : round2(net + tax);
    const backOutOfStock = credit.returnStock && line.item?.kind === "INVENTORY" && !!line.itemId;
    lines.push({ accountId: backOutOfStock ? keys.INVENTORY : line.accountId, credit: cost });
    if (claimVat) vatTotal += tax;
    if (backOutOfStock && line.itemId) {
      const qty = num(line.quantity);
      await prisma.stockMovement.create({
        data: {
          businessId: credit.businessId,
          itemId: line.itemId,
          date: credit.creditDate,
          quantity: -qty,
          unitCost: qty > 0 ? cost / qty : 0,
          sourceType: "SUPPLIER_CREDIT",
          sourceId: credit.id,
          note: `Supplier credit ${credit.number}`,
        },
      });
    }
  }
  lines.push({ accountId: keys.VAT_IN, credit: round2(vatTotal) });
  // Absorb rounding differences between the stated total and the line sum.
  const credits = round2(lines.reduce((s, l) => s + (l.credit ?? 0), 0));
  if (Math.abs(credits - total) > 0 && Math.abs(credits - total) <= 1) {
    lines.push(
      credits > total
        ? { accountId: keys.UNCATEGORISED_EXPENSE, debit: round2(credits - total) }
        : { accountId: keys.UNCATEGORISED_EXPENSE, credit: round2(total - credits) }
    );
  }

  await replaceEntry(credit.businessId, "SUPPLIER_CREDIT", credit.id, {
    date: credit.creditDate,
    memo: `Supplier credit ${credit.number} from ${credit.supplier.name}`,
    lines,
  });
}

// A delivery against a purchase order: stock comes in at the order price and the same amount is held in "Goods
// received not invoiced" until the supplier's bill arrives. Only receipts recorded since this existed are booked.
export async function postGoodsReceipt(receiptId: string) {
  const receipt = await prisma.goodsReceipt.findUnique({
    where: { id: receiptId },
    include: {
      lines: { include: { orderLine: { include: { item: true } } } },
      order: { select: { number: true } },
      business: { select: { vatRegistered: true } },
    },
  });
  await prisma.stockMovement.deleteMany({ where: { sourceType: "GOODS_RECEIPT", sourceId: receiptId } });
  if (!receipt || !receipt.accrued) return removeEntry("GOODS_RECEIPT", receiptId);

  const keys = await accountIdsByKey(receipt.businessId);
  const grniId = await ensureSystemAccount(receipt.businessId, "GRNI");
  const claimVat = receipt.business.vatRegistered;
  const lines: Line[] = [];
  for (const line of receipt.lines) {
    const orderLine = line.orderLine;
    if (orderLine.item?.kind !== "INVENTORY" || !orderLine.itemId) continue;
    const qty = num(line.quantity);
    const value = orderLineValue(orderLine, qty, claimVat);
    await prisma.stockMovement.create({
      data: {
        businessId: receipt.businessId,
        itemId: orderLine.itemId,
        date: receipt.receivedDate,
        quantity: qty,
        unitCost: qty > 0 ? value / qty : 0,
        sourceType: "GOODS_RECEIPT",
        sourceId: receipt.id,
        note: `Goods received ${receipt.number} (${receipt.order.number})`,
      },
    });
    lines.push({ accountId: keys.INVENTORY, debit: value }, { accountId: grniId, credit: value });
  }
  await replaceEntry(receipt.businessId, "GOODS_RECEIPT", receipt.id, {
    date: receipt.receivedDate,
    memo: `Goods received ${receipt.number} against ${receipt.order.number}`,
    lines,
  });
}
