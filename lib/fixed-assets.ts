import "server-only";
import { prisma } from "./prisma";
import { num, round2 } from "./money";
import { formatDate } from "./format";
import { removeEntry, replaceEntry } from "./ledger";
import { ensureSystemAccount } from "./fx";
import { lockMessage } from "./period-lock";
import { addMonths, depreciationForMonth, lastDayOfMonth, monthKey, monthLabel, monthNumber, type Terms } from "./depreciation";
import type { FixedAsset, AssetDepreciation } from "./generated/prisma/client";

type Business = { id: string; lockedThrough: Date | null };
type AssetWithRows = FixedAsset & { depreciations: Pick<AssetDepreciation, "month" | "amount">[] };

export const termsOf = (a: FixedAsset): Terms => ({
  cost: num(a.cost),
  salvage: num(a.salvageValue),
  method: a.method,
  lifeMonths: a.usefulLifeMonths,
  annualRate: a.annualRate === null ? null : num(a.annualRate),
  prior: num(a.priorDepreciation),
});

// Where an asset stands: written off so far (prior depreciation included) and what is left on the books.
export function positionOf(a: AssetWithRows) {
  const posted = round2(a.depreciations.reduce((s, d) => s + num(d.amount), 0));
  const accumulated = round2(num(a.priorDepreciation) + posted);
  const last = a.depreciations.reduce<Date | null>((m, d) => (m === null || d.month > m ? d.month : m), null);
  return { posted, accumulated, netBookValue: round2(num(a.cost) - accumulated), lastMonth: last };
}

export async function nextAssetNumber(businessId: string): Promise<string> {
  const rows = await prisma.fixedAsset.findMany({ where: { businessId, number: { startsWith: "FA-" } }, select: { number: true } });
  const max = rows.reduce((m, r) => Math.max(m, Number(r.number.slice(3)) || 0), 0);
  return `FA-${String(max + 1).padStart(4, "0")}`;
}

// The accounts depreciation is posted to. Made the first time they are needed, and by visiting the register so they
// can be given opening balances.
export async function ensureAssetAccounts(businessId: string) {
  const [accumulated, expense, disposal] = await Promise.all([
    ensureSystemAccount(businessId, "ACCUM_DEPRECIATION"),
    ensureSystemAccount(businessId, "DEPRECIATION_EXPENSE"),
    ensureSystemAccount(businessId, "ASSET_DISPOSAL"),
  ]);
  return { accumulated, expense, disposal };
}

export type PlannedMonth = { asset: AssetWithRows; month: Date; amount: number };

// The depreciation that would be booked to bring every active asset (or one) up to the end of a month: each asset
// continues from the month after its last booking, or from its first month. Stops once an asset is fully depreciated.
export function planDepreciation(assets: AssetWithRows[], through: Date, onlyAssetId?: string): PlannedMonth[] {
  const plan: PlannedMonth[] = [];
  for (const asset of assets) {
    if (asset.status !== "ACTIVE" || (onlyAssetId && asset.id !== onlyAssetId)) continue;
    const terms = termsOf(asset);
    const { accumulated: start, lastMonth } = positionOf(asset);
    let accumulated = start;
    let month = lastMonth ? addMonths(lastMonth, 1) : lastDayOfMonth(asset.depreciateFrom);
    for (let guard = 0; guard < 1200 && month.getTime() <= through.getTime(); guard += 1) {
      const amount = depreciationForMonth(terms, monthNumber(asset.depreciateFrom, month), accumulated);
      if (amount <= 0) break;
      plan.push({ asset, month, amount });
      accumulated = round2(accumulated + amount);
      month = addMonths(month, 1);
    }
  }
  return plan;
}

export const loadAssets = (businessId: string) =>
  prisma.fixedAsset.findMany({
    where: { businessId },
    include: { depreciations: { select: { month: true, amount: true }, orderBy: { month: "asc" } }, assetAccount: { select: { id: true, name: true, code: true } } },
    orderBy: { number: "asc" },
  });

// One journal entry per month holds that month's depreciation of every asset. It is rebuilt from the saved rows, so
// posting a month again never doubles it.
export async function postDepreciationMonth(businessId: string, month: Date) {
  const sourceId = `${businessId}:${monthKey(month)}`;
  const rows = await prisma.assetDepreciation.findMany({ where: { businessId, month }, include: { asset: { select: { number: true, name: true } } } });
  if (rows.length === 0) return removeEntry("DEPRECIATION", sourceId);
  const { accumulated, expense } = await ensureAssetAccounts(businessId);
  await replaceEntry(businessId, "DEPRECIATION", sourceId, {
    date: month,
    memo: `Depreciation for ${monthLabel(month)}`,
    lines: rows.flatMap((r) => {
      const amount = num(r.amount);
      const description = `${r.asset.number} ${r.asset.name}`;
      return [
        { accountId: expense, debit: amount, description },
        { accountId: accumulated, credit: amount, description },
      ];
    }),
  });
}

// The last day of the most recent month that has finished, which is as far as depreciation can be booked.
export function latestBookableMonth(today: Date): Date {
  const thisMonthEnd = lastDayOfMonth(today);
  return thisMonthEnd.getTime() <= today.getTime() ? thisMonthEnd : addMonths(thisMonthEnd, -1);
}

// Books depreciation up to the end of a month (every active asset, or one). Nothing is written if any month falls in
// closed books.
export async function runDepreciation(
  business: Business,
  through: Date,
  today: Date,
  onlyAssetId?: string
): Promise<{ error: string } | { months: number; amount: number; assets: number }> {
  if (through.getTime() > latestBookableMonth(today).getTime()) return { error: "Depreciation can only be booked up to the end of a month that has finished." };
  const plan = planDepreciation(await loadAssets(business.id), through, onlyAssetId);
  if (plan.length === 0) return { months: 0, amount: 0, assets: 0 };

  for (const month of new Set(plan.map((p) => p.month.getTime()))) {
    const locked = lockMessage(business, new Date(month));
    if (locked) return { error: `Depreciation for ${monthLabel(new Date(month))} falls in closed books. ${locked}` };
  }
  await prisma.assetDepreciation.createMany({
    data: plan.map((p) => ({ businessId: business.id, assetId: p.asset.id, month: p.month, amount: p.amount })),
    skipDuplicates: true,
  });
  const months = [...new Set(plan.map((p) => p.month.getTime()))].sort((a, b) => a - b).map((t) => new Date(t));
  for (const month of months) await postDepreciationMonth(business.id, month);
  return {
    months: months.length,
    amount: round2(plan.reduce((s, p) => s + p.amount, 0)),
    assets: new Set(plan.map((p) => p.asset.id)).size,
  };
}

// Takes back the depreciation of one month for every asset. Only the latest month of an asset can be taken back, so
// the months stay in order, and not after the asset was sold.
export async function undoDepreciationMonth(business: Business, month: Date): Promise<{ error: string } | { removed: number }> {
  const locked = lockMessage(business, month);
  if (locked) return { error: locked };
  const rows = await prisma.assetDepreciation.findMany({ where: { businessId: business.id, month }, include: { asset: { include: { depreciations: { select: { month: true } } } } } });
  if (rows.length === 0) return { error: `No depreciation was booked for ${monthLabel(month)}` };
  for (const r of rows) {
    if (r.asset.status === "DISPOSED") return { error: `${r.asset.name} has been sold. Undo its sale first.` };
    if (r.asset.depreciations.some((d) => d.month > month)) return { error: `${r.asset.name} has depreciation for a later month. Take back the latest month first.` };
  }
  await prisma.assetDepreciation.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  await postDepreciationMonth(business.id, month);
  return { removed: rows.length };
}

export type DisposalInput = { date: Date; proceeds: number; moneyAccountId: string | null };

// Sells or writes off an asset: depreciation is booked up to the month before the disposal month (none in the month
// itself), then the cost and accumulated depreciation come off the books, any money received goes in, and the difference
// from the book value is a gain or loss on sale.
export async function disposeAsset(business: Business, assetId: string, input: DisposalInput, today: Date): Promise<{ error: string } | { nbv: number; result: number }> {
  const asset = await prisma.fixedAsset.findFirst({ where: { id: assetId, businessId: business.id }, include: { depreciations: { select: { month: true, amount: true }, orderBy: { month: "asc" } } } });
  if (!asset) return { error: "Asset not found" };
  if (asset.status === "DISPOSED") return { error: "This asset has already been sold or written off" };
  if (input.date.getTime() < asset.purchaseDate.getTime()) return { error: "The sale cannot be before the purchase date" };
  if (input.date.getTime() > today.getTime()) return { error: "The date cannot be in the future" };
  const locked = lockMessage(business, input.date);
  if (locked) return { error: locked };
  if (input.proceeds < 0) return { error: "The amount received cannot be negative" };
  if (input.proceeds > 0 && !input.moneyAccountId) return { error: "Choose the account the money was paid into" };

  let moneyAccountId: string | null = null;
  if (input.proceeds > 0) {
    const account = await prisma.account.findFirst({ where: { id: input.moneyAccountId!, businessId: business.id, moneyKind: { not: null }, currency: null, isArchived: false } });
    if (!account) return { error: "Choose a bank, mobile money or cash account in your own currency" };
    moneyAccountId = account.id;
  }

  const disposalMonth = lastDayOfMonth(input.date);
  // Depreciation booked for the disposal month or later is taken back: none is charged in the month of sale.
  const stale = asset.depreciations.filter((d) => d.month.getTime() >= disposalMonth.getTime());
  for (const d of stale) {
    const message = lockMessage(business, d.month);
    if (message) return { error: `Depreciation for ${monthLabel(d.month)} is in closed books and would have to be taken back. ${message}` };
  }
  const before = addMonths(disposalMonth, -1);
  // Catching up the months before the sale (it may be years since depreciation was last run).
  const catchUp = planDepreciation(
    [{ ...asset, depreciations: asset.depreciations.filter((d) => d.month.getTime() < disposalMonth.getTime()) }],
    before
  );
  for (const month of new Set(catchUp.map((p) => p.month.getTime()))) {
    const message = lockMessage(business, new Date(month));
    if (message) return { error: `Depreciation for ${monthLabel(new Date(month))} must be booked before the sale but falls in closed books. ${message}` };
  }

  if (stale.length > 0) {
    await prisma.assetDepreciation.deleteMany({ where: { assetId, month: { gte: disposalMonth } } });
    for (const d of stale) await postDepreciationMonth(business.id, d.month);
  }
  if (catchUp.length > 0) {
    await prisma.assetDepreciation.createMany({
      data: catchUp.map((p) => ({ businessId: business.id, assetId, month: p.month, amount: p.amount })),
      skipDuplicates: true,
    });
    for (const month of [...new Set(catchUp.map((p) => p.month.getTime()))].map((t) => new Date(t))) await postDepreciationMonth(business.id, month);
  }

  const fresh = await prisma.fixedAsset.findUniqueOrThrow({ where: { id: assetId }, include: { depreciations: { select: { month: true, amount: true } } } });
  const { accumulated, netBookValue } = positionOf(fresh);
  const cost = num(asset.cost);
  const result = round2(input.proceeds - netBookValue);

  const { accumulated: accumulatedAccount, disposal } = await ensureAssetAccounts(business.id);
  await replaceEntry(business.id, "ASSET_DISPOSAL", assetId, {
    date: input.date,
    memo: `${input.proceeds > 0 ? "Sale" : "Write-off"} of ${asset.number} ${asset.name} (${formatDate(input.date)})`,
    lines: [
      ...(moneyAccountId ? [{ accountId: moneyAccountId, debit: input.proceeds }] : []),
      { accountId: accumulatedAccount, debit: accumulated },
      { accountId: asset.assetAccountId, credit: cost },
      ...(result > 0 ? [{ accountId: disposal, credit: result }] : result < 0 ? [{ accountId: disposal, debit: -result }] : []),
    ],
  });
  await prisma.fixedAsset.update({
    where: { id: assetId },
    data: { status: "DISPOSED", disposedAt: input.date, disposalProceeds: input.proceeds, proceedsAccountId: moneyAccountId },
  });
  return { nbv: netBookValue, result };
}

export async function undoDisposal(business: Business, assetId: string): Promise<{ error: string } | { ok: true }> {
  const asset = await prisma.fixedAsset.findFirst({ where: { id: assetId, businessId: business.id } });
  if (!asset || asset.status !== "DISPOSED") return { error: "This asset has not been sold" };
  const locked = lockMessage(business, asset.disposedAt);
  if (locked) return { error: locked };
  await removeEntry("ASSET_DISPOSAL", assetId);
  await prisma.fixedAsset.update({ where: { id: assetId }, data: { status: "ACTIVE", disposedAt: null, disposalProceeds: null, proceedsAccountId: null } });
  return { ok: true };
}
