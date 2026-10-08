// Schedule maths for recurring invoices. Dates are UTC midnight, matching the DATE columns they come from.
// The nth occurrence is always computed from the start date, so a monthly invoice starting on the 31st goes
// Jan 31, Feb 28, Mar 31 rather than drifting to the 28th for good.

export type Frequency = "WEEKLY" | "MONTHLY" | "YEARLY";

export function occurrence(start: Date, frequency: Frequency, interval: number, n: number): Date {
  if (frequency === "WEEKLY") {
    return new Date(start.getTime() + n * interval * 7 * 24 * 60 * 60 * 1000);
  }
  const months = frequency === "MONTHLY" ? n * interval : n * interval * 12;
  const total = start.getUTCMonth() + months;
  const year = start.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(start.getUTCDate(), lastDay)));
}

export function describeSchedule(frequency: Frequency, interval: number): string {
  if (frequency === "MONTHLY" && interval === 3) return "Every quarter";
  const unit = { WEEKLY: "week", MONTHLY: "month", YEARLY: "year" }[frequency];
  return interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`;
}

// Today's calendar date in Nairobi as a UTC-midnight Date, comparable with DATE columns.
export function todayInNairobi(now = new Date()): Date {
  const eat = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return new Date(Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate()));
}
