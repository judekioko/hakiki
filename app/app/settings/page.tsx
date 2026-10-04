import { requireBusiness } from "@/lib/business";
import { num } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { BusinessForm } from "@/components/forms";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { business } = await requireBusiness();
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Business settings" description={business.name} />
      <Card>
        <CardBody>
          <BusinessForm
            mode="edit"
            defaults={{
              name: business.name,
              kraPin: business.kraPin,
              incomeTaxRate: num(business.incomeTaxRate),
              yearEndMonth: business.yearEndMonth,
            }}
          />
        </CardBody>
      </Card>
    </div>
  );
}
