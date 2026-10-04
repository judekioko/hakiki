import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num, round2 } from "@/lib/money";
import { formatDate, toDateInput } from "@/lib/format";
import { businessContext } from "@/lib/form-options";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState, LinkButton } from "@/components/bits";
import { PayRunForm } from "@/components/module-forms";

export const metadata = { title: "Payroll" };

export default async function PayrollPage() {
  const { business } = await requireBusiness();
  const { fmt, pack } = businessContext(business);
  const [runs, employeeCount, ruleCount] = await Promise.all([
    prisma.payRun.findMany({
      where: { businessId: business.id },
      include: { payslips: { select: { gross: true, net: true } } },
      orderBy: { period: "desc" },
    }),
    prisma.employee.count({ where: { businessId: business.id, isActive: true } }),
    prisma.payrollRule.count({ where: { businessId: business.id } }),
  ]);

  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const lastDay = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0));
  const needsSetup = !pack.builtInPayroll && ruleCount === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll"
        description={
          pack.builtInPayroll
            ? "Kenyan PAYE, SHIF, NSSF and Housing Levy are calculated automatically."
            : `Deductions follow the rules you set for ${pack.name}.`
        }
        action={
          <div className="flex gap-2">
            <LinkButton href="/app/payroll/settings" variant="secondary">
              Payroll settings
            </LinkButton>
            <LinkButton href="/app/payroll/employees">Employees ({employeeCount})</LinkButton>
          </div>
        }
      />

      {needsSetup ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Set up {pack.name}&apos;s income tax bands and statutory deductions in{" "}
          <Link href="/app/payroll/settings" className="font-medium underline">
            payroll settings
          </Link>{" "}
          before running payroll.
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {runs.length === 0 ? (
            <EmptyState title="No pay runs yet">
              <p>Add your employees, then calculate the first month.</p>
            </EmptyState>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Month</Th>
                  <Th>Pay date</Th>
                  <Th className="text-right">Staff</Th>
                  <Th className="text-right">Gross</Th>
                  <Th className="text-right">Net pay</Th>
                  <Th>Status</Th>
                </Tr>
              </Thead>
              <Tbody>
                {runs.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <Link href={`/app/payroll/${r.id}`} className="font-medium text-slate-900 hover:underline">
                        {r.period}
                      </Link>
                    </Td>
                    <Td>{formatDate(r.payDate)}</Td>
                    <Td className="text-right">{r.payslips.length}</Td>
                    <Td className="text-right">{fmt(round2(r.payslips.reduce((s, p) => s + num(p.gross), 0)))}</Td>
                    <Td className="text-right">{fmt(round2(r.payslips.reduce((s, p) => s + num(p.net), 0)))}</Td>
                    <Td>
                      <Badge tone={r.status === "APPROVED" ? "teal" : "amber"}>{r.status === "APPROVED" ? "Approved" : "Draft"}</Badge>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </div>
        <Card>
          <CardHeader>
            <CardTitle>New pay run</CardTitle>
          </CardHeader>
          <CardBody>
            <PayRunForm defaultPeriod={period} defaultPayDate={toDateInput(lastDay)} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
