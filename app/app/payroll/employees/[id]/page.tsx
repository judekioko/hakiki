import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num } from "@/lib/money";
import { toDateInput } from "@/lib/format";
import { businessContext } from "@/lib/form-options";
import { employeeIdLabels } from "@/lib/payroll-labels";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmployeeForm } from "@/components/module-forms";

export const metadata = { title: "Employee" };

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { business } = await requireBusiness();
  const { id } = await params;
  const employee = await prisma.employee.findFirst({
    where: { id, businessId: business.id },
    include: { payslips: { include: { payRun: true }, orderBy: { payRun: { period: "desc" } }, take: 12 } },
  });
  if (!employee) notFound();
  const { fmt } = businessContext(business);

  return (
    <div className="space-y-6">
      <PageHeader title={employee.name} description={employee.jobTitle ?? undefined} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardBody>
            <EmployeeForm
              mode="edit"
              employeeId={employee.id}
              labels={employeeIdLabels(business.country)}
              defaults={{
                name: employee.name,
                jobTitle: employee.jobTitle,
                basicSalary: num(employee.basicSalary),
                allowances: num(employee.allowances),
                employeeNumber: employee.employeeNumber,
                nationalId: employee.nationalId,
                taxId: employee.taxId,
                pensionNumber: employee.pensionNumber,
                healthNumber: employee.healthNumber,
                phone: employee.phone,
                email: employee.email,
                startDate: employee.startDate ? toDateInput(employee.startDate) : null,
                isActive: employee.isActive,
              }}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Payslips</CardTitle>
          </CardHeader>
          <CardBody>
            {employee.payslips.length === 0 ? (
              <p className="text-sm text-slate-500">None yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {employee.payslips.map((p) => (
                  <li key={p.id} className="flex justify-between py-2">
                    <Link href={`/app/payroll/${p.payRunId}/payslips/${p.id}`} className="hover:underline">
                      {p.payRun.period}
                    </Link>
                    <span>{fmt(num(p.net))} net</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
