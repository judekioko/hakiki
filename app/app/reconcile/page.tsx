import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { businessContext } from "@/lib/form-options";
import { formatDate } from "@/lib/format";
import { num } from "@/lib/money";
import { reconciliationOverview } from "@/lib/reconcile";
import { PageHeader } from "@/components/page-header";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState, LinkButton } from "@/components/bits";

export const metadata = { title: "Bank reconciliation" };

export default async function ReconcilePage() {
  const { business } = await requireBusiness();
  const { fmt } = businessContext(business);
  const [overview, history] = await Promise.all([
    reconciliationOverview(business.id),
    prisma.reconciliation.findMany({
      where: { businessId: business.id, status: "COMPLETED" },
      include: { account: { select: { name: true } } },
      orderBy: { statementDate: "desc" },
      take: 20,
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bank reconciliation"
        description="Tick off your books against a bank, mobile money or cash statement and prove the balances agree."
      />
      {overview.length === 0 ? (
        <EmptyState title="No money accounts yet">
          <p>Add a bank, mobile money or cash account in the chart of accounts first.</p>
        </EmptyState>
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>Account</Th>
              <Th className="text-right">Balance in books</Th>
              <Th>Last reconciled</Th>
              <Th className="text-right">Lines not reconciled</Th>
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {overview.map(({ account, last, inProgress, uncleared, ledgerBalance }) => (
              <Tr key={account.id}>
                <Td className="font-medium text-slate-900">{account.name}</Td>
                <Td className="whitespace-nowrap text-right">{fmt(ledgerBalance)}</Td>
                <Td className="whitespace-nowrap">
                  {last ? `${formatDate(last.statementDate)} · ${fmt(num(last.statementBalance))}` : <span className="text-slate-400">Never</span>}
                </Td>
                <Td className="text-right">{uncleared}</Td>
                <Td className="text-right">
                  {inProgress ? (
                    <LinkButton href={`/app/reconcile/${inProgress.id}`} variant="secondary">
                      Continue
                    </LinkButton>
                  ) : (
                    <LinkButton href={`/app/reconcile/new?account=${account.id}`}>Reconcile</LinkButton>
                  )}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      {history.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-700">Completed reconciliations</h2>
          <Table>
            <Thead>
              <Tr>
                <Th>Account</Th>
                <Th>Statement date</Th>
                <Th className="text-right">Statement balance</Th>
                <Th>Completed by</Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {history.map((r) => (
                <Tr key={r.id}>
                  <Td>{r.account.name}</Td>
                  <Td className="whitespace-nowrap">{formatDate(r.statementDate)}</Td>
                  <Td className="whitespace-nowrap text-right">{fmt(num(r.statementBalance))}</Td>
                  <Td>
                    <Badge tone="teal">{r.completedBy ?? "—"}</Badge>
                  </Td>
                  <Td className="text-right">
                    <Link href={`/app/reconcile/${r.id}`} className="text-teal-700 hover:underline">
                      View
                    </Link>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </section>
      ) : null}
    </div>
  );
}
