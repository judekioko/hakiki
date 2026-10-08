"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { audit } from "@/lib/audit";
import { formatDate } from "@/lib/format";
import type { ActionState } from "./types";

// Sets or clears the date the books are closed through. Closing is for owners and accountants; moving the date
// back (reopening a period) is for owners only. Every change is written to the audit trail.
export async function setLockDate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  if (business.role === "STAFF") return { error: "Only an owner or accountant can close the books" };

  const clearing = formData.get("intent") === "reopen";
  const current = business.lockedThrough;
  let next: Date | null = null;

  if (!clearing) {
    const value = String(formData.get("lockedThrough") ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { error: "Choose the last day to close" };
    next = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(next.getTime())) return { error: "Choose a valid date" };
    if (next.getTime() > Date.now()) return { error: "You can only close days that have already passed" };
  }

  const reopening = current !== null && (next === null || next.getTime() < current.getTime());
  if (reopening && business.role !== "OWNER") return { error: "Only the business owner can reopen a closed period" };
  if (current && next && current.getTime() === next.getTime()) return { error: "The books are already closed through that date" };
  if (!current && !next) return { error: "The books are not closed" };

  await prisma.business.update({ where: { id: business.id }, data: { lockedThrough: next } });
  await audit(
    business.id,
    "UPDATE",
    "PERIOD_LOCK",
    business.id,
    next
      ? `${reopening ? "Moved" : "Closed"} the books ${reopening ? "back to" : "through"} ${formatDate(next)}${current ? ` (was ${formatDate(current)})` : ""}`
      : `Reopened all periods (books had been closed through ${formatDate(current!)})`
  );
  revalidatePath("/app", "layout");
  return { success: next ? `Books closed through ${formatDate(next)}` : "All periods reopened" };
}
