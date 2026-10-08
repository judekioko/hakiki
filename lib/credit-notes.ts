import { num, round2 } from "./money";

export const CREDIT_DISPLAY = {
  DRAFT: { label: "Draft", tone: "slate" },
  ISSUED: { label: "Issued", tone: "teal" },
  VOID: { label: "Void", tone: "slate" },
  USED: { label: "Fully applied", tone: "teal" },
} as const;

// How much of a credit note is still available to take off an invoice.
export function creditState(note: { status: string; total: unknown; allocations: { amount: unknown }[] }) {
  const total = num(note.total as never);
  const applied = round2(note.allocations.reduce((s, a) => s + num(a.amount as never), 0));
  const unused = note.status === "ISSUED" ? round2(total - applied) : 0;
  const display =
    note.status === "ISSUED" && unused <= 0.01 ? CREDIT_DISPLAY.USED : CREDIT_DISPLAY[note.status as "DRAFT" | "ISSUED" | "VOID"];
  return { total, applied, unused, display };
}
