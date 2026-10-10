"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { audit } from "@/lib/audit";
import { formatDate } from "@/lib/format";
import { num, round2 } from "@/lib/money";
import { setFlash } from "@/lib/flash";
import { todayInNairobi } from "@/lib/recurrence";
import { checkTerms, lastDayOfMonth, monthLabel } from "@/lib/depreciation";
import { disposeAsset, ensureAssetAccounts, latestBookableMonth, nextAssetNumber, runDepreciation, undoDepreciationMonth, undoDisposal } from "@/lib/fixed-assets";
import type { ActionState } from "./types";

function revalidateAll() {
  revalidatePath("/app", "layout");
}

const isoDay = /^\d{4}-\d{2}-\d{2}$/;
const day = (value: FormDataEntryValue | null) => {
  const text = String(value ?? "");
  return isoDay.test(text) ? new Date(`${text}T00:00:00Z`) : null;
};
// A month picked as 2026-10 becomes the first day of that month.
const monthStart = (value: FormDataEntryValue | null) => {
  const text = String(value ?? "");
  return /^\d{4}-\d{2}$/.test(text) ? new Date(`${text}-01T00:00:00Z`) : null;
};
const amount = (value: FormDataEntryValue | null, fallback = 0) => {
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!text) return fallback;
  const n = Number(text);
  return Number.isFinite(n) ? n : NaN;
};

// Reads and checks the asset form. The account must be a plain asset account, not a money, receivable, stock or tax one.
async function readAsset(businessId: string, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const purchaseDate = day(formData.get("purchaseDate"));
  if (!purchaseDate) return { error: "Choose the purchase date" as const };
  const depreciateFrom = monthStart(formData.get("depreciateFrom")) ?? new Date(Date.UTC(purchaseDate.getUTCFullYear(), purchaseDate.getUTCMonth(), 1));
  if (lastDayOfMonth(depreciateFrom).getTime() < lastDayOfMonth(purchaseDate).getTime()) return { error: "Depreciation cannot start before the month of purchase" as const };

  const method: "STRAIGHT_LINE" | "REDUCING_BALANCE" = formData.get("method") === "REDUCING_BALANCE" ? "REDUCING_BALANCE" : "STRAIGHT_LINE";
  const cost = amount(formData.get("cost"), NaN);
  const salvage = amount(formData.get("salvageValue"));
  const prior = amount(formData.get("priorDepreciation"));
  const life = method === "STRAIGHT_LINE" ? amount(formData.get("usefulLifeMonths"), NaN) : null;
  const rate = method === "REDUCING_BALANCE" ? amount(formData.get("annualRate"), NaN) : null;
  if ([cost, salvage, prior].some((n) => Number.isNaN(n))) return { error: "Enter the amounts as numbers" as const };
  const problem = checkTerms({ name, cost, salvage, method, lifeMonths: life === null || Number.isNaN(life) ? null : life, annualRate: rate === null || Number.isNaN(rate) ? null : rate, prior });
  if (problem) return { error: problem };

  const account = await prisma.account.findFirst({
    where: { id: String(formData.get("assetAccountId") ?? ""), businessId, type: "ASSET", moneyKind: null, systemKey: null, isArchived: false },
  });
  if (!account) return { error: "Choose the asset account the cost is recorded in, for example Equipment & furniture" as const };

  return {
    data: {
      name,
      notes: String(formData.get("notes") ?? "").trim() || null,
      assetAccountId: account.id,
      purchaseDate,
      cost: round2(cost),
      salvageValue: round2(salvage),
      method,
      usefulLifeMonths: life === null ? null : Math.round(life),
      annualRate: rate,
      depreciateFrom,
      priorDepreciation: round2(prior),
    },
  };
}

export async function saveAsset(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  if (business.role === "STAFF") return { error: "Only an owner or accountant can change fixed assets" };
  const read = await readAsset(business.id, formData);
  if ("error" in read) return { error: read.error };
  await ensureAssetAccounts(business.id);

  const assetId = String(formData.get("assetId") ?? "");
  if (assetId) {
    const existing = await prisma.fixedAsset.findFirst({ where: { id: assetId, businessId: business.id }, include: { _count: { select: { depreciations: true } } } });
    if (!existing) return { error: "Asset not found" };
    if (existing.status === "DISPOSED") return { error: "This asset has been sold. Undo the sale to change it." };
    const d = read.data;
    const termsChanged =
      num(existing.cost) !== d.cost ||
      num(existing.salvageValue) !== d.salvageValue ||
      existing.method !== d.method ||
      existing.usefulLifeMonths !== d.usefulLifeMonths ||
      (existing.annualRate === null ? null : num(existing.annualRate)) !== d.annualRate ||
      existing.depreciateFrom.getTime() !== d.depreciateFrom.getTime() ||
      num(existing.priorDepreciation) !== d.priorDepreciation ||
      existing.assetAccountId !== d.assetAccountId ||
      existing.purchaseDate.getTime() !== d.purchaseDate.getTime();
    if (termsChanged && existing._count.depreciations > 0) {
      return { error: "Depreciation has been booked for this asset, so its cost and terms can no longer change. Take the depreciation back first, or only edit the name and notes." };
    }
    await prisma.fixedAsset.update({ where: { id: assetId }, data: termsChanged ? d : { name: d.name, notes: d.notes } });
    await audit(business.id, "UPDATE", "FIXED_ASSET", assetId, `Changed ${existing.number} ${d.name}`);
    revalidateAll();
    return { success: "Asset saved" };
  }

  let created: { id: string; number: string } | null = null;
  for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
    try {
      created = await prisma.fixedAsset.create({ data: { businessId: business.id, number: await nextAssetNumber(business.id), ...read.data }, select: { id: true, number: true } });
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  await audit(business.id, "CREATE", "FIXED_ASSET", created!.id, `Added ${created!.number} ${read.data.name}, cost ${read.data.cost.toFixed(2)}`);
  revalidateAll();
  redirect(`/app/assets/${created!.id}`);
}

export async function deleteAsset(formData: FormData) {
  const { business } = await requireBusiness();
  if (business.role === "STAFF") return;
  const asset = await prisma.fixedAsset.findFirst({ where: { id: String(formData.get("assetId")), businessId: business.id }, include: { _count: { select: { depreciations: true } } } });
  if (!asset) return;
  if (asset.status === "DISPOSED" || asset._count.depreciations > 0) {
    await setFlash("This asset has depreciation or a sale booked, so it cannot be deleted. Take those back first.");
    revalidateAll();
    return;
  }
  await prisma.fixedAsset.delete({ where: { id: asset.id } });
  await audit(business.id, "DELETE", "FIXED_ASSET", asset.id, `Deleted ${asset.number} ${asset.name}`);
  revalidateAll();
  redirect("/app/assets");
}

// Books depreciation up to the end of the month chosen (every asset, or one).
export async function runDepreciationAction(formData: FormData) {
  const { business } = await requireBusiness();
  if (business.role === "STAFF") return;
  const today = todayInNairobi();
  const picked = monthStart(formData.get("through"));
  const through = picked ? lastDayOfMonth(picked) : latestBookableMonth(today);
  const onlyAssetId = String(formData.get("assetId") ?? "") || undefined;
  const result = await runDepreciation(business, through, today, onlyAssetId);
  if ("error" in result) {
    await setFlash(result.error);
  } else if (result.months === 0) {
    await setFlash(`Nothing to book: depreciation is already up to date through ${monthLabel(through)}.`);
  } else {
    await setFlash(`Booked ${result.amount.toFixed(2)} ${business.currency} of depreciation for ${result.assets} asset${result.assets === 1 ? "" : "s"} over ${result.months} month${result.months === 1 ? "" : "s"}, up to ${monthLabel(through)}.`);
    await audit(business.id, "CREATE", "FIXED_ASSET", onlyAssetId ?? null, `Booked depreciation of ${result.amount.toFixed(2)} through ${monthLabel(through)}`);
  }
  revalidateAll();
}

export async function undoDepreciationAction(formData: FormData) {
  const { business } = await requireBusiness();
  if (business.role === "STAFF") return;
  const month = day(formData.get("month"));
  if (!month) return;
  const result = await undoDepreciationMonth(business, month);
  if ("error" in result) {
    await setFlash(result.error);
  } else {
    await setFlash(`Took back the depreciation for ${monthLabel(month)}.`);
    await audit(business.id, "DELETE", "FIXED_ASSET", null, `Took back the depreciation for ${monthLabel(month)}`);
  }
  revalidateAll();
}

export async function disposeAssetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  if (business.role === "STAFF") return { error: "Only an owner or accountant can sell an asset" };
  const date = day(formData.get("date"));
  if (!date) return { error: "Choose the date of the sale" };
  const proceeds = amount(formData.get("proceeds"));
  if (Number.isNaN(proceeds)) return { error: "Enter the amount received as a number, or 0 for a write-off" };
  const assetId = String(formData.get("assetId") ?? "");
  const result = await disposeAsset(business, assetId, { date, proceeds: round2(proceeds), moneyAccountId: String(formData.get("moneyAccountId") ?? "") || null }, todayInNairobi());
  if ("error" in result) return { error: result.error };
  const asset = await prisma.fixedAsset.findUnique({ where: { id: assetId }, select: { number: true, name: true } });
  await audit(
    business.id,
    "UPDATE",
    "FIXED_ASSET",
    assetId,
    `${proceeds > 0 ? "Sold" : "Wrote off"} ${asset?.number} ${asset?.name} on ${formatDate(date)} for ${proceeds.toFixed(2)} (book value ${result.nbv.toFixed(2)}, ${result.result >= 0 ? "gain" : "loss"} ${Math.abs(result.result).toFixed(2)})`
  );
  revalidateAll();
  return {
    success:
      result.result === 0
        ? "Recorded. It went for exactly its book value, so there is no gain or loss."
        : `Recorded. Book value was ${result.nbv.toFixed(2)}, so there is a ${result.result > 0 ? "gain" : "loss"} of ${Math.abs(result.result).toFixed(2)} ${business.currency}.`,
  };
}

export async function undoDisposalAction(formData: FormData) {
  const { business } = await requireBusiness();
  if (business.role === "STAFF") return;
  const assetId = String(formData.get("assetId") ?? "");
  const result = await undoDisposal(business, assetId);
  if ("error" in result) {
    await setFlash(result.error);
  } else {
    await audit(business.id, "REOPEN", "FIXED_ASSET", assetId, "Undid the sale of an asset");
    await setFlash("The sale was undone. Depreciation will pick up again from the next run.");
  }
  revalidateAll();
}
