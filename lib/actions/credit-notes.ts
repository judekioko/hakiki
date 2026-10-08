"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { assertDocumentOpen, documentLockMessage, lockMessage } from "@/lib/period-lock";
import { num, round2 } from "@/lib/money";
import { audit } from "@/lib/audit";
import { accountIdsByKey, postCreditNote } from "@/lib/ledger";
import { runReceiptAutoMatch } from "@/lib/receipt-match";
import { settledAmount } from "@/lib/sales";
import { nextDocumentNumber, priceLines, totals } from "@/lib/document-lines";
import { creditNoteSchema, firstError, linesSchema, parseJsonField } from "@/lib/validators";
import type { ActionState } from "./types";

function revalidateAll() {
  revalidatePath("/app", "layout");
}

async function openBalance(invoiceId: string) {
  const invoice = await prisma.salesInvoice.findUnique({
    where: { id: invoiceId },
    include: { allocations: { select: { amount: true } }, creditAllocations: { select: { amount: true } } },
  });
  return invoice ? round2(num(invoice.total) - settledAmount(invoice)) : 0;
}

// Applies as much of the credit note as the invoice still owes. Moves no money, so the ledger is untouched.
async function applyCredit(creditNoteId: string, invoiceId: string) {
  const note = await prisma.creditNote.findUnique({ where: { id: creditNoteId }, include: { allocations: true } });
  if (!note || note.status !== "ISSUED") return 0;
  const unused = round2(num(note.total) - note.allocations.reduce((s, a) => s + num(a.amount), 0));
  const amount = round2(Math.min(unused, await openBalance(invoiceId)));
  if (amount <= 0.009) return 0;
  await prisma.creditAllocation.upsert({
    where: { creditNoteId_invoiceId: { creditNoteId, invoiceId } },
    create: { creditNoteId, invoiceId, amount },
    update: { amount: { increment: amount } },
  });
  return amount;
}

export async function saveCreditNote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const parsed = creditNoteSchema.safeParse({
    customerId: formData.get("customerId") ?? "",
    invoiceId: formData.get("invoiceId") ?? "",
    issueDate: formData.get("issueDate"),
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const data = parsed.data;

  const customer = await prisma.customer.findFirst({ where: { id: data.customerId, businessId: business.id } });
  if (!customer) return { error: "Customer not found" };

  const invoice = data.invoiceId
    ? await prisma.salesInvoice.findFirst({
        where: { id: data.invoiceId, businessId: business.id, customerId: customer.id, status: "SENT" },
      })
    : null;
  if (data.invoiceId && !invoice) return { error: "Choose a sent invoice that belongs to this customer" };

  const lineInput = parseJsonField(formData.get("lines"), linesSchema);
  if (lineInput.error) return { error: lineInput.error };
  const keys = await accountIdsByKey(business.id);
  const priced = await priceLines(business.id, lineInput.data!, "sale", keys.SALES, business.vatRegistered);
  if (priced.error) return { error: priced.error };
  const sums = totals(priced.lines!);
  if (sums.total <= 0) return { error: "A credit note must be for more than zero" };
  if (invoice && sums.total > num(invoice.total) + 0.01) {
    return { error: `The credit cannot be more than the invoice total (${num(invoice.total)})` };
  }

  const issue = formData.get("intent") === "issue";
  const noteId = String(formData.get("creditNoteId") ?? "");
  const issueAt = new Date(`${data.issueDate}T00:00:00Z`);
  const locked = noteId ? await documentLockMessage(business, "creditNote", noteId, issueAt) : lockMessage(business, issueAt);
  if (locked) return { error: locked };
  const header = {
    customerId: customer.id,
    invoiceId: invoice?.id ?? null,
    issueDate: new Date(`${data.issueDate}T00:00:00Z`),
    reason: data.reason ?? null,
    restock: formData.get("restock") === "on",
    ...sums,
  };

  let id: string;
  if (noteId) {
    const existing = await prisma.creditNote.findFirst({ where: { id: noteId, businessId: business.id } });
    if (!existing) return { error: "Credit note not found" };
    if (existing.status !== "DRAFT") return { error: "Only a draft credit note can be edited. Void it and create a new one." };
    await prisma.$transaction([
      prisma.creditNoteLine.deleteMany({ where: { creditNoteId: noteId } }),
      prisma.creditNote.update({
        where: { id: noteId },
        data: { ...header, status: issue ? "ISSUED" : "DRAFT", lines: { create: priced.lines!.map((l) => ({ ...l })) } },
      }),
    ]);
    id = noteId;
  } else {
    const created = await prisma.creditNote.create({
      data: {
        businessId: business.id,
        number: await nextDocumentNumber(business.id, "CN-"),
        status: issue ? "ISSUED" : "DRAFT",
        ...header,
        lines: { create: priced.lines!.map((l) => ({ ...l })) },
      },
    });
    id = created.id;
  }

  await postCreditNote(id);
  if (issue && invoice) await applyCredit(id, invoice.id);
  const note = await prisma.creditNote.findUniqueOrThrow({ where: { id } });
  await audit(
    business.id,
    noteId ? "UPDATE" : "CREATE",
    "CREDIT_NOTE",
    id,
    `${issue ? "Issued" : "Saved draft"} credit note ${note.number} for ${customer.name} (${num(note.total).toFixed(2)})`
  );
  revalidateAll();
  redirect(`/app/sales/credit-notes/${id}`);
}

async function ownedNote(businessId: string, formData: FormData) {
  return prisma.creditNote.findFirst({
    where: { id: String(formData.get("creditNoteId")), businessId },
    include: { allocations: true, customer: { select: { name: true } } },
  });
}

export async function issueCreditNote(formData: FormData) {
  const { business } = await requireBusiness();
  const note = await ownedNote(business.id, formData);
  if (!note || note.status !== "DRAFT") return;
  await assertDocumentOpen(business, "creditNote", note.id);
  await prisma.creditNote.update({ where: { id: note.id }, data: { status: "ISSUED" } });
  await postCreditNote(note.id);
  if (note.invoiceId) await applyCredit(note.id, note.invoiceId);
  await audit(business.id, "SEND", "CREDIT_NOTE", note.id, `Issued credit note ${note.number} for ${note.customer.name}`);
  revalidateAll();
}

export async function voidCreditNote(formData: FormData) {
  const { business } = await requireBusiness();
  const note = await ownedNote(business.id, formData);
  if (!note || note.status !== "ISSUED") return;
  await assertDocumentOpen(business, "creditNote", note.id);
  // The invoices it was reducing owe their full amount again.
  await prisma.creditAllocation.deleteMany({ where: { creditNoteId: note.id } });
  await prisma.creditNote.update({ where: { id: note.id }, data: { status: "VOID" } });
  await postCreditNote(note.id);
  await audit(business.id, "VOID", "CREDIT_NOTE", note.id, `Voided credit note ${note.number} for ${note.customer.name}`);
  revalidateAll();
}

export async function deleteDraftCreditNote(formData: FormData) {
  const { business } = await requireBusiness();
  const note = await ownedNote(business.id, formData);
  if (!note || note.status !== "DRAFT") return;
  await prisma.creditNote.delete({ where: { id: note.id } });
  await audit(business.id, "DELETE", "CREDIT_NOTE", note.id, `Deleted draft credit note ${note.number}`);
  revalidateAll();
  redirect("/app/sales/credit-notes");
}

export async function applyCreditToInvoice(formData: FormData) {
  const { business } = await requireBusiness();
  const note = await ownedNote(business.id, formData);
  if (!note) return;
  const invoice = await prisma.salesInvoice.findFirst({
    where: { id: String(formData.get("invoiceId")), businessId: business.id, status: "SENT", customerId: note.customerId },
  });
  if (!invoice) return;
  const applied = await applyCredit(note.id, invoice.id);
  if (applied > 0) {
    await audit(
      business.id,
      "LINK",
      "CREDIT_NOTE",
      note.id,
      `Applied ${applied.toFixed(2)} of credit note ${note.number} to invoice ${invoice.number}`
    );
    await runReceiptAutoMatch(business.id);
  }
  revalidateAll();
}

export async function removeCreditAllocation(formData: FormData) {
  const { business } = await requireBusiness();
  const allocation = await prisma.creditAllocation.findFirst({
    where: { id: String(formData.get("allocationId")), creditNote: { businessId: business.id } },
    include: { creditNote: true, invoice: true },
  });
  if (!allocation) return;
  await prisma.creditAllocation.delete({ where: { id: allocation.id } });
  await audit(
    business.id,
    "UNLINK",
    "CREDIT_NOTE",
    allocation.creditNoteId,
    `Removed credit note ${allocation.creditNote.number} from invoice ${allocation.invoice.number}`
  );
  revalidateAll();
}
