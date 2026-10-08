"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { saveReconciliation, startReconciliation } from "@/lib/actions/reconcile";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Feedback, Field, SubmitButton, useFormAction } from "./form-kit";
import { moneyFormatter } from "@/lib/format";

export type WorkbenchLine = {
  id: string;
  date: string;
  memo: string;
  href: string | null;
  moneyIn: number;
  moneyOut: number;
  checked: boolean;
};

const cents = (n: number) => Math.round(n * 100);

export function ReconcileWorkbench({
  reconciliationId,
  lines,
  opening,
  statementBalance,
  currency,
}: {
  reconciliationId: string;
  lines: WorkbenchLine[];
  opening: number;
  statementBalance: number;
  currency: string;
}) {
  const fmt = moneyFormatter(currency);
  const { state, onSubmit, pending } = useFormAction(saveReconciliation);
  const [ticked, setTicked] = useState(() => new Set(lines.filter((l) => l.checked).map((l) => l.id)));

  const totals = useMemo(() => {
    let inC = 0;
    let outC = 0;
    for (const l of lines) {
      if (!ticked.has(l.id)) continue;
      inC += cents(l.moneyIn);
      outC += cents(l.moneyOut);
    }
    const clearedC = cents(opening) + inC - outC;
    return { moneyIn: inC / 100, moneyOut: outC / 100, cleared: clearedC / 100, difference: (cents(statementBalance) - clearedC) / 100 };
  }, [lines, ticked, opening, statementBalance]);

  const toggle = (id: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const balanced = totals.difference === 0;

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Feedback state={state} />
      <input type="hidden" name="reconciliationId" value={reconciliationId} />
      {[...ticked].map((id) => (
        <input key={id} type="hidden" name="lineIds" value={id} />
      ))}

      <dl className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-5">
        <Stat label="Opening balance" value={fmt(opening)} />
        <Stat label="Money in ticked" value={fmt(totals.moneyIn)} />
        <Stat label="Money out ticked" value={fmt(totals.moneyOut)} />
        <Stat label="Statement balance" value={fmt(statementBalance)} />
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Difference</dt>
          <dd className={`text-lg font-bold ${balanced ? "text-teal-700" : "text-rose-700"}`}>{fmt(totals.difference)}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" className="text-teal-700 hover:underline" onClick={() => setTicked(new Set(lines.map((l) => l.id)))}>
          Tick all
        </button>
        <span className="text-slate-300">·</span>
        <button type="button" className="text-teal-700 hover:underline" onClick={() => setTicked(new Set())}>
          Clear all
        </button>
        <span className="text-slate-500">
          {ticked.size} of {lines.length} ticked
        </span>
      </div>

      {lines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          Nothing in this account is waiting to be reconciled up to the statement date.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="w-10 px-3 py-2" />
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Money in</th>
                <th className="px-3 py-2 text-right">Money out</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className={`border-b border-slate-100 ${ticked.has(l.id) ? "bg-teal-50/60" : ""}`}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={ticked.has(l.id)}
                      onChange={() => toggle(l.id)}
                      aria-label={`Tick ${l.memo}`}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{l.date}</td>
                  <td className="px-3 py-2">
                    {l.href ? (
                      <Link href={l.href} className="hover:underline">
                        {l.memo}
                      </Link>
                    ) : (
                      l.memo
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{l.moneyIn ? fmt(l.moneyIn) : ""}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{l.moneyOut ? fmt(l.moneyOut) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton pending={pending} name="intent" value="save" variant="secondary">
          Save progress
        </SubmitButton>
        <SubmitButton pending={pending} name="intent" value="finish" disabled={!balanced}>
          Finish reconciliation
        </SubmitButton>
        {!balanced ? <span className="text-xs text-slate-500">Finish unlocks when the difference is zero.</span> : null}
      </div>
    </form>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-lg font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

export function StartReconciliationForm({
  accounts,
  defaultAccountId,
  today,
  openingByAccount,
  currency,
}: {
  accounts: { id: string; name: string }[];
  defaultAccountId?: string;
  today: string;
  openingByAccount: Record<string, number>;
  currency: string;
}) {
  const fmt = moneyFormatter(currency);
  const { state, onSubmit, pending } = useFormAction(startReconciliation);
  const [accountId, setAccountId] = useState(defaultAccountId ?? accounts[0]?.id ?? "");
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Feedback state={state} />
      <Field label="Account" htmlFor="accountId">
        <Select id="accountId" name="accountId" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Statement closing date" htmlFor="statementDate">
          <Input id="statementDate" name="statementDate" type="date" defaultValue={today} max={today} required />
        </Field>
        <Field label="Closing balance on the statement" htmlFor="statementBalance">
          <Input id="statementBalance" name="statementBalance" inputMode="decimal" placeholder="0.00" required />
        </Field>
      </div>
      <p className="text-xs text-slate-500">Opening balance (from the last reconciliation): {fmt(openingByAccount[accountId] ?? 0)}</p>
      <SubmitButton pending={pending}>Start reconciling</SubmitButton>
    </form>
  );
}
