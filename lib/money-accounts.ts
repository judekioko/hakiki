import type { MoneyKind, PaymentSource } from "./generated/prisma/client";

export function sourceForMoneyAccount(account: { moneyKind: MoneyKind | null }): PaymentSource {
  switch (account.moneyKind) {
    case "MOBILE_MONEY":
      return "MPESA";
    case "CASH":
      return "CASH";
    default:
      return "BANK";
  }
}

export const MONEY_KIND_LABEL: Record<MoneyKind, string> = {
  BANK: "Bank",
  MOBILE_MONEY: "Mobile money",
  CASH: "Cash",
};
