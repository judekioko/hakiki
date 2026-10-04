"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { loginAction, signupAction } from "@/lib/actions/auth";
import { createBusiness, updateBusiness } from "@/lib/actions/businesses";
import { importStatement, createPayment } from "@/lib/actions/payments";
import { createInvoice } from "@/lib/actions/invoices";
import { createSupplier, updateSupplier } from "@/lib/actions/suppliers";
import { autoMatchAction } from "@/lib/actions/matching";
import { AccountSelect, Feedback, Field, SubmitButton, useFormAction, type AccountOption, type Option } from "./form-kit";
import { LineItemsEditor, type EditorItem, type EditorTaxRate } from "./line-items-editor";

export { SubmitButton };

export type CountryOption = { code: string; name: string; currency: string; taxIdLabel: string };

export function LoginForm({ from }: { from?: string }) {
  const { state, onSubmit, pending } = useFormAction(loginAction);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Feedback state={state} />
      <input type="hidden" name="from" value={from ?? ""} />
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <SubmitButton pending={pending} className="w-full" pendingText="Signing in...">
        Sign in
      </SubmitButton>
    </form>
  );
}

function CountryField({ countries, defaultCountry, onChange }: { countries: CountryOption[]; defaultCountry: string; onChange: (code: string) => void }) {
  return (
    <Field label="Country" htmlFor="country" hint="Sets your currency, tax rates and wording. It cannot be changed later.">
      <Select id="country" name="country" defaultValue={defaultCountry} onChange={(e) => onChange(e.target.value)}>
        {countries.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name} ({c.currency})
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function SignupForm({ countries }: { countries: CountryOption[] }) {
  const { state, onSubmit, pending } = useFormAction(signupAction);
  const [country, setCountry] = useState("KE");
  const taxIdLabel = countries.find((c) => c.code === country)?.taxIdLabel ?? "Tax number";
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Feedback state={state} />
      <Field label="Your name" htmlFor="name">
        <Input id="name" name="name" autoComplete="name" required />
      </Field>
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" htmlFor="password" hint="At least 8 characters">
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
      <Field label="Business name" htmlFor="businessName">
        <Input id="businessName" name="businessName" required />
      </Field>
      <CountryField countries={countries} defaultCountry="KE" onChange={setCountry} />
      <Field label={`Business ${taxIdLabel} (optional)`} htmlFor="taxId">
        <Input id="taxId" name="taxId" placeholder={country === "KE" ? "P051234567X" : undefined} className="uppercase" />
      </Field>
      <SubmitButton pending={pending} className="w-full" pendingText="Creating account...">
        Create free account
      </SubmitButton>
    </form>
  );
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function BusinessForm({
  mode,
  countries,
  defaults,
}: {
  mode: "create" | "edit";
  countries: CountryOption[];
  defaults?: {
    name: string;
    country: string;
    kraPin: string | null;
    incomeTaxRate: number;
    yearEndMonth: number;
    vatRegistered: boolean;
    address: string | null;
    phone: string | null;
    email: string | null;
    invoiceFooter: string | null;
  };
}) {
  const { state, onSubmit, pending } = useFormAction(mode === "create" ? createBusiness : updateBusiness);
  const [country, setCountry] = useState(defaults?.country ?? "KE");
  const pack = countries.find((c) => c.code === country);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Feedback state={state} />
      <Field label="Business name" htmlFor="name">
        <Input id="name" name="name" defaultValue={defaults?.name} required />
      </Field>
      {mode === "create" ? (
        <CountryField countries={countries} defaultCountry={country} onChange={setCountry} />
      ) : (
        <p className="text-sm text-slate-600">
          Country: <strong>{pack?.name}</strong> · Currency: <strong>{pack?.currency}</strong>
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={pack?.taxIdLabel ?? "Tax number"} htmlFor="taxId">
          <Input id="taxId" name="taxId" defaultValue={defaults?.kraPin ?? ""} className="uppercase" />
        </Field>
        <label className="flex items-center gap-2 pt-6 text-sm text-slate-700">
          <input type="checkbox" name="vatRegistered" defaultChecked={defaults?.vatRegistered ?? true} />
          Registered for VAT
        </label>
        <Field label="Phone" htmlFor="phone">
          <Input id="phone" name="phone" defaultValue={defaults?.phone ?? ""} />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" defaultValue={defaults?.email ?? ""} />
        </Field>
      </div>
      <Field label="Address (shown on invoices)" htmlFor="address">
        <Input id="address" name="address" defaultValue={defaults?.address ?? ""} />
      </Field>
      <Field label="Invoice footer" htmlFor="invoiceFooter" hint="Payment details, e.g. Paybill 123456, Account: invoice number">
        <Input id="invoiceFooter" name="invoiceFooter" defaultValue={defaults?.invoiceFooter ?? ""} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Income tax rate (%)" htmlFor="incomeTaxRate" hint="Used to estimate the tax cost of expenses without a valid tax invoice.">
          <Input id="incomeTaxRate" name="incomeTaxRate" type="number" step="0.01" min={0} max={100} defaultValue={defaults?.incomeTaxRate} />
        </Field>
        <Field label="Financial year ends in" htmlFor="yearEndMonth">
          <Select id="yearEndMonth" name="yearEndMonth" defaultValue={defaults?.yearEndMonth ?? 12}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {mode === "create" ? (
        <Field label="Your role" htmlFor="role">
          <Select id="role" name="role" defaultValue="OWNER">
            <option value="OWNER">I own or run this business</option>
            <option value="ACCOUNTANT">I am its accountant / tax agent</option>
          </Select>
        </Field>
      ) : null}
      <SubmitButton pending={pending}>{mode === "create" ? "Add business" : "Save changes"}</SubmitButton>
    </form>
  );
}

export type MoneyAccountOption = { id: string; name: string; kind: string };

function MoneyAccountField({ accounts, label, defaultValue }: { accounts: MoneyAccountOption[]; label: string; defaultValue?: string }) {
  return (
    <Field label={label} htmlFor="moneyAccountId">
      <Select id="moneyAccountId" name="moneyAccountId" defaultValue={defaultValue ?? accounts[0]?.id}>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function ImportForm({ moneyAccounts }: { moneyAccounts: MoneyAccountOption[] }) {
  const { state, onSubmit, pending } = useFormAction(importStatement);
  const mobile = moneyAccounts.find((a) => a.kind === "MOBILE_MONEY");
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Feedback state={state} />
      <MoneyAccountField accounts={moneyAccounts} label="Statement for account" defaultValue={mobile?.id} />
      <Field label="CSV file" htmlFor="file" hint="Re-importing the same statement skips transactions already added.">
        <Input id="file" name="file" type="file" accept=".csv,text/csv" required />
      </Field>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="includeIncoming" defaultChecked />
        Also import money received (customer payments)
      </label>
      <SubmitButton pending={pending} pendingText="Importing...">
        Import statement
      </SubmitButton>
    </form>
  );
}

export function PaymentForm({
  today,
  moneyAccounts,
  categories,
}: {
  today: string;
  moneyAccounts: MoneyAccountOption[];
  categories: AccountOption[];
}) {
  const { state, onSubmit, pending } = useFormAction(createPayment);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Feedback state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <MoneyAccountField accounts={moneyAccounts} label="Paid from" defaultValue={moneyAccounts.find((a) => a.kind === "CASH")?.id} />
        <Field label="Date paid" htmlFor="paidAt">
          <Input id="paidAt" name="paidAt" type="date" defaultValue={today} required />
        </Field>
        <Field label="Amount" htmlFor="amount">
          <Input id="amount" name="amount" type="number" step="0.01" min="0.01" required />
        </Field>
        <Field label="Reference (optional)" htmlFor="reference" hint="Transaction code, cheque or bank reference">
          <Input id="reference" name="reference" className="uppercase" />
        </Field>
      </div>
      <Field label="Paid to" htmlFor="counterparty">
        <Input id="counterparty" name="counterparty" required />
      </Field>
      <Field label="Category" htmlFor="categoryAccountId" hint="Leave as uncategorised if a supplier bill will cover it.">
        <AccountSelect id="categoryAccountId" name="categoryAccountId" accounts={categories} placeholder="Uncategorised / to be matched to a bill" />
      </Field>
      <Field label="What was it for? (optional)" htmlFor="details">
        <Input id="details" name="details" />
      </Field>
      <SubmitButton pending={pending}>Add payment</SubmitButton>
    </form>
  );
}

export function InvoiceForm({
  suppliers,
  defaults,
  paymentId,
  today,
  taxIdLabel,
  taxInvoiceLabel,
  categories,
  items,
  taxRates,
  allowLines = false,
}: {
  suppliers: Option[];
  defaults?: { supplierId?: string; supplierName?: string; amount?: number; date?: string };
  paymentId?: string;
  today: string;
  taxIdLabel: string;
  taxInvoiceLabel: string;
  categories: AccountOption[];
  items?: EditorItem[];
  taxRates?: EditorTaxRate[];
  allowLines?: boolean;
}) {
  const { state, onSubmit, pending } = useFormAction(createInvoice);
  const [mode, setMode] = useState<"total" | "lines">("total");
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Feedback state={state} />
      <input type="hidden" name="paymentId" value={paymentId ?? ""} />
      <Field label={`${taxInvoiceLabel} number`} htmlFor="invoiceNumber" hint="As printed on the supplier's invoice">
        <Input id="invoiceNumber" name="invoiceNumber" required className="uppercase" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Supplier" htmlFor="supplierId">
          <Select id="supplierId" name="supplierId" defaultValue={defaults?.supplierId ?? ""}>
            <option value="">New supplier (type the name)</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="New supplier name" htmlFor="supplierName" hint="Leave blank if you picked a supplier">
          <Input id="supplierName" name="supplierName" defaultValue={defaults?.supplierName ?? ""} />
        </Field>
        <Field label={`Supplier ${taxIdLabel}`} htmlFor="supplierPin">
          <Input id="supplierPin" name="supplierPin" className="uppercase" />
        </Field>
        <Field label="Invoice date" htmlFor="invoiceDate">
          <Input id="invoiceDate" name="invoiceDate" type="date" defaultValue={defaults?.date ?? today} required />
        </Field>
        <Field label="Due date (optional)" htmlFor="dueDate">
          <Input id="dueDate" name="dueDate" type="date" />
        </Field>
        <Field label="Expense category" htmlFor="categoryAccountId">
          <AccountSelect id="categoryAccountId" name="categoryAccountId" accounts={categories} placeholder="Uncategorised expense" />
        </Field>
      </div>

      {allowLines ? (
        <div className="flex gap-2 text-sm">
          <button type="button" onClick={() => setMode("total")} className={mode === "total" ? "font-semibold text-teal-700" : "text-slate-500"}>
            Enter total only
          </button>
          <span className="text-slate-300">|</span>
          <button type="button" onClick={() => setMode("lines")} className={mode === "lines" ? "font-semibold text-teal-700" : "text-slate-500"}>
            Enter line items (stock purchases)
          </button>
        </div>
      ) : null}

      {mode === "lines" && items && taxRates ? (
        <LineItemsEditor side="purchase" items={items} taxRates={taxRates} accounts={categories} chargeTax />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Total incl. VAT" htmlFor="totalAmount">
            <Input id="totalAmount" name="totalAmount" type="number" step="0.01" min="0.01" defaultValue={defaults?.amount} required />
          </Field>
          <Field label="VAT included" htmlFor="vatAmount" hint="0 if the supplier is not VAT registered">
            <Input id="vatAmount" name="vatAmount" type="number" step="0.01" min="0" defaultValue={0} />
          </Field>
        </div>
      )}
      <Field label="What was bought? (optional)" htmlFor="description">
        <Input id="description" name="description" />
      </Field>
      <Field label="Invoice photo or PDF (optional)" htmlFor="file" hint="Up to 5 MB. Kept so you can show the tax authority the original.">
        <Input id="file" name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" capture="environment" />
      </Field>
      <SubmitButton pending={pending}>Save bill</SubmitButton>
    </form>
  );
}

export function SupplierForm({
  mode,
  defaults,
  supplierId,
  paymentId,
  taxIdLabel = "Tax number",
}: {
  mode: "create" | "edit";
  defaults?: { name: string; kraPin: string | null; phone: string | null };
  supplierId?: string;
  paymentId?: string;
  taxIdLabel?: string;
}) {
  const { state, onSubmit, pending } = useFormAction(mode === "create" ? createSupplier : updateSupplier);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Feedback state={state} />
      <input type="hidden" name="supplierId" value={supplierId ?? ""} />
      <input type="hidden" name="paymentId" value={paymentId ?? ""} />
      <Field label="Supplier name" htmlFor="name">
        <Input id="name" name="name" defaultValue={defaults?.name} required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={taxIdLabel} htmlFor="kraPin">
          <Input id="kraPin" name="kraPin" defaultValue={defaults?.kraPin ?? ""} className="uppercase" />
        </Field>
        <Field label="WhatsApp number" htmlFor="phone" hint="Used to request missing invoices">
          <Input id="phone" name="phone" type="tel" defaultValue={defaults?.phone ?? ""} placeholder="0712 345 678" />
        </Field>
      </div>
      <SubmitButton pending={pending}>{mode === "create" ? "Add supplier" : "Save supplier"}</SubmitButton>
    </form>
  );
}

export function AutoMatchButton() {
  const { state, onSubmit, pending } = useFormAction(autoMatchAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col items-end gap-2">
      <SubmitButton pending={pending} variant="secondary" pendingText="Matching...">
        Auto-match
      </SubmitButton>
      {state.success ? <p className="text-xs text-slate-500">{state.success}</p> : null}
    </form>
  );
}
