import "server-only";
import { prisma } from "./prisma";
import { audit } from "./audit";
import { accountIdsByKey, postSalesInvoice } from "./ledger";
import { nextDocumentNumber, priceLines, totals } from "./document-lines";
import { openFrom } from "./period-lock";
import { runReceiptAutoMatch } from "./receipt-match";
import { occurrence, todayInNairobi, type Frequency } from "./recurrence";

const DAY_MS = 24 * 60 * 60 * 1000;
// Safety cap so a long-neglected weekly schedule cannot flood the books in one go.
const MAX_CATCH_UP = 24;

type Outcome = { invoiceId: string } | { error: string } | null;

// Issues the next invoice of a recurring schedule and advances it. The schedule is advanced first with a
// compare-and-set on runCount, so two people opening the app at once cannot issue the same invoice twice.
// issueOn overrides the invoice date (used by "issue now"); otherwise the scheduled date is used.
export async function issueRecurring(recurringId: string, issueOn?: Date): Promise<Outcome> {
  const rec = await prisma.recurringInvoice.findUnique({
    where: { id: recurringId },
    include: { lines: { orderBy: { position: "asc" } }, business: { select: { id: true, vatRegistered: true, lockedThrough: true } } },
  });
  if (!rec || rec.status !== "ACTIVE") return null;

  const nextCount = rec.runCount + 1;
  const next = occurrence(rec.startDate, rec.frequency as Frequency, rec.interval, nextCount);
  const ended = rec.endDate !== null && next.getTime() > rec.endDate.getTime();
  const claimed = await prisma.recurringInvoice.updateMany({
    where: { id: rec.id, runCount: rec.runCount, status: "ACTIVE" },
    data: { runCount: nextCount, nextRunDate: next, lastRunAt: new Date(), status: ended ? "ENDED" : "ACTIVE" },
  });
  if (claimed.count === 0) return null;

  const release = async (error: string): Promise<Outcome> => {
    await prisma.recurringInvoice.update({
      where: { id: rec.id },
      data: { runCount: rec.runCount, nextRunDate: rec.nextRunDate, status: "ACTIVE" },
    });
    return { error };
  };

  // An invoice cannot be dated inside closed books, so a catch-up invoice is dated the first open day instead.
  let issueDate = issueOn ?? rec.nextRunDate;
  if (rec.business.lockedThrough) {
    const firstOpen = new Date(openFrom(rec.business.lockedThrough).getTime() + 3 * 60 * 60 * 1000);
    if (issueDate.getTime() < firstOpen.getTime()) issueDate = firstOpen;
  }
  const dueDate = new Date(issueDate.getTime() + rec.dueDays * DAY_MS);

  const keys = await accountIdsByKey(rec.businessId);
  const priced = await priceLines(
    rec.businessId,
    rec.lines.map((l) => ({
      itemId: l.itemId,
      description: l.description,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      taxRateId: l.taxRateId,
      accountId: l.accountId,
    })),
    "sale",
    keys.SALES,
    rec.business.vatRegistered
  );
  if (priced.error) return release(priced.error);

  const invoice = await prisma.salesInvoice.create({
    data: {
      businessId: rec.businessId,
      customerId: rec.customerId,
      recurringInvoiceId: rec.id,
      number: await nextDocumentNumber(rec.businessId, "INV-"),
      status: rec.autoSend ? "SENT" : "DRAFT",
      issueDate,
      dueDate,
      reference: rec.reference,
      notes: rec.notes,
      ...totals(priced.lines!),
      lines: { create: priced.lines!.map((l) => ({ ...l })) },
    },
  });
  if (rec.autoSend) {
    try {
      await postSalesInvoice(invoice.id);
    } catch (error) {
      // Could not post (for example a reconciled period): keep it as a draft for someone to look at.
      await prisma.salesInvoice.update({ where: { id: invoice.id }, data: { status: "DRAFT" } });
      console.error("Recurring invoice left as draft", error);
    }
    await runReceiptAutoMatch(rec.businessId);
  }
  await audit(
    rec.businessId,
    "CREATE",
    "RECURRING",
    rec.id,
    `Recurring schedule issued invoice ${invoice.number} (${rec.autoSend ? "sent" : "draft"})`
  );
  return { invoiceId: invoice.id };
}

// Catches up every schedule that is due. Called when people open the app and by the cron endpoint.
export async function runDueRecurring(businessId?: string): Promise<number> {
  const today = todayInNairobi();
  const due = await prisma.recurringInvoice.findMany({
    where: { status: "ACTIVE", nextRunDate: { lte: today }, ...(businessId ? { businessId } : {}) },
    select: { id: true },
  });
  let issued = 0;
  for (const { id } of due) {
    for (let i = 0; i < MAX_CATCH_UP; i++) {
      const rec = await prisma.recurringInvoice.findUnique({ where: { id }, select: { status: true, nextRunDate: true } });
      if (!rec || rec.status !== "ACTIVE" || rec.nextRunDate.getTime() > today.getTime()) break;
      const result = await issueRecurring(id);
      if (!result || "error" in result) break;
      issued++;
    }
  }
  return issued;
}
