import { requireBusiness } from "@/lib/business";
import { agedReceivables } from "@/lib/reports";
import { businessContext } from "@/lib/form-options";
import { formatDate } from "@/lib/format";
import { ReportSheet } from "@/components/report-kit";
import { AgingTable } from "@/components/aging-table";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Aged receivables" };

export default async function AgedReceivablesPage() {
  const { business } = await requireBusiness();
  const { fmt } = businessContext(business);
  const rows = await agedReceivables(business.id);
  return (
    <div className="space-y-5">
      <div className="flex justify-end print:hidden">
        <PrintButton />
      </div>
      <ReportSheet title="Aged receivables" business={business.name} subtitle={`Unpaid sales invoices by days overdue, as at ${formatDate(new Date())}`}>
        <AgingTable rows={rows} fmt={fmt} linkPrefix="/app/sales/customers" />
      </ReportSheet>
    </div>
  );
}
