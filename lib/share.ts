import "server-only";
import { headers } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { formatDate, formatMoney } from "./format";

// Share links let a customer open a document without an account. The link carries a signed token naming exactly
// one document, so it cannot be used to see anything else, and it stops working after a while.

export type ShareKind = "invoice" | "quotation" | "credit-note" | "statement";
const LIFETIME_DAYS = 120;

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET environment variable is not set");
  // Derived, so a share token can never be accepted as a login session or the other way round.
  return new TextEncoder().encode(`${secret}:share-links`);
}

export async function signShareToken(kind: ShareKind, id: string, businessId: string) {
  return new SignJWT({ k: kind, id, b: businessId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${LIFETIME_DAYS}d`)
    .sign(key());
}

export async function verifyShareToken(token: string): Promise<{ kind: ShareKind; id: string; businessId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, key());
    const kind = payload.k as ShareKind;
    if (!["invoice", "quotation", "credit-note", "statement"].includes(kind)) return null;
    return { kind, id: String(payload.id), businessId: String(payload.b) };
  } catch {
    return null;
  }
}

// The address people reach the app at: APP_URL when set, otherwise what the current request came in on.
export async function appOrigin(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3001";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function shareUrl(kind: ShareKind, id: string, businessId: string): Promise<string> {
  return `${await appOrigin()}/share/${await signShareToken(kind, id, businessId)}`;
}

const NOUN: Record<ShareKind, string> = {
  invoice: "invoice",
  quotation: "quotation",
  "credit-note": "credit note",
  statement: "statement",
};

// The words that go with the link in a WhatsApp message or email.
export function shareMessage(input: {
  kind: ShareKind;
  customerName: string;
  businessName: string;
  number?: string;
  amount?: number;
  currency: string;
  dueDate?: Date;
  url: string;
}): { subject: string; text: string } {
  const { kind, customerName, businessName, number, amount, currency, dueDate, url } = input;
  const what = `${NOUN[kind]}${number ? ` ${number}` : ""}`;
  const lines = [`Hello ${customerName},`, ``, `Here is your ${what} from ${businessName}.`];
  if (amount !== undefined) lines.push(kind === "statement" ? `Balance owing: ${formatMoney(amount, currency)}` : `Amount: ${formatMoney(amount, currency)}`);
  if (dueDate) lines.push(`Due: ${formatDate(dueDate)}`);
  lines.push(``, `View or print it here: ${url}`, ``, `Thank you.`);
  return { subject: `${what[0].toUpperCase()}${what.slice(1)} from ${businessName}`, text: lines.join("\n") };
}
