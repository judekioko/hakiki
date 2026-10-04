import "server-only";
import { prisma } from "./prisma";
import { num, round2 } from "./money";

// Average cost of everything brought into stock (purchases, opening stock, positive counts).
// A simple weighted average keeps costing predictable for small traders.
export async function averageCost(itemId: string): Promise<number> {
  const incoming = await prisma.stockMovement.findMany({
    where: { itemId, quantity: { gt: 0 } },
    select: { quantity: true, unitCost: true },
  });
  const qty = incoming.reduce((s, m) => s + num(m.quantity), 0);
  if (qty <= 0) {
    const item = await prisma.item.findUnique({ where: { id: itemId }, select: { purchasePrice: true } });
    return num(item?.purchasePrice);
  }
  const value = incoming.reduce((s, m) => s + num(m.quantity) * num(m.unitCost), 0);
  return Math.round((value / qty) * 10000) / 10000;
}

export async function stockLevels(businessId: string) {
  const items = await prisma.item.findMany({
    where: { businessId, kind: "INVENTORY" },
    include: { movements: { select: { quantity: true, unitCost: true } } },
    orderBy: { name: "asc" },
  });
  return items.map((item) => {
    const onHand = item.movements.reduce((s, m) => s + num(m.quantity), 0);
    const incoming = item.movements.filter((m) => num(m.quantity) > 0);
    const inQty = incoming.reduce((s, m) => s + num(m.quantity), 0);
    const avg = inQty > 0 ? incoming.reduce((s, m) => s + num(m.quantity) * num(m.unitCost), 0) / inQty : num(item.purchasePrice);
    return {
      id: item.id,
      name: item.name,
      sku: item.sku,
      unit: item.unit,
      onHand: Math.round(onHand * 1000) / 1000,
      averageCost: avg,
      value: round2(onHand * avg),
      reorderLevel: item.reorderLevel === null ? null : num(item.reorderLevel),
      salePrice: num(item.salePrice),
    };
  });
}
