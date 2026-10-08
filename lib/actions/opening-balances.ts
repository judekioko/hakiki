"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { blockedByLock } from "@/lib/lock-guard";
import { audit } from "@/lib/audit";
import { formatDate } from "@/lib/format";
import { round2 } from "@/lib/money";
import { normaliseAlias } from "@/lib/matching";
import { findOrCreateSupplier } from "@/lib/suppliers";
import { postBill, postSalesInvoice } from "@/lib/ledger";
import { runAutoMatch } from "@/lib/auto-match";
import { runReceiptAutoMatch } from "@/lib/receipt-match";
import { createOpeningBill, createOpeningInvoice } from "@/lib/opening-items";
import { saveOpeningAccounts } from "@/lib/opening-entry";
import { firstError, parseJsonField } from "@/lib/validators";
import type { ActionState } from "./types";

function revalidateAll() {
  revalidatePath("/app", "layout");
}

const isoDay = /^\d{4}-\d{2}-\d{2}$/;
const balancesSchema = z.array(z.object({ accountId: z.string(), amount: z.coerce.number() }));

function parseDay(value: FormDataEntryValue | null) {
  const text = String(value ?? "");
  if (!isoDay.test(text)) return null;
  const d = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Saving replaces the whole opening entry, so the form always shows exactly what is in the books.
export async function saveOpeningBalances(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  if (business.role === "STAFF") return { error: "Only an owner or accountant can enter opening balances" };

  const date = parseDay(formData.get("openingDate"));
  if (!date) return { error: "Choose the date the balances are as at" };
  const input = parseJsonField(formData.get("balances"), balancesSchema);
  if (input.error) return { error: input.error };

  const result = await saveOpeningAccounts(business, date, input.data!);
  if ("error" in result) return { error: result.error };
  const count = `${result.count} account${result.count === 1 ? "" : "s"}`;
  await audit(business.id, "UPDATE", "OPENING_BALANCES", business.id, `Saved opening balances as at ${formatDate(date)} (${count})`);
  revalidateAll();
  return { success: `Saved opening balances for ${count} as at ${formatDate(date)}` };
}

const openingItemSchema = z.object({
  reference: z.string().trim().min(1, "Enter the original invoice number"),
  amount: z.coerce.number().positive("Enter the amount still owing"),
});

function openingDates(formData: FormData, openingDate: Date | null) {
  if (!openingDate) return { error: "Set the opening balance date first (Account balances, above)" };
  const issue = parseDay(formData.get("issueDate"));
  const due = parseDay(formData.get("dueDate"));
  if (!issue || !due) return { error: "Enter the invoice date and the due date" };
  if (issue.getTime() > openingDate.getTime()) return { error: `The invoice date must be on or before the opening balance date (${formatDate(openingDate)})` };
  if (due.getTime() < issue.getTime()) return { error: "The due date cannot be before the invoice date" };
  return { issue, due };
}

// An unpaid customer invoice from before Hakiki. It is a normal sent invoice, so receipts, statements, ageing and
// reminders all work on it, but it credits opening balance equity instead of sales.
export async function addOpeningInvoice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  if (business.role === "STAFF") return { error: "Only an owner or accountant can enter opening balances" };

  const parsed = openingItemSchema.safeParse({ reference: formData.get("reference"), amount: formData.get("amount") });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const dates = openingDates(formData, business.openingDate);
  if ("error" in dates) return { error: dates.error };

  let customer = String(formData.get("customerId") ?? "")
    ? await prisma.customer.findFirst({ where: { id: String(formData.get("customerId")), businessId: business.id } })
    : null;
  if (!customer) {
    const name = String(formData.get("newName") ?? "").trim();
    if (name.length < 2) return { error: "Choose a customer or type a new customer's name" };
    customer = await prisma.customer.create({ data: { businessId: business.id, name, aliases: [normaliseAlias(name)] } });
  }

  const result = await createOpeningInvoice(business, customer, {
    reference: parsed.data.reference,
    amount: parsed.data.amount,
    issue: dates.issue,
    due: dates.due,
  });
  if ("error" in result) return { error: result.error };
  await runReceiptAutoMatch(business.id);
  await audit(business.id, "CREATE", "OPENING_BALANCES", null, `Entered opening balance ${result.number} for ${customer.name} (${round2(parsed.data.amount).toFixed(2)})`);
  revalidateAll();
  return { success: `Added ${result.number} for ${customer.name}` };
}

export async function deleteOpeningInvoice(formData: FormData) {
  const { business } = await requireBusiness();
  if (business.role === "STAFF") return;
  const invoice = await prisma.salesInvoice.findFirst({
    where: { id: String(formData.get("invoiceId")), businessId: business.id, isOpening: true },
    include: { allocations: { select: { id: true } }, creditAllocations: { select: { id: true } } },
  });
  // Once payments or credits are applied it is part of the customer's history; void it instead.
  if (!invoice || invoice.allocations.length + invoice.creditAllocations.length > 0) return;
  if (await blockedByLock(business, "salesInvoice", invoice.id)) return;
  await prisma.salesInvoice.delete({ where: { id: invoice.id } });
  await postSalesInvoice(invoice.id);
  await audit(business.id, "DELETE", "OPENING_BALANCES", invoice.id, `Removed opening balance ${invoice.number}`);
  revalidateAll();
}

// An unpaid supplier bill from before Hakiki: owes the supplier, against opening balance equity rather than expense.
export async function addOpeningBill(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  if (business.role === "STAFF") return { error: "Only an owner or accountant can enter opening balances" };

  const parsed = openingItemSchema.safeParse({ reference: formData.get("reference"), amount: formData.get("amount") });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const dates = openingDates(formData, business.openingDate);
  if ("error" in dates) return { error: dates.error };

  let supplier = String(formData.get("supplierId") ?? "")
    ? await prisma.supplier.findFirst({ where: { id: String(formData.get("supplierId")), businessId: business.id } })
    : null;
  if (!supplier) {
    const name = String(formData.get("newName") ?? "").trim();
    if (name.length < 2) return { error: "Choose a supplier or type a new supplier's name" };
    supplier = await findOrCreateSupplier(business.id, name, null);
  }

  const result = await createOpeningBill(business, supplier, {
    reference: parsed.data.reference,
    amount: parsed.data.amount,
    issue: dates.issue,
    due: dates.due,
  });
  if ("error" in result) return { error: result.error };
  await runAutoMatch(business.id);
  await audit(business.id, "CREATE", "OPENING_BALANCES", null, `Entered opening balance ${result.number} owed to ${supplier.name} (${round2(parsed.data.amount).toFixed(2)})`);
  revalidateAll();
  return { success: `Added ${result.number} owed to ${supplier.name}` };
}

export async function deleteOpeningBill(formData: FormData) {
  const { business } = await requireBusiness();
  if (business.role === "STAFF") return;
  const bill = await prisma.invoice.findFirst({
    where: { id: String(formData.get("billId")), businessId: business.id, isOpening: true },
    include: { allocations: { select: { id: true } }, creditAllocations: { select: { id: true } } },
  });
  if (!bill || bill.allocations.length + bill.creditAllocations.length > 0) return;
  if (await blockedByLock(business, "bill", bill.id)) return;
  await prisma.invoice.delete({ where: { id: bill.id } });
  await postBill(bill.id);
  await audit(business.id, "DELETE", "OPENING_BALANCES", bill.id, `Removed opening balance ${bill.invoiceNumber}`);
  revalidateAll();
}
