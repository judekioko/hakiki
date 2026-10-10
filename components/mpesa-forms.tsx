"use client";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { requestMpesaPayment, saveMpesaConfig } from "@/lib/actions/mpesa";
import { Feedback, Field, SubmitButton, useFormAction } from "./form-kit";

export function MpesaSettingsForm({
  defaults,
  accounts,
}: {
  defaults: { environment: string; shortcode: string; shortcodeType: string; moneyAccountId: string | null; hasKeys: boolean; hasPasskey: boolean } | null;
  accounts: { id: string; name: string }[];
}) {
  const { state, onSubmit, pending } = useFormAction(saveMpesaConfig);
  const keyHint = defaults?.hasKeys ? "Saved. Leave blank to keep it." : "From your Daraja app";
  return (
    <form onSubmit={onSubmit} className="space-y-4" autoComplete="off">
      <Feedback state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Environment" htmlFor="environment" hint="Start with Sandbox to try it with no real money">
          <Select id="environment" name="environment" defaultValue={defaults?.environment ?? "SANDBOX"}>
            <option value="SANDBOX">Sandbox (testing)</option>
            <option value="PRODUCTION">Production (real money)</option>
          </Select>
        </Field>
        <Field label="Shortcode type" htmlFor="shortcodeType">
          <Select id="shortcodeType" name="shortcodeType" defaultValue={defaults?.shortcodeType ?? "PAYBILL"}>
            <option value="PAYBILL">Paybill (customers type an account number)</option>
            <option value="TILL">Till number (Buy Goods)</option>
          </Select>
        </Field>
        <Field label="Shortcode" htmlFor="shortcode" hint="Sandbox paybill: 174379">
          <Input id="shortcode" name="shortcode" inputMode="numeric" defaultValue={defaults?.shortcode ?? ""} required />
        </Field>
        <Field label="Record payments into" htmlFor="moneyAccountId">
          <Select id="moneyAccountId" name="moneyAccountId" defaultValue={defaults?.moneyAccountId ?? ""}>
            <option value="">The first mobile money account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Consumer key" htmlFor="consumerKey" hint={keyHint}>
          <Input id="consumerKey" name="consumerKey" type="password" autoComplete="new-password" required={!defaults?.hasKeys} />
        </Field>
        <Field label="Consumer secret" htmlFor="consumerSecret" hint={keyHint}>
          <Input id="consumerSecret" name="consumerSecret" type="password" autoComplete="new-password" required={!defaults?.hasKeys} />
        </Field>
        <Field
          label="Lipa na M-Pesa passkey (optional)"
          htmlFor="passkey"
          hint={defaults?.hasPasskey ? "Saved. Leave blank to keep it. Needed to send payment requests to phones." : "Needed to send payment requests to phones"}
        >
          <Input id="passkey" name="passkey" type="password" autoComplete="new-password" />
        </Field>
      </div>
      <SubmitButton pending={pending}>Save M-Pesa settings</SubmitButton>
    </form>
  );
}

// On an invoice: ask the customer to pay it from their phone.
export function MpesaRequestForm({ invoiceId, phone, balance }: { invoiceId: string; phone: string; balance: number }) {
  const { state, onSubmit, pending } = useFormAction(requestMpesaPayment);
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Feedback state={state} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Customer's phone" htmlFor="mpesaPhone">
          <Input id="mpesaPhone" name="phone" type="tel" defaultValue={phone} placeholder="0722 000 111" required />
        </Field>
        <Field label="Amount" htmlFor="mpesaAmount">
          <Input id="mpesaAmount" name="amount" type="number" step="1" min="1" defaultValue={Math.ceil(balance)} required />
        </Field>
      </div>
      <SubmitButton pending={pending} pendingText="Sending...">
        Send payment request to phone
      </SubmitButton>
    </form>
  );
}
