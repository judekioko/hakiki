"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { requireBusiness } from "@/lib/business";
import { lockMessage, reconciledMessage } from "@/lib/period-lock";
import { blockedWithMessage } from "@/lib/lock-guard";
import { round2 } from "@/lib/money";
import { replaceEntry, removeEntry } from "@/lib/ledger";
import { accountSchema, firstError, journalLineSchema, parseJsonField, taxRateSchema } from "@/lib/validators";
import type { ActionState } from "./types";

function revalidateAll() {
  revalidatePath("/app", "layout");
}

export async function createAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const parsed = accountSchema.safeParse({
    code: formData.get("code"),
    name: formData.get("name"),
    type: formData.get("type"),
    moneyKind: formData.get("moneyKind") ?? "",
    description: formData.get("description") ?? "",
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const d = parsed.data;
  if (d.moneyKind && d.type !== "ASSET") return { error: "Bank, mobile money and cash accounts must be asset accounts" };
  if (await prisma.account.findFirst({ where: { businessId: business.id, code: d.code } })) {
    return { error: `Account code ${d.code} is already used` };
  }
  await prisma.account.create({
    data: { businessId: business.id, code: d.code, name: d.name, type: d.type, moneyKind: d.moneyKind ?? null, description: d.description ?? null },
  });
  await audit(business.id, "CREATE", "ACCOUNT", null, `Created account ${d.code} ${d.name}`);
  revalidateAll();
  return { success: `Added ${d.code} ${d.name}` };
}

export async function renameAccount(formData: FormData) {
  const { business } = await requireBusiness();
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2) return;
  await prisma.account.updateMany({ where: { id: String(formData.get("accountId")), businessId: business.id }, data: { name } });
  revalidateAll();
}

export async function setAccountArchived(formData: FormData) {
  const { business } = await requireBusiness();
  // Accounts the app posts to automatically stay active.
  await prisma.account.updateMany({
    where: { id: String(formData.get("accountId")), businessId: business.id, systemKey: null },
    data: { isArchived: formData.get("archived") === "true" },
  });
  revalidateAll();
}

const manualLinesSchema = z.array(journalLineSchema).min(2, "A journal needs at least two lines");

export async function createManualJournal(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const date = String(formData.get("date") ?? "");
  const memo = String(formData.get("memo") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Enter a valid date" };
  if (memo.length < 3) return { error: "Describe what this journal is for" };
  const journalLock = lockMessage(business, new Date(`${date}T12:00:00+03:00`));
  if (journalLock) return { error: journalLock };

  const parsed = parseJsonField(formData.get("lines"), manualLinesSchema);
  if (parsed.error) return { error: parsed.error };
  const lines = parsed.data!.filter((l) => l.debit > 0 || l.credit > 0);
  if (lines.some((l) => l.debit > 0 && l.credit > 0)) return { error: "A line can have a debit or a credit, not both" };
  const debit = round2(lines.reduce((s, l) => s + l.debit, 0));
  const credit = round2(lines.reduce((s, l) => s + l.credit, 0));
  if (debit === 0 || Math.abs(debit - credit) > 0.009) {
    return { error: `Debits (${debit}) and credits (${credit}) must be equal and more than zero` };
  }
  const accountIds = [...new Set(lines.map((l) => l.accountId))];
  const owned = await prisma.account.count({ where: { id: { in: accountIds }, businessId: business.id } });
  if (owned !== accountIds.length) return { error: "One of the accounts was not found" };

  const sourceId = crypto.randomUUID();
  await replaceEntry(business.id, "MANUAL", sourceId, {
    date: new Date(`${date}T12:00:00+03:00`),
    memo,
    lines: lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, description: l.description || undefined })),
  });
  await audit(business.id, "CREATE", "JOURNAL", sourceId, `Manual journal "${memo}" for ${debit.toFixed(2)}`);
  revalidateAll();
  redirect("/app/journal");
}

export async function deleteManualJournal(formData: FormData) {
  const { business } = await requireBusiness();
  const entry = await prisma.journalEntry.findFirst({
    where: { id: String(formData.get("entryId")), businessId: business.id, sourceType: "MANUAL" },
  });
  if (entry?.sourceId) {
    if (await blockedWithMessage(lockMessage(business, entry.date) ?? (await reconciledMessage("MANUAL", entry.sourceId)))) return;
    await removeEntry("MANUAL", entry.sourceId);
    await audit(business.id, "DELETE", "JOURNAL", entry.sourceId, `Deleted manual journal "${entry.memo}"`);
  }
  revalidateAll();
}

// ---------- Tax rates ----------

export async function createTaxRate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const parsed = taxRateSchema.safeParse({ name: formData.get("name"), rate: formData.get("rate") });
  if (!parsed.success) return { error: firstError(parsed.error) };
  await prisma.taxRate.create({ data: { businessId: business.id, ...parsed.data } });
  revalidateAll();
  return { success: "Tax rate added" };
}

export async function setDefaultTaxRate(formData: FormData) {
  const { business } = await requireBusiness();
  const id = String(formData.get("taxRateId"));
  if (!(await prisma.taxRate.findFirst({ where: { id, businessId: business.id } }))) return;
  await prisma.$transaction([
    prisma.taxRate.updateMany({ where: { businessId: business.id }, data: { isDefault: false } }),
    prisma.taxRate.update({ where: { id }, data: { isDefault: true, isArchived: false } }),
  ]);
  revalidateAll();
}

export async function setTaxRateArchived(formData: FormData) {
  const { business } = await requireBusiness();
  await prisma.taxRate.updateMany({
    where: { id: String(formData.get("taxRateId")), businessId: business.id, isDefault: false },
    data: { isArchived: formData.get("archived") === "true" },
  });
  revalidateAll();
}
