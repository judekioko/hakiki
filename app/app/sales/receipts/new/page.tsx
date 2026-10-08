import { requireBusiness } from "@/lib/business";
import { toDateInput } from "@/lib/format";
import { moneyAccountOptions } from "@/lib/form-options";
import { latestRates } from "@/lib/fx";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { ReceiptForm } from "@/components/module-forms";

export const metadata = { title: "Record money received" };

export default async function NewReceiptPage() {
  const { business } = await requireBusiness();
  const [moneyAccounts, rates] = await Promise.all([moneyAccountOptions(business.id), latestRates(business.id)]);
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Record money received" description="You can match it to invoices on the next screen." />
      <Card>
        <CardBody>
          <ReceiptForm moneyAccounts={moneyAccounts} today={toDateInput(new Date())} baseCurrency={business.currency} rates={rates} />
        </CardBody>
      </Card>
    </div>
  );
}
