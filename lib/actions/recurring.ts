"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { audit } from "@/lib/audit";
import { describeSchedule, todayInNairobi, type Frequency } from "@/lib/recurrence";
import { issueRecurring } from "@/lib/recurring";
import { firstError, linesSchema, parseJsonField, recurringSchema } from "@/lib/validators";
import type { ActionState } from "./types";

function revalidateAll() {
  revalidatePath("/app", "layout");
}

// The form offers "quarterly" as a choice; it is stored as every 3 months.
function scheduleFrom(frequency: string, interval: number): { frequency: Frequency; interval: number } {
  if (frequency === "QUARTERLY") return { frequency: "MONTHLY", interval: 3 * interval };
  return { frequency: frequency as Frequency, interval };
}

export async function saveRecurring(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const parsed = recurringSchema.safeParse({
    customerId: formData.get("customerId") ?? "",
    frequency: formData.get("frequency"),
    interval: formData.get("interval") || 1,
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate") ?? "",
    dueDays: formData.get("dueDays") || 0,
    reference: formData.get("reference") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const data = parsed.data;
  if (data.endDate && data.endDate < data.startDate) return { error: "The end date cannot be before the start date" };

  const customer = await prisma.customer.findFirst({ where: { id: data.customerId, businessId: business.id } });
  if (!customer) return { error: "Customer not found" };
  const lineInput = parseJsonField(formData.get("lines"), linesSchema);
  if (lineInput.error) return { error: lineInput.error };

  // Items and accounts are checked here; the lines are priced each time an invoice is issued.
  const itemIds = lineInput.data!.map((l) => l.itemId).filter((v): v is string => !!v);
  if (itemIds.length && (await prisma.item.count({ where: { id: { in: itemIds }, businessId: business.id } })) !== new Set(itemIds).size) {
    return { error: "One of the items was not found" };
  }

  const schedule = scheduleFrom(data.frequency, data.interval);
  const recurringId = String(formData.get("recurringId") ?? "");
  const startDate = new Date(`${data.startDate}T00:00:00Z`);
  const lineRows = lineInput.data!.map((l, position) => ({
    itemId: l.itemId || null,
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    taxRateId: l.taxRateId || null,
    accountId: l.accountId || null,
    position,
  }));
  const header = {
    customerId: customer.id,
    ...schedule,
    endDate: data.endDate ? new Date(`${data.endDate}T00:00:00Z`) : null,
    dueDays: data.dueDays,
    autoSend: formData.get("autoSend") === "on",
    reference: data.reference ?? null,
    notes: data.notes ?? null,
  };

  let id: string;
  if (recurringId) {
    const existing = await prisma.recurringInvoice.findFirst({ where: { id: recurringId, businessId: business.id } });
    if (!existing) return { error: "Recurring invoice not found" };
    // Changing the start date or frequency restarts the schedule counting from the new start.
    const restart =
      existing.startDate.getTime() !== startDate.getTime() ||
      existing.frequency !== schedule.frequency ||
      existing.interval !== schedule.interval;
    await prisma.$transaction([
      prisma.recurringInvoiceLine.deleteMany({ where: { recurringId } }),
      prisma.recurringInvoice.update({
        where: { id: recurringId },
        data: {
          ...header,
          ...(restart ? { startDate, nextRunDate: startDate, runCount: 0, status: "ACTIVE" as const } : {}),
          lines: { create: lineRows },
        },
      }),
    ]);
    id = recurringId;
  } else {
    const created = await prisma.recurringInvoice.create({
      data: { businessId: business.id, ...header, startDate, nextRunDate: startDate, lines: { create: lineRows } },
    });
    id = created.id;
  }
  await audit(
    business.id,
    recurringId ? "UPDATE" : "CREATE",
    "RECURRING",
    id,
    `${recurringId ? "Edited" : "Created"} recurring invoice for ${customer.name} (${describeSchedule(schedule.frequency, schedule.interval).toLowerCase()})`
  );
  revalidateAll();
  redirect(`/app/sales/recurring/${id}`);
}

async function owned(businessId: string, formData: FormData) {
  return prisma.recurringInvoice.findFirst({
    where: { id: String(formData.get("recurringId")), businessId },
    include: { customer: { select: { name: true } } },
  });
}

export async function pauseRecurring(formData: FormData) {
  const { business } = await requireBusiness();
  const rec = await owned(business.id, formData);
  if (!rec || rec.status !== "ACTIVE") return;
  await prisma.recurringInvoice.update({ where: { id: rec.id }, data: { status: "PAUSED" } });
  await audit(business.id, "UPDATE", "RECURRING", rec.id, `Paused recurring invoice for ${rec.customer.name}`);
  revalidateAll();
}

// Resuming skips the runs missed while paused: the schedule picks up from the next date on or after today.
export async function resumeRecurring(formData: FormData) {
  const { business } = await requireBusiness();
  const rec = await owned(business.id, formData);
  if (!rec || rec.status !== "PAUSED") return;
  const { occurrence } = await import("@/lib/recurrence");
  const today = todayInNairobi();
  let count = rec.runCount;
  let next = rec.nextRunDate;
  while (next.getTime() < today.getTime() && count < rec.runCount + 5000) {
    count++;
    next = occurrence(rec.startDate, rec.frequency as Frequency, rec.interval, count);
  }
  const ended = rec.endDate !== null && next.getTime() > rec.endDate.getTime();
  await prisma.recurringInvoice.update({
    where: { id: rec.id },
    data: { status: ended ? "ENDED" : "ACTIVE", runCount: count, nextRunDate: next },
  });
  await audit(business.id, "UPDATE", "RECURRING", rec.id, `Resumed recurring invoice for ${rec.customer.name}`);
  revalidateAll();
}

export async function endRecurring(formData: FormData) {
  const { business } = await requireBusiness();
  const rec = await owned(business.id, formData);
  if (!rec || rec.status === "ENDED") return;
  await prisma.recurringInvoice.update({ where: { id: rec.id }, data: { status: "ENDED" } });
  await audit(business.id, "UPDATE", "RECURRING", rec.id, `Ended recurring invoice for ${rec.customer.name}`);
  revalidateAll();
}

// Issues the next scheduled invoice now, dated today, and moves the schedule on.
export async function issueRecurringNow(formData: FormData) {
  const { business } = await requireBusiness();
  const rec = await owned(business.id, formData);
  if (!rec || rec.status !== "ACTIVE") return;
  const result = await issueRecurring(rec.id, todayInNairobi());
  revalidateAll();
  if (result && "invoiceId" in result) redirect(`/app/sales/invoices/${result.invoiceId}`);
  if (result && "error" in result) throw new Error(result.error);
}

export async function deleteRecurring(formData: FormData) {
  const { business } = await requireBusiness();
  const rec = await owned(business.id, formData);
  if (!rec) return;
  // Invoices already issued stay; they just lose the link to the template.
  await prisma.recurringInvoice.delete({ where: { id: rec.id } });
  await audit(business.id, "DELETE", "RECURRING", rec.id, `Deleted recurring invoice for ${rec.customer.name}`);
  revalidateAll();
  redirect("/app/sales/recurring");
}
