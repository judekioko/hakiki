"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { addOpeningBill, addOpeningInvoice, saveOpeningBalances } from "@/lib/actions/opening-balances";
import { debitNatured } from "@/lib/opening-balances";
import { moneyFormatter } from "@/lib/format";
import { Feedback, Field, SubmitButton, useFormAction } from "./form-kit";

export type OpeningAccountRow = { id: string; code: string; name: string; type: string; kind: string | null; amount: number };

const TYPE_ORDER = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"];
const TYPE_LABEL: Record<string, string> = {
  ASSET: "Assets (what you own: normally a debit balance)",
  LIABILITY: "Liabilities (what you owe: normally a credit balance)",
  EQUITY: "Equity (the owner's stake: normally a credit balance)",
  INCOME: "Income (only for balances brought into a part-finished year)",
  EXPENSE: "Expenses (only for balances brought into a part-finished year)",
};

export function OpeningAccountsForm({
  rows,
  openingDate,
  today,
  currency,
}: {
  rows: OpeningAccountRow[];
  openingDate: string | null;
  today: string;
  currency: string;
}) {
  const fmt = moneyFormatter(currency);
  const { state, onSubmit, pending } = useFormAction(saveOpeningBalances);
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.filter((r) => r.amount !== 0).map((r) => [r.id, String(r.amount)]))
  );

  const { debits, credits } = useMemo(() => {
    let d = 0;
    let c = 0;
    for (const r of rows) {
      const n = Math.round((Number(amounts[r.id]) || 0) * 100);
      if (!n) continue;
      const isDebit = debitNatured(r.type) ? n > 0 : n < 0;
      if (isDebit) d += Math.abs(n);
      else c += Math.abs(n);
    }
    return { debits: d / 100, credits: c / 100 };
  }, [rows, amounts]);
  const plug = Math.round((debits - credits) * 100) / 100;

  const payload = JSON.stringify(
    rows.filter((r) => Number(amounts[r.id])).map((r) => ({ accountId: r.id, amount: Number(amounts[r.id]) }))
  );
  const groups = TYPE_ORDER.map((type) => ({ type, rows: rows.filter((r) => r.type === type) })).filter((g) => g.rows.length > 0);

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Feedback state={state} />
      <input type="hidden" name="balances" value={payload} />
      <Field label="Balances are as at (the last day of your old books)" htmlFor="openingDate">
        <Input id="openingDate" name="openingDate" type="date" defaultValue={openingDate ?? ""} max={today} required className="max-w-xs" />
      </Field>

      {groups.map((g) => (
        <fieldset key={g.type} className="space-y-1">
          <legend className="pb-1 text-sm font-semibold text-slate-700">{TYPE_LABEL[g.type]}</legend>
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {g.rows.map((r) => (
              <div key={r.id} className="grid grid-cols-[1fr_9rem] items-center gap-3 px-3 py-1.5 text-sm">
                <label htmlFor={`ob-${r.id}`}>
                  <span className="text-slate-400">{r.code}</span> {r.name}
                  {r.kind ? <span className="ml-2 text-xs text-slate-400">{r.kind.replace("_", " ").toLowerCase()}</span> : null}
                </label>
                <Input
                  id={`ob-${r.id}`}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amounts[r.id] ?? ""}
                  onChange={(e) => setAmounts((prev) => ({ ...prev, [r.id]: e.target.value.replace(/,/g, "") }))}
                  className="text-right"
                />
              </div>
            ))}
          </div>
        </fieldset>
      ))}

      <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
        <p>
          Total debits {fmt(debits)} · total credits {fmt(credits)}.
          {plug === 0 ? (
            " They agree, so nothing needs balancing."
          ) : (
            <>
              {" "}
              <strong className="text-slate-900">{fmt(Math.abs(plug))}</strong> will be booked to <em>Opening balance equity</em> as the
              balancing {plug > 0 ? "credit" : "debit"}. That is your starting equity once customers, suppliers and stock are in.
            </>
          )}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Enter each balance on its normal side. Use a minus sign for the unusual side, for example an overdrawn bank account.
        </p>
      </div>
      <SubmitButton pending={pending}>Save account balances</SubmitButton>
    </form>
  );
}

type Contact = { id: string; name: string };

// Adds one unpaid customer invoice or supplier bill from before the books started.
export function OpeningItemForm({
  kind,
  contacts,
  openingDate,
}: {
  kind: "customer" | "supplier";
  contacts: Contact[];
  openingDate: string | null;
}) {
  const action = kind === "customer" ? addOpeningInvoice : addOpeningBill;
  const { state, onSubmit, pending } = useFormAction(action);
  const noun = kind === "customer" ? "customer" : "supplier";
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Feedback state={state} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={kind === "customer" ? "Customer" : "Supplier"} htmlFor={`${kind}Id`}>
          <Select id={`${kind}Id`} name={kind === "customer" ? "customerId" : "supplierId"} defaultValue="">
            <option value="">New {noun} (type the name)</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`New ${noun} name`} htmlFor={`${kind}NewName`}>
          <Input id={`${kind}NewName`} name="newName" />
        </Field>
        <Field label={kind === "customer" ? "Original invoice number" : "Supplier's invoice number"} htmlFor={`${kind}Ref`}>
          <Input id={`${kind}Ref`} name="reference" className="uppercase" required />
        </Field>
        <Field label="Invoice date" htmlFor={`${kind}Issue`}>
          <Input id={`${kind}Issue`} name="issueDate" type="date" max={openingDate ?? undefined} required />
        </Field>
        <Field label="Due date" htmlFor={`${kind}Due`}>
          <Input id={`${kind}Due`} name="dueDate" type="date" required />
        </Field>
        <Field label="Amount still unpaid" htmlFor={`${kind}Amount`}>
          <Input id={`${kind}Amount`} name="amount" type="number" step="0.01" min="0.01" required />
        </Field>
      </div>
      <SubmitButton pending={pending} variant="secondary">
        {kind === "customer" ? "Add unpaid invoice" : "Add unpaid bill"}
      </SubmitButton>
    </form>
  );
}
