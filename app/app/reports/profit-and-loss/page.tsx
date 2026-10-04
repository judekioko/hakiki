import { requireBusiness } from "@/lib/business";
import { profitAndLoss } from "@/lib/reports";
import { parseRange, presetRanges } from "@/lib/report-range";
import { businessContext } from "@/lib/form-options";
import { formatDate } from "@/lib/format";
import { RangePicker, ReportSection, ReportSheet } from "@/components/report-kit";

export const metadata = { title: "Profit & loss" };

export default async function ProfitAndLossPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const { business } = await requireBusiness();
  const { fmt } = businessContext(business);
  const range = parseRange(await searchParams, business.yearEndMonth);
  const pnl = await profitAndLoss(business.id, range.from, range.to);

  return (
    <div className="space-y-5">
      <RangePicker basePath="/app/reports/profit-and-loss" fromInput={range.fromInput} toInput={range.toInput} presets={presetRanges(business.yearEndMonth)} />
      <ReportSheet
        title="Profit & loss"
        business={business.name}
        subtitle={`${formatDate(range.from)} – ${formatDate(new Date(range.to.getTime() - 1))}`}
      >
        <ReportSection title="Income" rows={pnl.income} total={pnl.totalIncome} totalLabel="Total income" fmt={fmt} />
        <ReportSection title="Cost of sales" rows={pnl.costOfSales} total={pnl.totalCostOfSales} totalLabel="Total cost of sales" fmt={fmt} />
        <p className="mb-5 flex justify-between border-y border-slate-300 py-2 font-semibold">
          <span>Gross profit</span>
          <span>{fmt(pnl.grossProfit)}</span>
        </p>
        <ReportSection title="Expenses" rows={pnl.expenses} total={pnl.totalExpenses} totalLabel="Total expenses" fmt={fmt} />
        <p className={`flex justify-between border-y-2 border-slate-800 py-2 text-lg font-bold ${pnl.netProfit < 0 ? "text-rose-700" : ""}`}>
          <span>{pnl.netProfit < 0 ? "Net loss" : "Net profit"}</span>
          <span>{fmt(pnl.netProfit)}</span>
        </p>
      </ReportSheet>
    </div>
  );
}
