"use client";

import { useState } from "react";
import { emailDocument } from "@/lib/actions/share";
import { Button } from "@/components/ui/button";
import { Feedback, SubmitButton, useFormAction } from "./form-kit";

// Gives a document a link the customer can open without logging in, with ready-made WhatsApp and email messages.
export function ShareActions({
  kind,
  id,
  url,
  message,
  subject,
  whatsappNumber,
  email,
  canSendEmail,
}: {
  kind: "invoice" | "quotation" | "credit-note" | "statement";
  id: string;
  url: string;
  message: string;
  subject: string;
  whatsappNumber: string | null;
  email: string | null;
  canSendEmail: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const { state, onSubmit, pending } = useFormAction(emailDocument);

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">Customers can open this link, view the document and print or save it as a PDF. No login needed.</p>
      <div className="flex gap-2">
        <input readOnly value={url} aria-label="Share link" className="min-w-0 flex-1 rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-xs text-slate-700" onFocus={(e) => e.currentTarget.select()} />
        <Button type="button" size="sm" variant="secondary" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {whatsappNumber ? (
          <a
            href={`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            WhatsApp
          </a>
        ) : null}
        {email ? (
          <a
            href={`mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Email (your mail app)
          </a>
        ) : null}
      </div>
      {!whatsappNumber && !email ? <p className="text-xs text-slate-500">Add a phone number or email to the customer to send it from here.</p> : null}
      {canSendEmail && email ? (
        <form onSubmit={onSubmit} className="space-y-2 border-t border-slate-100 pt-3">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />
          <Feedback state={state} />
          <SubmitButton pending={pending} variant="secondary" size="sm" pendingText="Sending...">
            Email it from Hakiki to {email}
          </SubmitButton>
        </form>
      ) : null}
    </div>
  );
}
