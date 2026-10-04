"use client";

import { useId, useState } from "react";
import type { AccountOption } from "./form-kit";
import { currencyDigits } from "@/lib/format";

export type EditorItem = {
  id: string;
  name: string;
  salePrice: number;
  purchasePrice: number;
  taxRateId: string | null;
  incomeAccountId: string | null;
  expenseAccountId: string | null;
  kind: string;
};
export type EditorTaxRate = { id: string; name: string; rate: number; isDefault: boolean };

export type EditorLine = {
  key: number;
  itemId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRateId: string;
  accountId: string;
};

const cell =
  "block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-teal-600 focus:outline-2 focus:outline-teal-100";

// Editable list of invoice/bill lines. The lines are submitted as JSON in a hidden "lines" field.
export function LineItemsEditor({
  side,
  items,
  taxRates,
  accounts,
  chargeTax,
  initial,
  currency = "",
}: {
  side: "sale" | "purchase";
  items: EditorItem[];
  taxRates: EditorTaxRate[];
  accounts: AccountOption[];
  chargeTax: boolean;
  initial?: Omit<EditorLine, "key">[];
  currency?: string;
}) {
  // Row keys are numbered from 1 so the server and the browser render identical ids.
  const idBase = useId();
  const defaultRate = chargeTax ? (taxRates.find((r) => r.isDefault)?.id ?? "") : "";
  const blank = (key: number): EditorLine => ({
    key,
    itemId: "",
    description: "",
    quantity: "1",
    unitPrice: "",
    taxRateId: defaultRate,
    accountId: "",
  });
  const [lines, setLines] = useState<EditorLine[]>(() =>
    initial && initial.length ? initial.map((l, i) => ({ ...l, key: i + 1 })) : [blank(1)]
  );
  const addLine = () => setLines((ls) => [...ls, blank(Math.max(0, ...ls.map((l) => l.key)) + 1)]);

  const update = (key: number, patch: Partial<EditorLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const chooseItem = (key: number, itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return update(key, { itemId: "" });
    update(key, {
      itemId,
      description: item.name,
      unitPrice: String(side === "sale" ? item.salePrice : item.purchasePrice),
      taxRateId: chargeTax ? (item.taxRateId ?? defaultRate) : "",
      accountId: (side === "sale" ? item.incomeAccountId : item.expenseAccountId) ?? "",
    });
  };

  const rateOf = (id: string) => taxRates.find((r) => r.id === id)?.rate ?? 0;
  const computed = lines.map((l) => {
    const net = (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0);
    const tax = chargeTax ? (net * rateOf(l.taxRateId)) / 100 : 0;
    return { net, tax };
  });
  const subtotal = computed.reduce((s, c) => s + c.net, 0);
  const taxTotal = computed.reduce((s, c) => s + c.tax, 0);
  const dp = currency ? currencyDigits(currency) : 2;
  const fmt = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const accountChoices = accounts.filter((a) => (side === "sale" ? a.type === "INCOME" : a.type !== "INCOME"));

  const payload = JSON.stringify(
    lines
      .filter((l) => l.description.trim() || l.itemId)
      .map((l) => ({
        itemId: l.itemId || null,
        description: l.description.trim() || items.find((i) => i.id === l.itemId)?.name || "",
        quantity: l.quantity,
        unitPrice: l.unitPrice || "0",
        taxRateId: l.taxRateId || null,
        accountId: l.accountId || null,
      }))
  );

  return (
    <div className="space-y-3">
      <input type="hidden" name="lines" value={payload} />
      <div className="space-y-3">
        {lines.map((line, index) => (
          <div key={line.key} className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-12">
            <div className="sm:col-span-4">
              <label className="text-xs text-slate-500" htmlFor={`${idBase}-item-${line.key}`}>
                Item
              </label>
              <select id={`${idBase}-item-${line.key}`} className={cell} value={line.itemId} onChange={(e) => chooseItem(line.key, e.target.value)}>
                <option value="">— No saved item —</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                    {i.kind === "INVENTORY" ? " (stock)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-8">
              <label className="text-xs text-slate-500" htmlFor={`${idBase}-desc-${line.key}`}>
                Description
              </label>
              <input
                id={`${idBase}-desc-${line.key}`}
                className={cell}
                value={line.description}
                onChange={(e) => update(line.key, { description: e.target.value })}
                placeholder="What is being sold or bought"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-slate-500" htmlFor={`${idBase}-qty-${line.key}`}>
                Qty
              </label>
              <input
                id={`${idBase}-qty-${line.key}`}
                className={cell}
                type="number"
                step="any"
                min="0"
                value={line.quantity}
                onChange={(e) => update(line.key, { quantity: e.target.value })}
              />
            </div>
            <div className="sm:col-span-3">
              <label className="text-xs text-slate-500" htmlFor={`${idBase}-price-${line.key}`}>
                Unit price (excl. tax)
              </label>
              <input
                id={`${idBase}-price-${line.key}`}
                className={cell}
                type="number"
                step="0.01"
                min="0"
                value={line.unitPrice}
                onChange={(e) => update(line.key, { unitPrice: e.target.value })}
              />
            </div>
            {chargeTax ? (
              <div className="sm:col-span-3">
                <label className="text-xs text-slate-500" htmlFor={`${idBase}-tax-${line.key}`}>
                  Tax
                </label>
                <select id={`${idBase}-tax-${line.key}`} className={cell} value={line.taxRateId} onChange={(e) => update(line.key, { taxRateId: e.target.value })}>
                  <option value="">No tax</option>
                  {taxRates.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className={chargeTax ? "sm:col-span-3" : "sm:col-span-6"}>
              <label className="text-xs text-slate-500" htmlFor={`${idBase}-acct-${line.key}`}>
                Account
              </label>
              <select id={`${idBase}-acct-${line.key}`} className={cell} value={line.accountId} onChange={(e) => update(line.key, { accountId: e.target.value })}>
                <option value="">{side === "sale" ? "Sales (default)" : "Default"}</option>
                {accountChoices.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end justify-between gap-2 sm:col-span-1 sm:flex-col sm:items-end">
              <span className="text-sm font-medium text-slate-800">{fmt(computed[index].net)}</span>
              {lines.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
                  className="text-xs text-rose-600 hover:underline"
                  aria-label={`Remove line ${index + 1}`}
                >
                  Remove
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <button type="button" onClick={addLine} className="text-sm font-medium text-teal-700 hover:underline">
        + Add line
      </button>
      <dl className="ml-auto w-full max-w-xs space-y-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-slate-500">Subtotal</dt>
          <dd>{currency} {fmt(subtotal)}</dd>
        </div>
        {chargeTax ? (
          <div className="flex justify-between">
            <dt className="text-slate-500">Tax</dt>
            <dd>{currency} {fmt(taxTotal)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold">
          <dt>Total</dt>
          <dd>{currency} {fmt(subtotal + taxTotal)}</dd>
        </div>
      </dl>
    </div>
  );
}
