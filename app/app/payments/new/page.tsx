import { requireBusiness } from "@/lib/business";
import { toDateInput } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { PaymentForm } from "@/components/forms";

export const metadata = { title: "Add payment" };

export default async function NewPaymentPage() {
  await requireBusiness();
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Add a payment" description="For cash payments or anything not on an imported statement." />
      <Card>
        <CardBody>
          <PaymentForm today={toDateInput(new Date())} />
        </CardBody>
      </Card>
    </div>
  );
}
