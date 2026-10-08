import { requireBusiness } from "@/lib/business";
import { businessContext } from "@/lib/form-options";
import { formatDate, formatMoney, toDateInput } from "@/lib/format";
import { foreignAccountPositions } from "@/lib/revaluation";
import { removeRevaluation, revalueAccount } from "@/lib/actions/foreign-accounts";
import { todayInNairobi } from "@/lib/recurrence";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/bits";
import { SubmitButton } from "@/components/forms";

export const metadata = { title: "Revalue foreign-currency accounts" };

export default async function RevaluationPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { business } = await requireBusiness();
  const { fmt } = businessContext(business);
  const { date: dateParam } = await searchParams;
  const today = todayInNairobi();
  const parsed = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? new Date(`${dateParam}T00:00:00Z`) : null;
  const date = parsed && parsed.getTime() <= today.getTime() ? parsed : today;
  const positions = await foreignAccountPositions(business.id, date);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Revalue foreign-currency accounts"
        description="At the end of a month or year, bring each foreign-currency account to what its balance is worth at that day's rate. The difference is an exchange gain or loss."
      />
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <label className="text-xs text-slate-500">
          As at
          <Input name="date" type="date" defaultValue={toDateInput(date)} max={toDateInput(today)} className="mt-1" />
        </label>
        <Button type="submit" variant="secondary" size="sm">
          Show
        </Button>
      </form>

      {positions.length === 0 ? (
        <EmptyState title="No foreign-currency accounts">
          <p>Add a bank, mobile money or cash account in a foreign currency under Chart of accounts. It will show up here.</p>
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {positions.map((p) => {
            const rate = p.savedRate;
            const target = rate ? Math.round(p.foreignBalance * rate * 100) / 100 : null;
            const difference = target === null ? null : Math.round((target - p.bookBalance) * 100) / 100;
            return (
              <Card key={p.account.id}>
                <CardBody className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900">
                        {p.account.name} <span className="text-sm font-normal text-slate-500">({p.currency})</span>
                      </p>
                      <p className="text-sm text-slate-500">As at {formatDate(date)}</p>
                    </div>
                    <div className="text-right text-sm">
                      <p className="text-lg font-bold text-slate-900">{formatMoney(p.foreignBalance, p.currency)}</p>
                      <p className="text-slate-500">carried in your books at {fmt(p.bookBalance)}</p>
                    </div>
                  </div>
                  <form action={revalueAccount} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="accountId" value={p.account.id} />
                    <input type="hidden" name="date" value={toDateInput(date)} />
                    <label className="text-xs text-slate-500">
                      Closing rate: 1 {p.currency} = ? {business.currency}
                      <Input name="rate" type="number" step="any" min="0" defaultValue={rate ?? ""} required className="mt-1 w-40" />
                    </label>
                    <SubmitButton variant="secondary" size="sm">
                      {p.alreadyPosted ? "Replace the revaluation" : "Post revaluation"}
                    </SubmitButton>
                  </form>
                  {difference !== null ? (
                    <p className="text-sm text-slate-600">
                      At {rate}, the balance is worth {fmt(target!)}:{" "}
                      {difference === 0 ? "no adjustment needed." : `${difference > 0 ? "a gain" : "a loss"} of ${fmt(Math.abs(difference))} will be booked.`}
                    </p>
                  ) : (
                    <p className="text-sm text-slate-500">Enter the closing rate to see the adjustment.</p>
                  )}
                  {p.alreadyPosted ? (
                    <form action={removeRevaluation}>
                      <input type="hidden" name="accountId" value={p.account.id} />
                      <input type="hidden" name="date" value={toDateInput(date)} />
                      <SubmitButton variant="ghost" size="sm" pendingText="Removing...">
                        Remove the revaluation for this date
                      </SubmitButton>
                    </form>
                  ) : null}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
