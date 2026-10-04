import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num } from "@/lib/money";
import { countryOptions } from "@/lib/form-options";
import { RATES_DISCLAIMER } from "@/lib/countries";
import { setDefaultTaxRate, setTaxRateArchived } from "@/lib/actions/accounting";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BusinessForm, SubmitButton } from "@/components/forms";
import { TaxRateForm } from "@/components/module-forms";
import { MONEY_KIND_LABEL } from "@/lib/money-accounts";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { business } = await requireBusiness();
  const [taxRates, moneyAccounts] = await Promise.all([
    prisma.taxRate.findMany({ where: { businessId: business.id }, orderBy: [{ isArchived: "asc" }, { rate: "desc" }] }),
    prisma.account.findMany({ where: { businessId: business.id, moneyKind: { not: null } }, orderBy: { code: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description={business.name} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Business details</CardTitle>
          </CardHeader>
          <CardBody>
            <BusinessForm
              mode="edit"
              countries={countryOptions()}
              defaults={{
                name: business.name,
                country: business.country,
                kraPin: business.kraPin,
                incomeTaxRate: num(business.incomeTaxRate),
                yearEndMonth: business.yearEndMonth,
                vatRegistered: business.vatRegistered,
                address: business.address,
                phone: business.phone,
                email: business.email,
                invoiceFooter: business.invoiceFooter,
              }}
            />
          </CardBody>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Tax rates</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <ul className="divide-y divide-slate-100 text-sm">
                {taxRates.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                    <span className={r.isArchived ? "text-slate-400 line-through" : ""}>
                      {r.name} · {num(r.rate)}%
                    </span>
                    <span className="flex items-center gap-2">
                      {r.isDefault ? (
                        <Badge tone="teal">Default</Badge>
                      ) : (
                        <>
                          {!r.isArchived ? (
                            <form action={setDefaultTaxRate}>
                              <input type="hidden" name="taxRateId" value={r.id} />
                              <SubmitButton variant="ghost" size="sm">
                                Make default
                              </SubmitButton>
                            </form>
                          ) : null}
                          <form action={setTaxRateArchived}>
                            <input type="hidden" name="taxRateId" value={r.id} />
                            <input type="hidden" name="archived" value={r.isArchived ? "false" : "true"} />
                            <SubmitButton variant="ghost" size="sm">
                              {r.isArchived ? "Restore" : "Hide"}
                            </SubmitButton>
                          </form>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <TaxRateForm />
              <p className="text-xs text-slate-500">{RATES_DISCLAIMER}</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Bank, mobile money & cash accounts</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              <ul className="divide-y divide-slate-100">
                {moneyAccounts.map((a) => (
                  <li key={a.id} className="flex justify-between py-2">
                    <Link href={`/app/accounts/${a.id}`} className="font-medium text-slate-900 hover:underline">
                      {a.code} · {a.name}
                    </Link>
                    <span className="text-slate-500">{MONEY_KIND_LABEL[a.moneyKind!]}</span>
                  </li>
                ))}
              </ul>
              <p className="text-slate-500">
                Add another bank account or wallet from the{" "}
                <Link href="/app/accounts" className="text-teal-700 underline">
                  chart of accounts
                </Link>
                .
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
