"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num } from "@/lib/money";
import { audit } from "@/lib/audit";
import { accountIdsByKey } from "@/lib/ledger";
import { nextDocumentNumber, priceLines, totals } from "@/lib/document-lines";
import { orderAccrualMode, orderProgress } from "@/lib/purchase-orders";
import { postGoodsReceipt } from "@/lib/ledger";
import { lockMessage } from "@/lib/period-lock";
import { blockedByLock } from "@/lib/lock-guard";
import { firstError, linesSchema, parseJsonField, purchaseOrderSchema } from "@/lib/validators";
import type { ActionState } from "./types";

function revalidateAll() {
  revalidatePath("/app", "layout");
}

// Lines are replaced wholesale when an order is edited, so an order that has been received against or billed can
// no longer be edited. Cancel or close it and raise a new one instead.
async function hasActivity(orderId: string) {
  const [receipts, billed] = await Promise.all([
    prisma.goodsReceipt.count({ where: { orderId } }),
    prisma.invoice.count({ where: { purchaseOrderId: orderId } }),
  ]);
  return receipts + billed > 0;
}

export async function savePurchaseOrder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const parsed = purchaseOrderSchema.safeParse({
    supplierId: formData.get("supplierId") ?? "",
    orderDate: formData.get("orderDate"),
    expectedDate: formData.get("expectedDate") ?? "",
    reference: formData.get("reference") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const data = parsed.data;
  if (data.expectedDate && data.expectedDate < data.orderDate) return { error: "The expected date cannot be before the order date" };

  const supplier = await prisma.supplier.findFirst({ where: { id: data.supplierId, businessId: business.id } });
  if (!supplier) return { error: "Supplier not found" };

  const lineInput = parseJsonField(formData.get("lines"), linesSchema);
  if (lineInput.error) return { error: lineInput.error };
  const keys = await accountIdsByKey(business.id);
  // Tax is always shown on a purchase order, as it will be on the supplier's invoice.
  const priced = await priceLines(business.id, lineInput.data!, "purchase", keys.UNCATEGORISED_EXPENSE, true);
  if (priced.error) return { error: priced.error };

  const orderId = String(formData.get("orderId") ?? "");
  const place = formData.get("intent") === "order";
  const header = {
    supplierId: supplier.id,
    orderDate: new Date(`${data.orderDate}T00:00:00Z`),
    expectedDate: data.expectedDate ? new Date(`${data.expectedDate}T00:00:00Z`) : null,
    reference: data.reference ?? null,
    notes: data.notes ?? null,
    ...totals(priced.lines!),
  };

  let id: string;
  if (orderId) {
    const existing = await prisma.purchaseOrder.findFirst({ where: { id: orderId, businessId: business.id } });
    if (!existing) return { error: "Purchase order not found" };
    if (existing.status === "CANCELLED" || existing.status === "CLOSED") return { error: "A closed or cancelled order cannot be edited" };
    if (await hasActivity(orderId)) return { error: "Goods have been received or billed against this order, so it can no longer be edited" };
    await prisma.$transaction([
      prisma.purchaseOrderLine.deleteMany({ where: { orderId } }),
      prisma.purchaseOrder.update({
        where: { id: orderId },
        data: { ...header, status: place ? "ORDERED" : existing.status, lines: { create: priced.lines!.map((l) => ({ ...l })) } },
      }),
    ]);
    id = orderId;
  } else {
    const created = await prisma.purchaseOrder.create({
      data: {
        businessId: business.id,
        number: await nextDocumentNumber(business.id, "PO-"),
        status: place ? "ORDERED" : "DRAFT",
        ...header,
        lines: { create: priced.lines!.map((l) => ({ ...l })) },
      },
    });
    id = created.id;
  }
  const saved = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } });
  await audit(
    business.id,
    orderId ? "UPDATE" : "CREATE",
    "PURCHASE_ORDER",
    id,
    `${orderId ? "Edited" : "Created"} purchase order ${saved.number} for ${supplier.name} (${num(saved.total).toFixed(2)})`
  );
  revalidateAll();
  redirect(`/app/purchase-orders/${id}`);
}

export async function setPurchaseOrderStatus(formData: FormData) {
  const { business } = await requireBusiness();
  const status = String(formData.get("status"));
  if (!["ORDERED", "CLOSED", "CANCELLED"].includes(status)) return;
  const order = await prisma.purchaseOrder.findFirst({ where: { id: String(formData.get("orderId")), businessId: business.id } });
  if (!order) return;

  const allowed: Record<string, string[]> = {
    ORDERED: ["DRAFT", "CLOSED"],
    CLOSED: ["ORDERED"],
    CANCELLED: ["DRAFT", "ORDERED"],
  };
  if (!allowed[status].includes(order.status)) return;
  if (status === "CANCELLED" && (await hasActivity(order.id))) return;

  await prisma.purchaseOrder.update({ where: { id: order.id }, data: { status: status as "ORDERED" | "CLOSED" | "CANCELLED" } });
  await audit(business.id, "UPDATE", "PURCHASE_ORDER", order.id, `Marked purchase order ${order.number} as ${status.toLowerCase()}`);
  revalidateAll();
}

export async function deletePurchaseOrder(formData: FormData) {
  const { business } = await requireBusiness();
  const order = await prisma.purchaseOrder.findFirst({ where: { id: String(formData.get("orderId")), businessId: business.id } });
  if (!order || !["DRAFT", "CANCELLED"].includes(order.status) || (await hasActivity(order.id))) return;
  await prisma.purchaseOrder.delete({ where: { id: order.id } });
  await audit(business.id, "DELETE", "PURCHASE_ORDER", order.id, `Deleted purchase order ${order.number}`);
  revalidateAll();
  redirect("/app/purchase-orders");
}

const receiptLinesSchema = z.array(z.object({ lineId: z.string(), quantity: z.coerce.number().min(0) }));

// Records a delivery. Quantities cannot exceed what is still outstanding on each line.
export async function recordGoodsReceipt(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const order = await prisma.purchaseOrder.findFirst({ where: { id: String(formData.get("orderId")), businessId: business.id } });
  if (!order) return { error: "Purchase order not found" };
  if (order.status !== "ORDERED") return { error: "Goods can only be received against an order that has been placed and is still open" };

  const date = String(formData.get("receivedDate") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Enter the date the goods arrived" };
  const input = parseJsonField(formData.get("lines"), receiptLinesSchema);
  if (input.error) return { error: input.error };
  const quantities = input.data!.filter((l) => l.quantity > 0);
  if (quantities.length === 0) return { error: "Enter the quantity received for at least one line" };
  const receivedAt = new Date(`${date}T00:00:00Z`);
  const locked = lockMessage(business, receivedAt);
  if (locked) return { error: locked };

  const { progress } = await orderProgress(order.id);
  for (const q of quantities) {
    const p = progress.find((x) => x.id === q.lineId);
    if (!p) return { error: "One of the lines does not belong to this order" };
    if (q.quantity > p.ordered - p.received + 0.0005) {
      return { error: `You can receive at most ${Math.round((p.ordered - p.received) * 1000) / 1000} more of one of the lines. Raise a new order for extra goods.` };
    }
  }

  const mode = await orderAccrualMode(order.id);
  const receipt = await prisma.goodsReceipt.create({
    data: {
      businessId: business.id,
      orderId: order.id,
      number: await nextDocumentNumber(business.id, "GRN-"),
      receivedDate: receivedAt,
      accrued: mode.stock,
      accruesServices: mode.services,
      note: String(formData.get("note") ?? "").trim() || null,
      lines: { create: quantities.map((q) => ({ orderLineId: q.lineId, quantity: q.quantity })) },
    },
  });
  await postGoodsReceipt(receipt.id);
  await audit(business.id, "CREATE", "GOODS_RECEIPT", receipt.id, `Recorded goods received ${receipt.number} against ${order.number}`);
  revalidateAll();
  return { success: `Recorded ${receipt.number}` };
}

export async function deleteGoodsReceipt(formData: FormData) {
  const { business } = await requireBusiness();
  const receipt = await prisma.goodsReceipt.findFirst({
    where: { id: String(formData.get("receiptId")), businessId: business.id },
    include: { order: { select: { number: true } } },
  });
  if (!receipt) return;
  if (receipt.accrued && (await blockedByLock(business, "goodsReceipt", receipt.id))) return;
  await prisma.goodsReceipt.delete({ where: { id: receipt.id } });
  await postGoodsReceipt(receipt.id);
  await audit(business.id, "DELETE", "GOODS_RECEIPT", receipt.id, `Deleted goods received ${receipt.number} from ${receipt.order.number}`);
  revalidateAll();
}
