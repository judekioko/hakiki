import { round2 } from "./money";

// The arithmetic of depreciation, kept free of the database so it can be checked on its own. Dates are whole days held
// as UTC midnights, like everywhere else in the books.

export type Terms = {
  cost: number;
  salvage: number;
  method: "STRAIGHT_LINE" | "REDUCING_BALANCE";
  lifeMonths: number | null;
  annualRate: number | null;
  // Depreciation already in the books before the first month this register depreciates.
  prior: number;
};

export function lastDayOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

export function addMonths(monthEnd: Date, months: number): Date {
  return new Date(Date.UTC(monthEnd.getUTCFullYear(), monthEnd.getUTCMonth() + months + 1, 0));
}

// 1 for the month the depreciation starts in, 2 for the next, and so on. Zero or less for earlier months.
export function monthNumber(from: Date, month: Date): number {
  return (month.getUTCFullYear() - from.getUTCFullYear()) * 12 + (month.getUTCMonth() - from.getUTCMonth()) + 1;
}

export function monthLabel(date: Date): string {
  return date.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

export const monthKey = (date: Date) => date.toISOString().slice(0, 7);

export const depreciableAmount = (t: Terms) => Math.max(0, round2(t.cost - t.salvage));

// What to charge for the k-th month (1 = the first month depreciated) when `accumulatedBefore` has been written off so
// far, prior depreciation included. Straight line is a fixed monthly amount that lands exactly on cost less salvage in
// the last month; reducing balance takes a share of what is left. Never goes below salvage value.
export function depreciationForMonth(t: Terms, k: number, accumulatedBefore: number): number {
  const depreciable = depreciableAmount(t);
  const room = round2(depreciable - accumulatedBefore);
  if (room <= 0 || k < 1) return 0;
  let amount: number;
  if (t.method === "STRAIGHT_LINE") {
    if (!t.lifeMonths || t.lifeMonths < 1) return 0;
    // The same amount every month, rounded to cents; the last month takes whatever is left so the total is exact.
    const monthsLeft = Math.ceil(((depreciable - t.prior) * t.lifeMonths) / depreciable - 1e-9);
    amount = k >= monthsLeft ? room : round2(depreciable / t.lifeMonths);
  } else {
    if (!t.annualRate || t.annualRate <= 0) return 0;
    amount = round2((t.cost - accumulatedBefore) * (t.annualRate / 100 / 12));
  }
  return round2(Math.min(Math.max(amount, 0), room));
}

// The months still to come, from where the asset stands now, until it is fully depreciated (at most `limit` months).
export function projectedSchedule(t: Terms, nextMonthEnd: Date, nextK: number, accumulated: number, limit = 600): { month: Date; amount: number; accumulated: number }[] {
  const rows: { month: Date; amount: number; accumulated: number }[] = [];
  let acc = accumulated;
  for (let i = 0; i < limit; i += 1) {
    const amount = depreciationForMonth(t, nextK + i, acc);
    if (amount <= 0) break;
    acc = round2(acc + amount);
    rows.push({ month: addMonths(nextMonthEnd, i), amount, accumulated: acc });
  }
  return rows;
}

export type AssetInput = {
  name: string;
  cost: number;
  salvage: number;
  method: "STRAIGHT_LINE" | "REDUCING_BALANCE";
  lifeMonths: number | null;
  annualRate: number | null;
  prior: number;
};

// A problem with the terms entered for an asset, if there is one.
export function checkTerms(a: AssetInput): string | null {
  if (!a.name.trim()) return "Give the asset a name";
  if (!(a.cost > 0)) return "Enter what the asset cost";
  if (a.salvage < 0 || a.salvage >= a.cost) return "The value left at the end must be less than the cost";
  if (a.prior < 0 || a.prior > a.cost - a.salvage + 0.005) return "Depreciation already booked cannot be more than the cost less the value left at the end";
  if (a.method === "STRAIGHT_LINE") {
    if (!a.lifeMonths || !Number.isInteger(a.lifeMonths) || a.lifeMonths < 1 || a.lifeMonths > 1200) return "Enter the useful life in whole months, for example 60 for five years";
  } else if (!a.annualRate || a.annualRate <= 0 || a.annualRate > 100) {
    return "Enter the yearly rate as a percentage between 0 and 100";
  }
  return null;
}
