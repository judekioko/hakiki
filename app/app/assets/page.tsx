import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { businessContext } from "@/lib/form-options";
import { formatDate } from "@/lib/format";
import { num, round2 } from "@/lib/money";
import { todayInNairobi } from "@/lib/recurrence";
import { lastDayOfMonth, monthKey, monthLabel } from "@/lib/depreciation";
import { ensureAssetAccounts, latestBookableMonth, loadAssets, planDepreciation, positionOf } from "@/lib/fixed-assets";
import { runDepreciationAction, undoDepreciationAction } from "@/lib/actions/fixed-assets";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/stat-card";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { EmptyState, LinkButton } from "@/components/bits";
import { SubmitButton } from "@/components/forms";

export const metadata = { title: "Fixed assets" };

export default async function AssetsPage({ searchParams }: { searchParams: Promise<{ through?: string }> }) {
  const { business } = await requireBusiness();
  const { fmt } = businessContext(business);
  const canManage = business.role !== "STAFF";
  const today = todayInNairobi();
  const accounts = await ensureAssetAccounts(business.id);
  const assets = await loadAssets(business.id);

  const bookable = latestBookableMonth(today);
  const { through: throughParam } = await searchParams;
  const picked = throughParam && /^\d{4}-\d{2}$/.test(throughParam) ? lastDayOfMonth(new Date(`${throughParam}-01T00:00:00Z`)) : bookable;
  const through = picked.getTime() > bookable.getTime() ? bookable : picked;
  const plan = planDepreciation(assets, through);
  const planMonths = new Set(plan.map((p) => p.month.getTime())).size;
  const planTotal = round2(plan.reduce((s, p) => s + p.amount, 0));

  const rows = assets.map((a) => ({ asset: a, ...positionOf(a) }));
  const active = rows.filter((r) => r.asset.status === "ACTIVE");
  const totalCost = round2(active.reduce((s, r) => s + num(r.asset.cost), 0));
  const totalAccumulated = round2(active.reduce((s, r) => s + r.accumulated, 0));

  // Does the register agree with the ledger? Cost by asset account, and the accumulated depreciation account.
  const accountIds = [...new Set([...active.map((r) => r.asset.assetAccountId), accounts.accumulated])];
  const sums = await prisma.journalLine.groupBy({ by: ["accountId"], where: { accountId: { in: accountIds }, entry: { businessId: business.id } }, _sum: { debit: true, credit: true } });
  const ledger = new Map(sums.map((s) => [s.accountId, round2(num(s._sum.debit) - num(s._sum.credit))]));
  const checks = [
    ...[...new Set(active.map((r) => r.asset.assetAccountId))].map((id) => {
      const first = active.find((r) => r.asset.assetAccountId === id)!.asset;
      const registered = round2(active.filter((r) => r.asset.assetAccountId === id).reduce((s, r) => s + num(r.asset.cost), 0));
      return { label: first.assetAccount.name, registered, books: ledger.get(id) ?? 0 };
    }),
    ...(active.length > 0 ? [{ label: "Accumulated depreciation", registered: -totalAccumulated, books: ledger.get(accounts.accumulated) ?? 0 }] : []),
  ];
  const mismatched = checks.filter((c) => Math.abs(c.registered - c.books) > 0.005);

  // Months with depreciation booked, newest first.
  const booked = new Map<string, { month: Date; total: number; assets: number }>();
  for (const a of assets) {
    for (const d of a.depreciations) {
      const key = monthKey(d.month);
      const row = booked.get(key) ?? { month: d.month, total: 0, assets: 0 };
      row.total = round2(row.total + num(d.amount));
      row.assets += 1;
      booked.set(key, row);
    }
  }
  const months = [...booked.values()].sort((a, b) => b.month.getTime() - a.month.getTime()).slice(0, 12);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fixed assets"
        description="Vehicles, equipment, furniture and other things you keep for years. Their cost is written off month by month instead of all at once."
        action={canManage ? <LinkButton href="/app/assets/new">Add an asset</LinkButton> : undefined}
      />

      {assets.length === 0 ? (
        <EmptyState title="No fixed assets yet">
          <p>
            Record the purchase first (a bill, or a payment to an asset account such as Equipment & furniture), then add it here so its depreciation is booked every
            month. For things you already own, put their cost and past depreciation in Opening balances.
          </p>
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Cost of assets in use" value={fmt(totalCost)} hint={`${active.length} asset${active.length === 1 ? "" : "s"}`} />
            <StatCard label="Written off so far" value={fmt(totalAccumulated)} />
            <StatCard label="Book value" value={fmt(round2(totalCost - totalAccumulated))} />
          </div>

          {mismatched.length > 0 ? (
            <Card>
              <CardBody className="space-y-2 text-sm">
                <p className="font-medium text-amber-800">The register and your books do not agree</p>
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Account</Th>
                      <Th className="text-right">Register</Th>
                      <Th className="text-right">Books</Th>
                      <Th className="text-right">Difference</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {mismatched.map((c) => (
                      <Tr key={c.label}>
                        <Td>{c.label}</Td>
                        <Td className="text-right">{fmt(c.registered)}</Td>
                        <Td className="text-right">{fmt(c.books)}</Td>
                        <Td className="text-right">{fmt(round2(c.books - c.registered))}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
                <p className="text-xs text-slate-500">
                  Usually the cost has not been recorded yet (add the bill or payment), or the depreciation already booked in an older system is missing from Opening
                  balances. Other things posted to the same accounts will also show here.
                </p>
              </CardBody>
            </Card>
          ) : null}

          {canManage ? (
            <Card>
              <CardHeader>
                <CardTitle>Book depreciation</CardTitle>
              </CardHeader>
              <CardBody className="space-y-3">
                <form method="get" className="flex flex-wrap items-end gap-3">
                  <label className="text-xs text-slate-500">
                    Up to the end of
                    <Input name="through" type="month" defaultValue={monthKey(through)} max={monthKey(bookable)} className="mt-1" />
                  </label>
                  <Button type="submit" variant="secondary" size="sm">
                    Preview
                  </Button>
                </form>
                {plan.length === 0 ? (
                  <p className="text-sm text-slate-600">Depreciation is up to date through {monthLabel(through)}.</p>
                ) : (
                  <form action={runDepreciationAction} className="flex flex-wrap items-center gap-3">
                    <input type="hidden" name="through" value={monthKey(through)} />
                    <p className="text-sm text-slate-600">
                      This books <strong>{fmt(planTotal)}</strong> over {planMonths} month{planMonths === 1 ? "" : "s"}, for {new Set(plan.map((p) => p.asset.id)).size} asset
                      {new Set(plan.map((p) => p.asset.id)).size === 1 ? "" : "s"}, up to {monthLabel(through)}.
                    </p>
                    <SubmitButton pendingText="Booking...">Book it</SubmitButton>
                  </form>
                )}
                <p className="text-xs text-slate-500">Only months that have finished can be booked. Each month is one journal entry, and booking again never doubles it.</p>
              </CardBody>
            </Card>
          ) : null}

          <Table>
            <Thead>
              <Tr>
                <Th>No.</Th>
                <Th>Asset</Th>
                <Th>Bought</Th>
                <Th className="text-right">Cost</Th>
                <Th className="text-right">Written off</Th>
                <Th className="text-right">Book value</Th>
                <Th>Status</Th>
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((r) => (
                <Tr key={r.asset.id}>
                  <Td className="whitespace-nowrap font-mono text-xs">{r.asset.number}</Td>
                  <Td>
                    <Link href={`/app/assets/${r.asset.id}`} className="font-medium text-teal-700 hover:underline">
                      {r.asset.name}
                    </Link>
                    <p className="text-xs text-slate-500">{r.asset.assetAccount.name}</p>
                  </Td>
                  <Td className="whitespace-nowrap">{formatDate(r.asset.purchaseDate)}</Td>
                  <Td className="whitespace-nowrap text-right">{fmt(num(r.asset.cost))}</Td>
                  <Td className="whitespace-nowrap text-right">{fmt(r.accumulated)}</Td>
                  <Td className="whitespace-nowrap text-right">{r.asset.status === "DISPOSED" ? "—" : fmt(r.netBookValue)}</Td>
                  <Td>
                    {r.asset.status === "DISPOSED" ? (
                      <Badge>{num(r.asset.disposalProceeds) > 0 ? "Sold" : "Written off"} {r.asset.disposedAt ? formatDate(r.asset.disposedAt) : ""}</Badge>
                    ) : r.netBookValue - num(r.asset.salvageValue) <= 0.005 ? (
                      <Badge tone="teal">Fully depreciated</Badge>
                    ) : (
                      <Badge tone="teal">In use</Badge>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>

          {months.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-slate-700">Depreciation booked</h2>
              <Table>
                <Thead>
                  <Tr>
                    <Th>Month</Th>
                    <Th>Assets</Th>
                    <Th className="text-right">Amount</Th>
                    <Th />
                  </Tr>
                </Thead>
                <Tbody>
                  {months.map((m) => (
                    <Tr key={monthKey(m.month)}>
                      <Td>{monthLabel(m.month)}</Td>
                      <Td>{m.assets}</Td>
                      <Td className="text-right">{fmt(m.total)}</Td>
                      <Td className="text-right">
                        {canManage ? (
                          <form action={undoDepreciationAction}>
                            <input type="hidden" name="month" value={m.month.toISOString().slice(0, 10)} />
                            <SubmitButton variant="ghost" size="sm" pendingText="...">
                              Take back
                            </SubmitButton>
                          </form>
                        ) : null}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
