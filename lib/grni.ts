import { round2 } from "./money";

// Goods received but not yet invoiced: when stock arrives against a purchase order it is booked to inventory at the
// price on the order, with the other side held in "Goods received not invoiced". The supplier's bill later clears
// that account and posts any difference in price. This is the value of `quantity` units of a purchase order line, on
// the same basis as a bill would carry it: tax is part of the cost for a business that cannot reclaim it.
export function orderLineValue(
  line: { quantity: unknown; lineTotal: unknown; taxAmount: unknown },
  quantity: number,
  claimVat: boolean
): number {
  const ordered = Number(line.quantity);
  if (ordered <= 0) return 0;
  const base = Number(line.lineTotal) + (claimVat ? 0 : Number(line.taxAmount));
  return round2((base * quantity) / ordered);
}
