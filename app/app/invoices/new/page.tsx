import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { toDateInput } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { InvoiceForm } from "@/components/forms";

export const metadata = { title: "Add invoice" };

export default async function NewInvoicePage() {
  const { business } = await requireBusiness();
  const suppliers = await prisma.supplier.findMany({
    where: { businessId: business.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Add an eTIMS invoice" description="Hakiki will match it to the payment it belongs to." />
      <Card>
        <CardBody>
          <InvoiceForm suppliers={suppliers} today={toDateInput(new Date())} />
        </CardBody>
      </Card>
    </div>
  );
}
