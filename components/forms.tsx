"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { loginAction, signupAction } from "@/lib/actions/auth";
import { createBusiness, updateBusiness } from "@/lib/actions/businesses";
import { importStatement, createPayment } from "@/lib/actions/payments";
import { createInvoice } from "@/lib/actions/invoices";
import { createSupplier, updateSupplier } from "@/lib/actions/suppliers";
import { autoMatchAction } from "@/lib/actions/matching";
import type { ActionState } from "@/lib/actions/types";

const empty: ActionState = {};

// Submits through onSubmit rather than <form action> so React does not clear the fields when validation fails.
function useFormAction(fn: (prev: ActionState, formData: FormData) => Promise<ActionState>) {
  const [state, dispatch, pending] = useActionState(fn, empty);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  };
  return { state, onSubmit, pending };
}

export function SubmitButton({
  children,
  pendingText,
  variant,
  size,
  className,
  pending: pendingProp,
}: {
  children: React.ReactNode;
  pending?: boolean;
  pendingText?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
  className?: string;
}) {
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;
  return (
    <Button type="submit" disabled={pending} variant={variant} size={size} className={className}>
      {pending ? (pendingText ?? "Saving...") : children}
    </Button>
  );
}

function Feedback({ state }: { state: ActionState }) {
  if (state.error) return <Alert variant="error">{state.error}</Alert>;
  if (state.success) return <Alert variant="success">{state.success}</Alert>;
  return null;
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

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

export function SignupForm() {
  const { state, onSubmit, pending } = useFormAction(signupAction);
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
      <Field label="Business KRA PIN (optional)" htmlFor="kraPin">
        <Input id="kraPin" name="kraPin" placeholder="P051234567X" className="uppercase" />
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
  defaults,
}: {
  mode: "create" | "edit";
  defaults?: { name: string; kraPin: string | null; incomeTaxRate: number; yearEndMonth: number };
}) {
  const { state, onSubmit, pending } = useFormAction(mode === "create" ? createBusiness : updateBusiness);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Feedback state={state} />
      <Field label="Business name" htmlFor="name">
        <Input id="name" name="name" defaultValue={defaults?.name} required />
      </Field>
      <Field label="KRA PIN" htmlFor="kraPin">
        <Input id="kraPin" name="kraPin" defaultValue={defaults?.kraPin ?? ""} placeholder="P051234567X" className="uppercase" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Income tax rate (%)"
          htmlFor="incomeTaxRate"
          hint="Used to estimate tax at risk. 30% for companies; use your top band for individuals."
        >
          <Input id="incomeTaxRate" name="incomeTaxRate" type="number" step="0.01" min={0} max={100} defaultValue={defaults?.incomeTaxRate ?? 30} />
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

export function ImportForm() {
  const { state, onSubmit, pending } = useFormAction(importStatement);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Feedback state={state} />
      <Field label="Statement type" htmlFor="source">
        <Select id="source" name="source" defaultValue="MPESA">
          <option value="MPESA">M-Pesa (till, paybill or business statement)</option>
          <option value="BANK">Bank statement</option>
        </Select>
      </Field>
      <Field label="CSV file" htmlFor="file" hint="Only money paid out is imported. Re-importing the same statement skips payments already added.">
        <Input id="file" name="file" type="file" accept=".csv,text/csv" required />
      </Field>
      <SubmitButton pending={pending} pendingText="Importing...">Import payments</SubmitButton>
    </form>
  );
}

export function PaymentForm({ today }: { today: string }) {
  const { state, onSubmit, pending } = useFormAction(createPayment);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Feedback state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Paid with" htmlFor="source">
          <Select id="source" name="source" defaultValue="CASH">
            <option value="CASH">Cash</option>
            <option value="MPESA">M-Pesa</option>
            <option value="BANK">Bank</option>
            <option value="OTHER">Other</option>
          </Select>
        </Field>
        <Field label="Date paid" htmlFor="paidAt">
          <Input id="paidAt" name="paidAt" type="date" defaultValue={today} required />
        </Field>
        <Field label="Amount (KES)" htmlFor="amount">
          <Input id="amount" name="amount" type="number" step="0.01" min="0.01" required />
        </Field>
        <Field label="Reference (optional)" htmlFor="reference" hint="M-Pesa code, cheque or bank reference">
          <Input id="reference" name="reference" className="uppercase" />
        </Field>
      </div>
      <Field label="Paid to" htmlFor="counterparty">
        <Input id="counterparty" name="counterparty" required />
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
}: {
  suppliers: { id: string; name: string }[];
  defaults?: { supplierId?: string; supplierName?: string; amount?: number; date?: string };
  paymentId?: string;
  today: string;
}) {
  const { state, onSubmit, pending } = useFormAction(createInvoice);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Feedback state={state} />
      <input type="hidden" name="paymentId" value={paymentId ?? ""} />
      <Field label="eTIMS invoice number" htmlFor="invoiceNumber" hint="The control unit (CU) invoice number printed on the invoice">
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
        <Field label="Supplier KRA PIN" htmlFor="supplierPin">
          <Input id="supplierPin" name="supplierPin" placeholder="P051234567X" className="uppercase" />
        </Field>
        <Field label="Invoice date" htmlFor="invoiceDate">
          <Input id="invoiceDate" name="invoiceDate" type="date" defaultValue={defaults?.date ?? today} required />
        </Field>
        <Field label="Total incl. VAT (KES)" htmlFor="totalAmount">
          <Input id="totalAmount" name="totalAmount" type="number" step="0.01" min="0.01" defaultValue={defaults?.amount} required />
        </Field>
        <Field label="VAT (KES)" htmlFor="vatAmount" hint="0 if the supplier is not VAT registered">
          <Input id="vatAmount" name="vatAmount" type="number" step="0.01" min="0" defaultValue={0} />
        </Field>
      </div>
      <Field label="What was bought? (optional)" htmlFor="description">
        <Input id="description" name="description" />
      </Field>
      <Field label="Invoice photo or PDF (optional)" htmlFor="file" hint="Up to 5 MB. Kept so you can show KRA the original.">
        <Input id="file" name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" capture="environment" />
      </Field>
      <SubmitButton pending={pending}>Save invoice</SubmitButton>
    </form>
  );
}

export function SupplierForm({
  mode,
  defaults,
  supplierId,
  paymentId,
}: {
  mode: "create" | "edit";
  defaults?: { name: string; kraPin: string | null; phone: string | null };
  supplierId?: string;
  paymentId?: string;
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
        <Field label="KRA PIN" htmlFor="kraPin">
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
