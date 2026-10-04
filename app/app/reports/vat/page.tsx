import { requireBusiness } from "@/lib/business";
import { vatSummary } from "@/lib/reports";
import { parseRange, presetRanges } from "@/lib/report-range";
import { businessContext } from "@/lib/form-options";
import { formatDate } from "@/lib/format";
import { RATES_DISCLAIMER } from "@/lib/countries";
import { RangePicker, ReportSheet } from "@/components/report-kit";

export const metadata = { title: "VAT summary" };

export default async function VatPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const { business } = await requireBusiness();
  const { fmt, pack } = businessContext(business);
  const range = parseRange(await searchParams, business.yearEndMonth);
  const vat = await vatSummary(business.id, range.from, range.to);
  const v = pack.vatName;

  return (
    <div className="space-y-5">
      <RangePicker basePath="/app/reports/vat" fromInput={range.fromInput} toInput={range.toInput} presets={presetRanges(business.yearEndMonth)} />
      <ReportSheet
        title={`${v} summary`}
        business={business.name}
        subtitle={`${formatDate(range.from)} – ${formatDate(new Date(range.to.getTime() - 1))}`}
      >
        {!business.vatRegistered ? (
          <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            This business is set as not registered for {v}, so no {v} is charged on invoices or claimed on bills.
          </p>
        ) : null}
        <table className="w-full text-sm">
          <tbody>
            <tr>
              <td className="py-1.5">
                Sales (excluding {v}) · {vat.salesCount} invoices
              </td>
              <td className="py-1.5 text-right">{fmt(vat.salesNet)}</td>
            </tr>
            <tr>
              <td className="py-1.5 font-medium">Output {v} charged on sales</td>
              <td className="py-1.5 text-right font-medium">{fmt(vat.output)}</td>
            </tr>
            <tr>
              <td className="py-1.5">
                Purchases (including {v}) · {vat.purchasesCount} bills
              </td>
              <td className="py-1.5 text-right">{fmt(vat.purchasesTotal)}</td>
            </tr>
            <tr>
              <td className="py-1.5 font-medium">Input {v} claimable on purchases</td>
              <td className="py-1.5 text-right font-medium">-{fmt(vat.input)}</td>
            </tr>
            <tr className="border-t-2 border-slate-800 text-lg font-bold">
              <td className="py-2">{vat.net >= 0 ? `${v} payable` : `${v} refundable / credit`}</td>
              <td className="py-2 text-right">{fmt(Math.abs(vat.net))}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-4 text-xs text-slate-500">
          Input {v} is only claimable on valid tax invoices{pack.taxInvoiceSystem ? ` issued through ${pack.taxInvoiceSystem}` : ""}. {RATES_DISCLAIMER}
        </p>
      </ReportSheet>
    </div>
  );
}
