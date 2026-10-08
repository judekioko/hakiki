"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { audit } from "@/lib/audit";
import { overdueCustomers } from "@/lib/reminders";
import { TONE_LABEL, type ReminderTone } from "@/lib/reminder-text";

// Called by the reminder buttons as the message is opened in WhatsApp or the mail app. Recording it here, rather
// than trusting the browser, means the amounts in the history are what was really overdue at that moment.
export async function logReminder(input: { customerId: string; channel: "WHATSAPP" | "EMAIL"; tone: ReminderTone }) {
  const { business, session } = await requireBusiness();
  if (!["WHATSAPP", "EMAIL"].includes(input.channel) || !(input.tone in TONE_LABEL)) return { error: "Invalid reminder" };

  const [entry] = await overdueCustomers(business.id, input.customerId);
  if (!entry) return { error: "This customer has nothing overdue" };

  await prisma.paymentReminder.create({
    data: {
      businessId: business.id,
      customerId: entry.customer.id,
      channel: input.channel,
      tone: input.tone,
      overdueAmount: entry.total,
      invoiceCount: entry.invoices.length,
      sentBy: session.name,
    },
  });
  await audit(
    business.id,
    "CREATE",
    "REMINDER",
    entry.customer.id,
    `Sent a ${TONE_LABEL[input.tone].toLowerCase()} to ${entry.customer.name} by ${input.channel === "WHATSAPP" ? "WhatsApp" : "email"} for ${entry.total.toFixed(2)} overdue`
  );
  revalidatePath("/app", "layout");
  return { ok: true };
}
