"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { audit } from "@/lib/audit";
import { setFlash } from "@/lib/flash";
import { toWhatsAppNumber } from "@/lib/kra";
import { num, round2 } from "@/lib/money";
import { encryptSecret } from "@/lib/secrets";
import { settledAmount } from "@/lib/sales";
import { callbackUrl, loadMpesaConfig, registerC2bUrls, simulateC2b, stkPush } from "@/lib/mpesa";
import type { ActionState } from "./types";

function revalidateAll() {
  revalidatePath("/app", "layout");
}

const newToken = () => randomBytes(24).toString("hex");

// Saves the business's Daraja details. Keys left blank keep what is already stored, so they never have to be shown
// again after the first time.
export async function saveMpesaConfig(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  if (business.role === "STAFF") return { error: "Only an owner or accountant can change the M-Pesa settings" };

  const environment: "PRODUCTION" | "SANDBOX" = formData.get("environment") === "PRODUCTION" ? "PRODUCTION" : "SANDBOX";
  const shortcode = String(formData.get("shortcode") ?? "").trim();
  if (!/^\d{5,7}$/.test(shortcode)) return { error: "The shortcode is the 5 to 7 digit paybill or till number" };
  const shortcodeType = formData.get("shortcodeType") === "TILL" ? "TILL" : "PAYBILL";
  const key = String(formData.get("consumerKey") ?? "").trim();
  const secret = String(formData.get("consumerSecret") ?? "").trim();
  const passkey = String(formData.get("passkey") ?? "").trim();

  const existing = await prisma.mpesaConfig.findUnique({ where: { businessId: business.id } });
  if (!existing && (!key || !secret)) return { error: "Enter the consumer key and consumer secret from your Daraja app" };

  const moneyAccountId = String(formData.get("moneyAccountId") ?? "");
  const account = moneyAccountId
    ? await prisma.account.findFirst({ where: { id: moneyAccountId, businessId: business.id, moneyKind: { not: null }, currency: null } })
    : null;

  const data = {
    environment,
    shortcode,
    shortcodeType,
    moneyAccountId: account?.id ?? null,
    ...(key ? { consumerKeyEnc: encryptSecret(key) } : {}),
    ...(secret ? { consumerSecretEnc: encryptSecret(secret) } : {}),
    ...(passkey ? { passkeyEnc: encryptSecret(passkey) } : {}),
  };
  if (existing) {
    // A different shortcode or environment means Safaricom must be told the addresses again.
    const changed = existing.shortcode !== shortcode || existing.environment !== environment;
    await prisma.mpesaConfig.update({ where: { businessId: business.id }, data: { ...data, ...(changed ? { urlsRegisteredAt: null } : {}) } });
  } else {
    await prisma.mpesaConfig.create({
      data: { businessId: business.id, callbackToken: newToken(), consumerKeyEnc: encryptSecret(key), consumerSecretEnc: encryptSecret(secret), ...data },
    });
  }
  await audit(business.id, "UPDATE", "MPESA", null, `Saved the M-Pesa settings (${environment.toLowerCase()}, shortcode ${shortcode})`);
  revalidateAll();
  return { success: "M-Pesa settings saved" };
}

// Tells Safaricom where to send payment notifications. The addresses must be public (https) for Safaricom to reach them.
export async function registerMpesaUrls() {
  const { business } = await requireBusiness();
  if (business.role === "STAFF") return;
  const config = await loadMpesaConfig(business.id);
  if (!config) return setFlash("Save the M-Pesa settings first.");
  try {
    const confirmation = await callbackUrl(business.id, config.row.callbackToken, "confirmation");
    const validation = await callbackUrl(business.id, config.row.callbackToken, "validation");
    if (/localhost|127\.0\.0\.1|^http:/.test(confirmation)) {
      await setFlash("Safaricom cannot reach this address: it must be a public https address. Set APP_URL to where Hakiki is hosted (or a tunnel to it) and try again.");
      revalidateAll();
      return;
    }
    const result = await registerC2bUrls(config.credentials, { confirmation, validation });
    await prisma.mpesaConfig.update({ where: { businessId: business.id }, data: { urlsRegisteredAt: new Date() } });
    await audit(business.id, "UPDATE", "MPESA", null, "Registered the M-Pesa payment notification addresses with Safaricom");
    await setFlash(`Safaricom accepted the notification addresses${result.ResponseDescription ? `: ${result.ResponseDescription}` : ""}.`);
  } catch (error) {
    await setFlash(`Safaricom did not accept the addresses: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  revalidateAll();
}

// A new secret in the notification addresses, for if they were ever exposed. The addresses must be registered again.
export async function rotateMpesaToken() {
  const { business } = await requireBusiness();
  if (business.role === "STAFF") return;
  await prisma.mpesaConfig.updateMany({ where: { businessId: business.id }, data: { callbackToken: newToken(), urlsRegisteredAt: null } });
  await audit(business.id, "UPDATE", "MPESA", null, "Changed the secret in the M-Pesa notification addresses");
  await setFlash("The notification addresses have changed. Register them with Safaricom again.");
  revalidateAll();
}

// Sandbox only: makes Safaricom send a pretend customer payment to the registered addresses.
export async function simulateMpesaPayment(formData: FormData) {
  const { business } = await requireBusiness();
  if (business.role === "STAFF") return;
  const config = await loadMpesaConfig(business.id);
  if (!config || config.credentials.environment !== "SANDBOX") return setFlash("Simulated payments only work with the sandbox environment.");
  const amount = Number(formData.get("amount"));
  const billRef = String(formData.get("billRef") ?? "").trim() || "TEST";
  if (!(amount > 0)) return setFlash("Enter an amount for the test payment.");
  try {
    const result = await simulateC2b(config.credentials, { amount, billRef });
    await setFlash(`Test payment sent: ${result.ResponseDescription ?? "accepted"}. It should appear in the list below within a few seconds.`);
  } catch (error) {
    await setFlash(`The test payment failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  revalidateAll();
}

// Asks the customer to pay an invoice from their phone: they get the M-Pesa PIN prompt, and the payment comes back
// through the notification address and settles the invoice.
export async function requestMpesaPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const config = await loadMpesaConfig(business.id);
  if (!config) return { error: "Set up M-Pesa first (Accounting → M-Pesa payments)" };

  const invoice = await prisma.salesInvoice.findFirst({
    where: { id: String(formData.get("invoiceId")), businessId: business.id, status: "SENT" },
    include: { allocations: { select: { amount: true } }, creditAllocations: { select: { amount: true } } },
  });
  if (!invoice) return { error: "Invoice not found" };
  const balance = round2(num(invoice.total) - settledAmount(invoice));
  const amount = Number(formData.get("amount"));
  if (!(amount > 0) || amount > balance + 0.01) return { error: `Enter an amount up to the balance of ${balance.toFixed(2)}` };
  const phone = toWhatsAppNumber(String(formData.get("phone") ?? ""));
  if (!phone) return { error: "Enter the customer's Safaricom number, like 0722 000 111" };

  try {
    const result = await stkPush(config.credentials, {
      phone,
      amount,
      reference: invoice.number,
      description: "Invoice",
      callback: await callbackUrl(business.id, config.row.callbackToken, "stk"),
    });
    if (result.ResponseCode !== "0" || !result.CheckoutRequestID) return { error: result.ResponseDescription ?? "Safaricom did not accept the request" };
    await prisma.mpesaTransaction.create({
      data: { businessId: business.id, kind: "STK", status: "PENDING", checkoutRequestId: result.CheckoutRequestID, amount, phone, billRef: invoice.number, invoiceId: invoice.id },
    });
    await audit(business.id, "CREATE", "MPESA", invoice.id, `Asked ${phone} to pay ${amount.toFixed(2)} for invoice ${invoice.number} by M-Pesa`);
    revalidateAll();
    return { success: `Payment request sent to ${phone}. Ask the customer to enter their M-Pesa PIN. The invoice is marked paid when the payment arrives.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The request could not be sent" };
  }
}
