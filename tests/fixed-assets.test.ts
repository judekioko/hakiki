import "dotenv/config";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { disposeAsset, runDepreciation, undoDepreciationMonth, undoDisposal } from "../lib/fixed-assets";
import { replaceEntry } from "../lib/ledger";
import { accountByKey, accountByName, balanceOf, bookTotals, day, dropBusiness, scratchBusiness, unbalancedEntries } from "./helpers";

const today = day("2026-10-10");

describe("fixed assets", () => {
  let businessId: string;
  let equipmentId: string;
  let bankId: string;
  let assetId: string;
  const open = () => ({ id: businessId, lockedThrough: null as Date | null });

  before(async () => {
    const business = await scratchBusiness();
    businessId = business.id;
    equipmentId = (await accountByName(businessId, "Equipment & furniture")).id;
    bankId = (await accountByKey(businessId, "BANK")).id;
    const asset = await prisma.fixedAsset.create({
      data: {
        businessId,
        number: "FA-0001",
        name: "Delivery van",
        assetAccountId: equipmentId,
        purchaseDate: day("2026-01-15"),
        cost: 120000,
        depreciateFrom: day("2026-01-01"),
        usefulLifeMonths: 60,
      },
    });
    assetId = asset.id;
    // The purchase itself: cost of the van against the owner's capital.
    await replaceEntry(businessId, "MANUAL", "t-purchase", {
      date: day("2026-01-15"),
      memo: "Bought a delivery van",
      lines: [{ accountId: equipmentId, debit: 120000 }, { accountId: (await accountByKey(businessId, "CAPITAL")).id, credit: 120000 }],
    });
  });
  after(() => dropBusiness(businessId));

  it("books a month of depreciation at a time, each month balanced", async () => {
    const result = await runDepreciation(open(), day("2026-09-30"), today);
    assert.deepEqual(result, { months: 9, amount: 18000, assets: 1 });
    const entries = await prisma.journalEntry.findMany({ where: { businessId, sourceType: "DEPRECIATION" } });
    assert.equal(entries.length, 9);
    assert.equal((await unbalancedEntries(businessId)).length, 0);
    assert.equal(await balanceOf((await accountByKey(businessId, "ACCUM_DEPRECIATION")).id), -18000);
    assert.equal(await balanceOf((await accountByKey(businessId, "DEPRECIATION_EXPENSE")).id), 18000);
  });

  it("does nothing the second time", async () => {
    const result = await runDepreciation(open(), day("2026-09-30"), today);
    assert.equal("months" in result && result.months, 0);
    assert.equal(await prisma.journalEntry.count({ where: { businessId, sourceType: "DEPRECIATION" } }), 9);
  });

  it("will not book a month that has not finished", async () => {
    assert.ok("error" in (await runDepreciation(open(), day("2026-10-31"), today)));
  });

  it("only takes back the latest month", async () => {
    assert.ok("error" in (await undoDepreciationMonth(open(), day("2026-03-31"))));
    const undone = await undoDepreciationMonth(open(), day("2026-09-30"));
    assert.deepEqual(undone, { removed: 1 });
    assert.equal(await prisma.journalEntry.count({ where: { businessId, sourceType: "DEPRECIATION" } }), 8);
    await runDepreciation(open(), day("2026-09-30"), today);
    assert.equal(await prisma.journalEntry.count({ where: { businessId, sourceType: "DEPRECIATION" } }), 9);
  });

  it("refuses to write anything into closed books", async () => {
    const other = await prisma.fixedAsset.create({
      data: {
        businessId,
        number: "FA-0002",
        name: "Old generator",
        assetAccountId: equipmentId,
        purchaseDate: day("2025-11-05"),
        cost: 60000,
        depreciateFrom: day("2025-11-01"),
        usefulLifeMonths: 60,
      },
    });
    const result = await runDepreciation({ id: businessId, lockedThrough: day("2025-12-31") }, day("2026-09-30"), today, other.id);
    assert.ok("error" in result && /closed/.test(result.error));
    assert.equal(await prisma.assetDepreciation.count({ where: { assetId: other.id } }), 0);
    await prisma.fixedAsset.delete({ where: { id: other.id } });
  });

  it("books a sale at a loss, charging no depreciation in the month of the sale", async () => {
    // Sold in August: depreciation stops at July (7 months), so book value is 120000 - 14000.
    const result = await disposeAsset(open(), assetId, { date: day("2026-08-20"), proceeds: 100000, moneyAccountId: bankId }, today);
    assert.deepEqual(result, { nbv: 106000, result: -6000 });
    assert.equal(await prisma.assetDepreciation.count({ where: { assetId } }), 7);

    const entry = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: "ASSET_DISPOSAL", sourceId: assetId }, include: { lines: { include: { account: true } } } });
    const net = (name: string) => entry.lines.filter((l) => l.account.name === name).reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
    assert.equal(net("Bank account"), 100000);
    assert.equal(net("Accumulated depreciation"), 14000);
    assert.equal(net("Equipment & furniture"), -120000);
    assert.equal(net("Gain or loss on sale of assets"), 6000);
    // After the sale nothing is left on the books for this asset.
    assert.equal(await balanceOf(equipmentId), 0);
    assert.equal(await balanceOf((await accountByKey(businessId, "ACCUM_DEPRECIATION")).id), 0);
  });

  it("does not depreciate a sold asset", async () => {
    const result = await runDepreciation(open(), day("2026-09-30"), today);
    assert.equal("months" in result && result.months, 0);
  });

  it("can undo a sale, and depreciation then catches up", async () => {
    assert.ok("ok" in (await undoDisposal(open(), assetId)));
    assert.equal(await prisma.journalEntry.count({ where: { sourceType: "ASSET_DISPOSAL", sourceId: assetId } }), 0);
    const catchUp = await runDepreciation(open(), day("2026-09-30"), today);
    assert.deepEqual(catchUp, { months: 2, amount: 4000, assets: 1 });
  });

  it("books a gain when it sells above book value", async () => {
    const result = await disposeAsset(open(), assetId, { date: day("2026-10-05"), proceeds: 110000, moneyAccountId: bankId }, today);
    assert.deepEqual(result, { nbv: 102000, result: 8000 });
    assert.equal(await balanceOf((await accountByKey(businessId, "ASSET_DISPOSAL")).id), -8000);
    await undoDisposal(open(), assetId);
  });

  it("writes an asset off with nothing received", async () => {
    const result = await disposeAsset(open(), assetId, { date: day("2026-10-05"), proceeds: 0, moneyAccountId: null }, today);
    assert.deepEqual(result, { nbv: 102000, result: -102000 });
  });

  it("will not sell into closed books or with money but no account", async () => {
    await undoDisposal(open(), assetId);
    const closed = await disposeAsset({ id: businessId, lockedThrough: day("2026-09-30") }, assetId, { date: day("2026-09-15"), proceeds: 1, moneyAccountId: bankId }, today);
    assert.ok("error" in closed);
    const noAccount = await disposeAsset(open(), assetId, { date: day("2026-10-05"), proceeds: 500, moneyAccountId: null }, today);
    assert.ok("error" in noAccount);
  });

  it("keeps the books balanced throughout", async () => {
    assert.equal((await bookTotals(businessId)).balanced, true);
    assert.equal((await unbalancedEntries(businessId)).length, 0);
  });
});
