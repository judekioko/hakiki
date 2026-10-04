"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { parseStatement } from "@/lib/statement-import";
import { normaliseAlias } from "@/lib/matching";
import { aliasIndex } from "@/lib/suppliers";
import { runAutoMatch } from "@/lib/auto-match";
import { exemptSchema, firstError, paymentSchema } from "@/lib/validators";
import type { ActionState } from "./types";

const MAX_STATEMENT_BYTES = 5 * 1024 * 1024;

function revalidateAll() {
  revalidatePath("/app", "layout");
}

export async function importStatement(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const file = formData.get("file");
  const source = formData.get("source") === "BANK" ? "BANK" : "MPESA";

  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file to import" };
  if (file.size > MAX_STATEMENT_BYTES) return { error: "The file is larger than 5 MB" };
  if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") {
    return {
      error: "Upload a CSV file. In Excel or Google Sheets, open the statement and use Save As / Download → CSV.",
    };
  }

  let parsed;
  try {
    parsed = parseStatement(await file.text());
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not read the file" };
  }
  if (parsed.payments.length === 0) {
    return { error: "No outgoing payments were found in this file." };
  }

  const references = parsed.payments.map((p) => p.reference).filter((r): r is string => !!r);
  const existing = new Set(
    (
      await prisma.payment.findMany({
        where: { businessId: business.id, reference: { in: references } },
        select: { reference: true },
      })
    ).map((p) => p.reference)
  );
  const aliases = await aliasIndex(business.id);
  const seen = new Set<string>();
  const fresh = parsed.payments.filter((p) => {
    if (!p.reference) return true;
    if (existing.has(p.reference) || seen.has(p.reference)) return false;
    seen.add(p.reference);
    return true;
  });
  const duplicates = parsed.payments.length - fresh.length;

  const batch = await prisma.importBatch.create({
    data: {
      businessId: business.id,
      source,
      fileName: file.name,
      imported: fresh.length,
      skipped: duplicates + parsed.skippedRows,
    },
  });
  await prisma.payment.createMany({
    data: fresh.map((p) => ({
      businessId: business.id,
      importBatchId: batch.id,
      source,
      reference: p.reference,
      paidAt: p.paidAt,
      amount: p.amount,
      counterparty: p.counterparty,
      details: p.details || null,
      supplierId: aliases.get(normaliseAlias(p.counterparty)) ?? null,
    })),
  });

  const matched = await runAutoMatch(business.id);
  revalidateAll();

  const parts = [`Imported ${fresh.length} payment${fresh.length === 1 ? "" : "s"}`];
  if (duplicates) parts.push(`${duplicates} already imported`);
  if (parsed.incomingRows) parts.push(`${parsed.incomingRows} incoming ignored`);
  if (parsed.skippedRows) parts.push(`${parsed.skippedRows} rows skipped`);
  if (matched) parts.push(`${matched} matched to invoices automatically`);
  return { success: parts.join(" · ") };
}

export async function createPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const parsed = paymentSchema.safeParse({
    source: formData.get("source"),
    reference: formData.get("reference") ?? "",
    paidAt: formData.get("paidAt"),
    amount: formData.get("amount"),
    counterparty: formData.get("counterparty"),
    details: formData.get("details") ?? "",
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const data = parsed.data;
  const reference = data.reference?.toUpperCase() ?? null;

  if (reference) {
    const duplicate = await prisma.payment.findFirst({ where: { businessId: business.id, reference } });
    if (duplicate) return { error: `A payment with reference ${reference} already exists` };
  }
  const aliases = await aliasIndex(business.id);
  const payment = await prisma.payment.create({
    data: {
      businessId: business.id,
      source: data.source,
      reference,
      // Noon Nairobi time keeps manually entered dates on the right day.
      paidAt: new Date(`${data.paidAt}T12:00:00+03:00`),
      amount: data.amount,
      counterparty: data.counterparty,
      details: data.details,
      supplierId: aliases.get(normaliseAlias(data.counterparty)) ?? null,
    },
  });
  await runAutoMatch(business.id);
  revalidateAll();
  redirect(`/app/payments/${payment.id}`);
}

export async function markExempt(formData: FormData) {
  const { business } = await requireBusiness();
  const parsed = exemptSchema.safeParse({
    paymentId: formData.get("paymentId"),
    exemptReason: formData.get("exemptReason"),
    exemptNote: formData.get("exemptNote") ?? "",
  });
  if (!parsed.success) throw new Error(firstError(parsed.error));

  await prisma.payment.updateMany({
    where: { id: parsed.data.paymentId, businessId: business.id },
    data: { exemptReason: parsed.data.exemptReason, exemptNote: parsed.data.exemptNote ?? null },
  });
  revalidateAll();
}

export async function clearExempt(formData: FormData) {
  const { business } = await requireBusiness();
  await prisma.payment.updateMany({
    where: { id: String(formData.get("paymentId")), businessId: business.id },
    data: { exemptReason: null, exemptNote: null },
  });
  revalidateAll();
}

// Applies one exemption reason to many payments at once (e.g. every M-Pesa charge line).
export async function bulkMarkExempt(formData: FormData) {
  const { business } = await requireBusiness();
  const ids = formData.getAll("paymentIds").map(String);
  const reason = exemptSchema.shape.exemptReason.safeParse(formData.get("exemptReason"));
  if (!reason.success || ids.length === 0) return;

  await prisma.payment.updateMany({
    where: { id: { in: ids }, businessId: business.id },
    data: { exemptReason: reason.data },
  });
  revalidateAll();
}

export async function deletePayment(formData: FormData) {
  const { business } = await requireBusiness();
  await prisma.payment.deleteMany({ where: { id: String(formData.get("paymentId")), businessId: business.id } });
  revalidateAll();
  redirect("/app/payments");
}
