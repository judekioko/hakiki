"use client";

import { Input } from "@/components/ui/input";
import { saveForeignOpening } from "@/lib/actions/foreign-accounts";
import { Feedback, SubmitButton, useFormAction } from "./form-kit";

export function ForeignOpeningForm({
  accountId,
  name,
  currency,
  baseCurrency,
  amount,
  rate,
  disabled,
}: {
  accountId: string;
  name: string;
  currency: string;
  baseCurrency: string;
  amount: number | null;
  rate: number | null;
  disabled: boolean;
}) {
  const { state, onSubmit, pending } = useFormAction(saveForeignOpening);
  return (
    <form onSubmit={onSubmit} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
      <Feedback state={state} />
      <input type="hidden" name="accountId" value={accountId} />
      <div className="flex flex-wrap items-end gap-3">
        <p className="min-w-40 flex-1 text-sm font-medium text-slate-900">
          {name} <span className="font-normal text-slate-500">({currency})</span>
        </p>
        <label className="text-xs text-slate-500">
          Balance in {currency}
          <Input name="amount" type="number" step="0.01" min="0" defaultValue={amount ?? ""} placeholder="0.00" className="mt-1 w-36" />
        </label>
        <label className="text-xs text-slate-500">
          1 {currency} = ? {baseCurrency}
          <Input name="rate" type="number" step="any" min="0" defaultValue={rate ?? ""} className="mt-1 w-32" />
        </label>
        <SubmitButton pending={pending} variant="secondary" size="sm">
          Save
        </SubmitButton>
      </div>
      {disabled ? <p className="text-xs text-slate-500">Set the opening balance date in step 1 first.</p> : null}
    </form>
  );
}
