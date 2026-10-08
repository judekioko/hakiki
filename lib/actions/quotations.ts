"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num } from "@/lib/money";
import { audit } from "@/lib/audit";
import { accountIdsByKey } from "@/lib/ledger";
import { nextDocumentNumber, priceLines, totals } from "@/lib/document-lines";
import { firstError, linesSchema, parseJsonField, quotationSchema } from "@/lib/validators";
import type { ActionState } from "./types";

function revalidateAll() {
  revalidatePath("/app", "layout");
}

export async function saveQuotation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const parsed = quotationSchema.safeParse({
    customerId: formData.get("customerId") ?? "",
    issueDate: formData.get("issueDate"),
    expiryDate: formData.get("expiryDate"),
    reference: formData.get("reference") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const data = parsed.data;
  if (data.expiryDate < data.issueDate) return { error: "The expiry date cannot be before the quotation date" };

  const customer = await prisma.customer.findFirst({ where: { id: data.customerId, businessId: business.id } });
  if (!customer) return { error: "Customer not found" };

  const lineInput = parseJsonField(formData.get("lines"), linesSchema);
  if (lineInput.error) return { error: lineInput.error };
  const keys = await accountIdsByKey(business.id);
  const priced = await priceLines(business.id, lineInput.data!, "sale", keys.SALES, business.vatRegistered);
  if (priced.error) return { error: priced.error };

  const send = formData.get("intent") === "send";
  const quotationId = String(formData.get("quotationId") ?? "");
  const header = {
    customerId: customer.id,
    issueDate: new Date(`${data.issueDate}T00:00:00Z`),
    expiryDate: new Date(`${data.expiryDate}T00:00:00Z`),
    reference: data.reference ?? null,
    notes: data.notes ?? null,
    ...totals(priced.lines!),
  };

  let id: string;
  if (quotationId) {
    const existing = await prisma.quotation.findFirst({ where: { id: quotationId, businessId: business.id } });
    if (!existing) return { error: "Quotation not found" };
    if (existing.status === "INVOICED") return { error: "This quotation has already been turned into an invoice" };
    await prisma.$transaction([
      prisma.quotationLine.deleteMany({ where: { quotationId } }),
      prisma.quotation.update({
        where: { id: quotationId },
        data: {
          ...header,
          status: send && existing.status === "DRAFT" ? "SENT" : existing.status,
          lines: { create: priced.lines!.map((l) => ({ ...l })) },
        },
      }),
    ]);
    id = quotationId;
  } else {
    const created = await prisma.quotation.create({
      data: {
        businessId: business.id,
        number: await nextDocumentNumber(business.id, "QUO-"),
        status: send ? "SENT" : "DRAFT",
        ...header,
        lines: { create: priced.lines!.map((l) => ({ ...l })) },
      },
    });
    id = created.id;
  }
  const saved = await prisma.quotation.findUniqueOrThrow({ where: { id } });
  await audit(
    business.id,
    quotationId ? "UPDATE" : "CREATE",
    "QUOTATION",
    id,
    `${quotationId ? "Edited" : "Created"} quotation ${saved.number} for ${customer.name} (${num(saved.total).toFixed(2)})`
  );
  revalidateAll();
  redirect(`/app/sales/quotations/${id}`);
}

async function ownedQuotation(businessId: string, formData: FormData) {
  return prisma.quotation.findFirst({
    where: { id: String(formData.get("quotationId")), businessId },
    include: { customer: { select: { name: true } } },
  });
}

export async function setQuotationStatus(formData: FormData) {
  const { business } = await requireBusiness();
  const status = String(formData.get("status"));
  if (!["SENT", "ACCEPTED", "DECLINED", "DRAFT"].includes(status)) return;
  const quotation = await ownedQuotation(business.id, formData);
  if (!quotation || quotation.status === "INVOICED") return;
  await prisma.quotation.update({ where: { id: quotation.id }, data: { status: status as "SENT" | "ACCEPTED" | "DECLINED" | "DRAFT" } });
  await audit(business.id, "UPDATE", "QUOTATION", quotation.id, `Marked quotation ${quotation.number} as ${status.toLowerCase()}`);
  revalidateAll();
}

// Copies the quotation into a draft invoice dated today, for review before it is sent.
export async function convertQuotation(formData: FormData) {
  const { business } = await requireBusiness();
  const quotation = await prisma.quotation.findFirst({
    where: { id: String(formData.get("quotationId")), businessId: business.id },
    include: { lines: { orderBy: { position: "asc" } } },
  });
  if (!quotation || quotation.status === "INVOICED" || quotation.status === "DECLINED") return;

  // Claim the quotation first so a double click cannot create two invoices.
  const claimed = await prisma.quotation.updateMany({
    where: { id: quotation.id, status: { notIn: ["INVOICED", "DECLINED"] } },
    data: { status: "INVOICED" },
  });
  if (claimed.count === 0) return;

  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const invoice = await prisma.salesInvoice.create({
    data: {
      businessId: business.id,
      customerId: quotation.customerId,
      number: await nextDocumentNumber(business.id, "INV-"),
      status: "DRAFT",
      issueDate: today,
      dueDate: new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000),
      reference: quotation.reference ?? quotation.number,
      notes: quotation.notes,
      subtotal: quotation.subtotal,
      taxTotal: quotation.taxTotal,
      total: quotation.total,
      lines: {
        create: quotation.lines.map((l) => ({
          itemId: l.itemId,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          taxRate: l.taxRate,
          taxRateId: l.taxRateId,
          accountId: l.accountId,
          lineTotal: l.lineTotal,
          taxAmount: l.taxAmount,
          position: l.position,
        })),
      },
    },
  });
  await prisma.quotation.update({ where: { id: quotation.id }, data: { invoiceId: invoice.id } });
  await audit(business.id, "CREATE", "QUOTATION", quotation.id, `Converted quotation ${quotation.number} to draft invoice ${invoice.number}`);
  revalidateAll();
  redirect(`/app/sales/invoices/${invoice.id}`);
}

export async function deleteQuotation(formData: FormData) {
  const { business } = await requireBusiness();
  const quotation = await ownedQuotation(business.id, formData);
  if (!quotation || quotation.status === "INVOICED") return;
  await prisma.quotation.delete({ where: { id: quotation.id } });
  await audit(business.id, "DELETE", "QUOTATION", quotation.id, `Deleted quotation ${quotation.number}`);
  revalidateAll();
  redirect("/app/sales/quotations");
}
