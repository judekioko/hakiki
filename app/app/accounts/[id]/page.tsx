import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num, round2 } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { businessContext } from "@/lib/form-options";
import { SOURCE_LABEL, sourceHref } from "@/lib/journal-links";
import { renameAccount } from "@/lib/actions/accounting";
import { PageHeader } from "@/components/page-header";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/forms";

export const metadata = { title: "Account" };

export default async function AccountLedgerPage({ params }: { params: Promise<{ id: string }> }) {
  const { business } = await requireBusiness();
  const { id } = await params;
  const account = await prisma.account.findFirst({ where: { id, businessId: business.id } });
  if (!account) notFound();
  const { fmt } = businessContext(business);

  const lines = await prisma.journalLine.findMany({
    where: { accountId: account.id },
    include: { entry: true },
    orderBy: [{ entry: { date: "asc" } }, { entry: { createdAt: "asc" } }],
  });
  const debitNormal = account.type === "ASSET" || account.type === "EXPENSE";
  const rows: { l: (typeof lines)[number]; debit: number; credit: number; running: number }[] = [];
  for (const l of lines) {
    const debit = num(l.debit);
    const credit = num(l.credit);
    const previous = rows.at(-1)?.running ?? 0;
    rows.push({ l, debit, credit, running: round2(previous + (debitNormal ? debit - credit : credit - debit)) });
  }
  const balance = rows.at(-1)?.running ?? 0;
  const shown = rows.slice(-300).reverse();

  return (
    <div className="space-y-6">
      <PageHeader title={`${account.code} · ${account.name}`} description={`Balance ${fmt(balance)} · ${lines.length} entries`} />
      <form action={renameAccount} className="flex max-w-md gap-2">
        <input type="hidden" name="accountId" value={account.id} />
        <Input name="name" defaultValue={account.name} aria-label="Account name" />
        <SubmitButton variant="secondary" size="sm">
          Rename
        </SubmitButton>
      </form>
      {shown.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing posted to this account yet.</p>
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>Date</Th>
              <Th>Type</Th>
              <Th>Description</Th>
              <Th className="text-right">Debit</Th>
              <Th className="text-right">Credit</Th>
              <Th className="text-right">Balance</Th>
            </Tr>
          </Thead>
          <Tbody>
            {shown.map(({ l, debit, credit, running }) => {
              const href = sourceHref(l.entry.sourceType, l.entry.sourceId);
              return (
                <Tr key={l.id}>
                  <Td className="whitespace-nowrap">{formatDate(l.entry.date)}</Td>
                  <Td className="text-xs text-slate-500">{SOURCE_LABEL[l.entry.sourceType]}</Td>
                  <Td>
                    {href ? (
                      <Link href={href} className="hover:underline">
                        {l.entry.memo}
                      </Link>
                    ) : (
                      l.entry.memo
                    )}
                    {l.description ? <p className="text-xs text-slate-500">{l.description}</p> : null}
                  </Td>
                  <Td className="whitespace-nowrap text-right">{debit ? fmt(debit) : ""}</Td>
                  <Td className="whitespace-nowrap text-right">{credit ? fmt(credit) : ""}</Td>
                  <Td className="whitespace-nowrap text-right font-medium">{fmt(running)}</Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      )}
    </div>
  );
}
