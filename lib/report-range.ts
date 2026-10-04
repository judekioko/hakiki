import { currentFinancialYear, financialYear } from "./periods";

const DAY = 24 * 60 * 60 * 1000;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

// Nairobi midnight for a yyyy-mm-dd date.
export function startOfDay(date: string): Date {
  return new Date(`${date}T00:00:00+03:00`);
}

function toInput(date: Date): string {
  return new Date(date.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Today's date in Nairobi as yyyy-mm-dd.
export function todayInput(): string {
  return toInput(new Date());
}

export type ReportRange = { from: Date; to: Date; fromInput: string; toInput: string };

// Reports take inclusive from/to dates in the URL; queries use an exclusive end.
export function parseRange(params: { from?: string; to?: string }, yearEndMonth: number): ReportRange {
  const fy = financialYear(currentFinancialYear(yearEndMonth), yearEndMonth);
  const from = params.from && isoDate.test(params.from) ? startOfDay(params.from) : fy.start;
  const toInclusive = params.to && isoDate.test(params.to) ? startOfDay(params.to) : new Date(fy.end.getTime() - DAY);
  const to = new Date(toInclusive.getTime() + DAY);
  return { from, to, fromInput: toInput(from), toInput: toInput(toInclusive) };
}

export function presetRanges(yearEndMonth: number) {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const monthStart = (year: number, month: number) => new Date(Date.UTC(year, month, 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const fyYear = currentFinancialYear(yearEndMonth);
  const fy = financialYear(fyYear, yearEndMonth);
  const lastFy = financialYear(fyYear - 1, yearEndMonth);
  const quarterStart = Math.floor(m / 3) * 3;
  return [
    { label: "This month", from: iso(monthStart(y, m)), to: iso(new Date(monthStart(y, m + 1).getTime() - DAY)) },
    { label: "Last month", from: iso(monthStart(y, m - 1)), to: iso(new Date(monthStart(y, m).getTime() - DAY)) },
    { label: "This quarter", from: iso(monthStart(y, quarterStart)), to: iso(new Date(monthStart(y, quarterStart + 3).getTime() - DAY)) },
    { label: fy.label, from: toInput(fy.start), to: toInput(new Date(fy.end.getTime() - DAY)) },
    { label: lastFy.label, from: toInput(lastFy.start), to: toInput(new Date(lastFy.end.getTime() - DAY)) },
  ];
}
