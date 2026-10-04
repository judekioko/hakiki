import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num } from "@/lib/money";
import { formatNumber } from "@/lib/format";
import { businessContext } from "@/lib/form-options";
import { KENYA_PAYROLL } from "@/lib/payroll";
import { deletePayrollRule } from "@/lib/actions/payroll";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/components/forms";
import { PayrollRuleForm, TaxBandsForm } from "@/components/module-forms";

export const metadata = { title: "Payroll settings" };

export default async function PayrollSettingsPage() {
  const { business } = await requireBusiness();
  const { pack } = businessContext(business);

  if (pack.builtInPayroll) {
    const k = KENYA_PAYROLL;
    const bandRows = k.payeBands.map((b, i) => ({ ...b, lower: i === 0 ? 0 : (k.payeBands[i - 1].upTo ?? 0) }));
    return (
      <div className="max-w-3xl space-y-6">
        <PageHeader title="Payroll settings" description="Kenya: statutory rules built in." />
        <Card>
          <CardHeader>
            <CardTitle>How pay is calculated</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 text-sm text-slate-700">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                NSSF: {k.nssfRate}% from employee and employer on pay up to KES {formatNumber(k.nssfUpperLimit, 0)} (Tier I up to KES{" "}
                {formatNumber(k.nssfLowerLimit, 0)}, Tier II above it).
              </li>
              <li>SHIF: {k.shifRate}% of gross pay, minimum KES {k.shifMinimum}, no upper limit.</li>
              <li>Affordable Housing Levy: {k.housingLevyRate}% from employee and {k.housingLevyRate}% from employer.</li>
              <li>NSSF, SHIF and Housing Levy are deducted before PAYE is worked out.</li>
              <li>PAYE monthly bands, less personal relief of KES {formatNumber(k.personalRelief, 0)}:</li>
            </ul>
            <table className="w-full max-w-sm text-sm">
              <tbody>
                {bandRows.map((b) => (
                  <tr key={b.rate} className="border-b border-slate-100">
                    <td className="py-1">
                      {b.upTo === null
                        ? `Above ${formatNumber(b.lower, 0)}`
                        : `${formatNumber(b.lower === 0 ? 0 : b.lower + 1, 0)} – ${formatNumber(b.upTo, 0)}`}
                    </td>
                    <td className="py-1 text-right">{b.rate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-slate-500">
              Based on the rules in force from February 2025. Check them against KRA, SHA and NSSF guidance whenever the law
              changes.
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }

  const [rules, bands] = await Promise.all([
    prisma.payrollRule.findMany({ where: { businessId: business.id }, orderBy: { position: "asc" } }),
    prisma.incomeTaxBand.findMany({ where: { businessId: business.id } }),
  ]);
  const bandsText = [...bands]
    .sort((a, b) => (a.upTo === null ? 1 : b.upTo === null ? -1 : num(a.upTo) - num(b.upTo)))
    .map((b) => `${b.upTo === null ? "*" : num(b.upTo)}, ${num(b.rate)}`)
    .join("\n");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll settings"
        description={`Enter ${pack.name}'s monthly income tax bands and statutory deductions. Check them with the tax authority.`}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Income tax</CardTitle>
          </CardHeader>
          <CardBody>
            <TaxBandsForm bandsText={bandsText} personalRelief={num(business.payrollPersonalRelief)} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Deductions & employer contributions</CardTitle>
          </CardHeader>
          <CardBody className="space-y-5">
            {rules.length > 0 ? (
              <ul className="divide-y divide-slate-100 text-sm">
                {rules.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                    <div>
                      <p className="font-medium">{r.name}</p>
                      <p className="text-xs text-slate-500">
                        {r.party === "EMPLOYEE" ? "Employee" : "Employer"} ·{" "}
                        {[
                          num(r.rate) ? `${num(r.rate)}%` : null,
                          num(r.fixedAmount) ? `+ ${num(r.fixedAmount)} fixed` : null,
                          r.maxBase !== null ? `on pay up to ${num(r.maxBase)}` : null,
                          r.maxAmount !== null ? `max ${num(r.maxAmount)}` : null,
                          r.preTax ? "before tax" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <form action={deletePayrollRule}>
                      <input type="hidden" name="ruleId" value={r.id} />
                      <SubmitButton variant="ghost" size="sm">
                        Remove
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            ) : null}
            <PayrollRuleForm />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
