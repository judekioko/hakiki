const fractionDigitsCache = new Map<string, number>();

// Currencies such as UGX, RWF and XOF have no minor unit, so they are shown without decimals.
export function currencyDigits(currency: string): number {
  let digits = fractionDigitsCache.get(currency);
  if (digits === undefined) {
    try {
      digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
    } catch {
      digits = 2;
    }
    fractionDigitsCache.set(currency, digits);
  }
  return digits;
}

export function formatMoney(amount: number, currency = "KES"): string {
  const digits = currencyDigits(currency);
  const factor = 10 ** digits;
  const rounded = Math.round(amount * factor) / factor;
  const text = Math.abs(rounded).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: digits });
  return `${rounded < 0 ? "-" : ""}${currency} ${text}`;
}

// Bound formatter for pages that show many amounts in the business's currency.
export function moneyFormatter(currency: string) {
  return (amount: number) => formatMoney(amount, currency);
}

// Plain number with thousands separators, for table columns that already state the currency.
export function formatNumber(amount: number, digits = 2): string {
  return amount.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatKes(amount: number): string {
  return formatMoney(amount, "KES");
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
