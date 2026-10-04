export function formatKes(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return `KES ${rounded.toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

// yyyy-mm-dd for <input type="date"> values.
export function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}
