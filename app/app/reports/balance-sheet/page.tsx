import { requireBusiness } from "@/lib/business";
import { balanceSheet } from "@/lib/reports";
import { parseRange, presetRanges, todayInput } from "@/lib/report-range";
import { businessContext } from "@/lib/form-options";
import { formatDate } from "@/lib/format";
import { round2 } from "@/lib/money";
import { RangePicker, ReportSection, ReportSheet } from "@/components/report-kit";

export const metadata = { title: "Balance sheet" };

export default async function BalanceSheetPage({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const { business } = await requireBusiness();
  const { fmt } = businessContext(business);
  const params = await searchParams;
  const range = parseRange({ to: params.to ?? todayInput() }, business.yearEndMonth);
  const bs = await balanceSheet(business.id, range.to);
  const difference = round2(bs.totalAssets - bs.totalLiabilities - bs.totalEquity);

  return (
    <div className="space-y-5">
      <RangePicker
        basePath="/app/reports/balance-sheet"
        fromInput={range.fromInput}
        toInput={range.toInput}
        presets={presetRanges(business.yearEndMonth).map((p) => ({ ...p, label: `End of ${p.label.startsWith("FY") ? p.label : p.label.toLowerCase()}` }))}
        single
      />
      <ReportSheet title="Balance sheet" business={business.name} subtitle={`As at ${formatDate(new Date(range.to.getTime() - 1))}`}>
        <ReportSection title="Assets" rows={bs.assets} total={bs.totalAssets} totalLabel="Total assets" fmt={fmt} />
        <ReportSection title="Liabilities" rows={bs.liabilities} total={bs.totalLiabilities} totalLabel="Total liabilities" fmt={fmt} />
        <ReportSection
          title="Equity"
          rows={[...bs.equity, { id: "profit", code: "", name: "Profit to date (not yet closed)", balance: bs.profitToDate }]}
          total={bs.totalEquity}
          totalLabel="Total equity"
          fmt={fmt}
        />
        <p className="flex justify-between border-y-2 border-slate-800 py-2 font-bold">
          <span>Liabilities + equity</span>
          <span>{fmt(round2(bs.totalLiabilities + bs.totalEquity))}</span>
        </p>
        {Math.abs(difference) > 0.01 ? (
          <p className="mt-3 text-sm text-rose-700">Out of balance by {fmt(difference)}. Please report this.</p>
        ) : (
          <p className="mt-3 text-xs text-teal-700">Assets equal liabilities plus equity.</p>
        )}
      </ReportSheet>
    </div>
  );
}
