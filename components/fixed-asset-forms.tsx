"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { disposeAssetAction, saveAsset } from "@/lib/actions/fixed-assets";
import { depreciationForMonth } from "@/lib/depreciation";
import { formatMoney } from "@/lib/format";
import { Feedback, Field, SubmitButton, useFormAction } from "./form-kit";

export type AssetDefaults = {
  id: string;
  name: string;
  notes: string | null;
  assetAccountId: string;
  purchaseDate: string;
  cost: number;
  salvageValue: number;
  method: "STRAIGHT_LINE" | "REDUCING_BALANCE";
  usefulLifeMonths: number | null;
  annualRate: number | null;
  depreciateFrom: string;
  priorDepreciation: number;
  // When depreciation has been booked only the name and notes can change.
  locked: boolean;
};

export function AssetForm({
  accounts,
  currency,
  today,
  defaults,
}: {
  accounts: { id: string; name: string }[];
  currency: string;
  today: string;
  defaults?: AssetDefaults;
}) {
  const { state, onSubmit, pending } = useFormAction(saveAsset);
  const [method, setMethod] = useState<"STRAIGHT_LINE" | "REDUCING_BALANCE">(defaults?.method ?? "STRAIGHT_LINE");
  const [purchaseDate, setPurchaseDate] = useState(defaults?.purchaseDate ?? today);
  const [from, setFrom] = useState(defaults?.depreciateFrom.slice(0, 7) ?? "");
  const [cost, setCost] = useState(defaults ? String(defaults.cost) : "");
  const [salvage, setSalvage] = useState(defaults ? String(defaults.salvageValue) : "0");
  const [life, setLife] = useState(defaults?.usefulLifeMonths ? String(defaults.usefulLifeMonths) : "60");
  const [rate, setRate] = useState(defaults?.annualRate ? String(defaults.annualRate) : "25");
  const [prior, setPrior] = useState(defaults ? String(defaults.priorDepreciation) : "0");
  const locked = defaults?.locked ?? false;

  const estimate = depreciationForMonth(
    { cost: Number(cost) || 0, salvage: Number(salvage) || 0, method, lifeMonths: Number(life) || null, annualRate: Number(rate) || null, prior: Number(prior) || 0 },
    1,
    Number(prior) || 0
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Feedback state={state} />
      {defaults ? <input type="hidden" name="assetId" value={defaults.id} /> : null}
      {locked ? (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          Depreciation has been booked for this asset, so only the name and notes can change. To change the cost or terms, take its depreciation back first.
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="name">
          <Input id="name" name="name" defaultValue={defaults?.name} placeholder="Delivery van KDA 123X" required />
        </Field>
        <Field label="Asset account" htmlFor="assetAccountId" hint="Where the cost sits in your books">
          <Select id="assetAccountId" name="assetAccountId" defaultValue={defaults?.assetAccountId} disabled={locked}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          {locked ? <input type="hidden" name="assetAccountId" value={defaults?.assetAccountId} /> : null}
        </Field>
        <Field label="Date bought" htmlFor="purchaseDate">
          <Input
            id="purchaseDate"
            name="purchaseDate"
            type="date"
            value={purchaseDate}
            max={today}
            onChange={(e) => {
              setPurchaseDate(e.target.value);
              if (!defaults) setFrom("");
            }}
            readOnly={locked}
            required
          />
        </Field>
        <Field label={`Cost (${currency})`} htmlFor="cost" hint="Already recorded as a bill, payment or opening balance">
          <Input id="cost" name="cost" type="number" step="0.01" min="0.01" value={cost} onChange={(e) => setCost(e.target.value)} readOnly={locked} required />
        </Field>
        <Field label={`Value left at the end (${currency})`} htmlFor="salvageValue" hint="What it should still be worth when you are done with it. Often 0">
          <Input id="salvageValue" name="salvageValue" type="number" step="0.01" min="0" value={salvage} onChange={(e) => setSalvage(e.target.value)} readOnly={locked} />
        </Field>
        <Field label="Method" htmlFor="method">
          <Select id="method" name="method" value={method} onChange={(e) => setMethod(e.target.value as typeof method)} disabled={locked}>
            <option value="STRAIGHT_LINE">Straight line: the same amount every month</option>
            <option value="REDUCING_BALANCE">Reducing balance: a share of what is left</option>
          </Select>
          {locked ? <input type="hidden" name="method" value={method} /> : null}
        </Field>
        {method === "STRAIGHT_LINE" ? (
          <Field label="Useful life (months)" htmlFor="usefulLifeMonths" hint="60 months is five years">
            <Input id="usefulLifeMonths" name="usefulLifeMonths" type="number" step="1" min="1" value={life} onChange={(e) => setLife(e.target.value)} readOnly={locked} required />
          </Field>
        ) : (
          <Field label="Yearly rate (%)" htmlFor="annualRate" hint="For example 25 for a quarter of what is left each year">
            <Input id="annualRate" name="annualRate" type="number" step="0.01" min="0.01" max="100" value={rate} onChange={(e) => setRate(e.target.value)} readOnly={locked} required />
          </Field>
        )}
        <Field label="Start depreciating in" htmlFor="depreciateFrom" hint="Leave as the month bought, or pick the first month not yet depreciated">
          <Input id="depreciateFrom" name="depreciateFrom" type="month" value={from || purchaseDate.slice(0, 7)} onChange={(e) => setFrom(e.target.value)} readOnly={locked} required />
        </Field>
        <Field label={`Depreciation already booked (${currency})`} htmlFor="priorDepreciation" hint="Only for an asset you already owned: what your old books show as written off. Put the same amount in Accumulated depreciation under Opening balances">
          <Input id="priorDepreciation" name="priorDepreciation" type="number" step="0.01" min="0" value={prior} onChange={(e) => setPrior(e.target.value)} readOnly={locked} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Notes (optional)" htmlFor="notes">
            <Input id="notes" name="notes" defaultValue={defaults?.notes ?? ""} placeholder="Serial number, location, supplier..." />
          </Field>
        </div>
      </div>
      {estimate > 0 ? (
        <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
          About <strong>{formatMoney(estimate, currency)}</strong> will be written off in the first month.
        </p>
      ) : null}
      <SubmitButton pending={pending}>{defaults ? "Save changes" : "Add asset"}</SubmitButton>
    </form>
  );
}

export function DisposeForm({
  assetId,
  today,
  currency,
  bookValue,
  moneyAccounts,
}: {
  assetId: string;
  today: string;
  currency: string;
  bookValue: number;
  moneyAccounts: { id: string; name: string }[];
}) {
  const { state, onSubmit, pending } = useFormAction(disposeAssetAction);
  const [proceeds, setProceeds] = useState("");
  const received = Number(proceeds) || 0;
  const difference = Math.round((received - bookValue) * 100) / 100;
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Feedback state={state} />
      <input type="hidden" name="assetId" value={assetId} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Date" htmlFor="date">
          <Input id="date" name="date" type="date" defaultValue={today} max={today} required />
        </Field>
        <Field label={`Amount received (${currency})`} htmlFor="proceeds" hint="0 if it is being written off or scrapped">
          <Input id="proceeds" name="proceeds" type="number" step="0.01" min="0" value={proceeds} onChange={(e) => setProceeds(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Paid into" htmlFor="moneyAccountId" hint={received > 0 ? undefined : "Not needed for a write-off"}>
          <Select id="moneyAccountId" name="moneyAccountId" disabled={received <= 0}>
            {moneyAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <p className={`rounded-md p-3 text-sm ${difference === 0 ? "bg-slate-50 text-slate-600" : difference > 0 ? "bg-teal-50 text-teal-800" : "bg-amber-50 text-amber-800"}`}>
        Book value is about {formatMoney(bookValue, currency)} today (the exact figure is set when the sale is recorded).{" "}
        {difference === 0 ? "That is a break-even sale." : `At this price that is a ${difference > 0 ? "gain" : "loss"} of about ${formatMoney(Math.abs(difference), currency)}.`}
      </p>
      <SubmitButton pending={pending} variant="danger">
        {received > 0 ? "Record the sale" : "Write the asset off"}
      </SubmitButton>
    </form>
  );
}
