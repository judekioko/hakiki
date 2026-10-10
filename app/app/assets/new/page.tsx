import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { toDateInput } from "@/lib/format";
import { todayInNairobi } from "@/lib/recurrence";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/bits";
import { AssetForm } from "@/components/fixed-asset-forms";

export const metadata = { title: "Add a fixed asset" };

export default async function NewAssetPage() {
  const { business } = await requireBusiness();
  if (business.role === "STAFF") {
    return (
      <EmptyState title="Only an owner or accountant can add assets">
        <p>Ask the owner of the business to add this asset.</p>
      </EmptyState>
    );
  }
  const accounts = await prisma.account.findMany({
    where: { businessId: business.id, type: "ASSET", moneyKind: null, systemKey: null, isArchived: false },
    orderBy: { code: "asc" },
    select: { id: true, name: true },
  });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Add a fixed asset"
        description="Record the purchase first as a bill, or a payment to the asset account. This adds the asset to the register so it is depreciated every month."
      />
      <Card>
        <CardBody>
          <AssetForm accounts={accounts} currency={business.currency} today={toDateInput(todayInNairobi())} />
        </CardBody>
      </Card>
    </div>
  );
}
