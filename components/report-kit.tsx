import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PrintButton } from "@/components/print-button";

export function RangePicker({
  basePath,
  fromInput,
  toInput,
  presets,
  single = false,
}: {
  basePath: string;
  fromInput: string;
  toInput: string;
  presets: { label: string; from: string; to: string }[];
  single?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
      <form action={basePath} className="flex flex-wrap items-end gap-2">
        {single ? (
          <label className="text-sm text-slate-600">
            As at
            <Input type="date" name="to" defaultValue={toInput} className="mt-1" />
          </label>
        ) : (
          <>
            <label className="text-sm text-slate-600">
              From
              <Input type="date" name="from" defaultValue={fromInput} className="mt-1" />
            </label>
            <label className="text-sm text-slate-600">
              To
              <Input type="date" name="to" defaultValue={toInput} className="mt-1" />
            </label>
          </>
        )}
        <Button type="submit" variant="secondary">
          Update
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        {presets.map((p) => (
          <Link
            key={p.label}
            href={`${basePath}?${new URLSearchParams(single ? { to: p.to } : { from: p.from, to: p.to })}`}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            {p.label}
          </Link>
        ))}
        <PrintButton />
      </div>
    </div>
  );
}

export function ReportSheet({ title, subtitle, business, children }: { title: string; subtitle: string; business: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 print:border-0 print:p-0">
      <header className="mb-5 border-b border-slate-200 pb-4">
        <p className="text-sm text-slate-500">{business}</p>
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        <p className="text-sm text-slate-500">{subtitle}</p>
      </header>
      {children}
    </div>
  );
}

export function ReportSection({
  title,
  rows,
  total,
  totalLabel,
  fmt,
}: {
  title: string;
  rows: { id: string; code: string; name: string; balance: number }[];
  total: number;
  totalLabel: string;
  fmt: (n: number) => string;
}) {
  return (
    <section className="mb-5">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      <table className="w-full text-sm">
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="py-1 text-slate-400">None</td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id}>
                <td className="py-1">
                  {r.code ? (
                    <Link href={`/app/accounts/${r.id}`} className="hover:underline">
                      <span className="mr-2 font-mono text-xs text-slate-400">{r.code}</span>
                      {r.name}
                    </Link>
                  ) : (
                    <span className="italic text-slate-600">{r.name}</span>
                  )}
                </td>
                <td className="py-1 text-right">{fmt(r.balance)}</td>
              </tr>
            ))
          )}
          <tr className="border-t border-slate-300 font-semibold">
            <td className="py-1">{totalLabel}</td>
            <td className="py-1 text-right">{fmt(total)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
