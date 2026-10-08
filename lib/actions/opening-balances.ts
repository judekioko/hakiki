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
import { accountIdsByKey, postBill, postSalesInvoice, replaceEntry } from "@/lib/ledger";
import { runAutoMatch } from "@/lib/auto-match";
import { runReceiptAutoMatch } from "@/lib/receipt-match";
import { lockMessage, reconciledMessage } from "@/lib/period-lock";
import { OPENING_EXCLUDED_KEYS, debitNatured } from "@/lib/opening-balances";
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

// One journal entry holds every opening account balance, with whatever is needed to make it balance booked to
// opening balance equity. Saving replaces the whole entry, so the form always shows exactly what is in the books.
export async function saveOpeningBalances(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  if (business.role === "STAFF") return { error: "Only an owner or accountant can enter opening balances" };

  const date = parseDay(formData.get("openingDate"));
  if (!date) return { error: "Choose the date the balances are as at" };
  if (date.getTime() > Date.now()) return { error: "The opening balance date cannot be in the future" };
  const dateLock = lockMessage(business, date);
  if (dateLock) return { error: dateLock };
  const reconciled = await reconciledMessage("OPENING_BALANCE", business.id);
  if (reconciled) return { error: reconciled };

  const input = parseJsonField(formData.get("balances"), balancesSchema);
  if (input.error) return { error: input.error };
  const entered = input.data!.filter((b) => Math.abs(b.amount) >= 0.005);

  const keys = await accountIdsByKey(business.id);
  const excluded = new Set(OPENING_EXCLUDED_KEYS.map((k) => keys[k]));
  const accounts = await prisma.account.findMany({
    where: { businessId: business.id, id: { in: entered.map((e) => e.accountId) } },
    select: { id: true, name: true, type: true },
  });
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const lines: { accountId: string; debit?: number; credit?: number; description?: string }[] = [];
  let debits = 0;
  let credits = 0;
  for (const e of entered) {
    const account = byId.get(e.accountId);
    if (!account || excluded.has(account.id)) return { error: "One of the accounts cannot take an opening balance here" };
    // Amounts are entered on each account's normal side; a negative amount is the opposite side.
    const debit = debitNatured(account.type) ? e.amount > 0 : e.amount < 0;
    const amount = round2(Math.abs(e.amount));
    lines.push(debit ? { accountId: account.id, debit: amount } : { accountId: account.id, credit: amount });
    if (debit) debits = round2(debits + amount);
    else credits = round2(credits + amount);
  }
  // Customer and supplier balances, stock and all the rest are booked separately, but they all sit against the same
  // opening balance equity account, so the figure here only plugs the accounts entered on this form.
  const plug = round2(debits - credits);
  if (plug !== 0) {
    lines.push({
      accountId: keys.OPENING_BALANCE,
      ...(plug > 0 ? { credit: plug } : { debit: -plug }),
      description: "Opening balance equity (balancing figure)",
    });
  }

  await replaceEntry(business.id, "OPENING_BALANCE", business.id, {
    date,
    memo: `Opening balances as at ${formatDate(date)}`,
    lines,
  });
  await prisma.business.update({ where: { id: business.id }, data: { openingDate: date } });
  await audit(
    business.id,
    "UPDATE",
    "OPENING_BALANCES",
    business.id,
    `Saved opening balances as at ${formatDate(date)} (${entered.length} account${entered.length === 1 ? "" : "s"})`
  );
  revalidateAll();
  return { success: `Saved opening balances for ${entered.length} account${entered.length === 1 ? "" : "s"} as at ${formatDate(date)}` };
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
  const locked = lockMessage(business, dates.issue);
  if (locked) return { error: locked };

  const number = `OB-${parsed.data.reference.toUpperCase()}`;
  if (await prisma.salesInvoice.findUnique({ where: { businessId_number: { businessId: business.id, number } } })) {
    return { error: `${number} has already been entered` };
  }

  let customer = String(formData.get("customerId") ?? "")
    ? await prisma.customer.findFirst({ where: { id: String(formData.get("customerId")), businessId: business.id } })
    : null;
  if (!customer) {
    const name = String(formData.get("newName") ?? "").trim();
    if (name.length < 2) return { error: "Choose a customer or type a new customer's name" };
    customer = await prisma.customer.create({ data: { businessId: business.id, name, aliases: [normaliseAlias(name)] } });
  }

  const keys = await accountIdsByKey(business.id);
  const amount = round2(parsed.data.amount);
  const invoice = await prisma.salesInvoice.create({
    data: {
      businessId: business.id,
      customerId: customer.id,
      number,
      status: "SENT",
      isOpening: true,
      issueDate: dates.issue,
      dueDate: dates.due,
      reference: parsed.data.reference.toUpperCase(),
      notes: "Balance brought forward from before Hakiki",
      subtotal: amount,
      taxTotal: 0,
      total: amount,
      lines: {
        create: [
          {
            description: `Balance brought forward: invoice ${parsed.data.reference.toUpperCase()}`,
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
  await runReceiptAutoMatch(business.id);
  await audit(business.id, "CREATE", "OPENING_BALANCES", invoice.id, `Entered opening balance ${number} for ${customer.name} (${amount.toFixed(2)})`);
  revalidateAll();
  return { success: `Added ${number} for ${customer.name}` };
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
  const locked = lockMessage(business, dates.issue);
  if (locked) return { error: locked };

  const invoiceNumber = `OB-${parsed.data.reference.toUpperCase()}`;
  if (await prisma.invoice.findUnique({ where: { businessId_invoiceNumber: { businessId: business.id, invoiceNumber } } })) {
    return { error: `${invoiceNumber} has already been entered` };
  }

  let supplier = String(formData.get("supplierId") ?? "")
    ? await prisma.supplier.findFirst({ where: { id: String(formData.get("supplierId")), businessId: business.id } })
    : null;
  if (!supplier) {
    const name = String(formData.get("newName") ?? "").trim();
    if (name.length < 2) return { error: "Choose a supplier or type a new supplier's name" };
    supplier = await findOrCreateSupplier(business.id, name, null);
  }

  const keys = await accountIdsByKey(business.id);
  const amount = round2(parsed.data.amount);
  const bill = await prisma.invoice.create({
    data: {
      businessId: business.id,
      supplierId: supplier.id,
      supplierName: supplier.name,
      supplierPin: supplier.kraPin,
      invoiceNumber,
      invoiceDate: dates.issue,
      dueDate: dates.due,
      totalAmount: amount,
      vatAmount: 0,
      description: "Balance brought forward from before Hakiki",
      categoryAccountId: keys.OPENING_BALANCE,
      // Already tax-reported in an earlier period, so it is not something to chase an invoice for.
      status: "VERIFIED",
      isOpening: true,
    },
  });
  await postBill(bill.id);
  await runAutoMatch(business.id);
  await audit(business.id, "CREATE", "OPENING_BALANCES", bill.id, `Entered opening balance ${invoiceNumber} owed to ${supplier.name} (${amount.toFixed(2)})`);
  revalidateAll();
  return { success: `Added ${invoiceNumber} owed to ${supplier.name}` };
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
