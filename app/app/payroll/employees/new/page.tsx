import { requireBusiness } from "@/lib/business";
import { employeeIdLabels } from "@/lib/payroll-labels";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { EmployeeForm } from "@/components/module-forms";

export const metadata = { title: "Add employee" };

export default async function NewEmployeePage() {
  const { business } = await requireBusiness();
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Add an employee" />
      <Card>
        <CardBody>
          <EmployeeForm mode="create" labels={employeeIdLabels(business.country)} />
        </CardBody>
      </Card>
    </div>
  );
}
