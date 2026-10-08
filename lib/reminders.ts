import "server-only";
import { prisma } from "./prisma";
import { num, round2 } from "./money";
import { settledAmount } from "./sales";
import { todayInNairobi } from "./recurrence";
import type { ReminderInvoice } from "./reminder-text";

const DAY_MS = 24 * 60 * 60 * 1000;

export type OverdueCustomer = {
  customer: { id: string; name: string; phone: string | null; email: string | null };
  invoices: ReminderInvoice[];
  total: number;
  oldestDaysOverdue: number;
  lastReminder: { createdAt: Date; tone: string; channel: string; sentBy: string } | null;
  reminderCount: number;
};

// Sent invoices past their due date with a balance left, grouped by customer. A customer's balance here is invoice
// balances only; money received but not yet applied to an invoice is shown on the statement instead.
export async function overdueCustomers(businessId: string, customerId?: string): Promise<OverdueCustomer[]> {
  const today = todayInNairobi();
  const invoices = await prisma.salesInvoice.findMany({
    where: { businessId, status: "SENT", dueDate: { lt: today }, ...(customerId ? { customerId } : {}) },
    include: {
      customer: { select: { id: true, name: true, phone: true, email: true } },
      allocations: { select: { amount: true } },
      creditAllocations: { select: { amount: true } },
    },
    orderBy: { dueDate: "asc" },
  });

  const grouped = new Map<string, OverdueCustomer>();
  for (const inv of invoices) {
    const balance = round2(num(inv.total) - settledAmount(inv));
    if (balance <= 0.01) continue;
    const daysOverdue = Math.max(1, Math.floor((today.getTime() - inv.dueDate.getTime()) / DAY_MS));
    const entry = grouped.get(inv.customerId) ?? {
      customer: inv.customer,
      invoices: [],
      total: 0,
      oldestDaysOverdue: 0,
      lastReminder: null,
      reminderCount: 0,
    };
    entry.invoices.push({ number: inv.number, dueDate: inv.dueDate, balance, daysOverdue });
    entry.total = round2(entry.total + balance);
    entry.oldestDaysOverdue = Math.max(entry.oldestDaysOverdue, daysOverdue);
    grouped.set(inv.customerId, entry);
  }
  if (grouped.size === 0) return [];

  const reminders = await prisma.paymentReminder.findMany({
    where: { businessId, customerId: { in: [...grouped.keys()] } },
    orderBy: { createdAt: "desc" },
  });
  for (const r of reminders) {
    const entry = grouped.get(r.customerId)!;
    entry.reminderCount++;
    entry.lastReminder ??= { createdAt: r.createdAt, tone: r.tone, channel: r.channel, sentBy: r.sentBy };
  }
  // Biggest problems first: most overdue, then largest amount.
  return [...grouped.values()].sort((a, b) => b.oldestDaysOverdue - a.oldestDaysOverdue || b.total - a.total);
}
