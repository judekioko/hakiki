import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { businessContext, moneyAccountOptions } from "@/lib/form-options";
import { formatDate, toDateInput } from "@/lib/format";
import { num, round2 } from "@/lib/money";
import { todayInNairobi } from "@/lib/recurrence";
import { addMonths, lastDayOfMonth, monthLabel, monthNumber, projectedSchedule } from "@/lib/depreciation";
import { positionOf, termsOf } from "@/lib/fixed-assets";
import { deleteAsset, runDepreciationAction, undoDisposalAction } from "@/lib/actions/fixed-assets";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/stat-card";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { SubmitButton } from "@/components/forms";
import { AssetForm, DisposeForm } from "@/components/fixed-asset-forms";

export const metadata = { title: "Fixed asset" };

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { business } = await requireBusiness();
  const { fmt } = businessContext(business);
  const canManage = business.role !== "STAFF";
  const asset = await prisma.fixedAsset.findFirst({
    where: { id, businessId: business.id },
    include: {
      depreciations: { select: { month: true, amount: true }, orderBy: { month: "asc" } },
      assetAccount: { select: { name: true } },
      proceedsAccount: { select: { name: true } },
    },
  });
  if (!asset) notFound();

  const today = todayInNairobi();
  const position = positionOf(asset);
  const terms = termsOf(asset);
  const disposed = asset.status === "DISPOSED";
  const nextMonth = position.lastMonth ? addMonths(position.lastMonth, 1) : lastDayOfMonth(asset.depreciateFrom);
  const future = disposed ? [] : projectedSchedule(terms, nextMonth, monthNumber(asset.depreciateFrom, nextMonth), position.accumulated);
  const shown = future.slice(0, 24);

  const posted = asset.depreciations.reduce<{ month: Date; amount: number; accumulated: number }[]>((rows, d) => {
    const before = rows.length > 0 ? rows[rows.length - 1].accumulated : num(asset.priorDepreciation);
    return [...rows, { month: d.month, amount: num(d.amount), accumulated: round2(before + num(d.amount)) }];
  }, []);

  const [assetAccounts, moneyAccounts] = await Promise.all([
    prisma.account.findMany({
      where: { businessId: business.id, type: "ASSET", moneyKind: null, systemKey: null, isArchived: false },
      orderBy: { code: "asc" },
      select: { id: true, name: true },
    }),
    moneyAccountOptions(business.id, { baseOnly: true }),
  ]);
  const result = disposed ? round2(num(asset.disposalProceeds) - (num(asset.cost) - position.accumulated)) : 0;
  const monthly = asset.method === "STRAIGHT_LINE" ? round2((num(asset.cost) - num(asset.salvageValue)) / (asset.usefulLifeMonths ?? 1)) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${asset.number} · ${asset.name}`}
        description={`${asset.assetAccount.name} · bought ${formatDate(asset.purchaseDate)}`}
        action={
          <div className="flex items-center gap-2">
            {disposed ? <Badge>{num(asset.disposalProceeds) > 0 ? "Sold" : "Written off"}</Badge> : <Badge tone="teal">In use</Badge>}
            <Link href="/app/assets" className="text-sm text-teal-700 hover:underline">
              All assets
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Cost" value={fmt(num(asset.cost))} hint={num(asset.salvageValue) > 0 ? `Value left at the end: ${fmt(num(asset.salvageValue))}` : undefined} />
        <StatCard label="Written off so far" value={fmt(position.accumulated)} />
        <StatCard
          label={disposed ? "Gain or loss on sale" : "Book value"}
          value={disposed ? `${result >= 0 ? "Gain" : "Loss"} ${fmt(Math.abs(result))}` : fmt(position.netBookValue)}
        />
      </div>

      {disposed ? (
        <Card>
          <CardBody className="space-y-2 text-sm text-slate-600">
            <p>
              {num(asset.disposalProceeds) > 0
                ? `Sold on ${formatDate(asset.disposedAt!)} for ${fmt(num(asset.disposalProceeds))}${asset.proceedsAccount ? `, paid into ${asset.proceedsAccount.name}` : ""}.`
                : `Written off on ${formatDate(asset.disposedAt!)}.`}{" "}
              {result === 0 ? "There was no gain or loss." : `That is a ${result > 0 ? "gain" : "loss"} of ${fmt(Math.abs(result))} against its book value.`}
            </p>
            {canManage ? (
              <form action={undoDisposalAction}>
                <input type="hidden" name="assetId" value={asset.id} />
                <SubmitButton variant="secondary" size="sm" pendingText="Undoing...">
                  Undo the sale
                </SubmitButton>
              </form>
            ) : null}
          </CardBody>
        </Card>
      ) : canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Depreciation</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-sm text-slate-600">
            <p>
              {asset.method === "STRAIGHT_LINE"
                ? `Straight line over ${asset.usefulLifeMonths} months (${fmt(monthly)} a month).`
                : `Reducing balance at ${num(asset.annualRate)}% a year.`}{" "}
              Starting {monthLabel(lastDayOfMonth(asset.depreciateFrom))}.
            </p>
            <form action={runDepreciationAction}>
              <input type="hidden" name="assetId" value={asset.id} />
              <SubmitButton variant="secondary" size="sm" pendingText="Booking...">
                Book this asset&apos;s depreciation up to last month
              </SubmitButton>
            </form>
          </CardBody>
        </Card>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-700">Depreciation schedule</h2>
        {posted.length === 0 && shown.length === 0 && num(asset.priorDepreciation) === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Nothing to depreciate.</p>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Month</Th>
                <Th className="text-right">Depreciation</Th>
                <Th className="text-right">Written off in total</Th>
                <Th className="text-right">Book value</Th>
                <Th>Status</Th>
              </Tr>
            </Thead>
            <Tbody>
              {num(asset.priorDepreciation) > 0 ? (
                <Tr>
                  <Td>Before this register</Td>
                  <Td className="text-right">{fmt(num(asset.priorDepreciation))}</Td>
                  <Td className="text-right">{fmt(num(asset.priorDepreciation))}</Td>
                  <Td className="text-right">{fmt(round2(num(asset.cost) - num(asset.priorDepreciation)))}</Td>
                  <Td>
                    <Badge>In opening balances</Badge>
                  </Td>
                </Tr>
              ) : null}
              {posted.map((p) => (
                <Tr key={p.month.toISOString()}>
                  <Td>{monthLabel(p.month)}</Td>
                  <Td className="text-right">{fmt(p.amount)}</Td>
                  <Td className="text-right">{fmt(p.accumulated)}</Td>
                  <Td className="text-right">{fmt(round2(num(asset.cost) - p.accumulated))}</Td>
                  <Td>
                    <Badge tone="teal">Booked</Badge>
                  </Td>
                </Tr>
              ))}
              {shown.map((p) => (
                <Tr key={p.month.toISOString()} className="text-slate-400">
                  <Td>{monthLabel(p.month)}</Td>
                  <Td className="text-right">{fmt(p.amount)}</Td>
                  <Td className="text-right">{fmt(p.accumulated)}</Td>
                  <Td className="text-right">{fmt(round2(num(asset.cost) - p.accumulated))}</Td>
                  <Td>{p.month.getTime() <= today.getTime() ? <Badge tone="amber">Due</Badge> : <Badge>Coming</Badge>}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
        {future.length > shown.length ? <p className="text-xs text-slate-500">…and {future.length - shown.length} more months until it is fully depreciated.</p> : null}
      </section>

      {canManage && !disposed ? (
        <Card>
          <CardHeader>
            <CardTitle>Sell or write off</CardTitle>
          </CardHeader>
          <CardBody>
            <DisposeForm
              assetId={asset.id}
              today={toDateInput(today)}
              currency={business.currency}
              bookValue={position.netBookValue}
              moneyAccounts={moneyAccounts.map((a) => ({ id: a.id, name: a.name }))}
            />
            <p className="mt-3 text-xs text-slate-500">
              No depreciation is charged in the month of the sale. If you will be paid later, record the sale when the money arrives.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {canManage && !disposed ? (
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardBody>
            <AssetForm
              accounts={assetAccounts}
              currency={business.currency}
              today={toDateInput(today)}
              defaults={{
                id: asset.id,
                name: asset.name,
                notes: asset.notes,
                assetAccountId: asset.assetAccountId,
                purchaseDate: toDateInput(asset.purchaseDate),
                cost: num(asset.cost),
                salvageValue: num(asset.salvageValue),
                method: asset.method,
                usefulLifeMonths: asset.usefulLifeMonths,
                annualRate: asset.annualRate === null ? null : num(asset.annualRate),
                depreciateFrom: toDateInput(asset.depreciateFrom),
                priorDepreciation: num(asset.priorDepreciation),
                locked: asset.depreciations.length > 0,
              }}
            />
          </CardBody>
        </Card>
      ) : null}

      {canManage && !disposed && asset.depreciations.length === 0 ? (
        <form action={deleteAsset}>
          <input type="hidden" name="assetId" value={asset.id} />
          <SubmitButton variant="ghost" size="sm" pendingText="Deleting...">
            Delete this asset
          </SubmitButton>
        </form>
      ) : null}
    </div>
  );
}
