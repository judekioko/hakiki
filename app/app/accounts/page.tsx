import Link from "next/link";
import { requireBusiness } from "@/lib/business";
import { accountBalances } from "@/lib/reports";
import { businessContext } from "@/lib/form-options";
import { prisma } from "@/lib/prisma";
import { setAccountArchived } from "@/lib/actions/accounting";
import { MONEY_KIND_LABEL } from "@/lib/money-accounts";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/forms";
import { AccountForm } from "@/components/module-forms";

export const metadata = { title: "Chart of accounts" };

const TYPE_LABEL = { ASSET: "Assets", LIABILITY: "Liabilities", EQUITY: "Equity", INCOME: "Income", EXPENSE: "Expenses" } as const;

export default async function AccountsPage() {
  const { business } = await requireBusiness();
  const { fmt } = businessContext(business);
  const [balances, archived] = await Promise.all([
    accountBalances(business.id),
    prisma.account.findMany({ where: { businessId: business.id, isArchived: true }, select: { id: true } }),
  ]);
  const archivedIds = new Set(archived.map((a) => a.id));

  return (
    <div className="space-y-6">
      <PageHeader title="Chart of accounts" description="Every account in your books with its current balance." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {(Object.keys(TYPE_LABEL) as (keyof typeof TYPE_LABEL)[]).map((type) => (
            <Card key={type}>
              <CardHeader>
                <CardTitle>{TYPE_LABEL[type]}</CardTitle>
              </CardHeader>
              <CardBody>
                <ul className="divide-y divide-slate-100 text-sm">
                  {balances
                    .filter((b) => b.type === type)
                    .map((b) => (
                      <li key={b.id} className={`flex items-center justify-between gap-3 py-2 ${archivedIds.has(b.id) ? "opacity-50" : ""}`}>
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="w-12 shrink-0 font-mono text-xs text-slate-500">{b.code}</span>
                          <Link href={`/app/accounts/${b.id}`} className="truncate text-slate-900 hover:underline">
                            {b.name}
                          </Link>
                          {b.moneyKind ? <Badge tone="teal">{MONEY_KIND_LABEL[b.moneyKind as keyof typeof MONEY_KIND_LABEL]}</Badge> : null}
                          {b.systemKey ? <Badge>System</Badge> : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className={b.balance < 0 ? "text-rose-700" : ""}>{b.debit || b.credit ? fmt(b.balance) : "—"}</span>
                          {!b.systemKey ? (
                            <form action={setAccountArchived}>
                              <input type="hidden" name="accountId" value={b.id} />
                              <input type="hidden" name="archived" value={archivedIds.has(b.id) ? "false" : "true"} />
                              <SubmitButton variant="ghost" size="sm" pendingText="...">
                                {archivedIds.has(b.id) ? "Restore" : "Hide"}
                              </SubmitButton>
                            </form>
                          ) : null}
                        </div>
                      </li>
                    ))}
                </ul>
              </CardBody>
            </Card>
          ))}
        </div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Add an account</CardTitle>
          </CardHeader>
          <CardBody>
            <AccountForm />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
