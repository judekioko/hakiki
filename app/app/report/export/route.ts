import { requireBusiness } from "@/lib/business";
import { loadPayments, PAYMENT_STATUS_LABEL } from "@/lib/coverage";
import { financialYear, parseYear } from "@/lib/periods";
import { EXEMPT_LABEL } from "@/lib/exemptions";

function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  // Prefix formula-like values so spreadsheet apps do not execute them.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

// Every payment in the financial year with its tax invoice backing status, for the accountant's working papers.
export async function GET(request: Request) {
  const { business } = await requireBusiness();
  const url = new URL(request.url);
  const year = parseYear(url.searchParams.get("year") ?? undefined, business.yearEndMonth);
  const period = financialYear(year, business.yearEndMonth);
  const rows = await loadPayments(business.id, period);

  const header = ["Date", "Source", "Reference", "Paid to", "Supplier", "Amount", "Backed", "Not backed", "Status", "Exempt reason"];
  const lines = rows
    .slice()
    .sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime())
    .map((r) =>
      [
        r.paidAt.toISOString().slice(0, 10),
        r.source,
        r.reference,
        r.counterparty,
        r.supplierName,
        r.amount.toFixed(2),
        r.allocated.toFixed(2),
        r.unbacked.toFixed(2),
        PAYMENT_STATUS_LABEL[r.status],
        r.exemptReason ? EXEMPT_LABEL[r.exemptReason] : "",
      ]
        .map(csvCell)
        .join(",")
    );

  const fileName = `${business.name.replace(/[^A-Za-z0-9]+/g, "-")}-etims-${year}.csv`;
  return new Response([header.join(","), ...lines].join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
