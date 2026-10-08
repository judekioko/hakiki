import Link from "next/link";
import { requireBusiness } from "@/lib/business";
import { businessContext } from "@/lib/form-options";
import { formatDate } from "@/lib/format";
import { toWhatsAppNumber } from "@/lib/kra";
import { overdueCustomers } from "@/lib/reminders";
import { TONE_LABEL, reminderMessage, suggestedTone, type ReminderTone } from "@/lib/reminder-text";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, FilterTabs } from "@/components/bits";
import { ReminderActions } from "@/components/reminder-actions";

export const metadata = { title: "Payment reminders" };

const DAY_MS = 24 * 60 * 60 * 1000;
const TONES = Object.keys(TONE_LABEL) as ReminderTone[];

const FILTERS = [
  { value: "all", label: "All overdue" },
  { value: "due", label: "Not reminded in 7 days" },
  { value: "never", label: "Never reminded" },
];

export default async function RemindersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { business } = await requireBusiness();
  const { fmt } = businessContext(business);
  const { status } = await searchParams;
  const current = FILTERS.find((f) => f.value === status)?.value ?? "all";

  const all = await overdueCustomers(business.id);
  const now = new Date().getTime();
  const needsChasing = (c: (typeof all)[number]) => !c.lastReminder || now - c.lastReminder.createdAt.getTime() > 7 * DAY_MS;
  const matches = {
    all: () => true,
    due: needsChasing,
    never: (c: (typeof all)[number]) => c.reminderCount === 0,
  }[current as "all" | "due" | "never"];
  const shown = all.filter(matches);
  const totalOverdue = all.reduce((s, c) => s + c.total, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Payment reminders"
        description={
          all.length === 0
            ? "Nobody is overdue."
            : `${fmt(totalOverdue)} overdue from ${all.length} customer${all.length === 1 ? "" : "s"}. Reminders are sent from your own WhatsApp or email and recorded here.`
        }
      />
      <FilterTabs
        basePath="/app/sales/reminders"
        current={current}
        options={FILTERS.map((f) => ({
          value: f.value,
          label: f.label,
          count: all.filter({ all: () => true, due: needsChasing, never: (c: (typeof all)[number]) => c.reminderCount === 0 }[f.value as "all" | "due" | "never"]).length,
        }))}
      />

      {shown.length === 0 ? (
        <EmptyState title={all.length === 0 ? "No overdue invoices" : "Nothing in this view"}>
          {all.length === 0 ? <p>When an invoice passes its due date without being paid, the customer shows up here.</p> : null}
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {shown.map((c) => {
            const messages = Object.fromEntries(
              TONES.map((tone) => [
                tone,
                reminderMessage(tone, {
                  customerName: c.customer.name,
                  businessName: business.name,
                  currency: business.currency,
                  invoices: c.invoices,
                  footer: business.invoiceFooter,
                }),
              ])
            ) as Record<ReminderTone, string>;
            const daysSince = c.lastReminder ? Math.floor((now - c.lastReminder.createdAt.getTime()) / DAY_MS) : null;
            return (
              <Card key={c.customer.id}>
                <CardBody className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <Link href={`/app/sales/customers/${c.customer.id}`} className="text-base font-semibold text-slate-900 hover:underline">
                        {c.customer.name}
                      </Link>
                      <p className="text-sm text-slate-500">
                        {c.invoices.length} overdue invoice{c.invoices.length === 1 ? "" : "s"} · oldest {c.oldestDaysOverdue} days overdue ·{" "}
                        <Link href={`/app/sales/customers/${c.customer.id}/statement`} className="text-teal-700 hover:underline">
                          Statement
                        </Link>
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold text-rose-700">{fmt(c.total)}</p>
                      {c.lastReminder ? (
                        <p className="text-xs text-slate-500">
                          Reminded {daysSince === 0 ? "today" : `${daysSince} day${daysSince === 1 ? "" : "s"} ago`} ·{" "}
                          {TONE_LABEL[c.lastReminder.tone as ReminderTone].toLowerCase()} by {c.lastReminder.sentBy}
                          {c.reminderCount > 1 ? ` · ${c.reminderCount} reminders so far` : ""}
                        </p>
                      ) : (
                        <Badge tone="amber">Not reminded yet</Badge>
                      )}
                    </div>
                  </div>

                  <ul className="divide-y divide-slate-100 rounded-md border border-slate-100 text-sm">
                    {c.invoices.map((i) => (
                      <li key={i.number} className="flex items-center justify-between gap-3 px-3 py-1.5">
                        <span>
                          {i.number} <span className="text-slate-400">· due {formatDate(i.dueDate)}</span>
                        </span>
                        <span className="flex items-center gap-3">
                          <span className="text-xs text-rose-700">{i.daysOverdue} days overdue</span>
                          <span className="font-medium">{fmt(i.balance)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>

                  <ReminderActions
                    customerId={c.customer.id}
                    whatsappNumber={toWhatsAppNumber(c.customer.phone)}
                    email={c.customer.email}
                    subject={`Overdue payment: ${business.name}`}
                    messages={messages}
                    defaultTone={suggestedTone(c.oldestDaysOverdue)}
                  />
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
