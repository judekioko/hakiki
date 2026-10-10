import "server-only";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "./prisma";
import { decryptSecret } from "./secrets";
import { appOrigin } from "./share";

// A thin client for Safaricom's Daraja API. Each business brings its own Daraja app (consumer key and secret) and
// shortcode, so everything here takes that business's configuration.

export type MpesaCredentials = {
  environment: "SANDBOX" | "PRODUCTION";
  shortcode: string;
  shortcodeType: string;
  consumerKey: string;
  consumerSecret: string;
  passkey: string | null;
};

const BASE = { SANDBOX: "https://sandbox.safaricom.co.ke", PRODUCTION: "https://api.safaricom.co.ke" } as const;

export async function loadMpesaConfig(businessId: string) {
  const row = await prisma.mpesaConfig.findUnique({ where: { businessId } });
  if (!row) return null;
  const credentials: MpesaCredentials = {
    environment: row.environment,
    shortcode: row.shortcode,
    shortcodeType: row.shortcodeType,
    consumerKey: decryptSecret(row.consumerKeyEnc),
    consumerSecret: decryptSecret(row.consumerSecretEnc),
    passkey: row.passkeyEnc ? decryptSecret(row.passkeyEnc) : null,
  };
  return { row, credentials };
}

// The callback address must be the only thing that can reach the endpoints below, so the token is compared safely.
export async function configForCallback(businessId: string, token: string) {
  const row = await prisma.mpesaConfig.findUnique({ where: { businessId } });
  if (!row) return null;
  const a = Buffer.from(row.callbackToken);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b) ? row : null;
}

// Daraja asks for these addresses to avoid certain words (M-Pesa, Safaricom, sql...), hence the neutral "pay" path.
export async function callbackUrl(businessId: string, token: string, kind: "validation" | "confirmation" | "stk") {
  return `${await appOrigin()}/api/pay/${businessId}/${token}/${kind}`;
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(25_000) });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    const b = body as { errorMessage?: string; errorCode?: string; ResponseDescription?: string };
    throw new Error(b.errorMessage ?? b.ResponseDescription ?? `Safaricom answered ${response.status}`);
  }
  return body as T;
}

export async function accessToken(c: MpesaCredentials): Promise<string> {
  const basic = Buffer.from(`${c.consumerKey}:${c.consumerSecret}`).toString("base64");
  const body = await request<{ access_token?: string }>(`${BASE[c.environment]}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${basic}` },
  });
  if (!body.access_token) throw new Error("Safaricom did not return an access token. Check the consumer key and secret.");
  return body.access_token;
}

async function post<T>(c: MpesaCredentials, path: string, payload: object): Promise<T> {
  const token = await accessToken(c);
  return request<T>(`${BASE[c.environment]}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// Tells Safaricom where to send payment notifications for the shortcode.
export function registerC2bUrls(c: MpesaCredentials, urls: { confirmation: string; validation: string }) {
  return post<{ ResponseDescription?: string; ResponseCode?: string }>(c, "/mpesa/c2b/v2/registerurl", {
    ShortCode: c.shortcode,
    ResponseType: "Completed",
    ConfirmationURL: urls.confirmation,
    ValidationURL: urls.validation,
  });
}

// Sandbox only: pretends a customer paid the shortcode, so the whole flow can be tried without real money.
export function simulateC2b(c: MpesaCredentials, input: { amount: number; billRef: string; phone?: string }) {
  return post<{ ResponseDescription?: string }>(c, "/mpesa/c2b/v1/simulate", {
    ShortCode: c.shortcode,
    CommandID: c.shortcodeType === "TILL" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
    Amount: Math.round(input.amount),
    Msisdn: input.phone ?? "254708374149",
    BillRefNumber: input.billRef,
  });
}

// Daraja timestamps are yyyyMMddHHmmss in Nairobi time.
export function darajaTimestamp(now = new Date()): string {
  const eat = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${eat.getUTCFullYear()}${p(eat.getUTCMonth() + 1)}${p(eat.getUTCDate())}${p(eat.getUTCHours())}${p(eat.getUTCMinutes())}${p(eat.getUTCSeconds())}`;
}

export function parseDarajaTime(raw: string | number | undefined): Date {
  const m = String(raw ?? "").match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m) return new Date();
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+03:00`);
}

// Sends a payment request to the customer's phone (they get the M-Pesa PIN prompt).
export async function stkPush(
  c: MpesaCredentials,
  input: { phone: string; amount: number; reference: string; description: string; callback: string }
) {
  if (!c.passkey) throw new Error("Add the Lipa na M-Pesa passkey in the M-Pesa settings to send payment requests.");
  const timestamp = darajaTimestamp();
  const password = Buffer.from(`${c.shortcode}${c.passkey}${timestamp}`).toString("base64");
  return post<{ CheckoutRequestID?: string; MerchantRequestID?: string; ResponseCode?: string; CustomerMessage?: string; ResponseDescription?: string }>(
    c,
    "/mpesa/stkpush/v1/processrequest",
    {
      BusinessShortCode: c.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: c.shortcodeType === "TILL" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
      Amount: Math.ceil(input.amount),
      PartyA: input.phone,
      PartyB: c.shortcode,
      PhoneNumber: input.phone,
      CallBackURL: input.callback,
      AccountReference: input.reference.slice(0, 12),
      TransactionDesc: input.description.slice(0, 13),
    }
  );
}
