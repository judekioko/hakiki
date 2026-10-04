import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num } from "@/lib/money";
import { formatDate, toDateInput } from "@/lib/format";
import { allAccountOptions, businessContext } from "@/lib/form-options";
import { SOURCE_LABEL, sourceHref } from "@/lib/journal-links";
import { deleteManualJournal } from "@/lib/actions/accounting";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/components/forms";
import { JournalForm } from "@/components/module-forms";
import { FilterTabs } from "@/components/bits";

export const metadata = { title: "Journal" };

export default async function JournalPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { business } = await requireBusiness();
  const { fmt } = businessContext(business);
  const { status = "all" } = await searchParams;
  const [entries, accounts] = await Promise.all([
    prisma.journalEntry.findMany({
      where: { businessId: business.id, ...(status === "MANUAL" ? { sourceType: "MANUAL" } : {}) },
      include: { lines: { include: { account: { select: { code: true, name: true } } } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 100,
    }),
    allAccountOptions(business.id),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Journal"
        description="Every entry in your books. Invoices, bills, payments and payroll post here automatically."
      />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-3 lg:col-span-3">
          <FilterTabs
            basePath="/app/journal"
            current={status === "MANUAL" ? "MANUAL" : "all"}
            options={[
              { value: "all", label: "All entries" },
              { value: "MANUAL", label: "Manual journals" },
            ]}
          />
          {entries.length === 0 ? <p className="text-sm text-slate-500">No entries yet.</p> : null}
          {entries.map((e) => {
            const href = sourceHref(e.sourceType, e.sourceId);
            return (
              <div key={e.id} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-slate-500">
                      {formatDate(e.date)} · {SOURCE_LABEL[e.sourceType]}
                    </p>
                    {href ? (
                      <Link href={href} className="font-medium text-slate-900 hover:underline">
                        {e.memo}
                      </Link>
                    ) : (
                      <p className="font-medium text-slate-900">{e.memo}</p>
                    )}
                  </div>
                  {e.sourceType === "MANUAL" ? (
                    <form action={deleteManualJournal}>
                      <input type="hidden" name="entryId" value={e.id} />
                      <SubmitButton variant="ghost" size="sm" pendingText="...">
                        Delete
                      </SubmitButton>
                    </form>
                  ) : null}
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {e.lines.map((l) => (
                      <tr key={l.id}>
                        <td className={`py-0.5 ${num(l.credit) ? "pl-6" : ""}`}>
                          {l.account.code} · {l.account.name}
                        </td>
                        <td className="w-32 py-0.5 text-right">{num(l.debit) ? fmt(num(l.debit)) : ""}</td>
                        <td className="w-32 py-0.5 text-right">{num(l.credit) ? fmt(num(l.credit)) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
        <Card className="h-fit lg:col-span-2">
          <CardHeader>
            <CardTitle>New manual journal</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="mb-4 text-sm text-slate-500">
              For opening balances, depreciation, corrections and anything else not recorded elsewhere.
            </p>
            <JournalForm accounts={accounts} today={toDateInput(new Date())} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
