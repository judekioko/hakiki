import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { AUDIT_ENTITIES } from "@/lib/audit";
import { PageHeader } from "@/components/page-header";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState, FilterTabs } from "@/components/bits";

export const metadata = { title: "Audit trail" };

const PAGE_SIZE = 100;

const ACTION_TONE: Record<string, "slate" | "teal" | "amber" | "rose"> = {
  CREATE: "teal",
  UPDATE: "amber",
  DELETE: "rose",
  VOID: "rose",
};

const stamp = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Nairobi",
});

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { business } = await requireBusiness();
  const { status: type } = await searchParams;
  const entityType = type && type in AUDIT_ENTITIES ? type : undefined;

  const logs = await prisma.auditLog.findMany({
    where: { businessId: business.id, ...(entityType ? { entityType } : {}) },
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE,
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit trail"
        description="Who created, changed, voided or deleted records in these books. Entries cannot be edited."
      />
      <FilterTabs
        basePath="/app/audit"
        current={entityType ?? "all"}
        options={[{ value: "all", label: "Everything" }, ...Object.entries(AUDIT_ENTITIES).map(([value, label]) => ({ value, label }))]}
      />
      {logs.length === 0 ? (
        <EmptyState title="Nothing recorded yet">
          <p>Changes to invoices, credit notes, payments, journals and payroll appear here as they happen.</p>
        </EmptyState>
      ) : (
        <>
          <Table>
            <Thead>
              <Tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>Action</Th>
                <Th>Record</Th>
                <Th>What happened</Th>
              </Tr>
            </Thead>
            <Tbody>
              {logs.map((log) => (
                <Tr key={log.id}>
                  <Td className="whitespace-nowrap">{stamp.format(log.createdAt)}</Td>
                  <Td className="whitespace-nowrap">{log.userName}</Td>
                  <Td>
                    <Badge tone={ACTION_TONE[log.action] ?? "slate"}>{log.action.toLowerCase()}</Badge>
                  </Td>
                  <Td className="whitespace-nowrap">{AUDIT_ENTITIES[log.entityType] ?? log.entityType}</Td>
                  <Td>{log.summary}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
          {logs.length === PAGE_SIZE ? <p className="text-xs text-slate-500">Showing the latest {PAGE_SIZE} entries.</p> : null}
        </>
      )}
    </div>
  );
}
