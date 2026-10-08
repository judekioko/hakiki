import "server-only";
import { prisma } from "./prisma";
import { num, round2 } from "./money";

export const PO_DISPLAY = {
  DRAFT: { label: "Draft", tone: "slate" },
  ORDERED: { label: "Ordered", tone: "amber" },
  PART_RECEIVED: { label: "Part received", tone: "amber" },
  RECEIVED: { label: "Received", tone: "teal" },
  COMPLETE: { label: "Received & billed", tone: "teal" },
  CLOSED: { label: "Closed", tone: "slate" },
  CANCELLED: { label: "Cancelled", tone: "rose" },
} as const;

export type PoDisplayStatus = keyof typeof PO_DISPLAY;

export type LineProgress = { id: string; ordered: number; received: number; billed: number };

// Ordered, received and billed quantities per line. Receipts are goods received notes; billed comes from bill lines
// raised against the order. Neither moves stock or the ledger by itself: that happens when the bill is posted.
export async function orderProgress(orderId: string) {
  const [lines, billed] = await Promise.all([
    prisma.purchaseOrderLine.findMany({
      where: { orderId },
      orderBy: { position: "asc" },
      include: { received: { select: { quantity: true } }, item: { select: { kind: true } } },
    }),
    prisma.billLine.groupBy({
      by: ["purchaseOrderLineId"],
      where: { purchaseOrderLineId: { not: null }, invoice: { purchaseOrderId: orderId } },
      _sum: { quantity: true },
    }),
  ]);
  const billedBy = new Map(billed.map((b) => [b.purchaseOrderLineId!, num(b._sum.quantity)]));
  const progress: LineProgress[] = lines.map((l) => ({
    id: l.id,
    ordered: num(l.quantity),
    received: round2(l.received.reduce((s, r) => s + num(r.quantity), 0) * 1000) / 1000,
    billed: billedBy.get(l.id) ?? 0,
  }));
  return { lines, progress };
}

export function displayStatus(status: string, progress: LineProgress[]): PoDisplayStatus {
  if (status !== "ORDERED") return status as PoDisplayStatus;
  const ordered = progress.reduce((s, p) => s + p.ordered, 0);
  const received = progress.reduce((s, p) => s + Math.min(p.received, p.ordered), 0);
  const billed = progress.reduce((s, p) => s + Math.min(p.billed, p.ordered), 0);
  if (received <= 0) return "ORDERED";
  if (received + 0.0005 < ordered) return "PART_RECEIVED";
  return billed + 0.0005 >= ordered ? "COMPLETE" : "RECEIVED";
}

// Summary figures for the list page, using two queries for every order rather than two per order.
export async function orderSummaries(businessId: string) {
  const [orders, receipts, billed] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: { businessId },
      include: { supplier: { select: { name: true } }, lines: { select: { id: true, quantity: true } } },
      orderBy: [{ orderDate: "desc" }, { number: "desc" }],
    }),
    prisma.goodsReceiptLine.groupBy({ by: ["orderLineId"], where: { receipt: { businessId } }, _sum: { quantity: true } }),
    prisma.billLine.groupBy({
      by: ["purchaseOrderLineId"],
      where: { purchaseOrderLineId: { not: null }, invoice: { businessId } },
      _sum: { quantity: true },
    }),
  ]);
  const receivedBy = new Map(receipts.map((r) => [r.orderLineId, num(r._sum.quantity)]));
  const billedBy = new Map(billed.map((b) => [b.purchaseOrderLineId!, num(b._sum.quantity)]));
  return orders.map((order) => {
    const progress: LineProgress[] = order.lines.map((l) => ({
      id: l.id,
      ordered: num(l.quantity),
      received: receivedBy.get(l.id) ?? 0,
      billed: billedBy.get(l.id) ?? 0,
    }));
    return { order, progress, status: displayStatus(order.status, progress) };
  });
}

// Whether this order books stock when goods arrive (and its bills clear "Goods received not invoiced"). Orders that
// were already received or billed under the earlier method, where the bill added the stock, carry on that way, so
// nothing is counted twice.
export async function orderUsesAccrual(orderId: string): Promise<boolean> {
  const [legacyReceipts, legacyBills] = await Promise.all([
    prisma.goodsReceipt.count({ where: { orderId, accrued: false } }),
    prisma.invoice.count({ where: { purchaseOrderId: orderId, usesGrni: false } }),
  ]);
  return legacyReceipts + legacyBills === 0;
}
