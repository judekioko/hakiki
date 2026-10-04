import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { businessContext } from "@/lib/form-options";
import { employeeIdLabels } from "@/lib/payroll-labels";
import type { PayslipLine } from "@/lib/payroll";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Payslip" };

export default async function PayslipPage({ params }: { params: Promise<{ id: string; slipId: string }> }) {
  const { business } = await requireBusiness();
  const { id, slipId } = await params;
  const slip = await prisma.payslip.findFirst({
    where: { id: slipId, payRunId: id, payRun: { businessId: business.id } },
    include: { employee: true, payRun: true },
  });
  if (!slip) notFound();
  const { fmt } = businessContext(business);
  const labels = employeeIdLabels(business.country);
  const lines = (slip.breakdown as unknown as PayslipLine[]) ?? [];
  // The last TAX line is the tax actually deducted (earlier ones show the calculation before relief).
  const finalTax = lines.filter((l) => l.party === "TAX").at(-1);
  const employeeLines = [...lines.filter((l) => l.party === "EMPLOYEE"), ...(finalTax ? [finalTax] : [])];
  const employerLines = lines.filter((l) => l.party === "EMPLOYER");

  return (
    <div className="space-y-4">
      <div className="flex justify-end print:hidden">
        <PrintButton />
      </div>
      <article className="mx-auto max-w-2xl rounded-lg border border-slate-200 bg-white p-8 print:border-0 print:p-0">
        <header className="flex justify-between border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-lg font-bold">{business.name}</h1>
            <p className="text-sm text-slate-500">Payslip for {slip.payRun.period}</p>
          </div>
          <p className="text-sm text-slate-500">Paid {formatDate(slip.payRun.payDate)}</p>
        </header>
        <section className="grid gap-1 border-b border-slate-200 py-4 text-sm sm:grid-cols-2">
          <p>
            <span className="text-slate-500">Employee:</span> {slip.employee.name}
          </p>
          {slip.employee.jobTitle ? (
            <p>
              <span className="text-slate-500">Job title:</span> {slip.employee.jobTitle}
            </p>
          ) : null}
          {slip.employee.taxId ? (
            <p>
              <span className="text-slate-500">{labels.taxId}:</span> {slip.employee.taxId}
            </p>
          ) : null}
          {slip.employee.pensionNumber ? (
            <p>
              <span className="text-slate-500">{labels.pension}:</span> {slip.employee.pensionNumber}
            </p>
          ) : null}
        </section>
        <table className="mt-4 w-full text-sm">
          <tbody>
            <tr>
              <td className="py-1">Basic salary</td>
              <td className="py-1 text-right">{fmt(num(slip.basicSalary))}</td>
            </tr>
            <tr>
              <td className="py-1">Allowances</td>
              <td className="py-1 text-right">{fmt(num(slip.allowances))}</td>
            </tr>
            <tr className="border-t border-slate-200 font-semibold">
              <td className="py-1">Gross pay</td>
              <td className="py-1 text-right">{fmt(num(slip.gross))}</td>
            </tr>
            <tr>
              <td colSpan={2} className="pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Deductions
              </td>
            </tr>
            {employeeLines.map((l) => (
              <tr key={l.label}>
                <td className="py-1">{l.label}</td>
                <td className="py-1 text-right">-{fmt(l.amount)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-800 text-base font-bold">
              <td className="py-2">Net pay</td>
              <td className="py-2 text-right">{fmt(num(slip.net))}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-4 text-xs text-slate-500">
          Taxable pay {fmt(num(slip.taxableIncome))}.{" "}
          {lines
            .filter((l) => l.party === "RELIEF")
            .map((l) => `${l.label} ${fmt(l.amount)}.`)
            .join(" ")}
        </p>
        {employerLines.length > 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            Employer also pays: {employerLines.map((l) => `${l.label} ${fmt(l.amount)}`).join(", ")}.
          </p>
        ) : null}
      </article>
    </div>
  );
}
