import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { businessContext } from "@/lib/form-options";
import { formatDate, toDateInput } from "@/lib/format";
import { num, round2 } from "@/lib/money";
import { accountIdsByKey } from "@/lib/ledger";
import { OPENING_EXCLUDED_KEYS, debitNatured } from "@/lib/opening-balances";
import { settledAmount } from "@/lib/sales";
import { deleteOpeningBill, deleteOpeningInvoice } from "@/lib/actions/opening-balances";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { SubmitButton } from "@/components/forms";
import { OpeningAccountsForm, OpeningItemForm } from "@/components/opening-balances-forms";

export const metadata = { title: "Opening balances" };

export default async function OpeningBalancesPage() {
  const { business } = await requireBusiness();
  const { fmt } = businessContext(business);
  const keys = await accountIdsByKey(business.id);
  const excluded = new Set<string>(OPENING_EXCLUDED_KEYS.map((k) => keys[k]));

  const [accounts, entry, customers, suppliers, invoices, bills, inventory, equity] = await Promise.all([
    prisma.account.findMany({ where: { businessId: business.id, isArchived: false }, orderBy: { code: "asc" } }),
    prisma.journalEntry.findFirst({
      where: { businessId: business.id, sourceType: "OPENING_BALANCE", sourceId: business.id },
      include: { lines: true },
    }),
    prisma.customer.findMany({ where: { businessId: business.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.supplier.findMany({ where: { businessId: business.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.salesInvoice.findMany({
      where: { businessId: business.id, isOpening: true },
      include: {
        customer: { select: { name: true } },
        allocations: { select: { amount: true } },
        creditAllocations: { select: { amount: true } },
      },
      orderBy: { issueDate: "asc" },
    }),
    prisma.invoice.findMany({
      where: { businessId: business.id, isOpening: true },
      include: { allocations: { select: { amount: true } }, creditAllocations: { select: { amount: true } } },
      orderBy: { invoiceDate: "asc" },
    }),
    prisma.journalLine.aggregate({ where: { accountId: keys.INVENTORY }, _sum: { debit: true, credit: true } }),
    prisma.journalLine.aggregate({ where: { accountId: keys.OPENING_BALANCE }, _sum: { debit: true, credit: true } }),
  ]);

  // What is already in the books, on each account's normal side, so the form shows the saved figures.
  const saved = new Map<string, number>();
  for (const line of entry?.lines ?? []) {
    saved.set(line.accountId, round2((saved.get(line.accountId) ?? 0) + num(line.debit) - num(line.credit)));
  }
  const rows = accounts
    .filter((a) => !excluded.has(a.id))
    .sort((a, b) => Number(!!b.moneyKind) - Number(!!a.moneyKind) || a.code.localeCompare(b.code))
    .map((a) => {
      const net = saved.get(a.id) ?? 0;
      return { id: a.id, code: a.code, name: a.name, type: a.type as string, kind: a.moneyKind as string | null, amount: debitNatured(a.type) ? net : -net };
    });

  const customerTotal = invoices.reduce((s, i) => s + num(i.total), 0);
  const supplierTotal = bills.reduce((s, b) => s + num(b.totalAmount), 0);
  const inventoryValue = round2(num(inventory._sum.debit) - num(inventory._sum.credit));
  const equityBalance = round2(num(equity._sum.credit) - num(equity._sum.debit));
  const openingDate = business.openingDate;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Opening balances"
        description="Bring in where the business stood when you started using Hakiki, so your reports begin from the right place."
      />

      <Card>
        <CardHeader>
          <CardTitle>1. Account balances</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-slate-600">
            Take these from your last trial balance or balance sheet: bank, mobile money and cash, loans, capital and anything else you
            hold. Customers, suppliers and stock are entered in the next steps, not here.
          </p>
          <OpeningAccountsForm
            rows={rows}
            openingDate={openingDate ? toDateInput(openingDate) : null}
            today={toDateInput(new Date())}
            currency={business.currency}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Customers who owe you</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-sm text-slate-600">
            Enter each invoice that was still unpaid on the opening date, for the amount still owing. They behave like normal invoices: you
            can record payments against them, they appear on statements and in reminders, and they do not count as sales.
          </p>
          {invoices.length > 0 ? (
            <Table>
              <Thead>
                <Tr>
                  <Th>Customer</Th>
                  <Th>Invoice</Th>
                  <Th>Date</Th>
                  <Th>Due</Th>
                  <Th className="text-right">Amount</Th>
                  <Th className="text-right">Still owing</Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {invoices.map((inv) => {
                  const balance = round2(num(inv.total) - settledAmount(inv));
                  const used = inv.allocations.length + inv.creditAllocations.length > 0;
                  return (
                    <Tr key={inv.id}>
                      <Td>{inv.customer.name}</Td>
                      <Td>
                        <Link href={`/app/sales/invoices/${inv.id}`} className="font-mono text-xs hover:underline">
                          {inv.number}
                        </Link>
                      </Td>
                      <Td className="whitespace-nowrap">{formatDate(inv.issueDate)}</Td>
                      <Td className="whitespace-nowrap">{formatDate(inv.dueDate)}</Td>
                      <Td className="whitespace-nowrap text-right">{fmt(num(inv.total))}</Td>
                      <Td className="whitespace-nowrap text-right">{inv.status === "VOID" ? "Void" : fmt(balance)}</Td>
                      <Td className="text-right">
                        {used ? (
                          <span className="text-xs text-slate-400">has payments</span>
                        ) : (
                          <form action={deleteOpeningInvoice}>
                            <input type="hidden" name="invoiceId" value={inv.id} />
                            <SubmitButton variant="ghost" size="sm" pendingText="...">
                              Remove
                            </SubmitButton>
                          </form>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          ) : null}
          <p className="text-sm font-medium text-slate-700">Total owed by customers at the start: {fmt(customerTotal)}</p>
          <OpeningItemForm kind="customer" contacts={customers} openingDate={openingDate ? toDateInput(openingDate) : null} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. Suppliers you owe</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-sm text-slate-600">
            Enter each supplier bill that was still unpaid on the opening date. When you pay them, match the payment to the bill as
            usual. These are not expenses of the new period.
          </p>
          {bills.length > 0 ? (
            <Table>
              <Thead>
                <Tr>
                  <Th>Supplier</Th>
                  <Th>Bill</Th>
                  <Th>Date</Th>
                  <Th>Due</Th>
                  <Th className="text-right">Amount</Th>
                  <Th className="text-right">Still owing</Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {bills.map((b) => {
                  const settled = [...b.allocations, ...b.creditAllocations].reduce((s, a) => s + num(a.amount), 0);
                  const used = b.allocations.length + b.creditAllocations.length > 0;
                  return (
                    <Tr key={b.id}>
                      <Td>{b.supplierName}</Td>
                      <Td>
                        <Link href={`/app/invoices/${b.id}`} className="font-mono text-xs hover:underline">
                          {b.invoiceNumber}
                        </Link>
                      </Td>
                      <Td className="whitespace-nowrap">{formatDate(b.invoiceDate)}</Td>
                      <Td className="whitespace-nowrap">{b.dueDate ? formatDate(b.dueDate) : "—"}</Td>
                      <Td className="whitespace-nowrap text-right">{fmt(num(b.totalAmount))}</Td>
                      <Td className="whitespace-nowrap text-right">{fmt(round2(num(b.totalAmount) - settled))}</Td>
                      <Td className="text-right">
                        {used ? (
                          <span className="text-xs text-slate-400">has payments</span>
                        ) : (
                          <form action={deleteOpeningBill}>
                            <input type="hidden" name="billId" value={b.id} />
                            <SubmitButton variant="ghost" size="sm" pendingText="...">
                              Remove
                            </SubmitButton>
                          </form>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          ) : null}
          <p className="text-sm font-medium text-slate-700">Total owed to suppliers at the start: {fmt(supplierTotal)}</p>
          <OpeningItemForm kind="supplier" contacts={suppliers} openingDate={openingDate ? toDateInput(openingDate) : null} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>4. Stock on hand</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2 text-sm text-slate-600">
          <p>
            Stock is counted item by item so quantities and costs are right. Open each stocked item under{" "}
            <Link href="/app/items" className="text-teal-700 hover:underline">
              Products & services
            </Link>{" "}
            and add its quantity and unit cost with the reason <em>Opening stock</em>.
          </p>
          <p>
            Stock value in the books now: <strong className="text-slate-900">{fmt(inventoryValue)}</strong>
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Where this leaves your equity</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2 text-sm text-slate-600">
          <p>
            Everything above is balanced against <em>Opening balance equity</em>, which now stands at{" "}
            <strong className="text-slate-900">{fmt(equityBalance)}</strong>. That is what the business was worth when you started
            (assets less what you owe). Your accountant may want it moved to <em>Owner&apos;s capital</em> or <em>Retained earnings</em> with a
            manual journal. Check your figures on the{" "}
            <Link href="/app/reports/trial-balance" className="text-teal-700 hover:underline">
              trial balance
            </Link>
            .
          </p>
          {openingDate ? <p className="text-xs text-slate-500">Opening balances are as at {formatDate(openingDate)}.</p> : null}
        </CardBody>
      </Card>
    </div>
  );
}
