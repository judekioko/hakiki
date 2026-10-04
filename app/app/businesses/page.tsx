import { requireSession } from "@/lib/session";
import { getActiveBusiness, listMyBusinesses } from "@/lib/business";
import { switchBusiness } from "@/lib/actions/businesses";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BusinessForm, SubmitButton } from "@/components/forms";

export const metadata = { title: "Businesses" };

export default async function BusinessesPage() {
  const session = await requireSession();
  const [businesses, active] = await Promise.all([listMyBusinesses(session.userId), getActiveBusiness(session)]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Businesses"
        description="Accountants and tax agents: add each client here and switch between them."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Your businesses</CardTitle>
          </CardHeader>
          <CardBody>
            {businesses.length === 0 ? (
              <p className="text-sm text-slate-500">Add your first business to get started.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {businesses.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div>
                      <p className="font-medium text-slate-900">{b.name}</p>
                      <p className="text-xs text-slate-500">
                        {b.kraPin ?? "No KRA PIN"} · {b.role === "ACCOUNTANT" ? "Client" : "Owner"}
                      </p>
                    </div>
                    {b.id === active?.id ? (
                      <Badge tone="teal">Current</Badge>
                    ) : (
                      <form action={switchBusiness}>
                        <input type="hidden" name="businessId" value={b.id} />
                        <SubmitButton variant="secondary" size="sm">
                          Open
                        </SubmitButton>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Add a business</CardTitle>
          </CardHeader>
          <CardBody>
            <BusinessForm mode="create" />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
