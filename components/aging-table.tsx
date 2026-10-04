import Link from "next/link";
import { AGING_BUCKETS } from "@/lib/reports";

export function AgingTable({
  rows,
  fmt,
  linkPrefix,
}: {
  rows: { id: string; name: string; buckets: number[]; total: number }[];
  fmt: (n: number) => string;
  linkPrefix?: string;
}) {
  const totals = AGING_BUCKETS.map((_, i) => rows.reduce((s, r) => s + r.buckets[i], 0));
  const grand = rows.reduce((s, r) => s + r.total, 0);
  if (rows.length === 0) return <p className="text-sm text-slate-500">Nothing outstanding.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-300 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2">Name</th>
            {AGING_BUCKETS.map((b) => (
              <th key={b} className="whitespace-nowrap py-2 text-right">
                {b}
              </th>
            ))}
            <th className="py-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-slate-100">
              <td className="py-1.5">
                {linkPrefix && !r.id.startsWith("name:") ? (
                  <Link href={`${linkPrefix}/${r.id}`} className="hover:underline">
                    {r.name}
                  </Link>
                ) : (
                  r.name
                )}
              </td>
              {r.buckets.map((b, i) => (
                <td key={i} className={`whitespace-nowrap py-1.5 text-right ${i >= 2 && b > 0 ? "text-rose-700" : ""}`}>
                  {b ? fmt(b) : ""}
                </td>
              ))}
              <td className="whitespace-nowrap py-1.5 text-right font-medium">{fmt(r.total)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-slate-800 font-bold">
            <td className="py-2">Total</td>
            {totals.map((t, i) => (
              <td key={i} className="whitespace-nowrap py-2 text-right">
                {t ? fmt(t) : ""}
              </td>
            ))}
            <td className="whitespace-nowrap py-2 text-right">{fmt(grand)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
