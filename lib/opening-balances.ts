// Shared by the opening balances form (browser) and its actions (server).

// Accounts that are filled from their own records instead: customers and suppliers by listing the unpaid invoices
// and bills, inventory through stock counts. Opening balance equity is the balancing figure itself.
export const OPENING_EXCLUDED_KEYS = ["AR", "AP", "INVENTORY", "OPENING_BALANCE"] as const;

// Assets and expenses normally carry debit balances; liabilities, equity and income carry credit balances.
export function debitNatured(type: string): boolean {
  return type === "ASSET" || type === "EXPENSE";
}
