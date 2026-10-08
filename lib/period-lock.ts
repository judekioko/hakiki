import "server-only";
import { prisma } from "./prisma";
import { formatDate } from "./format";
import type { JournalSource } from "./generated/prisma/client";

// "Closing the books": once a business is locked through a date, nothing dated on or before it can be added,
// changed or removed. The ledger enforces this for every entry (lib/ledger.ts); actions check it first so the
// user gets a clear message before any document is touched.

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export class PeriodLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PeriodLockedError";
  }
}

type Lockable = { lockedThrough: Date | null };

// First instant (Nairobi midnight) that is still open. Anything earlier belongs to a closed day.
export function openFrom(lockedThrough: Date): Date {
  return new Date(lockedThrough.getTime() + DAY_MS - EAT_OFFSET_MS);
}

export function isLocked(business: Lockable, date: Date | null | undefined): boolean {
  if (!business.lockedThrough || !date) return false;
  return date.getTime() < openFrom(business.lockedThrough).getTime();
}

export function lockMessage(business: Lockable, ...dates: (Date | null | undefined)[]): string | null {
  if (!dates.some((d) => isLocked(business, d))) return null;
  return `The books are closed through ${formatDate(business.lockedThrough!)}. Use a later date, or reopen the period under Accounting → Close the books.`;
}

// Throws when any of the dates falls in a closed period. Use in actions that cannot return a form error.
export function assertOpen(business: Lockable, ...dates: (Date | null | undefined)[]) {
  const message = lockMessage(business, ...dates);
  if (message) throw new PeriodLockedError(message);
}

export type LockableDocument = "payment" | "receipt" | "salesInvoice" | "bill" | "creditNote" | "supplierCredit" | "goodsReceipt" | "payRun";

async function documentDate(kind: LockableDocument, id: string): Promise<Date | null> {
  switch (kind) {
    case "payment":
      return (await prisma.payment.findUnique({ where: { id }, select: { paidAt: true } }))?.paidAt ?? null;
    case "receipt":
      return (await prisma.receipt.findUnique({ where: { id }, select: { receivedAt: true } }))?.receivedAt ?? null;
    case "salesInvoice":
      return (await prisma.salesInvoice.findUnique({ where: { id }, select: { issueDate: true } }))?.issueDate ?? null;
    case "bill":
      return (await prisma.invoice.findUnique({ where: { id }, select: { invoiceDate: true } }))?.invoiceDate ?? null;
    case "creditNote":
      return (await prisma.creditNote.findUnique({ where: { id }, select: { issueDate: true } }))?.issueDate ?? null;
    case "supplierCredit":
      return (await prisma.supplierCredit.findUnique({ where: { id }, select: { creditDate: true } }))?.creditDate ?? null;
    case "goodsReceipt":
      return (await prisma.goodsReceipt.findUnique({ where: { id }, select: { receivedDate: true } }))?.receivedDate ?? null;
    case "payRun":
      return (await prisma.payRun.findUnique({ where: { id }, select: { payDate: true } }))?.payDate ?? null;
  }
}

const SOURCE_FOR: Record<LockableDocument, JournalSource> = {
  payment: "PAYMENT",
  receipt: "RECEIPT",
  salesInvoice: "SALES_INVOICE",
  bill: "BILL",
  creditNote: "CREDIT_NOTE",
  supplierCredit: "SUPPLIER_CREDIT",
  goodsReceipt: "GOODS_RECEIPT",
  payRun: "PAYRUN",
};

// A line cleared in a completed bank reconciliation must not change under it.
export async function reconciledMessage(sourceType: JournalSource, sourceId: string): Promise<string | null> {
  const line = await prisma.journalLine.findFirst({
    where: { entry: { sourceType, sourceId }, reconciliation: { status: "COMPLETED" } },
    select: { reconciliation: { select: { statementDate: true, account: { select: { name: true } } } } },
  });
  if (!line?.reconciliation) return null;
  return `This was cleared in the ${line.reconciliation.account.name} reconciliation for ${formatDate(line.reconciliation.statementDate)}. Undo that reconciliation first (Accounting → Bank reconciliation).`;
}

// Why an existing document cannot be changed (closed period or already reconciled), or null if it can.
// Also checks any new date the document is about to move to.
export async function documentLockMessage(
  business: Lockable,
  kind: LockableDocument,
  id: string,
  ...newDates: (Date | null | undefined)[]
): Promise<string | null> {
  const closed = business.lockedThrough ? lockMessage(business, await documentDate(kind, id), ...newDates) : null;
  return closed ?? (await reconciledMessage(SOURCE_FOR[kind], id));
}

export async function assertDocumentOpen(
  business: Lockable,
  kind: LockableDocument,
  id: string,
  ...newDates: (Date | null | undefined)[]
) {
  const message = await documentLockMessage(business, kind, id, ...newDates);
  if (message) throw new PeriodLockedError(message);
}
