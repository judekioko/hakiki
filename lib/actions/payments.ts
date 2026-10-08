"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { requireBusiness } from "@/lib/business";
import { assertDocumentOpen, isLocked, lockMessage } from "@/lib/period-lock";
import { parseStatement } from "@/lib/statement-import";
import { normaliseAlias } from "@/lib/matching";
import { aliasIndex } from "@/lib/suppliers";
import { runAutoMatch } from "@/lib/auto-match";
import { runReceiptAutoMatch } from "@/lib/receipt-match";
import { postPayment, postReceipt } from "@/lib/ledger";
import { sourceForMoneyAccount } from "@/lib/money-accounts";
import { exemptSchema, firstError, paymentSchema } from "@/lib/validators";
import type { ActionState } from "./types";

const MAX_STATEMENT_BYTES = 5 * 1024 * 1024;

function revalidateAll() {
  revalidatePath("/app", "layout");
}

async function resolveMoneyAccount(businessId: string, moneyAccountId: FormDataEntryValue | null) {
  if (typeof moneyAccountId !== "string" || !moneyAccountId) return null;
  return prisma.account.findFirst({ where: { id: moneyAccountId, businessId, moneyKind: { not: null } } });
}

export async function importStatement(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const file = formData.get("file");
  const account = await resolveMoneyAccount(business.id, formData.get("moneyAccountId"));
  if (!account) return { error: "Choose which account this statement is for" };
  const source = sourceForMoneyAccount(account);
  const includeIncoming = formData.get("includeIncoming") === "on";

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
  if (parsed.payments.length === 0 && (!includeIncoming || parsed.incoming.length === 0)) {
    return { error: "No transactions were found in this file." };
  }

  const batch = await prisma.importBatch.create({
    data: { businessId: business.id, source, moneyAccountId: account.id, fileName: file.name, imported: 0, skipped: 0 },
  });

  // Money out
  const outRefs = parsed.payments.map((p) => p.reference).filter((r): r is string => !!r);
  const existingOut = new Set(
    (await prisma.payment.findMany({ where: { businessId: business.id, reference: { in: outRefs } }, select: { reference: true } })).map((p) => p.reference)
  );
  const supplierAliases = await aliasIndex(business.id);
  const dedupedOut = dedupe(parsed.payments, existingOut);
  const freshOut = dedupedOut.filter((p) => !isLocked(business, p.paidAt));
  let closedRows = dedupedOut.length - freshOut.length;
  await prisma.payment.createMany({
    data: freshOut.map((p) => ({
      businessId: business.id,
      importBatchId: batch.id,
      moneyAccountId: account.id,
      source,
      reference: p.reference,
      paidAt: p.paidAt,
      amount: p.amount,
      counterparty: p.counterparty,
      details: p.details || null,
      supplierId: supplierAliases.get(normaliseAlias(p.counterparty)) ?? null,
    })),
  });

  // Money in
  let freshIn: typeof parsed.incoming = [];
  if (includeIncoming) {
    const inRefs = parsed.incoming.map((p) => p.reference).filter((r): r is string => !!r);
    const existingIn = new Set(
      (await prisma.receipt.findMany({ where: { businessId: business.id, reference: { in: inRefs } }, select: { reference: true } })).map((r) => r.reference)
    );
    const customers = await prisma.customer.findMany({ where: { businessId: business.id }, select: { id: true, aliases: true } });
    const customerAliases = new Map<string, string>();
    for (const c of customers) for (const a of c.aliases) customerAliases.set(a, c.id);
    const dedupedIn = dedupe(parsed.incoming, existingIn);
    freshIn = dedupedIn.filter((p) => !isLocked(business, p.paidAt));
    closedRows += dedupedIn.length - freshIn.length;
    await prisma.receipt.createMany({
      data: freshIn.map((p) => ({
        businessId: business.id,
        importBatchId: batch.id,
        moneyAccountId: account.id,
        source,
        reference: p.reference,
        receivedAt: p.paidAt,
        amount: p.amount,
        payer: p.counterparty,
        details: p.details || null,
        customerId: customerAliases.get(normaliseAlias(p.counterparty)) ?? null,
      })),
    });
  }

  const skipped = parsed.payments.length - freshOut.length + (includeIncoming ? parsed.incoming.length - freshIn.length : 0) + parsed.skippedRows - closedRows;
  await prisma.importBatch.update({ where: { id: batch.id }, data: { imported: freshOut.length + freshIn.length, skipped } });

  const [newPayments, newReceipts] = await Promise.all([
    prisma.payment.findMany({ where: { importBatchId: batch.id }, select: { id: true } }),
    prisma.receipt.findMany({ where: { importBatchId: batch.id }, select: { id: true } }),
  ]);
  for (const p of newPayments) await postPayment(p.id);
  for (const r of newReceipts) await postReceipt(r.id);

  const matched = await runAutoMatch(business.id);
  const matchedIn = await runReceiptAutoMatch(business.id);
  revalidateAll();

  const parts = [`Imported ${freshOut.length} payment${freshOut.length === 1 ? "" : "s"} out`];
  if (includeIncoming) parts.push(`${freshIn.length} received`);
  else if (parsed.incomingRows) parts.push(`${parsed.incomingRows} incoming ignored`);
  if (skipped) parts.push(`${skipped} skipped or already imported`);
  if (closedRows) parts.push(`${closedRows} in a closed period (not imported)`);
  if (matched + matchedIn) parts.push(`${matched + matchedIn} matched automatically`);
  return { success: parts.join(" · ") };
}

function dedupe<T extends { reference: string | null }>(rows: T[], existing: Set<string | null>): T[] {
  const seen = new Set<string>();
  return rows.filter((p) => {
    if (!p.reference) return true;
    if (existing.has(p.reference) || seen.has(p.reference)) return false;
    seen.add(p.reference);
    return true;
  });
}

export async function createPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const account = await resolveMoneyAccount(business.id, formData.get("moneyAccountId"));
  if (!account) return { error: "Choose the account the money was paid from" };
  const parsed = paymentSchema.safeParse({
    source: sourceForMoneyAccount(account),
    reference: formData.get("reference") ?? "",
    paidAt: formData.get("paidAt"),
    amount: formData.get("amount"),
    counterparty: formData.get("counterparty"),
    details: formData.get("details") ?? "",
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const data = parsed.data;
  const paidLock = lockMessage(business, new Date(`${data.paidAt}T12:00:00+03:00`));
  if (paidLock) return { error: paidLock };
  const reference = data.reference?.toUpperCase() ?? null;

  if (reference) {
    const duplicate = await prisma.payment.findFirst({ where: { businessId: business.id, reference } });
    if (duplicate) return { error: `A payment with reference ${reference} already exists` };
  }
  const categoryAccountId = await validCategory(business.id, formData.get("categoryAccountId"));
  const aliases = await aliasIndex(business.id);
  const payment = await prisma.payment.create({
    data: {
      businessId: business.id,
      source: data.source,
      moneyAccountId: account.id,
      reference,
      // Noon Nairobi time keeps manually entered dates on the right day.
      paidAt: new Date(`${data.paidAt}T12:00:00+03:00`),
      amount: data.amount,
      counterparty: data.counterparty,
      details: data.details,
      categoryAccountId,
      supplierId: aliases.get(normaliseAlias(data.counterparty)) ?? null,
    },
  });
  await postPayment(payment.id);
  await runAutoMatch(business.id);
  await audit(business.id, "CREATE", "PAYMENT", payment.id, `Recorded ${data.amount.toFixed(2)} paid to ${data.counterparty}`);
  revalidateAll();
  redirect(`/app/payments/${payment.id}`);
}

async function validCategory(businessId: string, value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value) return null;
  const account = await prisma.account.findFirst({ where: { id: value, businessId, moneyKind: null } });
  return account?.id ?? null;
}

export async function setPaymentCategory(formData: FormData) {
  const { business } = await requireBusiness();
  const paymentId = String(formData.get("paymentId"));
  const categoryAccountId = await validCategory(business.id, formData.get("categoryAccountId"));
  await assertDocumentOpen(business, "payment", paymentId);
  const updated = await prisma.payment.updateMany({
    where: { id: paymentId, businessId: business.id },
    data: { categoryAccountId },
  });
  if (updated.count) await postPayment(paymentId);
  revalidateAll();
}

export async function markExempt(formData: FormData) {
  const { business } = await requireBusiness();
  const parsed = exemptSchema.safeParse({
    paymentId: formData.get("paymentId"),
    exemptReason: formData.get("exemptReason"),
    exemptNote: formData.get("exemptNote") ?? "",
  });
  if (!parsed.success) throw new Error(firstError(parsed.error));
  await assertDocumentOpen(business, "payment", parsed.data.paymentId);

  const updated = await prisma.payment.updateMany({
    where: { id: parsed.data.paymentId, businessId: business.id },
    data: { exemptReason: parsed.data.exemptReason, exemptNote: parsed.data.exemptNote ?? null },
  });
  if (updated.count) await postPayment(parsed.data.paymentId);
  revalidateAll();
}

export async function clearExempt(formData: FormData) {
  const { business } = await requireBusiness();
  const paymentId = String(formData.get("paymentId"));
  await assertDocumentOpen(business, "payment", paymentId);
  const updated = await prisma.payment.updateMany({
    where: { id: paymentId, businessId: business.id },
    data: { exemptReason: null, exemptNote: null },
  });
  if (updated.count) await postPayment(paymentId);
  revalidateAll();
}

// Applies one exemption reason to many payments at once (e.g. every M-Pesa charge line).
export async function bulkMarkExempt(formData: FormData) {
  const { business } = await requireBusiness();
  const ids = formData.getAll("paymentIds").map(String);
  const reason = exemptSchema.shape.exemptReason.safeParse(formData.get("exemptReason"));
  if (!reason.success || ids.length === 0) return;

  const owned = await prisma.payment.findMany({ where: { id: { in: ids }, businessId: business.id }, select: { id: true } });
  for (const p of owned) await assertDocumentOpen(business, "payment", p.id);
  await prisma.payment.updateMany({
    where: { id: { in: owned.map((p) => p.id) } },
    data: { exemptReason: reason.data },
  });
  for (const p of owned) await postPayment(p.id);
  revalidateAll();
}

export async function deletePayment(formData: FormData) {
  const { business } = await requireBusiness();
  const paymentId = String(formData.get("paymentId"));
  await assertDocumentOpen(business, "payment", paymentId);
  const deleted = await prisma.payment.deleteMany({ where: { id: paymentId, businessId: business.id } });
  if (deleted.count) {
    await postPayment(paymentId);
    await audit(business.id, "DELETE", "PAYMENT", paymentId, "Deleted a money-paid-out record");
  }
  revalidateAll();
  redirect("/app/payments");
}
