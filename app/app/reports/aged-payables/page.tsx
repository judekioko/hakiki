import { requireBusiness } from "@/lib/business";
import { agedPayables } from "@/lib/reports";
import { businessContext } from "@/lib/form-options";
import { formatDate } from "@/lib/format";
import { ReportSheet } from "@/components/report-kit";
import { AgingTable } from "@/components/aging-table";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Aged payables" };

export default async function AgedPayablesPage() {
  const { business } = await requireBusiness();
  const { fmt } = businessContext(business);
  const rows = await agedPayables(business.id);
  return (
    <div className="space-y-5">
      <div className="flex justify-end print:hidden">
        <PrintButton />
      </div>
      <ReportSheet
        title="Aged payables"
        business={business.name}
        subtitle={`Supplier bills not yet matched to a payment, by days past due, as at ${formatDate(new Date())}`}
      >
        <AgingTable rows={rows} fmt={fmt} linkPrefix="/app/suppliers" />
        <p className="mt-4 text-xs text-slate-500">
          A bill counts as paid once it is matched to a payment on the Money paid out page.
        </p>
      </ReportSheet>
    </div>
  );
}
