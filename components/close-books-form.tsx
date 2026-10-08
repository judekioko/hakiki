"use client";

import { Input } from "@/components/ui/input";
import { setLockDate } from "@/lib/actions/close-books";
import { Feedback, Field, SubmitButton, useFormAction } from "./form-kit";

export function CloseBooksForm({
  current,
  suggestions,
  canReopen,
  max,
}: {
  current: string | null;
  suggestions: { label: string; value: string }[];
  canReopen: boolean;
  max: string;
}) {
  const { state, onSubmit, pending } = useFormAction(setLockDate);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Feedback state={state} />
      <Field label="Close the books through (last day included)" htmlFor="lockedThrough">
        <Input id="lockedThrough" name="lockedThrough" type="date" defaultValue={current ?? suggestions[0]?.value} max={max} required />
      </Field>
      {suggestions.length > 0 ? (
        <p className="text-xs text-slate-500">
          Common choices: {suggestions.map((s) => `${s.label} (${s.value})`).join(" · ")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <SubmitButton pending={pending} name="intent" value="close">
          {current ? "Change closing date" : "Close the books"}
        </SubmitButton>
        {current && canReopen ? (
          <SubmitButton pending={pending} name="intent" value="reopen" variant="secondary">
            Reopen all periods
          </SubmitButton>
        ) : null}
      </div>
    </form>
  );
}
