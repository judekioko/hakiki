import { AMOUNT_TOLERANCE } from "./money";

// Words that say nothing about who a supplier is.
const NOISE_WORDS = new Set([
  "ltd", "limited", "co", "company", "enterprises", "enterprise", "ent", "and", "the", "kenya", "ke",
  "services", "shop", "store", "stores", "general", "supplies", "plc", "inc", "llp", "agencies", "traders",
]);

export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !NOISE_WORDS.has(t) && !/^\d+$/.test(t));
}

export function normaliseAlias(name: string): string {
  return name.trim().replace(/\s+/g, " ").toUpperCase();
}

// 0..1 overlap between two names, ignoring generic business words.
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

export type MatchPayment = {
  id: string;
  paidAt: Date;
  remaining: number;
  counterparty: string;
  supplierId: string | null;
};

export type MatchInvoice = {
  id: string;
  invoiceDate: Date;
  remaining: number;
  supplierName: string;
  supplierId: string | null;
  supplierAliases: string[];
};

export type MatchScore = {
  score: number;
  exactAmount: boolean;
  days: number;
  nameScore: number;
  reasons: string[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
// Invoices are usually issued shortly before or after payment; anything further apart is not suggested.
const MAX_DAYS_APART = 90;

export function scoreMatch(payment: MatchPayment, invoice: MatchInvoice): MatchScore | null {
  if (payment.remaining <= 0 || invoice.remaining <= 0) return null;

  const days = Math.round((invoice.invoiceDate.getTime() - payment.paidAt.getTime()) / DAY_MS);
  if (Math.abs(days) > MAX_DAYS_APART) return null;

  const reasons: string[] = [];
  let score = 0;

  const exactAmount = Math.abs(payment.remaining - invoice.remaining) <= AMOUNT_TOLERANCE;
  if (exactAmount) {
    score += 50;
    reasons.push("Same amount");
  } else {
    score += 10;
    reasons.push(payment.remaining < invoice.remaining ? "Part payment" : "Payment covers more than this invoice");
  }

  const absDays = Math.abs(days);
  if (absDays <= 3) score += 25;
  else if (absDays <= 14) score += 15;
  else if (absDays <= 45) score += 5;
  reasons.push(absDays === 0 ? "Same day" : `${absDays} day${absDays === 1 ? "" : "s"} apart`);

  let nameScore = 0;
  if (payment.supplierId && payment.supplierId === invoice.supplierId) {
    nameScore = 1;
    reasons.push("Same supplier");
  } else {
    const names = [invoice.supplierName, ...invoice.supplierAliases];
    nameScore = Math.max(...names.map((n) => nameSimilarity(payment.counterparty, n)));
    if (invoice.supplierAliases.includes(normaliseAlias(payment.counterparty))) nameScore = 1;
    if (nameScore >= 0.5) reasons.push("Name matches");
  }
  score += Math.round(nameScore * 25);

  return { score, exactAmount, days, nameScore, reasons };
}

export function suggestInvoices(payment: MatchPayment, invoices: MatchInvoice[], limit = 5) {
  return invoices
    .map((invoice) => ({ invoice, match: scoreMatch(payment, invoice) }))
    .filter((s): s is { invoice: MatchInvoice; match: MatchScore } => s.match !== null && s.match.score >= 30)
    .sort((a, b) => b.match.score - a.match.score)
    .slice(0, limit);
}

// Auto-match only when there is one clear winner: same amount, close date, and a matching name.
export function isConfidentMatch(best: MatchScore, runnerUp?: MatchScore): boolean {
  return (
    best.exactAmount &&
    Math.abs(best.days) <= 14 &&
    best.nameScore >= 0.5 &&
    (!runnerUp || runnerUp.score < best.score - 15)
  );
}
