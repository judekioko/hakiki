import { requireBusiness } from "@/lib/business";
import { toDateInput } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { PaymentForm } from "@/components/forms";
import { categoryAccountOptions, moneyAccountOptions } from "@/lib/form-options";
import { latestRates } from "@/lib/fx";

export const metadata = { title: "Add payment" };

export default async function NewPaymentPage() {
  const { business } = await requireBusiness();
  const [moneyAccounts, categories, rates] = await Promise.all([moneyAccountOptions(business.id), categoryAccountOptions(business.id), latestRates(business.id)]);
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Add a payment" description="Money paid out that is not on an imported statement, such as cash." />
      <Card>
        <CardBody>
          <PaymentForm today={toDateInput(new Date())} moneyAccounts={moneyAccounts} categories={categories} baseCurrency={business.currency} rates={rates} />
        </CardBody>
      </Card>
    </div>
  );
}
