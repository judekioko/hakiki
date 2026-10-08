import "server-only";
import { prisma } from "./prisma";
import { countryPack } from "./countries";
import type { AccountType, MoneyKind } from "./generated/prisma/client";

type AccountSeed = { code: string; name: string; type: AccountType; key?: string; moneyKind?: MoneyKind };

// Default chart of accounts. Accounts with a key are posted to automatically and cannot be deleted.
export function defaultAccounts(countryCode: string): AccountSeed[] {
  const pack = countryPack(countryCode);
  const isKenya = pack.code === "KE";
  return [
    { code: "1000", name: "Cash on hand", type: "ASSET", key: "CASH", moneyKind: "CASH" },
    { code: "1010", name: "Bank account", type: "ASSET", key: "BANK", moneyKind: "BANK" },
    { code: "1020", name: pack.mobileMoney[0] ?? "Mobile money", type: "ASSET", key: "MOBILE_MONEY", moneyKind: "MOBILE_MONEY" },
    { code: "1100", name: "Accounts receivable", type: "ASSET", key: "AR" },
    { code: "1200", name: "Inventory", type: "ASSET", key: "INVENTORY" },
    { code: "1300", name: `${pack.vatName} recoverable (input)`, type: "ASSET", key: "VAT_IN" },
    { code: "1500", name: "Equipment & furniture", type: "ASSET" },
    { code: "1510", name: "Vehicles", type: "ASSET" },
    { code: "2000", name: "Accounts payable", type: "LIABILITY", key: "AP" },
    { code: "2100", name: `${pack.vatName} payable (output)`, type: "LIABILITY", key: "VAT_OUT" },
    { code: "2200", name: isKenya ? "PAYE payable" : "Employee income tax payable", type: "LIABILITY", key: "PAYE_PAYABLE" },
    { code: "2210", name: isKenya ? "NSSF, SHIF & Housing Levy payable" : "Payroll deductions payable", type: "LIABILITY", key: "PAYROLL_LIABILITIES" },
    { code: "2220", name: "Net salaries payable", type: "LIABILITY", key: "SALARIES_PAYABLE" },
    { code: "2300", name: "Loans", type: "LIABILITY", key: "LOANS" },
    { code: "2900", name: "Unallocated money received", type: "LIABILITY", key: "UNALLOCATED_RECEIPTS" },
    { code: "3000", name: "Owner's capital", type: "EQUITY", key: "CAPITAL" },
    { code: "3100", name: "Owner's drawings", type: "EQUITY", key: "DRAWINGS" },
    { code: "3200", name: "Retained earnings", type: "EQUITY", key: "RETAINED_EARNINGS" },
    { code: "3900", name: "Opening balance equity", type: "EQUITY", key: "OPENING_BALANCE" },
    { code: "4000", name: "Sales", type: "INCOME", key: "SALES" },
    { code: "4100", name: "Service income", type: "INCOME" },
    { code: "4900", name: "Other income", type: "INCOME", key: "OTHER_INCOME" },
    { code: "5000", name: "Cost of goods sold", type: "EXPENSE", key: "COGS" },
    { code: "5100", name: "Stock adjustments", type: "EXPENSE", key: "STOCK_ADJUSTMENTS" },
    { code: "6000", name: "Salaries & wages", type: "EXPENSE", key: "SALARIES_EXPENSE" },
    { code: "6010", name: "Employer payroll contributions", type: "EXPENSE", key: "PAYROLL_EXPENSE" },
    { code: "6100", name: "Rent", type: "EXPENSE" },
    { code: "6200", name: "Electricity & water", type: "EXPENSE" },
    { code: "6300", name: "Transport & fuel", type: "EXPENSE" },
    { code: "6400", name: "Repairs & maintenance", type: "EXPENSE" },
    { code: "6500", name: "Office supplies", type: "EXPENSE" },
    { code: "6600", name: "Bank & mobile money charges", type: "EXPENSE", key: "BANK_CHARGES" },
    { code: "6700", name: "Telephone & internet", type: "EXPENSE" },
    { code: "6800", name: "Professional fees", type: "EXPENSE" },
    { code: "6900", name: "Marketing & advertising", type: "EXPENSE" },
    { code: "6950", name: "Taxes & licences", type: "EXPENSE", key: "TAXES_LICENCES" },
    { code: "6990", name: "Uncategorised expense", type: "EXPENSE", key: "UNCATEGORISED_EXPENSE" },
    { code: "7000", name: "Interest expense", type: "EXPENSE", key: "INTEREST_EXPENSE" },
    { code: "7100", name: "Exchange gains and losses", type: "EXPENSE", key: "FX_GAIN_LOSS" },
  ];
}

// Creates the chart of accounts and tax rates for a business the first time it is opened,
// then posts any documents recorded before the ledger existed.
export async function ensureBooks(business: { id: string; country: string; booksReadyAt: Date | null }) {
  if (business.booksReadyAt) return;

  const pack = countryPack(business.country);
  await prisma.account.createMany({
    data: defaultAccounts(business.country).map((a) => ({
      businessId: business.id,
      code: a.code,
      name: a.name,
      type: a.type,
      systemKey: a.key ?? null,
      moneyKind: a.moneyKind ?? null,
    })),
    skipDuplicates: true,
  });
  if ((await prisma.taxRate.count({ where: { businessId: business.id } })) === 0) {
    await prisma.taxRate.createMany({
      data: pack.vatRates.map((r) => ({ businessId: business.id, name: r.name, rate: r.rate, isDefault: !!r.isDefault })),
    });
  }

  const { postBill, postPayment } = await import("./ledger");
  const [bills, payments] = await Promise.all([
    prisma.invoice.findMany({ where: { businessId: business.id }, select: { id: true } }),
    prisma.payment.findMany({ where: { businessId: business.id }, select: { id: true } }),
  ]);
  for (const b of bills) await postBill(b.id);
  for (const p of payments) await postPayment(p.id);

  await prisma.business.update({ where: { id: business.id }, data: { booksReadyAt: new Date() } });
}
