import { formatDate, formatMoney } from "./format";

// Wording for overdue-payment reminders. Kept free of server-only code so the page can show a preview and the
// buttons can build the WhatsApp / email links in the browser.

export type ReminderTone = "FRIENDLY" | "FIRM" | "FINAL";

export const TONE_LABEL: Record<ReminderTone, string> = {
  FRIENDLY: "Friendly nudge",
  FIRM: "Firm reminder",
  FINAL: "Final notice",
};

export type ReminderInvoice = { number: string; dueDate: Date; balance: number; daysOverdue: number };

// The longer an invoice has been overdue, the firmer the first suggestion.
export function suggestedTone(oldestDaysOverdue: number): ReminderTone {
  if (oldestDaysOverdue <= 14) return "FRIENDLY";
  if (oldestDaysOverdue <= 45) return "FIRM";
  return "FINAL";
}

export function reminderMessage(
  tone: ReminderTone,
  input: { customerName: string; businessName: string; currency: string; invoices: ReminderInvoice[]; footer?: string | null }
): string {
  const { customerName, businessName, currency, invoices, footer } = input;
  const total = invoices.reduce((s, i) => s + i.balance, 0);
  const lines = invoices.slice(0, 10).map(
    (i) => `• ${i.number} — ${formatMoney(i.balance, currency)}, due ${formatDate(i.dueDate)} (${i.daysOverdue} day${i.daysOverdue === 1 ? "" : "s"} overdue)`
  );
  if (invoices.length > 10) lines.push(`• and ${invoices.length - 10} more`);
  const noun = invoices.length === 1 ? "invoice is" : "invoices are";
  const totalLine = `Total overdue: ${formatMoney(total, currency)}`;

  const intro: Record<ReminderTone, string[]> = {
    FRIENDLY: [
      `Hello ${customerName},`,
      ``,
      `A friendly reminder from ${businessName}: the following ${noun} past the due date.`,
    ],
    FIRM: [
      `Hello ${customerName},`,
      ``,
      `Our records show the following ${noun} overdue on your account with ${businessName}, despite earlier reminders.`,
    ],
    FINAL: [
      `FINAL NOTICE: ${customerName},`,
      ``,
      `The following ${noun} seriously overdue on your account with ${businessName}.`,
    ],
  };
  const close: Record<ReminderTone, string[]> = {
    FRIENDLY: [``, `If you have already paid, please ignore this message and accept our thanks. Otherwise we would appreciate payment soon.`],
    FIRM: [``, `Please arrange payment within 7 days, or let us know when we can expect it. If you have already paid, please send us the payment details.`],
    FINAL: [``, `Please settle this account immediately. If payment is not received we may have to take further steps to recover the amount. If you have already paid, send us the confirmation today.`],
  };

  return [...intro[tone], ``, ...lines, ``, totalLine, ...close[tone], ...(footer ? [``, footer] : []), ``, `Thank you.`].join("\n");
}
