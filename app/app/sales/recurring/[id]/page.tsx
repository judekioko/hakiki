import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num } from "@/lib/money";
import { formatDate, formatNumber } from "@/lib/format";
import { businessContext } from "@/lib/form-options";
import { INVOICE_DISPLAY, invoiceState } from "@/lib/sales";
import { describeSchedule, type Frequency } from "@/lib/recurrence";
import { runDueRecurring } from "@/lib/recurring";
import { deleteRecurring, endRecurring, issueRecurringNow, pauseRecurring, resumeRecurring } from "@/lib/actions/recurring";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { LinkButton } from "@/components/bits";
import { SubmitButton } from "@/components/forms";

export const metadata = { title: "Recurring invoice" };

const STATUS = {
  ACTIVE: { label: "Active", tone: "teal" },
  PAUSED: { label: "Paused", tone: "amber" },
  ENDED: { label: "Ended", tone: "slate" },
} as const;

function Action({ action, id, children, variant }: { action: (f: FormData) => Promise<void>; id: string; children: React.ReactNode; variant?: "secondary" | "ghost" }) {
  return (
    <form action={action}>
      <input type="hidden" name="recurringId" value={id} />
      <SubmitButton variant={variant ?? "secondary"} size="sm">
        {children}
      </SubmitButton>
    </form>
  );
}

export default async function RecurringDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { business } = await requireBusiness();
  await runDueRecurring(business.id);
  const { id } = await params;
  const rec = await prisma.recurringInvoice.findFirst({
    where: { id, businessId: business.id },
    include: {
      customer: true,
      lines: { orderBy: { position: "asc" } },
      invoices: {
        orderBy: { issueDate: "desc" },
        include: { allocations: { select: { amount: true } }, creditAllocations: { select: { amount: true } } },
      },
    },
  });
  if (!rec) notFound();
  const { fmt } = businessContext(business);
  const status = STATUS[rec.status];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/app/sales/recurring" className="text-sm text-slate-500 hover:underline">
            ← Recurring invoices
          </Link>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton href={`/app/sales/recurring/${rec.id}/edit`} variant="secondary">
            Edit
          </LinkButton>
          {rec.status === "ACTIVE" ? (
            <>
              <Action action={issueRecurringNow} id={rec.id}>Issue next invoice now</Action>
              <Action action={pauseRecurring} id={rec.id}>Pause</Action>
            </>
          ) : null}
          {rec.status === "PAUSED" ? <Action action={resumeRecurring} id={rec.id}>Resume</Action> : null}
          {rec.status !== "ENDED" ? <Action action={endRecurring} id={rec.id} variant="ghost">End</Action> : null}
        </div>
      </div>

      <PageHeader
        title={rec.customer.name}
        description={`${describeSchedule(rec.frequency as Frequency, rec.interval)} · payment terms ${rec.dueDays} days · issued as ${rec.autoSend ? "sent invoices" : "drafts to review"}`}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-sm text-slate-600">
            <p>
              First invoice: <strong className="text-slate-900">{formatDate(rec.startDate)}</strong>
            </p>
            <p>
              Next invoice:{" "}
              <strong className="text-slate-900">{rec.status === "ENDED" ? "none" : rec.status === "PAUSED" ? "paused" : formatDate(rec.nextRunDate)}</strong>
            </p>
            {rec.endDate ? (
              <p>
                Stops after: <strong className="text-slate-900">{formatDate(rec.endDate)}</strong>
              </p>
            ) : null}
            <p>
              Issued so far: <strong className="text-slate-900">{rec.runCount}</strong>
            </p>
            <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100 pt-2">
              {rec.lines.map((l) => (
                <li key={l.id} className="flex justify-between gap-3 py-1.5">
                  <span>
                    {formatNumber(num(l.quantity), num(l.quantity) % 1 ? 2 : 0)} × {l.description}
                  </span>
                  <span className="whitespace-nowrap">{fmt(num(l.quantity) * num(l.unitPrice))}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-400">Before tax. Tax and prices are applied afresh each time.</p>
          </CardBody>
        </Card>

        <div className="space-y-3 lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-700">Invoices issued</h2>
          {rec.invoices.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
              Nothing has been issued yet. The first invoice is created on {formatDate(rec.startDate)}.
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Number</Th>
                  <Th>Date</Th>
                  <Th className="text-right">Total</Th>
                  <Th className="text-right">Balance</Th>
                  <Th>Status</Th>
                </Tr>
              </Thead>
              <Tbody>
                {rec.invoices.map((inv) => {
                  const state = invoiceState(inv);
                  return (
                    <Tr key={inv.id}>
                      <Td>
                        <Link href={`/app/sales/invoices/${inv.id}`} className="font-medium text-slate-900 hover:underline">
                          {inv.number}
                        </Link>
                      </Td>
                      <Td className="whitespace-nowrap">{formatDate(inv.issueDate)}</Td>
                      <Td className="whitespace-nowrap text-right">{fmt(state.total)}</Td>
                      <Td className="whitespace-nowrap text-right">{state.status === "VOID" ? "—" : fmt(state.balance)}</Td>
                      <Td>
                        <Badge tone={INVOICE_DISPLAY[state.status].tone}>{INVOICE_DISPLAY[state.status].label}</Badge>
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          )}
        </div>
      </div>

      <form action={deleteRecurring}>
        <input type="hidden" name="recurringId" value={rec.id} />
        <SubmitButton variant="ghost" size="sm">
          Delete schedule
        </SubmitButton>
      </form>
    </div>
  );
}
