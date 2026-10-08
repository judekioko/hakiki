"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { audit } from "@/lib/audit";
import { mailConfigured, sendMail } from "@/lib/mailer";
import { shareMessage, shareUrl, type ShareKind } from "@/lib/share";
import { num } from "@/lib/money";
import { customerStatement } from "@/lib/statements";
import { todayInNairobi } from "@/lib/recurrence";
import type { ActionState } from "./types";

// Emails a document link to the customer from Hakiki, when SMTP is configured.
export async function emailDocument(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  if (!mailConfigured()) return { error: "Email sending is not set up on this server. Use the Email button instead, which opens your own mail app." };

  const kind = String(formData.get("kind")) as ShareKind;
  const id = String(formData.get("id"));

  let customer: { name: string; email: string | null } | null = null;
  let number: string | undefined;
  let amount: number | undefined;
  let dueDate: Date | undefined;
  if (kind === "invoice") {
    const doc = await prisma.salesInvoice.findFirst({ where: { id, businessId: business.id }, include: { customer: true } });
    if (!doc || doc.status === "DRAFT") return { error: "Send the invoice first, then email it" };
    customer = doc.customer;
    number = doc.number;
    amount = num(doc.total);
    dueDate = doc.dueDate;
  } else if (kind === "quotation") {
    const doc = await prisma.quotation.findFirst({ where: { id, businessId: business.id }, include: { customer: true } });
    if (!doc) return { error: "Quotation not found" };
    customer = doc.customer;
    number = doc.number;
    amount = num(doc.total);
  } else if (kind === "credit-note") {
    const doc = await prisma.creditNote.findFirst({ where: { id, businessId: business.id }, include: { customer: true } });
    if (!doc || doc.status !== "ISSUED") return { error: "Issue the credit note first, then email it" };
    customer = doc.customer;
    number = doc.number;
    amount = num(doc.total);
  } else if (kind === "statement") {
    const c = await prisma.customer.findFirst({ where: { id, businessId: business.id } });
    if (!c) return { error: "Customer not found" };
    customer = c;
    const today = todayInNairobi();
    amount = (await customerStatement(business.id, c.id, new Date(today.getTime() - 90 * 86400000), today)).closing;
  } else {
    return { error: "Unknown document" };
  }
  if (!customer.email) return { error: `Add an email address for ${customer.name} first` };

  const { subject, text } = shareMessage({
    kind,
    customerName: customer.name,
    businessName: business.name,
    number,
    amount,
    currency: business.currency,
    dueDate,
    url: await shareUrl(kind, id, business.id),
  });
  try {
    await sendMail({ to: customer.email, subject, text, replyTo: business.email });
  } catch (error) {
    console.error("Could not send email", error);
    return { error: "The email could not be sent. Check the SMTP settings on the server." };
  }
  await audit(business.id, "SEND", kind === "statement" ? "CUSTOMER" : kind === "invoice" ? "SALES_INVOICE" : kind === "quotation" ? "QUOTATION" : "CREDIT_NOTE", id, `Emailed ${kind.replace("-", " ")}${number ? ` ${number}` : ""} to ${customer.name} (${customer.email})`);
  revalidatePath("/app", "layout");
  return { success: `Emailed to ${customer.email}` };
}
