import { requireBusiness } from "@/lib/business";
import { IMPORTS, IMPORT_KINDS } from "@/lib/csv-import";
import { toDateInput } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { ImportWizard } from "@/components/import-wizard";

export const metadata = { title: "Import from CSV" };

export default async function ImportPage() {
  const { business } = await requireBusiness();
  const today = toDateInput(new Date());
  const options = IMPORT_KINDS.map((kind) => ({
    kind,
    label: IMPORTS[kind].label,
    description: IMPORTS[kind].description,
    columns: IMPORTS[kind].columns.map((c) => ({ label: c.label, required: !!c.required, hint: c.hint })),
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="Import from CSV" description="Bring your customers, suppliers, products and opening balances over from a spreadsheet." />
      {business.role === "STAFF" ? (
        <Card>
          <CardBody className="text-sm text-slate-600">Only an owner or accountant can import data.</CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody>
            <ImportWizard options={options} today={today} defaultStockDate={business.openingDate ? toDateInput(business.openingDate) : today} />
          </CardBody>
        </Card>
      )}
      <p className="text-xs text-slate-500">
        Suggested order: customers and suppliers, products and opening stock, account balances (your old trial balance), then the unpaid invoices and bills. Nothing is saved until you
        have seen the preview and clicked Import.
      </p>
    </div>
  );
}
