"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { audit } from "@/lib/audit";
import { formatDate } from "@/lib/format";
import { round2 } from "@/lib/money";
import { candidateLines, clearedBalance, previousReconciliation } from "@/lib/reconcile";
import type { ActionState } from "./types";

function revalidateAll() {
  revalidatePath("/app", "layout");
}

export async function startReconciliation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  if (business.role === "STAFF") return { error: "Only an owner or accountant can reconcile accounts" };

  const account = await prisma.account.findFirst({
    where: { id: String(formData.get("accountId") ?? ""), businessId: business.id, moneyKind: { not: null } },
  });
  if (!account) return { error: "Choose the account to reconcile" };

  const date = String(formData.get("statementDate") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Enter the statement's closing date" };
  const statementDate = new Date(`${date}T00:00:00Z`);
  if (statementDate.getTime() > Date.now()) return { error: "The statement date cannot be in the future" };

  const balanceText = String(formData.get("statementBalance") ?? "").replace(/,/g, "").trim();
  const statementBalance = Number(balanceText);
  if (!balanceText || !Number.isFinite(statementBalance)) return { error: "Enter the closing balance shown on the statement" };

  const existing = await prisma.reconciliation.findFirst({ where: { accountId: account.id, status: "IN_PROGRESS" } });
  if (existing) redirect(`/app/reconcile/${existing.id}`);

  const previous = await previousReconciliation(account.id);
  if (previous && statementDate.getTime() <= previous.statementDate.getTime()) {
    return { error: `${account.name} is already reconciled through ${formatDate(previous.statementDate)}. Choose a later statement date.` };
  }

  const created = await prisma.reconciliation.create({
    data: {
      businessId: business.id,
      accountId: account.id,
      statementDate,
      statementBalance: round2(statementBalance),
      openingBalance: previous ? previous.statementBalance : 0,
    },
  });
  redirect(`/app/reconcile/${created.id}`);
}

// Saves which lines are ticked. With intent=finish it also completes the reconciliation, but only when the
// difference is exactly zero, so a completed reconciliation always agrees with its statement.
export async function saveReconciliation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business, session } = await requireBusiness();
  if (business.role === "STAFF") return { error: "Only an owner or accountant can reconcile accounts" };

  const reconciliation = await prisma.reconciliation.findFirst({
    where: { id: String(formData.get("reconciliationId") ?? ""), businessId: business.id },
    include: { account: { select: { name: true, currency: true } } },
  });
  if (!reconciliation) return { error: "Reconciliation not found" };
  if (reconciliation.status !== "IN_PROGRESS") return { error: "This reconciliation is already complete" };

  const wanted = new Set(formData.getAll("lineIds").map(String));
  const candidates = await candidateLines(reconciliation);
  const chosen = candidates.filter((l) => wanted.has(l.id));

  await prisma.$transaction([
    prisma.journalLine.updateMany({ where: { reconciliationId: reconciliation.id }, data: { reconciliationId: null } }),
    prisma.journalLine.updateMany({ where: { id: { in: chosen.map((l) => l.id) } }, data: { reconciliationId: reconciliation.id } }),
  ]);

  const cleared = clearedBalance(Number(reconciliation.openingBalance), chosen, !!reconciliation.account.currency);
  const difference = round2(Number(reconciliation.statementBalance) - cleared);

  if (formData.get("intent") !== "finish") {
    revalidateAll();
    return { success: `Progress saved. ${chosen.length} line${chosen.length === 1 ? "" : "s"} ticked, difference ${difference.toFixed(2)}.` };
  }
  if (Math.abs(difference) > 0.005) {
    revalidateAll();
    return { error: `The difference is ${difference.toFixed(2)}, not zero. Progress was saved; tick the missing lines or check the statement balance.` };
  }

  await prisma.reconciliation.update({
    where: { id: reconciliation.id },
    data: { status: "COMPLETED", completedAt: new Date(), completedBy: session.name },
  });
  await audit(
    business.id,
    "APPROVE",
    "RECONCILIATION",
    reconciliation.id,
    `Reconciled ${reconciliation.account.name} to ${formatDate(reconciliation.statementDate)} (${chosen.length} lines, statement balance ${Number(reconciliation.statementBalance).toFixed(2)})`
  );
  revalidateAll();
  redirect(`/app/reconcile/${reconciliation.id}`);
}

export async function discardReconciliation(formData: FormData) {
  const { business } = await requireBusiness();
  if (business.role === "STAFF") return;
  const reconciliation = await prisma.reconciliation.findFirst({
    where: { id: String(formData.get("reconciliationId")), businessId: business.id, status: "IN_PROGRESS" },
  });
  if (!reconciliation) return;
  await prisma.reconciliation.delete({ where: { id: reconciliation.id } });
  revalidateAll();
  redirect("/app/reconcile");
}

// Only the latest completed reconciliation of an account can be undone, so the chain of balances stays intact.
export async function undoReconciliation(formData: FormData) {
  const { business } = await requireBusiness();
  if (business.role !== "OWNER" && business.role !== "ACCOUNTANT") return;
  const reconciliation = await prisma.reconciliation.findFirst({
    where: { id: String(formData.get("reconciliationId")), businessId: business.id, status: "COMPLETED" },
    include: { account: { select: { name: true } } },
  });
  if (!reconciliation) return;
  const later = await prisma.reconciliation.count({
    where: { accountId: reconciliation.accountId, status: "COMPLETED", statementDate: { gt: reconciliation.statementDate } },
  });
  if (later > 0) throw new Error("Undo the more recent reconciliations of this account first");

  await prisma.reconciliation.delete({ where: { id: reconciliation.id } });
  await audit(
    business.id,
    "REOPEN",
    "RECONCILIATION",
    reconciliation.id,
    `Undid the ${reconciliation.account.name} reconciliation for ${formatDate(reconciliation.statementDate)}`
  );
  revalidateAll();
  redirect("/app/reconcile");
}
