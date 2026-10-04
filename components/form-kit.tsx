"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import type { ActionState } from "@/lib/actions/types";

const empty: ActionState = {};

// Submits through onSubmit rather than <form action> so React does not clear the fields when validation fails.
// The clicked button's name/value (e.g. intent=send) is included like a normal form post.
export function useFormAction(fn: (prev: ActionState, formData: FormData) => Promise<ActionState>) {
  const [state, dispatch, pending] = useActionState(fn, empty);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const formData = new FormData(event.currentTarget, submitter);
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
  name,
  value,
}: {
  children: React.ReactNode;
  pending?: boolean;
  pendingText?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
  className?: string;
  name?: string;
  value?: string;
}) {
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;
  return (
    <Button type="submit" disabled={pending} variant={variant} size={size} className={className} name={name} value={value}>
      {pending ? (pendingText ?? "Saving...") : children}
    </Button>
  );
}

export function Feedback({ state }: { state: ActionState }) {
  if (state.error) return <Alert variant="error">{state.error}</Alert>;
  if (state.success) return <Alert variant="success">{state.success}</Alert>;
  return null;
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export type Option = { id: string; name: string };
export type AccountOption = { id: string; code: string; name: string; type: string };

export function AccountSelect({
  id,
  name,
  accounts,
  defaultValue,
  placeholder,
  className,
  onChange,
}: {
  id?: string;
  name: string;
  accounts: AccountOption[];
  defaultValue?: string;
  placeholder?: string;
  className?: string;
  onChange?: (value: string) => void;
}) {
  const groups = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"].filter((t) => accounts.some((a) => a.type === t));
  const label: Record<string, string> = {
    ASSET: "Assets",
    LIABILITY: "Liabilities",
    EQUITY: "Equity",
    INCOME: "Income",
    EXPENSE: "Expenses",
  };
  return (
    <select
      id={id}
      name={name}
      defaultValue={defaultValue ?? ""}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      className={
        className ??
        "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-600 focus:outline-2 focus:outline-teal-100"
      }
    >
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {groups.map((g) => (
        <optgroup key={g} label={label[g]}>
          {accounts
            .filter((a) => a.type === g)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}
