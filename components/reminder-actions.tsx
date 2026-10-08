"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { logReminder } from "@/lib/actions/reminders";
import { TONE_LABEL, type ReminderTone } from "@/lib/reminder-text";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

// Tone picker with WhatsApp, email and copy buttons. The messages for every tone are prepared on the server so
// switching tone is instant; the reminder is recorded as it is sent.
export function ReminderActions({
  customerId,
  whatsappNumber,
  email,
  subject,
  messages,
  defaultTone,
}: {
  customerId: string;
  whatsappNumber: string | null;
  email: string | null;
  subject: string;
  messages: Record<ReminderTone, string>;
  defaultTone: ReminderTone;
}) {
  const router = useRouter();
  const [tone, setTone] = useState<ReminderTone>(defaultTone);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const text = messages[tone];

  const record = (channel: "WHATSAPP" | "EMAIL") =>
    startTransition(async () => {
      const result = await logReminder({ customerId, channel, tone });
      setNote(result.error ?? null);
      router.refresh();
    });

  const sendWhatsApp = () => {
    // Opened first, in the click itself, so the browser does not treat it as a blocked pop-up.
    window.open(`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    record("WHATSAPP");
  };
  const sendEmail = () => {
    record("EMAIL");
    window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  };
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setNote("Message copied. Paste it into any app, then use the buttons to log it if you send it from here.");
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-44">
        <Select value={tone} onChange={(e) => setTone(e.target.value as ReminderTone)} aria-label="Tone">
          {(Object.keys(TONE_LABEL) as ReminderTone[]).map((t) => (
            <option key={t} value={t}>
              {TONE_LABEL[t]}
            </option>
          ))}
        </Select>
        </div>
        {whatsappNumber ? (
          <Button type="button" size="sm" onClick={sendWhatsApp} disabled={pending}>
            WhatsApp
          </Button>
        ) : null}
        {email ? (
          <Button type="button" size="sm" variant="secondary" onClick={sendEmail} disabled={pending}>
            Email
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" onClick={copy}>
          Copy message
        </Button>
        {!whatsappNumber && !email ? <span className="text-xs text-slate-500">Add a phone number or email to this customer to send from here.</span> : null}
      </div>
      <details className="text-xs text-slate-500">
        <summary className="cursor-pointer">Preview message</summary>
        <pre className="mt-1 whitespace-pre-wrap rounded-md bg-slate-50 p-3 font-sans text-slate-700">{text}</pre>
      </details>
      {note ? <p className="text-xs text-amber-700">{note}</p> : null}
    </div>
  );
}
