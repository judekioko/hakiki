"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { blockedByLock } from "@/lib/lock-guard";
import { documentLockMessage, lockMessage } from "@/lib/period-lock";
import { num, round2 } from "@/lib/money";
import { normaliseAlias } from "@/lib/matching";
import { audit } from "@/lib/audit";
import { settledAmount } from "@/lib/sales";
import { accountIdsByKey, postReceipt, postSalesInvoice } from "@/lib/ledger";
import { runReceiptAutoMatch } from "@/lib/receipt-match";
import { nextDocumentNumber, priceLines, priceLinesFx, totals, totalsFx, type PricedLineFx } from "@/lib/document-lines";
import { CURRENCIES } from "@/lib/currencies";
import { sourceForMoneyAccount } from "@/lib/money-accounts";
import {
  customerSchema,
  firstError,
  linesSchema,
  parseJsonField,
  receiptSchema,
  salesInvoiceSchema,
} from "@/lib/validators";
import type { ActionState } from "./types";

function revalidateAll() {
  revalidatePath("/app", "layout");
}

// ---------- Customers ----------

function readCustomer(formData: FormData) {
  return customerSchema.safeParse({
    name: formData.get("name"),
    taxId: formData.get("taxId") ?? "",
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    address: formData.get("address") ?? "",
  });
}

export async function createCustomer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const parsed = readCustomer(formData);
  if (!parsed.success) return { error: firstError(parsed.error) };
  const customer = await prisma.customer.create({
    data: { businessId: business.id, ...parsed.data, aliases: [normaliseAlias(parsed.data.name)] },
  });
  revalidateAll();
  redirect(`/app/sales/customers/${customer.id}`);
}

export async function updateCustomer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const parsed = readCustomer(formData);
  if (!parsed.success) return { error: firstError(parsed.error) };
  await prisma.customer.updateMany({
    where: { id: String(formData.get("customerId")), businessId: business.id },
    data: {
      name: parsed.data.name,
      taxId: parsed.data.taxId ?? null,
      phone: parsed.data.phone ?? null,
      email: parsed.data.email ?? null,
      address: parsed.data.address ?? null,
    },
  });
  revalidateAll();
  return { success: "Customer saved" };
}

// ---------- Sales invoices ----------

export async function saveSalesInvoice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const parsed = salesInvoiceSchema.safeParse({
    customerId: formData.get("customerId") ?? "",
    newCustomerName: formData.get("newCustomerName") ?? "",
    issueDate: formData.get("issueDate"),
    dueDate: formData.get("dueDate"),
    reference: formData.get("reference") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const data = parsed.data;
  if (data.dueDate < data.issueDate) return { error: "The due date cannot be before the invoice date" };
  const editingId = String(formData.get("invoiceId") ?? "");
  const issueAt = new Date(`${data.issueDate}T00:00:00Z`);
  const locked = editingId ? await documentLockMessage(business, "salesInvoice", editingId, issueAt) : lockMessage(business, issueAt);
  if (locked) return { error: locked };

  const lineInput = parseJsonField(formData.get("lines"), linesSchema);
  if (lineInput.error) return { error: lineInput.error };

  const keys = await accountIdsByKey(business.id);
  // An invoice can be written in another currency. Prices are then entered in that currency and converted to the
  // business currency at the rate given, which is what the books hold.
  const currency = String(formData.get("currency") ?? "").trim().toUpperCase();
  const foreign = !!currency && currency !== business.currency;
  const rate = foreign ? Number(formData.get("exchangeRate")) : 1;
  if (foreign && !CURRENCIES.some((c) => c.code === currency)) return { error: "Choose a currency from the list" };
  if (foreign && (!Number.isFinite(rate) || rate <= 0)) {
    return { error: `Enter the exchange rate: how many ${business.currency} one ${currency} is worth` };
  }
  const priced = foreign
    ? await priceLinesFx(business.id, lineInput.data!, "sale", keys.SALES, business.vatRegistered, rate)
    : await priceLines(business.id, lineInput.data!, "sale", keys.SALES, business.vatRegistered);
  if (priced.error) return { error: priced.error };
  const sums = totals(priced.lines!);
  const fxSums = foreign ? totalsFx(priced.lines as PricedLineFx[]) : null;
  const fxFields = {
    currency: foreign ? currency : null,
    exchangeRate: foreign ? rate : null,
    foreignSubtotal: fxSums?.foreignSubtotal ?? null,
    foreignTaxTotal: fxSums?.foreignTaxTotal ?? null,
    foreignTotal: fxSums?.foreignTotal ?? null,
  };

  let customerId = data.customerId
    ? (await prisma.customer.findFirst({ where: { id: data.customerId, businessId: business.id } }))?.id
    : undefined;
  if (!customerId) {
    if (!data.newCustomerName) return { error: "Choose a customer or type a new customer's name" };
    const created = await prisma.customer.create({
      data: { businessId: business.id, name: data.newCustomerName, aliases: [normaliseAlias(data.newCustomerName)] },
    });
    customerId = created.id;
  }

  const send = formData.get("intent") === "send";
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const header = {
    customerId,
    issueDate: new Date(`${data.issueDate}T00:00:00Z`),
    dueDate: new Date(`${data.dueDate}T00:00:00Z`),
    reference: data.reference ?? null,
    notes: data.notes ?? null,
    ...sums,
    ...fxFields,
  };
  const lineRows = priced.lines!.map((l) => ({ ...l }));

  let id: string;
  if (invoiceId) {
    const existing = await prisma.salesInvoice.findFirst({
      where: { id: invoiceId, businessId: business.id },
      include: { allocations: { select: { amount: true } }, creditAllocations: { select: { amount: true } } },
    });
    if (!existing) return { error: "Invoice not found" };
    if (existing.status === "VOID") return { error: "A void invoice cannot be edited" };
    if (existing.isOpening) return { error: "This is an opening balance. Remove and re-enter it under Opening balances." };
    const paid = settledAmount(existing);
    if (paid > sums.total + 0.01) return { error: "The new total is less than what the customer has already paid" };
    await prisma.$transaction([
      prisma.salesInvoiceLine.deleteMany({ where: { invoiceId } }),
      prisma.salesInvoice.update({
        where: { id: invoiceId },
        data: { ...header, status: send ? "SENT" : existing.status, lines: { create: lineRows } },
      }),
    ]);
    id = invoiceId;
  } else {
    const created = await prisma.salesInvoice.create({
      data: {
        businessId: business.id,
        number: await nextDocumentNumber(business.id, "INV-"),
        status: send ? "SENT" : "DRAFT",
        ...header,
        lines: { create: lineRows },
      },
    });
    id = created.id;
  }

  await postSalesInvoice(id);
  await runReceiptAutoMatch(business.id);
  await audit(
    business.id,
    invoiceId ? "UPDATE" : "CREATE",
    "SALES_INVOICE",
    id,
    `${invoiceId ? "Edited" : "Created"} invoice (${send ? "sent" : "draft"}) total ${sums.total.toFixed(2)}`
  );
  revalidateAll();
  redirect(`/app/sales/invoices/${id}`);
}

async function ownedInvoice(businessId: string, formData: FormData) {
  return prisma.salesInvoice.findFirst({
    where: { id: String(formData.get("invoiceId")), businessId },
    include: { allocations: true },
  });
}

export async function markInvoiceSent(formData: FormData) {
  const { business } = await requireBusiness();
  const invoice = await ownedInvoice(business.id, formData);
  if (!invoice || invoice.status !== "DRAFT") return;
  if (await blockedByLock(business, "salesInvoice", invoice.id)) return;
  await prisma.salesInvoice.update({ where: { id: invoice.id }, data: { status: "SENT" } });
  await postSalesInvoice(invoice.id);
  await runReceiptAutoMatch(business.id);
  await audit(business.id, "SEND", "SALES_INVOICE", invoice.id, `Marked invoice ${invoice.number} as sent`);
  revalidateAll();
}

export async function voidInvoice(formData: FormData) {
  const { business } = await requireBusiness();
  const invoice = await ownedInvoice(business.id, formData);
  if (!invoice || invoice.status === "VOID") return;
  // Payments applied to the invoice go back to being unapplied money from the customer.
  const receiptIds = invoice.allocations.map((a) => a.receiptId);
  if (await blockedByLock(business, "salesInvoice", invoice.id)) return;
  for (const receiptId of receiptIds) if (await blockedByLock(business, "receipt", receiptId)) return;
  await prisma.receiptAllocation.deleteMany({ where: { invoiceId: invoice.id } });
  await prisma.creditAllocation.deleteMany({ where: { invoiceId: invoice.id } });
  await prisma.salesInvoice.update({ where: { id: invoice.id }, data: { status: "VOID" } });
  await postSalesInvoice(invoice.id);
  for (const id of receiptIds) await postReceipt(id);
  await audit(business.id, "VOID", "SALES_INVOICE", invoice.id, `Voided invoice ${invoice.number}`);
  revalidateAll();
}

export async function deleteDraftInvoice(formData: FormData) {
  const { business } = await requireBusiness();
  const invoice = await ownedInvoice(business.id, formData);
  if (!invoice || invoice.status !== "DRAFT") return;
  await prisma.salesInvoice.delete({ where: { id: invoice.id } });
  await postSalesInvoice(invoice.id);
  await audit(business.id, "DELETE", "SALES_INVOICE", invoice.id, `Deleted draft invoice ${invoice.number}`);
  revalidateAll();
  redirect("/app/sales/invoices");
}

export async function setTaxInvoiceNumber(formData: FormData) {
  const { business } = await requireBusiness();
  const value = String(formData.get("taxInvoiceNumber") ?? "").trim().toUpperCase();
  await prisma.salesInvoice.updateMany({
    where: { id: String(formData.get("invoiceId")), businessId: business.id },
    data: { taxInvoiceNumber: value || null },
  });
  revalidateAll();
}

// ---------- Money received ----------

export async function recordReceipt(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const parsed = receiptSchema.safeParse({
    receivedAt: formData.get("receivedAt"),
    amount: formData.get("amount"),
    payer: formData.get("payer"),
    reference: formData.get("reference") ?? "",
    details: formData.get("details") ?? "",
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const data = parsed.data;

  const account = await prisma.account.findFirst({
    where: { id: String(formData.get("moneyAccountId") ?? ""), businessId: business.id, moneyKind: { not: null } },
  });
  if (!account) return { error: "Choose the account the money went into" };

  const receivedLock = lockMessage(business, new Date(`${data.receivedAt}T12:00:00+03:00`));
  if (receivedLock) return { error: receivedLock };

  const reference = data.reference?.toUpperCase() ?? null;
  if (reference && (await prisma.receipt.findFirst({ where: { businessId: business.id, reference } }))) {
    return { error: `Money with reference ${reference} has already been recorded` };
  }

  const invoiceId = String(formData.get("invoiceId") ?? "");
  const invoice = invoiceId
    ? await prisma.salesInvoice.findFirst({
        where: { id: invoiceId, businessId: business.id, status: "SENT" },
        include: { allocations: { select: { amount: true } }, creditAllocations: { select: { amount: true } } },
      })
    : null;
  let customerId = String(formData.get("customerId") ?? "") || invoice?.customerId || null;
  if (customerId && !(await prisma.customer.findFirst({ where: { id: customerId, businessId: business.id } }))) {
    customerId = null;
  }

  const receipt = await prisma.receipt.create({
    data: {
      businessId: business.id,
      customerId,
      moneyAccountId: account.id,
      source: sourceForMoneyAccount(account),
      reference,
      receivedAt: new Date(`${data.receivedAt}T12:00:00+03:00`),
      amount: data.amount,
      payer: data.payer,
      details: data.details ?? null,
    },
  });
  if (invoice) {
    const open = round2(num(invoice.total) - settledAmount(invoice));
    const amount = Math.min(open, data.amount);
    if (amount > 0) {
      await prisma.receiptAllocation.create({ data: { receiptId: receipt.id, invoiceId: invoice.id, amount } });
    }
  }
  await postReceipt(receipt.id);
  await audit(
    business.id,
    "CREATE",
    "RECEIPT",
    receipt.id,
    `Recorded ${data.amount.toFixed(2)} received from ${data.payer}${invoice ? ` for invoice ${invoice.number}` : ""}`
  );
  revalidateAll();
  redirect(invoice ? `/app/sales/invoices/${invoice.id}` : `/app/sales/receipts/${receipt.id}`);
}

export async function applyReceiptToInvoice(formData: FormData) {
  const { business } = await requireBusiness();
  const [receipt, invoice] = await Promise.all([
    prisma.receipt.findFirst({
      where: { id: String(formData.get("receiptId")), businessId: business.id },
      include: { allocations: true },
    }),
    prisma.salesInvoice.findFirst({
      where: { id: String(formData.get("invoiceId")), businessId: business.id, status: "SENT" },
      include: { allocations: true, creditAllocations: true },
    }),
  ]);
  if (!receipt || !invoice || receipt.allocations.some((a) => a.invoiceId === invoice.id)) return;
  if (await blockedByLock(business, "receipt", receipt.id)) return;

  const receiptOpen = num(receipt.amount) - receipt.allocations.reduce((s, a) => s + num(a.amount), 0);
  const invoiceOpen = num(invoice.total) - settledAmount(invoice);
  const amount = round2(Math.min(receiptOpen, invoiceOpen));
  if (amount <= 0) return;

  await prisma.receiptAllocation.create({ data: { receiptId: receipt.id, invoiceId: invoice.id, amount } });
  if (!receipt.customerId) {
    await prisma.receipt.update({ where: { id: receipt.id }, data: { customerId: invoice.customerId } });
  }
  // Remember the payer's statement name for this customer.
  const customer = await prisma.customer.findUnique({ where: { id: invoice.customerId } });
  const alias = normaliseAlias(receipt.payer);
  if (customer && !customer.aliases.includes(alias)) {
    await prisma.customer.update({ where: { id: customer.id }, data: { aliases: { push: alias } } });
  }
  await postReceipt(receipt.id);
  revalidateAll();
}

export async function removeReceiptAllocation(formData: FormData) {
  const { business } = await requireBusiness();
  const allocation = await prisma.receiptAllocation.findFirst({
    where: { id: String(formData.get("allocationId")), receipt: { businessId: business.id } },
  });
  if (!allocation) return;
  if (await blockedByLock(business, "receipt", allocation.receiptId)) return;
  await prisma.receiptAllocation.delete({ where: { id: allocation.id } });
  await postReceipt(allocation.receiptId);
  revalidateAll();
}

export async function setReceiptCategory(formData: FormData) {
  const { business } = await requireBusiness();
  const receiptId = String(formData.get("receiptId"));
  const value = String(formData.get("categoryAccountId") ?? "");
  const account = value
    ? await prisma.account.findFirst({ where: { id: value, businessId: business.id, moneyKind: null } })
    : null;
  if (await blockedByLock(business, "receipt", receiptId)) return;
  const updated = await prisma.receipt.updateMany({
    where: { id: receiptId, businessId: business.id },
    data: { categoryAccountId: account?.id ?? null },
  });
  if (updated.count) await postReceipt(receiptId);
  revalidateAll();
}

export async function setReceiptCustomer(formData: FormData) {
  const { business } = await requireBusiness();
  const receiptId = String(formData.get("receiptId"));
  const customer = await prisma.customer.findFirst({
    where: { id: String(formData.get("customerId")), businessId: business.id },
  });
  const receipt = await prisma.receipt.findFirst({ where: { id: receiptId, businessId: business.id } });
  if (!customer || !receipt) return;
  if (await blockedByLock(business, "receipt", receipt.id)) return;
  await prisma.receipt.update({ where: { id: receipt.id }, data: { customerId: customer.id } });
  const alias = normaliseAlias(receipt.payer);
  if (!customer.aliases.includes(alias)) {
    await prisma.customer.update({ where: { id: customer.id }, data: { aliases: { push: alias } } });
  }
  await postReceipt(receipt.id);
  await runReceiptAutoMatch(business.id);
  revalidateAll();
}

export async function deleteReceipt(formData: FormData) {
  const { business } = await requireBusiness();
  const receiptId = String(formData.get("receiptId"));
  if (await blockedByLock(business, "receipt", receiptId)) return;
  const deleted = await prisma.receipt.deleteMany({ where: { id: receiptId, businessId: business.id } });
  if (deleted.count) {
    await postReceipt(receiptId);
    await audit(business.id, "DELETE", "RECEIPT", receiptId, "Deleted a money-received record");
  }
  revalidateAll();
  redirect("/app/sales/receipts");
}
