import { requireBusiness } from "@/lib/business";
import { cashFlow } from "@/lib/cash-flow";
import { parseRange, presetRanges } from "@/lib/report-range";
import { businessContext } from "@/lib/form-options";
import { formatDate } from "@/lib/format";
import { RangePicker, ReportSection, ReportSheet } from "@/components/report-kit";

export const metadata = { title: "Cash flow" };

export default async function CashFlowPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const { business } = await requireBusiness();
  const { fmt } = businessContext(business);
  const range = parseRange(await searchParams, business.yearEndMonth);
  const report = await cashFlow(business.id, range.from, range.to);

  return (
    <div className="space-y-5">
      <RangePicker basePath="/app/reports/cash-flow" fromInput={range.fromInput} toInput={range.toInput} presets={presetRanges(business.yearEndMonth)} />
      <ReportSheet
        title="Cash flow statement"
        business={business.name}
        subtitle={`${formatDate(range.from)} – ${formatDate(new Date(range.to.getTime() - 1))}`}
      >
        <p className="mb-4 text-xs text-slate-500">
          Money that actually moved through your bank, mobile money and cash accounts. Positive figures are money in, negative are money
          out.
        </p>
        <ReportSection
          title="Cash from operating activities"
          rows={report.operating}
          total={report.totals.operating}
          totalLabel="Net cash from operating activities"
          fmt={fmt}
        />
        <ReportSection
          title="Cash from investing activities"
          rows={report.investing}
          total={report.totals.investing}
          totalLabel="Net cash from investing activities"
          fmt={fmt}
        />
        <ReportSection
          title="Cash from financing activities"
          rows={report.financing}
          total={report.totals.financing}
          totalLabel="Net cash from financing activities"
          fmt={fmt}
        />
        {report.openingEntries.length > 0 ? (
          <ReportSection
            title="Opening balances brought in"
            rows={report.openingEntries}
            total={report.totals.openingEntries}
            totalLabel="Cash brought in as opening balances"
            fmt={fmt}
          />
        ) : null}

        <dl className="space-y-1 border-t-2 border-slate-800 pt-3 text-sm">
          <div className="flex justify-between">
            <dt>Cash at the start of the period</dt>
            <dd>{fmt(report.opening)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Net increase (decrease) in cash</dt>
            <dd className={report.netChange < 0 ? "text-rose-700" : ""}>{fmt(report.netChange)}</dd>
          </div>
          <div className="flex justify-between text-base font-bold">
            <dt>Cash at the end of the period</dt>
            <dd>{fmt(report.closing)}</dd>
          </div>
        </dl>
        {Math.abs(report.unexplained) >= 0.01 ? (
          <p className="mt-3 rounded-md bg-amber-50 p-3 text-xs text-amber-800">
            {fmt(report.unexplained)} of the change in cash is not shown in the sections above. Please tell your accountant.
          </p>
        ) : null}
      </ReportSheet>
    </div>
  );
}
