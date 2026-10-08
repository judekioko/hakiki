import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { formatDate, formatMoney, toDateInput } from "@/lib/format";
import { num } from "@/lib/money";
import { latestRates } from "@/lib/fx";
import { deleteTransfer } from "@/lib/actions/foreign-accounts";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/bits";
import { SubmitButton } from "@/components/forms";
import { TransferForm } from "@/components/transfer-form";

export const metadata = { title: "Transfers and currency exchange" };

export default async function TransfersPage() {
  const { business } = await requireBusiness();
  const [accounts, transfers, rates] = await Promise.all([
    prisma.account.findMany({ where: { businessId: business.id, moneyKind: { not: null }, isArchived: false }, orderBy: { code: "asc" } }),
    prisma.moneyTransfer.findMany({
      where: { businessId: business.id },
      include: { fromAccount: { select: { name: true, currency: true } }, toAccount: { select: { name: true, currency: true } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 50,
    }),
    latestRates(business.id),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transfers and currency exchange"
        description="Move money between your own bank, mobile money and cash accounts, including converting between currencies."
      />
      {accounts.length < 2 ? (
        <EmptyState title="You need two accounts to transfer between">
          <p>Add another bank, mobile money or cash account in the chart of accounts. For a USD account, pick the currency when you add it.</p>
        </EmptyState>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>New transfer</CardTitle>
          </CardHeader>
          <CardBody>
            <TransferForm
              accounts={accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }))}
              baseCurrency={business.currency}
              rates={rates}
              today={toDateInput(new Date())}
            />
          </CardBody>
        </Card>
      )}

      {transfers.length > 0 ? (
        <Table>
          <Thead>
            <Tr>
              <Th>Date</Th>
              <Th>From</Th>
              <Th>To</Th>
              <Th className="text-right">Left</Th>
              <Th className="text-right">Arrived</Th>
              <Th>Note</Th>
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {transfers.map((t) => (
              <Tr key={t.id}>
                <Td className="whitespace-nowrap">{formatDate(t.date)}</Td>
                <Td>{t.fromAccount.name}</Td>
                <Td>{t.toAccount.name}</Td>
                <Td className="whitespace-nowrap text-right">{formatMoney(num(t.fromAmount), t.fromAccount.currency ?? business.currency)}</Td>
                <Td className="whitespace-nowrap text-right">{formatMoney(num(t.toAmount), t.toAccount.currency ?? business.currency)}</Td>
                <Td>{t.note ?? ""}</Td>
                <Td className="text-right">
                  <form action={deleteTransfer}>
                    <input type="hidden" name="transferId" value={t.id} />
                    <SubmitButton variant="ghost" size="sm" pendingText="...">
                      Delete
                    </SubmitButton>
                  </form>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      ) : null}
    </div>
  );
}
