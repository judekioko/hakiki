export const QUOTE_DISPLAY = {
  DRAFT: { label: "Draft", tone: "slate" },
  SENT: { label: "Sent", tone: "amber" },
  ACCEPTED: { label: "Accepted", tone: "teal" },
  DECLINED: { label: "Declined", tone: "rose" },
  INVOICED: { label: "Invoiced", tone: "teal" },
  EXPIRED: { label: "Expired", tone: "rose" },
} as const;

export type QuoteDisplayStatus = keyof typeof QUOTE_DISPLAY;

// A quotation that was sent but has passed its valid-until date shows as expired.
export function quoteStatus(quote: { status: string; expiryDate: Date }, today = new Date()): QuoteDisplayStatus {
  if (quote.status === "SENT" && quote.expiryDate.getTime() < today.getTime() - 24 * 60 * 60 * 1000) return "EXPIRED";
  return quote.status as QuoteDisplayStatus;
}
