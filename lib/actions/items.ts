"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num, round2 } from "@/lib/money";
import { accountIdsByKey, replaceEntry } from "@/lib/ledger";
import { averageCost } from "@/lib/inventory";
import { firstError, itemSchema } from "@/lib/validators";
import type { ActionState } from "./types";

async function readItem(businessId: string, formData: FormData) {
  const parsed = itemSchema.safeParse({
    name: formData.get("name"),
    sku: formData.get("sku") ?? "",
    kind: formData.get("kind"),
    unit: formData.get("unit") ?? "",
    salePrice: formData.get("salePrice") || 0,
    purchasePrice: formData.get("purchasePrice") || 0,
    taxRateId: formData.get("taxRateId") ?? "",
    incomeAccountId: formData.get("incomeAccountId") ?? "",
    expenseAccountId: formData.get("expenseAccountId") ?? "",
    reorderLevel: String(formData.get("reorderLevel") ?? ""),
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const d = parsed.data;
  // Ignore ids that do not belong to this business.
  const [rate, income, expense] = await Promise.all([
    d.taxRateId ? prisma.taxRate.findFirst({ where: { id: d.taxRateId, businessId } }) : null,
    d.incomeAccountId ? prisma.account.findFirst({ where: { id: d.incomeAccountId, businessId, type: "INCOME" } }) : null,
    d.expenseAccountId ? prisma.account.findFirst({ where: { id: d.expenseAccountId, businessId, moneyKind: null } }) : null,
  ]);
  return {
    data: {
      name: d.name,
      sku: d.sku ?? null,
      kind: d.kind,
      unit: d.unit ?? null,
      salePrice: d.salePrice,
      purchasePrice: d.purchasePrice,
      taxRateId: rate?.id ?? null,
      incomeAccountId: income?.id ?? null,
      expenseAccountId: expense?.id ?? null,
      reorderLevel: d.reorderLevel,
    },
  };
}

export async function createItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const result = await readItem(business.id, formData);
  if (result.error) return { error: result.error };
  const item = await prisma.item.create({ data: { businessId: business.id, ...result.data! } });
  revalidatePath("/app", "layout");
  redirect(`/app/items/${item.id}`);
}

export async function updateItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const result = await readItem(business.id, formData);
  if (result.error) return { error: result.error };
  const itemId = String(formData.get("itemId"));
  const existing = await prisma.item.findFirst({ where: { id: itemId, businessId: business.id }, include: { _count: { select: { movements: true } } } });
  if (!existing) return { error: "Item not found" };
  if (existing._count.movements > 0 && existing.kind !== result.data!.kind) {
    return { error: "This item already has stock movements, so its type cannot change" };
  }
  await prisma.item.update({ where: { id: itemId }, data: result.data! });
  revalidatePath("/app", "layout");
  return { success: "Item saved" };
}

const ADJUSTMENT_REASONS = {
  OPENING: "Opening stock",
  COUNT: "Stock count correction",
  DAMAGE: "Damaged / expired / lost",
  OTHER: "Other adjustment",
} as const;

// Records stock in or out without a sale or purchase. Opening stock is balanced against opening balance equity;
// everything else goes to the stock adjustments expense account.
export async function adjustStock(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const item = await prisma.item.findFirst({
    where: { id: String(formData.get("itemId")), businessId: business.id, kind: "INVENTORY" },
  });
  if (!item) return { error: "Only stocked items can be adjusted" };

  const reason = String(formData.get("reason")) as keyof typeof ADJUSTMENT_REASONS;
  if (!(reason in ADJUSTMENT_REASONS)) return { error: "Choose a reason" };
  const quantity = Number(formData.get("quantity"));
  if (!Number.isFinite(quantity) || quantity === 0) return { error: "Enter the quantity to add (positive) or remove (negative)" };
  const date = String(formData.get("date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Enter a valid date" };

  const enteredCost = Number(formData.get("unitCost") || 0);
  const unitCost = quantity > 0 && enteredCost > 0 ? enteredCost : await averageCost(item.id);
  if (quantity > 0 && unitCost <= 0) return { error: "Enter the cost per unit for stock coming in" };

  const movement = await prisma.stockMovement.create({
    data: {
      businessId: business.id,
      itemId: item.id,
      date: new Date(`${date}T12:00:00+03:00`),
      quantity,
      unitCost,
      sourceType: "STOCK_ADJUSTMENT",
      note: `${ADJUSTMENT_REASONS[reason]}${formData.get("note") ? `: ${formData.get("note")}` : ""}`,
    },
  });
  const keys = await accountIdsByKey(business.id);
  const value = round2(Math.abs(quantity) * unitCost);
  const other = reason === "OPENING" ? keys.OPENING_BALANCE : keys.STOCK_ADJUSTMENTS;
  await replaceEntry(business.id, "STOCK_ADJUSTMENT", movement.id, {
    date: movement.date,
    memo: `${ADJUSTMENT_REASONS[reason]}: ${num(movement.quantity)} × ${item.name}`,
    lines:
      quantity > 0
        ? [{ accountId: keys.INVENTORY, debit: value }, { accountId: other, credit: value }]
        : [{ accountId: other, debit: value }, { accountId: keys.INVENTORY, credit: value }],
  });
  await prisma.stockMovement.update({ where: { id: movement.id }, data: { sourceId: movement.id } });

  revalidatePath("/app", "layout");
  return { success: "Stock updated" };
}

export async function archiveItem(formData: FormData) {
  const { business } = await requireBusiness();
  await prisma.item.updateMany({
    where: { id: String(formData.get("itemId")), businessId: business.id },
    data: { isArchived: formData.get("archived") === "true" },
  });
  revalidatePath("/app", "layout");
}
