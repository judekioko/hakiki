import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { toDateInput } from "@/lib/format";
import { num } from "@/lib/money";
import { previousReconciliation } from "@/lib/reconcile";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { StartReconciliationForm } from "@/components/reconcile-workbench";

export const metadata = { title: "Start reconciliation" };

export default async function NewReconciliationPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const { business } = await requireBusiness();
  const { account } = await searchParams;
  const accounts = await prisma.account.findMany({
    where: { businessId: business.id, moneyKind: { not: null }, isArchived: false },
    orderBy: { code: "asc" },
    select: { id: true, name: true, currency: true },
  });
  const openingByAccount: Record<string, number> = {};
  for (const a of accounts) openingByAccount[a.id] = num((await previousReconciliation(a.id))?.statementBalance);

  return (
    <div className="space-y-6">
      <PageHeader title="Start a reconciliation" description="Enter the closing date and balance printed on the statement." />
      <Card>
        <CardBody>
          <StartReconciliationForm
            accounts={accounts}
            defaultAccountId={account}
            today={toDateInput(new Date())}
            openingByAccount={openingByAccount}
            currency={business.currency}
          />
        </CardBody>
      </Card>
    </div>
  );
}
