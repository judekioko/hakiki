import "server-only";
import { prisma } from "./prisma";
import { num, round2 } from "./money";

export type CashFlowRow = { id: string; code: string; name: string; balance: number };

// Accounts whose movements are part of running the business day to day. Other assets are investments; other
// liabilities and equity are financing.
const OPERATING_KEYS = new Set([
  "AR",
  "AP",
  "INVENTORY",
  "VAT_IN",
  "VAT_OUT",
  "PAYE_PAYABLE",
  "PAYROLL_LIABILITIES",
  "SALARIES_PAYABLE",
  "UNALLOCATED_RECEIPTS",
]);

// Plain-language names for the control accounts, as cash movements rather than balances.
const LABELS: Record<string, string> = {
  AR: "Received from customers",
  AP: "Paid to suppliers",
  INVENTORY: "Stock bought for cash",
  VAT_IN: "Input VAT paid to suppliers",
  VAT_OUT: "VAT paid to / refunded by the tax authority",
  PAYE_PAYABLE: "Income tax (PAYE) paid for staff",
  PAYROLL_LIABILITIES: "Payroll deductions paid to authorities",
  SALARIES_PAYABLE: "Net salaries paid",
  UNALLOCATED_RECEIPTS: "Money received, not yet matched to a customer",
};

type Section = "operating" | "investing" | "financing" | "opening";
const ASSET_SALE_KEY = "investing:asset-sale";

// The direct method, built from the ledger. Every journal entry that touches a bank, mobile money or cash account
// is balanced, so what happened to the cash is exactly the opposite of what happened to the other lines of that
// entry: each of those lines says where cash came from or went to.
export async function cashFlow(businessId: string, from: Date, to: Date) {
  const accounts = await prisma.account.findMany({ where: { businessId } });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const moneyIds = accounts.filter((a) => a.moneyKind).map((a) => a.id);

  const [openingSums, closingSums, entries] = await Promise.all([
    prisma.journalLine.aggregate({
      where: { accountId: { in: moneyIds }, entry: { businessId, date: { lt: from } } },
      _sum: { debit: true, credit: true },
    }),
    prisma.journalLine.aggregate({
      where: { accountId: { in: moneyIds }, entry: { businessId, date: { lt: to } } },
      _sum: { debit: true, credit: true },
    }),
    prisma.journalEntry.findMany({
      where: { businessId, date: { gte: from, lt: to }, lines: { some: { accountId: { in: moneyIds } } } },
      select: { sourceType: true, lines: { select: { accountId: true, debit: true, credit: true } } },
    }),
  ]);
  const opening = round2(num(openingSums._sum.debit) - num(openingSums._sum.credit));
  const closing = round2(num(closingSums._sum.debit) - num(closingSums._sum.credit));

  const totals = new Map<string, { section: Section; amount: number }>();
  for (const entry of entries) {
    for (const line of entry.lines) {
      const account = byId.get(line.accountId);
      if (!account || account.moneyKind) continue;
      const effect = num(line.credit) - num(line.debit);
      if (effect === 0) continue;

      // Selling an asset is one investing item: what came in, whatever the cost, depreciation and gain or loss were.
      if (entry.sourceType === "ASSET_DISPOSAL") {
        const current = totals.get(ASSET_SALE_KEY) ?? { section: "investing" as Section, amount: 0 };
        current.amount = round2(current.amount + effect);
        totals.set(ASSET_SALE_KEY, current);
        continue;
      }

      let section: Section;
      if (entry.sourceType === "OPENING_BALANCE" || account.systemKey === "OPENING_BALANCE") section = "opening";
      else if (account.type === "INCOME" || account.type === "EXPENSE" || (account.systemKey && OPERATING_KEYS.has(account.systemKey))) section = "operating";
      else if (account.type === "ASSET") section = "investing";
      else section = "financing";

      const key = `${section}:${account.id}`;
      const current = totals.get(key) ?? { section, amount: 0 };
      current.amount = round2(current.amount + effect);
      totals.set(key, current);
    }
  }

  const rowsFor = (section: Section): CashFlowRow[] =>
    [...totals.entries()]
      .filter(([, v]) => v.section === section && Math.abs(v.amount) >= 0.005)
      .map(([key, v]) => {
        if (key === ASSET_SALE_KEY) return { id: "asset-sale", code: "", name: "Sale of fixed assets", balance: v.amount, sort: "9999" };
        const account = byId.get(key.split(":")[1])!;
        const label = account.systemKey ? LABELS[account.systemKey] : undefined;
        return { id: account.id, code: label ? "" : account.code, name: label ?? account.name, balance: v.amount, sort: account.code };
      })
      .sort((a, b) => a.sort.localeCompare(b.sort))
      .map(({ sort, ...row }) => (void sort, row));
  const sum = (rows: CashFlowRow[]) => round2(rows.reduce((s, r) => s + r.balance, 0));

  const operating = rowsFor("operating");
  const investing = rowsFor("investing");
  const financing = rowsFor("financing");
  const openingEntries = rowsFor("opening");
  const netChange = round2(closing - opening);
  const explained = round2(sum(operating) + sum(investing) + sum(financing) + sum(openingEntries));

  return {
    operating,
    investing,
    financing,
    openingEntries,
    totals: {
      operating: sum(operating),
      investing: sum(investing),
      financing: sum(financing),
      openingEntries: sum(openingEntries),
    },
    opening,
    closing,
    netChange,
    // Anything the sections above do not account for (should be zero; shown if it ever is not).
    unexplained: round2(netChange - explained),
  };
}
