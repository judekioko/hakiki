import "dotenv/config";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { accountIdsByKey, postReceipt, postSalesInvoice, removeEntry, replaceEntry } from "../lib/ledger";
import { assertOpen, isLocked, lockMessage, PeriodLockedError } from "../lib/period-lock";
import { balanceOf, bookTotals, day, dropBusiness, scratchBusiness, unbalancedEntries } from "./helpers";

describe("the ledger", () => {
  let businessId: string;
  let keys: Record<string, string>;

  before(async () => {
    businessId = (await scratchBusiness()).id;
    keys = await accountIdsByKey(businessId);
  });
  after(() => dropBusiness(businessId));

  it("refuses an entry that does not balance", async () => {
    await assert.rejects(
      replaceEntry(businessId, "MANUAL", "t-unbalanced", { date: day("2026-01-05"), memo: "bad", lines: [{ accountId: keys.CASH, debit: 100 }, { accountId: keys.SALES, credit: 90 }] }),
      /does not balance/
    );
    assert.equal(await prisma.journalEntry.count({ where: { sourceType: "MANUAL", sourceId: "t-unbalanced" } }), 0);
  });

  it("replaces an entry instead of adding to it", async () => {
    const lines = (amount: number) => [{ accountId: keys.CASH, debit: amount }, { accountId: keys.SALES, credit: amount }];
    await replaceEntry(businessId, "MANUAL", "t-replace", { date: day("2026-01-05"), memo: "first", lines: lines(100) });
    await replaceEntry(businessId, "MANUAL", "t-replace", { date: day("2026-01-05"), memo: "second", lines: lines(250) });
    assert.equal(await prisma.journalEntry.count({ where: { sourceType: "MANUAL", sourceId: "t-replace" } }), 1);
    assert.equal(await balanceOf(keys.CASH), 250);
    await removeEntry("MANUAL", "t-replace");
    assert.equal(await balanceOf(keys.CASH), 0);
  });

  it("drops zero lines and merges lines on the same account", async () => {
    await replaceEntry(businessId, "MANUAL", "t-merge", {
      date: day("2026-01-06"),
      memo: "merge",
      lines: [{ accountId: keys.CASH, debit: 40 }, { accountId: keys.CASH, debit: 60 }, { accountId: keys.AR, debit: 0 }, { accountId: keys.SALES, credit: 100 }],
    });
    const entry = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: "MANUAL", sourceId: "t-merge" }, include: { lines: true } });
    assert.equal(entry.lines.length, 2);
    await removeEntry("MANUAL", "t-merge");
  });

  it("settles an invoice with a receipt and keeps the books balanced", async () => {
    const customer = await prisma.customer.create({ data: { businessId, name: "Test Customer" } });
    const invoice = await prisma.salesInvoice.create({
      data: {
        businessId,
        customerId: customer.id,
        number: "INV-0001",
        issueDate: day("2026-02-01"),
        dueDate: day("2026-03-01"),
        status: "SENT",
        subtotal: 1000,
        taxTotal: 160,
        total: 1160,
        lines: { create: [{ description: "Goods", quantity: 1, unitPrice: 1000, taxRate: 16, accountId: keys.SALES, lineTotal: 1000, taxAmount: 160 }] },
      },
    });
    await postSalesInvoice(invoice.id);
    assert.equal(await balanceOf(keys.AR), 1160);
    assert.equal(await balanceOf(keys.SALES), -1000);
    assert.equal(await balanceOf(keys.VAT_OUT), -160);

    const receipt = await prisma.receipt.create({
      data: { businessId, customerId: customer.id, moneyAccountId: keys.BANK, source: "BANK", reference: "T-REC-1", receivedAt: day("2026-02-10"), amount: 1160, payer: "Test Customer" },
    });
    await prisma.receiptAllocation.create({ data: { receiptId: receipt.id, invoiceId: invoice.id, amount: 1160 } });
    await postReceipt(receipt.id);
    assert.equal(await balanceOf(keys.AR), 0);
    assert.equal(await balanceOf(keys.BANK), 1160);
    assert.equal((await bookTotals(businessId)).balanced, true);
    assert.equal((await unbalancedEntries(businessId)).length, 0);
  });

  it("will not write into closed books", async () => {
    await prisma.business.update({ where: { id: businessId }, data: { lockedThrough: day("2026-01-31") } });
    await assert.rejects(
      replaceEntry(businessId, "MANUAL", "t-locked", { date: day("2026-01-15"), memo: "late", lines: [{ accountId: keys.CASH, debit: 5 }, { accountId: keys.SALES, credit: 5 }] }),
      PeriodLockedError
    );
    // The day after the lock is open.
    await replaceEntry(businessId, "MANUAL", "t-open", { date: day("2026-02-01"), memo: "ok", lines: [{ accountId: keys.CASH, debit: 5 }, { accountId: keys.SALES, credit: 5 }] });
    await prisma.business.update({ where: { id: businessId }, data: { lockedThrough: null } });
    await removeEntry("MANUAL", "t-open");
  });
});

describe("period locking rules", () => {
  const locked = { lockedThrough: day("2026-03-31") };

  it("closes the lock day itself and everything before", () => {
    assert.equal(isLocked(locked, day("2026-03-31")), true);
    assert.equal(isLocked(locked, day("2026-03-01")), true);
    assert.equal(isLocked(locked, day("2026-04-01")), false);
  });

  it("is never locked when nothing is closed", () => {
    assert.equal(isLocked({ lockedThrough: null }, day("2020-01-01")), false);
    assert.equal(lockMessage({ lockedThrough: null }, day("2020-01-01")), null);
  });

  it("explains itself", () => {
    assert.match(lockMessage(locked, day("2026-02-01"))!, /closed through/);
    assert.throws(() => assertOpen(locked, day("2026-02-01")), PeriodLockedError);
    assert.doesNotThrow(() => assertOpen(locked, day("2026-04-02"), null));
  });
});
