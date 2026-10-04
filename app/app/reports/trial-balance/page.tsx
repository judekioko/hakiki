import Link from "next/link";
import { requireBusiness } from "@/lib/business";
import { accountBalances } from "@/lib/reports";
import { parseRange, presetRanges, todayInput } from "@/lib/report-range";
import { businessContext } from "@/lib/form-options";
import { formatDate } from "@/lib/format";
import { round2 } from "@/lib/money";
import { RangePicker, ReportSheet } from "@/components/report-kit";

export const metadata = { title: "Trial balance" };

export default async function TrialBalancePage({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const { business } = await requireBusiness();
  const { fmt } = businessContext(business);
  const params = await searchParams;
  const range = parseRange({ to: params.to ?? todayInput() }, business.yearEndMonth);
  const balances = (await accountBalances(business.id, { to: range.to })).filter((b) => b.debit || b.credit);
  const rows = balances.map((b) => {
    const net = round2(b.debit - b.credit);
    return { ...b, dr: net > 0 ? net : 0, cr: net < 0 ? -net : 0 };
  });
  const totalDr = round2(rows.reduce((s, r) => s + r.dr, 0));
  const totalCr = round2(rows.reduce((s, r) => s + r.cr, 0));

  return (
    <div className="space-y-5">
      <RangePicker basePath="/app/reports/trial-balance" fromInput={range.fromInput} toInput={range.toInput} presets={presetRanges(business.yearEndMonth)} single />
      <ReportSheet title="Trial balance" business={business.name} subtitle={`As at ${formatDate(new Date(range.to.getTime() - 1))}`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2">Account</th>
              <th className="py-2 text-right">Debit</th>
              <th className="py-2 text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-100">
                <td className="py-1">
                  <Link href={`/app/accounts/${r.id}`} className="hover:underline">
                    <span className="mr-2 font-mono text-xs text-slate-400">{r.code}</span>
                    {r.name}
                  </Link>
                </td>
                <td className="py-1 text-right">{r.dr ? fmt(r.dr) : ""}</td>
                <td className="py-1 text-right">{r.cr ? fmt(r.cr) : ""}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-800 font-bold">
              <td className="py-2">Totals</td>
              <td className="py-2 text-right">{fmt(totalDr)}</td>
              <td className="py-2 text-right">{fmt(totalCr)}</td>
            </tr>
          </tbody>
        </table>
      </ReportSheet>
    </div>
  );
}
