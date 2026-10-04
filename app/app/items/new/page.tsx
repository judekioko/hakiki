import { requireBusiness } from "@/lib/business";
import { categoryAccountOptions, taxRateOptions } from "@/lib/form-options";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { ItemForm } from "@/components/module-forms";

export const metadata = { title: "Add item" };

export default async function NewItemPage() {
  const { business } = await requireBusiness();
  const [taxRates, accounts] = await Promise.all([taxRateOptions(business.id), categoryAccountOptions(business.id)]);
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Add a product or service" description="For stocked products, add opening stock on the next screen." />
      <Card>
        <CardBody>
          <ItemForm mode="create" taxRates={taxRates} accounts={accounts} />
        </CardBody>
      </Card>
    </div>
  );
}
