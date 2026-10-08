"use client";

import { startTransition, useActionState, useState } from "react";
import { runCsvImport, type ImportState } from "@/lib/actions/csv-import";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export type ImportOption = {
  kind: string;
  label: string;
  description: string;
  columns: { label: string; required: boolean; hint: string }[];
};

const empty: ImportState = {};

export function ImportWizard({ options, today, defaultStockDate }: { options: ImportOption[]; today: string; defaultStockDate: string }) {
  const [state, dispatch, pending] = useActionState(runCsvImport, empty);
  const [kind, setKind] = useState(options[0].kind);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [stockDate, setStockDate] = useState(defaultStockDate);
  const [asAt, setAsAt] = useState(defaultStockDate);
  const option = options.find((o) => o.kind === kind)!;

  const submit = (intent: "preview" | "import", text = csv) => {
    const data = new FormData();
    data.set("kind", kind);
    data.set("csv", text);
    data.set("stockDate", stockDate);
    data.set("asAt", asAt);
    data.set("intent", intent);
    startTransition(() => dispatch(data));
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    submit("preview", text);
  };

  const reset = () => {
    setCsv("");
    setFileName("");
    startTransition(() => dispatch(new FormData()));
  };

  if (state.done) {
    const d = state.done;
    return (
      <div className="space-y-4">
        <Alert variant="success">
          Imported {d.created} row{d.created === 1 ? "" : "s"} into {options.find((o) => o.kind === d.kind)?.label.toLowerCase()}.{d.skipped > 0 ? ` ${d.skipped} row${d.skipped === 1 ? " was" : "s were"} skipped.` : ""}
        </Alert>
        {d.failed.length > 0 ? (
          <Alert variant="error">
            {d.failed.length} row{d.failed.length === 1 ? "" : "s"} could not be saved:
            <ul className="mt-1 list-disc pl-5">
              {d.failed.slice(0, 10).map((f) => (
                <li key={f.line}>
                  Row {f.line}: {f.message}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <Button type="button" variant="secondary" onClick={reset}>
          Import another file
        </Button>
      </div>
    );
  }

  const preview = state.preview;
  return (
    <div className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-slate-700">1. What are you importing?</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {options.map((o) => (
            <label
              key={o.kind}
              className={`cursor-pointer rounded-lg border p-3 text-sm ${o.kind === kind ? "border-teal-600 bg-teal-50" : "border-slate-200 bg-white hover:border-slate-300"}`}
            >
              <input
                type="radio"
                name="kind"
                value={o.kind}
                checked={o.kind === kind}
                onChange={() => {
                  setKind(o.kind);
                  setCsv("");
                  setFileName("");
                  startTransition(() => dispatch(new FormData()));
                }}
                className="sr-only"
              />
              <span className="block font-medium text-slate-900">{o.label}</span>
            </label>
          ))}
        </div>
        <p className="text-sm text-slate-600">{option.description}</p>
      </fieldset>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-700">2. Get the spreadsheet ready</h3>
        <p className="text-sm text-slate-600">
          Save your sheet as CSV (in Excel or Google Sheets: File → Save as / Download → CSV). The first row must be the column headings.{" "}
          <a href={`/app/import/template/${kind}`} className="text-teal-700 underline">
            Download the template
          </a>{" "}
          to see the layout.
        </p>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-3 py-1.5">Column</th>
                <th className="px-3 py-1.5">What goes in it</th>
              </tr>
            </thead>
            <tbody>
              {option.columns.map((c) => (
                <tr key={c.label} className="border-b border-slate-100">
                  <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-800">
                    {c.label}
                    {c.required ? <span className="text-rose-600"> *</span> : null}
                  </td>
                  <td className="px-3 py-1.5 text-slate-600">{c.hint || "Optional"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {kind === "account-balances" ? (
        <section className="space-y-1">
          <label htmlFor="asAt" className="text-sm font-semibold text-slate-700">
            Balances are as at (the last day of your old books)
          </label>
          <Input id="asAt" type="date" value={asAt} max={today} onChange={(e) => setAsAt(e.target.value)} className="max-w-xs" />
          <p className="text-xs text-slate-500">Change the date here before you choose the file. It also sets the opening balance date for unpaid invoices and bills.</p>
        </section>
      ) : null}

      {kind === "items" ? (
        <section className="space-y-1">
          <label htmlFor="stockDate" className="text-sm font-semibold text-slate-700">
            Opening stock is as at
          </label>
          <Input id="stockDate" type="date" value={stockDate} max={today} onChange={(e) => setStockDate(e.target.value)} className="max-w-xs" />
          <p className="text-xs text-slate-500">Used for items that have a Quantity. It is the date of your stock count.</p>
        </section>
      ) : null}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-700">3. Choose the file</h3>
        <Input type="file" accept=".csv,text/csv" onChange={(e) => readFile(e.target.files?.[0])} disabled={pending} />
        {fileName ? <p className="text-xs text-slate-500">{fileName}</p> : null}
        {pending ? <p className="text-sm text-slate-500">Working...</p> : null}
      </section>

      {state.error ? <Alert variant="error">{state.error}</Alert> : null}

      {preview ? (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">4. Check it, then import</h3>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="teal">{preview.summary.new} ready to import</Badge>
            {preview.summary.duplicate > 0 ? <Badge tone="slate">{preview.summary.duplicate} already there (skipped)</Badge> : null}
            {preview.summary.error > 0 ? <Badge tone="rose">{preview.summary.error} with problems (skipped)</Badge> : null}
          </div>
          {preview.notes.length > 0 ? (
            <ul className="space-y-1 rounded-md bg-slate-50 p-3 text-xs text-slate-600">
              {preview.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
          <div className="max-h-96 overflow-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">What</th>
                  <th className="px-3 py-2">Result</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.line} className="border-b border-slate-100 align-top">
                    <td className="px-3 py-1.5 text-slate-400">{r.line}</td>
                    <td className="px-3 py-1.5">
                      <span className="font-medium text-slate-900">{r.label}</span>
                      {r.detail ? <span className="block text-xs text-slate-500">{r.detail}</span> : null}
                    </td>
                    <td className="px-3 py-1.5">
                      {r.status === "new" ? (
                        <span className="text-teal-700">{kind === "account-balances" ? "Will be set" : "Will be added"}</span>
                      ) : r.status === "duplicate" ? (
                        <span className="text-slate-500">{r.message}</span>
                      ) : (
                        <span className="text-rose-700">{r.message}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.total > preview.rows.length ? (
            <p className="text-xs text-slate-500">Showing the first {preview.rows.length} of {preview.total} rows. Every row is checked.</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={pending || preview.summary.new === 0} onClick={() => submit("import")}>
              {pending ? "Importing..." : `Import ${preview.summary.new} row${preview.summary.new === 1 ? "" : "s"}`}
            </Button>
            <Button type="button" variant="secondary" onClick={reset} disabled={pending}>
              Choose a different file
            </Button>
          </div>
          {preview.summary.error > 0 ? (
            <p className="text-xs text-slate-500">Rows with problems are left out. Fix them in your spreadsheet and import the file again: rows already imported are skipped, so nothing is duplicated.</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
