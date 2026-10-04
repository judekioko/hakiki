// Financial years are labelled by the calendar year they end in (FY 2026 = Jan–Dec 2026 for a December year end).

// Boundaries are midnight in Nairobi (UTC+3), so late-night payments land in the right year.
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

export type Period = { label: string; year: number; start: Date; end: Date };

export function financialYear(year: number, yearEndMonth: number): Period {
  // end is exclusive: Nairobi midnight on the first day after the year end.
  const end = new Date(Date.UTC(year, yearEndMonth, 1) - EAT_OFFSET_MS);
  const start = new Date(Date.UTC(year - 1, yearEndMonth, 1) - EAT_OFFSET_MS);
  const label =
    yearEndMonth === 12 ? `FY ${year}` : `FY ${year} (${monthName(yearEndMonth % 12)} ${year - 1} – ${monthName(yearEndMonth - 1)} ${year})`;
  return { label, year, start, end };
}

export function currentFinancialYear(yearEndMonth: number, today = new Date()): number {
  const month = today.getUTCMonth() + 1;
  return month > yearEndMonth ? today.getUTCFullYear() + 1 : today.getUTCFullYear();
}

export function yearOptions(yearEndMonth: number): number[] {
  const current = currentFinancialYear(yearEndMonth);
  return [current, current - 1, current - 2];
}

export function parseYear(value: string | string[] | undefined, yearEndMonth: number): number {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(parsed) && parsed > 2000 && parsed < 2100 ? parsed : currentFinancialYear(yearEndMonth);
}

function monthName(zeroBasedMonth: number): string {
  return new Date(Date.UTC(2000, zeroBasedMonth, 1)).toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
}
