import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num } from "@/lib/money";
import { businessContext } from "@/lib/form-options";
import { PageHeader } from "@/components/page-header";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState, LinkButton } from "@/components/bits";

export const metadata = { title: "Employees" };

export default async function EmployeesPage() {
  const { business } = await requireBusiness();
  const { fmt } = businessContext(business);
  const employees = await prisma.employee.findMany({
    where: { businessId: business.id },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Employees" action={<LinkButton href="/app/payroll/employees/new">Add employee</LinkButton>} />
      {employees.length === 0 ? (
        <EmptyState title="No employees yet" />
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>Name</Th>
              <Th>Job title</Th>
              <Th className="text-right">Basic salary</Th>
              <Th className="text-right">Allowances</Th>
              <Th>Status</Th>
            </Tr>
          </Thead>
          <Tbody>
            {employees.map((e) => (
              <Tr key={e.id}>
                <Td>
                  <Link href={`/app/payroll/employees/${e.id}`} className="font-medium text-slate-900 hover:underline">
                    {e.name}
                  </Link>
                </Td>
                <Td>{e.jobTitle ?? "—"}</Td>
                <Td className="text-right">{fmt(num(e.basicSalary))}</Td>
                <Td className="text-right">{fmt(num(e.allowances))}</Td>
                <Td>{e.isActive ? <Badge tone="teal">Active</Badge> : <Badge>Inactive</Badge>}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </div>
  );
}
