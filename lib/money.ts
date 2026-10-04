// Prisma returns Decimal objects for money columns; all arithmetic in the app is done on numbers.
export function num(value: { toString(): string } | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : Number(value.toString());
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Payments and invoices within a shilling of each other are treated as equal (rounding on receipts).
export const AMOUNT_TOLERANCE = 1;
