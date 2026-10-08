import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num, round2 } from "@/lib/money";
import { formatDate, toDateInput } from "@/lib/format";
import { businessContext, moneyAccountOptions } from "@/lib/form-options";
import { approvePayRun, deletePayRun, recalculatePayRun, reopenPayRun } from "@/lib/actions/payroll";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/stat-card";
import { SubmitButton } from "@/components/forms";
import { PayrollPaymentForm } from "@/components/module-forms";

export const metadata = { title: "Pay run" };

export default async function PayRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { business } = await requireBusiness();
  const { id } = await params;
  const run = await prisma.payRun.findFirst({
    where: { id, businessId: business.id },
    include: { payslips: { include: { employee: true }, orderBy: { employee: { name: "asc" } } } },
  });
  if (!run) notFound();
  const { fmt, pack } = businessContext(business);
  const moneyAccounts = await moneyAccountOptions(business.id, { baseOnly: true });

  const sum = (f: "gross" | "incomeTax" | "employeeDeductions" | "employerContributions" | "net") =>
    round2(run.payslips.reduce((s, p) => s + num(p[f]), 0));
  const approved = run.status === "APPROVED";
  const taxName = pack.builtInPayroll ? "PAYE" : "Income tax";

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Payroll ${run.period}`}
        description={`Pay date ${formatDate(run.payDate)} · ${run.payslips.length} employee${run.payslips.length === 1 ? "" : "s"}`}
        action={<Badge tone={approved ? "teal" : "amber"}>{approved ? "Approved" : "Draft"}</Badge>}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Gross pay" value={fmt(sum("gross"))} />
        <StatCard label={taxName} value={fmt(sum("incomeTax"))} />
        <StatCard label="Employee deductions" value={fmt(sum("employeeDeductions"))} />
        <StatCard label="Employer contributions" value={fmt(sum("employerContributions"))} />
        <StatCard label="Net pay" value={fmt(sum("net"))} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Table>
            <Thead>
              <Tr>
                <Th>Employee</Th>
                <Th className="text-right">Gross</Th>
                <Th className="text-right">{taxName}</Th>
                <Th className="text-right">Deductions</Th>
                <Th className="text-right">Net</Th>
              </Tr>
            </Thead>
            <Tbody>
              {run.payslips.map((p) => (
                <Tr key={p.id}>
                  <Td>
                    <Link href={`/app/payroll/${run.id}/payslips/${p.id}`} className="font-medium text-slate-900 hover:underline">
                      {p.employee.name}
                    </Link>
                  </Td>
                  <Td className="text-right">{fmt(num(p.gross))}</Td>
                  <Td className="text-right">{fmt(num(p.incomeTax))}</Td>
                  <Td className="text-right">{fmt(num(p.employeeDeductions))}</Td>
                  <Td className="text-right font-medium">{fmt(num(p.net))}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>

        <div className="space-y-6">
          {approved ? (
            <Card>
              <CardHeader>
                <CardTitle>Record payments</CardTitle>
              </CardHeader>
              <CardBody>
                <PayrollPaymentForm
                  payRunId={run.id}
                  moneyAccounts={moneyAccounts}
                  today={toDateInput(new Date())}
                  options={[
                    { value: "NET", label: `Net salaries to staff (${fmt(sum("net"))})` },
                    { value: "TAX", label: `${taxName} to tax authority (${fmt(sum("incomeTax"))})` },
                    {
                      value: "STATUTORY",
                      label: `${pack.builtInPayroll ? "NSSF, SHIF & Housing Levy" : "Statutory deductions"} (${fmt(round2(sum("employeeDeductions") + sum("employerContributions")))})`,
                    },
                  ]}
                />
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardBody className="space-y-3 text-sm">
              {approved ? (
                <>
                  <p className="text-slate-600">This pay run is posted to your books.</p>
                  <form action={reopenPayRun}>
                    <input type="hidden" name="payRunId" value={run.id} />
                    <SubmitButton variant="secondary" size="sm">
                      Reopen to edit
                    </SubmitButton>
                  </form>
                </>
              ) : (
                <>
                  <p className="text-slate-600">
                    Check the figures, then approve to post salaries and deductions to your books.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <form action={approvePayRun}>
                      <input type="hidden" name="payRunId" value={run.id} />
                      <SubmitButton size="sm">Approve</SubmitButton>
                    </form>
                    <form action={recalculatePayRun}>
                      <input type="hidden" name="payRunId" value={run.id} />
                      <SubmitButton variant="secondary" size="sm" pendingText="Recalculating...">
                        Recalculate
                      </SubmitButton>
                    </form>
                    <form action={deletePayRun}>
                      <input type="hidden" name="payRunId" value={run.id} />
                      <SubmitButton variant="ghost" size="sm">
                        Delete
                      </SubmitButton>
                    </form>
                  </div>
                  <p className="text-xs text-slate-500">Recalculate after changing salaries or payroll settings.</p>
                </>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
