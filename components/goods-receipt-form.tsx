"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { recordGoodsReceipt } from "@/lib/actions/purchase-orders";
import { Feedback, Field, SubmitButton, useFormAction } from "./form-kit";

export type ReceivableLine = { id: string; description: string; ordered: number; received: number };

// Records a delivery: one quantity per order line, defaulting to everything still outstanding.
export function GoodsReceiptForm({ orderId, lines, today }: { orderId: string; lines: ReceivableLine[]; today: string }) {
  const { state, onSubmit, pending } = useFormAction(recordGoodsReceipt);
  const outstanding = (l: ReceivableLine) => Math.max(0, Math.round((l.ordered - l.received) * 1000) / 1000);
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, String(outstanding(l))])));
  const payload = JSON.stringify(lines.map((l) => ({ lineId: l.id, quantity: qty[l.id] || "0" })));

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Feedback state={state} />
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="lines" value={payload} />
      <div className="space-y-2">
        {lines.map((l) => (
          <div key={l.id} className="grid grid-cols-[1fr_auto] items-center gap-3 text-sm">
            <div>
              <p className="text-slate-900">{l.description}</p>
              <p className="text-xs text-slate-500">
                Ordered {l.ordered} · received {l.received} · outstanding {outstanding(l)}
              </p>
            </div>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              max={outstanding(l)}
              step="any"
              value={qty[l.id] ?? ""}
              onChange={(e) => setQty((prev) => ({ ...prev, [l.id]: e.target.value }))}
              disabled={outstanding(l) === 0}
              aria-label={`Quantity received: ${l.description}`}
              className="w-24 text-right"
            />
          </div>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date received" htmlFor="receivedDate">
          <Input id="receivedDate" name="receivedDate" type="date" defaultValue={today} max={today} required />
        </Field>
        <Field label="Delivery note / comment (optional)" htmlFor="note">
          <Input id="note" name="note" />
        </Field>
      </div>
      <SubmitButton pending={pending} variant="secondary">
        Record goods received
      </SubmitButton>
    </form>
  );
}
