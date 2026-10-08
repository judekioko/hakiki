import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { formatDate } from "@/lib/format";
import { describeSchedule, type Frequency } from "@/lib/recurrence";
import { runDueRecurring } from "@/lib/recurring";
import { PageHeader } from "@/components/page-header";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState, LinkButton } from "@/components/bits";

export const metadata = { title: "Recurring invoices" };

const STATUS = {
  ACTIVE: { label: "Active", tone: "teal" },
  PAUSED: { label: "Paused", tone: "amber" },
  ENDED: { label: "Ended", tone: "slate" },
} as const;

export default async function RecurringPage() {
  const { business } = await requireBusiness();
  await runDueRecurring(business.id);
  const schedules = await prisma.recurringInvoice.findMany({
    where: { businessId: business.id },
    include: { customer: { select: { name: true } }, _count: { select: { invoices: true } } },
    orderBy: [{ status: "asc" }, { nextRunDate: "asc" }],
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Recurring invoices"
        description="Invoices that are issued for you on a schedule: rent, retainers, subscriptions, monthly supplies."
        action={<LinkButton href="/app/sales/recurring/new">New recurring invoice</LinkButton>}
      />
      {schedules.length === 0 ? (
        <EmptyState title="No recurring invoices yet">
          <p>Set one up for a customer you bill on a regular schedule. Hakiki issues each invoice when it falls due.</p>
        </EmptyState>
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>Customer</Th>
              <Th>Schedule</Th>
              <Th>Next invoice</Th>
              <Th className="text-right">Issued</Th>
              <Th>Issues as</Th>
              <Th>Status</Th>
            </Tr>
          </Thead>
          <Tbody>
            {schedules.map((r) => (
              <Tr key={r.id}>
                <Td>
                  <Link href={`/app/sales/recurring/${r.id}`} className="font-medium text-slate-900 hover:underline">
                    {r.customer.name}
                  </Link>
                </Td>
                <Td>{describeSchedule(r.frequency as Frequency, r.interval)}</Td>
                <Td className="whitespace-nowrap">{r.status === "ENDED" ? "—" : formatDate(r.nextRunDate)}</Td>
                <Td className="text-right">{r._count.invoices}</Td>
                <Td>{r.autoSend ? "Sent" : "Draft"}</Td>
                <Td>
                  <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </div>
  );
}
