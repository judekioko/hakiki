import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { businessContext } from "@/lib/form-options";
import { formatDate } from "@/lib/format";
import { num } from "@/lib/money";
import { sourceHref } from "@/lib/journal-links";
import { candidateLines, clearedBalance } from "@/lib/reconcile";
import { discardReconciliation, undoReconciliation } from "@/lib/actions/reconcile";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { PrintButton } from "@/components/print-button";
import { SubmitButton } from "@/components/forms";
import { ReconcileWorkbench } from "@/components/reconcile-workbench";

export const metadata = { title: "Reconciliation" };

export default async function ReconciliationPage({ params }: { params: Promise<{ id: string }> }) {
  const { business } = await requireBusiness();
  const { id } = await params;
  const reconciliation = await prisma.reconciliation.findFirst({
    where: { id, businessId: business.id },
    include: { account: { select: { name: true } } },
  });
  if (!reconciliation) notFound();

  const { fmt } = businessContext(business);
  const opening = num(reconciliation.openingBalance);
  const statementBalance = num(reconciliation.statementBalance);
  const lines = await candidateLines(reconciliation);
  const dateFormat = (d: Date) => formatDate(d);
  const header = (
    <PageHeader
      title={`${reconciliation.account.name} · ${formatDate(reconciliation.statementDate)}`}
      description={`Statement closing balance ${fmt(statementBalance)}`}
    />
  );

  if (reconciliation.status === "IN_PROGRESS") {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <Link href="/app/reconcile" className="text-sm text-slate-500 hover:underline">
            ← Bank reconciliation
          </Link>
          <form action={discardReconciliation}>
            <input type="hidden" name="reconciliationId" value={reconciliation.id} />
            <SubmitButton variant="ghost" size="sm">
              Discard
            </SubmitButton>
          </form>
        </div>
        {header}
        <ReconcileWorkbench
          reconciliationId={reconciliation.id}
          opening={opening}
          statementBalance={statementBalance}
          currency={business.currency}
          lines={lines.map((l) => ({
            id: l.id,
            date: dateFormat(l.entry.date),
            memo: l.description ? `${l.entry.memo} · ${l.description}` : l.entry.memo,
            href: sourceHref(l.entry.sourceType, l.entry.sourceId),
            moneyIn: num(l.debit),
            moneyOut: num(l.credit),
            checked: l.reconciliationId === reconciliation.id,
          }))}
        />
      </div>
    );
  }

  // Completed: a read-only record that can be printed for the auditor.
  const cleared = lines.filter((l) => l.reconciliationId === reconciliation.id);
  const closing = clearedBalance(opening, cleared);
  const moneyIn = cleared.reduce((s, l) => s + num(l.debit), 0);
  const moneyOut = cleared.reduce((s, l) => s + num(l.credit), 0);
  const later = await prisma.reconciliation.count({
    where: { accountId: reconciliation.accountId, status: "COMPLETED", statementDate: { gt: reconciliation.statementDate } },
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <Link href="/app/reconcile" className="text-sm text-slate-500 hover:underline">
            ← Bank reconciliation
          </Link>
          <Badge tone="teal">Reconciled</Badge>
        </div>
        <div className="flex gap-2">
          <PrintButton />
          {later === 0 && business.role !== "STAFF" ? (
            <form action={undoReconciliation}>
              <input type="hidden" name="reconciliationId" value={reconciliation.id} />
              <SubmitButton variant="ghost" size="sm" pendingText="Undoing...">
                Undo reconciliation
              </SubmitButton>
            </form>
          ) : null}
        </div>
      </div>
      {header}
      <dl className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Opening balance</dt>
          <dd className="text-lg font-semibold">{fmt(opening)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Money in</dt>
          <dd className="text-lg font-semibold">{fmt(moneyIn)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Money out</dt>
          <dd className="text-lg font-semibold">{fmt(moneyOut)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Closing balance</dt>
          <dd className="text-lg font-semibold">{fmt(closing)}</dd>
        </div>
      </dl>
      <p className="text-xs text-slate-500">
        Completed {reconciliation.completedAt ? formatDate(reconciliation.completedAt) : ""}
        {reconciliation.completedBy ? ` by ${reconciliation.completedBy}` : ""}. The lines below are protected from changes until this is undone.
      </p>
      <Table>
        <Thead>
          <Tr>
            <Th>Date</Th>
            <Th>Description</Th>
            <Th className="text-right">Money in</Th>
            <Th className="text-right">Money out</Th>
          </Tr>
        </Thead>
        <Tbody>
          {cleared.map((l) => {
            const href = sourceHref(l.entry.sourceType, l.entry.sourceId);
            return (
              <Tr key={l.id}>
                <Td className="whitespace-nowrap">{formatDate(l.entry.date)}</Td>
                <Td>
                  {href ? (
                    <Link href={href} className="hover:underline">
                      {l.entry.memo}
                    </Link>
                  ) : (
                    l.entry.memo
                  )}
                </Td>
                <Td className="whitespace-nowrap text-right">{num(l.debit) ? fmt(num(l.debit)) : ""}</Td>
                <Td className="whitespace-nowrap text-right">{num(l.credit) ? fmt(num(l.credit)) : ""}</Td>
              </Tr>
            );
          })}
        </Tbody>
      </Table>
    </div>
  );
}
