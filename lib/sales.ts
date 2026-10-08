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

type Amounts = { amount: unknown }[];

// Money received plus credit notes applied: everything that has reduced what the customer owes on an invoice.
export function settledAmount(invoice: { allocations: Amounts; creditAllocations?: Amounts }) {
  const sum = (rows: Amounts = []) => rows.reduce((s, a) => s + num(a.amount as never), 0);
  return round2(sum(invoice.allocations) + sum(invoice.creditAllocations));
}

export function invoiceState(
  invoice: { status: string; total: unknown; dueDate: Date; allocations: Amounts; creditAllocations?: Amounts },
  today = new Date()
) {
  const total = num(invoice.total as never);
  const paid = settledAmount(invoice);
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
