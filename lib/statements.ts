import "server-only";
import { prisma } from "./prisma";
import { num, round2 } from "./money";
import { settledAmount } from "./sales";
import { AGING_BUCKETS, bucketFor } from "./reports";
import { todayInNairobi } from "./recurrence";

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type StatementRow = {
  date: Date;
  kind: "INVOICE" | "PAYMENT" | "CREDIT";
  label: string;
  detail: string | null;
  href: string;
  debit: number;
  credit: number;
  balance: number;
};

export type OpenInvoice = {
  id: string;
  number: string;
  issueDate: Date;
  dueDate: Date;
  total: number;
  balance: number;
  daysOverdue: number;
  bucket: number;
};

// Everything that changes what a customer owes, in the same terms the ledger uses for accounts receivable:
// sent invoices add to it; money received, applied or sitting unapplied on the customer, and issued credit notes
// take from it. Draft and void documents are ignored.
async function movements(businessId: string, customerId: string) {
  const [invoices, notes, receipts] = await Promise.all([
    prisma.salesInvoice.findMany({ where: { businessId, customerId, status: "SENT" } }),
    prisma.creditNote.findMany({ where: { businessId, customerId, status: "ISSUED" } }),
    prisma.receipt.findMany({
      where: { businessId, OR: [{ customerId }, { allocations: { some: { invoice: { customerId } } } }] },
      include: { allocations: { select: { amount: true, invoice: { select: { customerId: true } } } } },
    }),
  ]);

  const events: Omit<StatementRow, "balance">[] = [];
  for (const inv of invoices) {
    events.push({
      date: inv.issueDate,
      kind: "INVOICE",
      label: `Invoice ${inv.number}`,
      detail: inv.reference,
      href: `/app/sales/invoices/${inv.id}`,
      debit: num(inv.total),
      credit: 0,
    });
  }
  for (const note of notes) {
    events.push({
      date: note.issueDate,
      kind: "CREDIT",
      label: `Credit note ${note.number}`,
      detail: note.reason,
      href: `/app/sales/credit-notes/${note.id}`,
      debit: 0,
      credit: num(note.total),
    });
  }
  for (const r of receipts) {
    const amount = num(r.amount);
    const allocatedAll = Math.min(amount, r.allocations.reduce((s, a) => s + num(a.amount), 0));
    const allocatedHere = r.allocations.filter((a) => a.invoice.customerId === customerId).reduce((s, a) => s + num(a.amount), 0);
    // Unapplied money sits on the customer's account unless it was categorised somewhere else.
    const unapplied = r.customerId === customerId && !r.categoryAccountId ? Math.max(0, amount - allocatedAll) : 0;
    const credit = round2(allocatedHere + unapplied);
    if (credit <= 0) continue;
    events.push({
      date: r.receivedAt,
      kind: "PAYMENT",
      label: `Payment received${r.reference ? ` (${r.reference})` : ""}`,
      detail: allocatedHere > 0 && unapplied > 0 ? "Part applied to invoices, part on account" : unapplied > 0 ? "On account" : null,
      href: `/app/sales/receipts/${r.id}`,
      debit: 0,
      credit,
    });
  }

  const order = { INVOICE: 0, CREDIT: 1, PAYMENT: 2 } as const;
  events.sort((a, b) => a.date.getTime() - b.date.getTime() || order[a.kind] - order[b.kind]);
  return events;
}

// Opening balance, the movements between two dates (inclusive, Nairobi days) and the closing balance.
export async function customerStatement(businessId: string, customerId: string, from: Date, to: Date) {
  const events = await movements(businessId, customerId);
  const start = from.getTime() - EAT_OFFSET_MS;
  const end = to.getTime() + DAY_MS - EAT_OFFSET_MS;

  let balance = 0;
  for (const e of events) if (e.date.getTime() < start) balance = round2(balance + e.debit - e.credit);
  const opening = balance;

  const rows: StatementRow[] = [];
  for (const e of events) {
    const t = e.date.getTime();
    if (t < start || t >= end) continue;
    balance = round2(balance + e.debit - e.credit);
    rows.push({ ...e, balance });
  }
  const owedToday = round2(events.reduce((s, e) => s + e.debit - e.credit, 0));
  return { opening, rows, closing: balance, owedToday };
}

// Invoices still unpaid today, with how late each is, bucketed like the aged receivables report.
export async function openInvoicesFor(businessId: string, customerId: string, now = new Date()) {
  const today = todayInNairobi(now);
  const invoices = await prisma.salesInvoice.findMany({
    where: { businessId, customerId, status: "SENT" },
    include: { allocations: { select: { amount: true } }, creditAllocations: { select: { amount: true } } },
    orderBy: { dueDate: "asc" },
  });
  const open: OpenInvoice[] = [];
  const buckets = [0, 0, 0, 0, 0];
  for (const inv of invoices) {
    const balance = round2(num(inv.total) - settledAmount(inv));
    if (balance <= 0.01) continue;
    const bucket = bucketFor(inv.dueDate, today);
    buckets[bucket] = round2(buckets[bucket] + balance);
    open.push({
      id: inv.id,
      number: inv.number,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      total: num(inv.total),
      balance,
      daysOverdue: Math.max(0, Math.floor((today.getTime() - inv.dueDate.getTime()) / DAY_MS)),
      bucket,
    });
  }
  const overdue = round2(buckets.slice(1).reduce((s, v) => s + v, 0));
  return { open, buckets, bucketLabels: AGING_BUCKETS, overdue, total: round2(buckets.reduce((s, v) => s + v, 0)) };
}
