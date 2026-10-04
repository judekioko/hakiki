import { num, round2 } from "./money";

export type InvoiceDisplayStatus = "DRAFT" | "VOID" | "PAID" | "PARTIAL" | "OVERDUE" | "UNPAID";

export const INVOICE_DISPLAY = {
  DRAFT: { label: "Draft", tone: "slate" },
  VOID: { label: "Void", tone: "slate" },
  PAID: { label: "Paid", tone: "teal" },
  PARTIAL: { label: "Part paid", tone: "amber" },
  OVERDUE: { label: "Overdue", tone: "rose" },
  UNPAID: { label: "Unpaid", tone: "amber" },
} as const;

export function invoiceState(
  invoice: { status: string; total: unknown; dueDate: Date; allocations: { amount: unknown }[] },
  today = new Date()
) {
  const total = num(invoice.total as never);
  const paid = round2(invoice.allocations.reduce((s, a) => s + num(a.amount as never), 0));
  const balance = round2(total - paid);
  let status: InvoiceDisplayStatus;
  if (invoice.status === "DRAFT") status = "DRAFT";
  else if (invoice.status === "VOID") status = "VOID";
  else if (balance <= 0.01) status = "PAID";
  else if (invoice.dueDate.getTime() < today.getTime() - 24 * 60 * 60 * 1000) status = "OVERDUE";
  else if (paid > 0) status = "PARTIAL";
  else status = "UNPAID";
  return { total, paid, balance, status };
}
