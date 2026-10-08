import "server-only";
import { prisma } from "./prisma";
import { formatDate } from "./format";

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

export type LockableDocument = "payment" | "receipt" | "salesInvoice" | "bill" | "creditNote" | "payRun";

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
    case "payRun":
      return (await prisma.payRun.findUnique({ where: { id }, select: { payDate: true } }))?.payDate ?? null;
  }
}

// Checks the stored date of an existing document, plus any new date it is about to move to.
export async function assertDocumentOpen(
  business: Lockable,
  kind: LockableDocument,
  id: string,
  ...newDates: (Date | null | undefined)[]
) {
  if (!business.lockedThrough) return;
  assertOpen(business, await documentDate(kind, id), ...newDates);
}

export async function documentLockMessage(
  business: Lockable,
  kind: LockableDocument,
  id: string,
  ...newDates: (Date | null | undefined)[]
): Promise<string | null> {
  if (!business.lockedThrough) return null;
  return lockMessage(business, await documentDate(kind, id), ...newDates);
}
