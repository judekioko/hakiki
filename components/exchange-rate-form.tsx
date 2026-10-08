"use client";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { saveExchangeRate } from "@/lib/actions/exchange-rates";
import { foreignCurrencies } from "@/lib/currencies";
import { Feedback, Field, SubmitButton, useFormAction } from "./form-kit";

export function ExchangeRateForm({ baseCurrency, today }: { baseCurrency: string; today: string }) {
  const { state, onSubmit, pending } = useFormAction(saveExchangeRate);
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Feedback state={state} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Currency" htmlFor="rateCurrency">
          <Select id="rateCurrency" name="currency" defaultValue="USD">
            {foreignCurrencies(baseCurrency).map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Worth in ${baseCurrency}`} htmlFor="rateValue" hint="For one unit">
          <Input id="rateValue" name="rate" type="number" step="any" min="0" required />
        </Field>
        <Field label="As at" htmlFor="rateDate">
          <Input id="rateDate" name="date" type="date" defaultValue={today} max={today} required />
        </Field>
      </div>
      <SubmitButton pending={pending} variant="secondary" size="sm">
        Save rate
      </SubmitButton>
    </form>
  );
}
