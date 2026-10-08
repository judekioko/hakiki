"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { saveTransfer } from "@/lib/actions/foreign-accounts";
import { formatMoney } from "@/lib/format";
import { Feedback, Field, SubmitButton, useFormAction } from "./form-kit";

type Account = { id: string; name: string; currency: string | null };

export function TransferForm({ accounts, baseCurrency, rates, today }: { accounts: Account[]; baseCurrency: string; rates: Record<string, number>; today: string }) {
  const { state, onSubmit, pending } = useFormAction(saveTransfer);
  const [fromId, setFromId] = useState(accounts[0]?.id ?? "");
  const [toId, setToId] = useState(accounts[1]?.id ?? accounts[0]?.id ?? "");
  const from = accounts.find((a) => a.id === fromId);
  const to = accounts.find((a) => a.id === toId);
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [fromRate, setFromRate] = useState("");
  const [toRate, setToRate] = useState("");

  const fromCur = from?.currency ?? null;
  const toCur = to?.currency ?? null;
  const sameCurrency = fromCur === toCur;
  const rateFor = (cur: string | null, typed: string) => (cur ? Number(typed) || 0 : 1);
  const effectiveToRate = sameCurrency && fromCur ? rateFor(fromCur, fromRate) : rateFor(toCur, toRate);
  const baseOut = (Number(fromAmount) || 0) * rateFor(fromCur, fromRate);
  const baseIn = (sameCurrency ? Number(fromAmount) || 0 : Number(toAmount) || 0) * effectiveToRate;
  const difference = Math.round((baseIn - baseOut) * 100) / 100;
  const showDifference = Number(fromAmount) > 0 && (sameCurrency ? false : Number(toAmount) > 0) && (!fromCur || Number(fromRate) > 0) && (!toCur || Number(toRate) > 0);

  const pickAccount = (set: (v: string) => void, setRate: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    set(e.target.value);
    const cur = accounts.find((a) => a.id === e.target.value)?.currency;
    setRate(cur && rates[cur] ? String(rates[cur]) : "");
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Feedback state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Money leaves" htmlFor="fromAccountId">
          <Select id="fromAccountId" name="fromAccountId" value={fromId} onChange={pickAccount(setFromId, setFromRate)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.currency ? ` (${a.currency})` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Money arrives in" htmlFor="toAccountId">
          <Select id="toAccountId" name="toAccountId" value={toId} onChange={pickAccount(setToId, setToRate)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.currency ? ` (${a.currency})` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Amount that left (${fromCur ?? baseCurrency})`} htmlFor="fromAmount">
          <Input id="fromAmount" name="fromAmount" type="number" step="0.01" min="0.01" value={fromAmount} onChange={(e) => setFromAmount(e.target.value)} required />
        </Field>
        {!sameCurrency ? (
          <Field label={`Amount that arrived (${toCur ?? baseCurrency})`} htmlFor="toAmount" hint="What the bank actually credited">
            <Input id="toAmount" name="toAmount" type="number" step="0.01" min="0.01" value={toAmount} onChange={(e) => setToAmount(e.target.value)} required />
          </Field>
        ) : (
          <div className="self-end pb-2 text-xs text-slate-500">Same currency: the same amount arrives.</div>
        )}
        {fromCur ? (
          <Field label={`Rate: 1 ${fromCur} = ? ${baseCurrency}`} htmlFor="fromRate">
            <Input id="fromRate" name="fromRate" type="number" step="any" min="0" value={fromRate} onChange={(e) => setFromRate(e.target.value)} required />
          </Field>
        ) : null}
        {toCur && !sameCurrency ? (
          <Field label={`Rate: 1 ${toCur} = ? ${baseCurrency}`} htmlFor="toRate">
            <Input id="toRate" name="toRate" type="number" step="any" min="0" value={toRate} onChange={(e) => setToRate(e.target.value)} required />
          </Field>
        ) : null}
        <Field label="Date" htmlFor="date">
          <Input id="date" name="date" type="date" defaultValue={today} max={today} required />
        </Field>
        <Field label="Note (optional)" htmlFor="note">
          <Input id="note" name="note" placeholder="Converted USD to pay suppliers..." />
        </Field>
      </div>
      {showDifference ? (
        <p className={`rounded-md p-3 text-sm ${difference === 0 ? "bg-slate-50 text-slate-600" : difference > 0 ? "bg-teal-50 text-teal-800" : "bg-amber-50 text-amber-800"}`}>
          {difference === 0
            ? "No exchange difference at these rates."
            : `Exchange ${difference > 0 ? "gain" : "loss"} of ${formatMoney(Math.abs(difference), baseCurrency)} at these rates: it is booked to Exchange gains and losses.`}
        </p>
      ) : null}
      <SubmitButton pending={pending}>Record transfer</SubmitButton>
    </form>
  );
}
