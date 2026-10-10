import type { JournalSource } from "./generated/prisma/client";

// Where to open the document behind a journal entry.
export function sourceHref(sourceType: JournalSource, sourceId: string | null): string | null {
  if (!sourceId) return null;
  switch (sourceType) {
    case "SALES_INVOICE":
      return `/app/sales/invoices/${sourceId}`;
    case "RECEIPT":
      return `/app/sales/receipts/${sourceId}`;
    case "BILL":
      return `/app/invoices/${sourceId}`;
    case "PAYMENT":
      return `/app/payments/${sourceId}`;
    case "PAYRUN":
      return `/app/payroll/${sourceId}`;
    case "TRANSFER":
      return "/app/transfers";
    case "FX_REVALUATION":
      return "/app/revaluation";
    case "DEPRECIATION":
      return "/app/assets";
    case "ASSET_DISPOSAL":
      return `/app/assets/${sourceId}`;
    case "OPENING_BALANCE":
      return "/app/opening-balances";
    case "SUPPLIER_CREDIT":
      return `/app/supplier-credits/${sourceId}`;
    case "CREDIT_NOTE":
      return `/app/sales/credit-notes/${sourceId}`;
    default:
      return null;
  }
}

export const SOURCE_LABEL: Record<JournalSource, string> = {
  SALES_INVOICE: "Invoice",
  RECEIPT: "Money in",
  BILL: "Bill",
  PAYMENT: "Money out",
  PAYRUN: "Payroll",
  MANUAL: "Journal",
  STOCK_ADJUSTMENT: "Stock",
  CREDIT_NOTE: "Credit note",
  SUPPLIER_CREDIT: "Supplier credit",
  OPENING_BALANCE: "Opening balances",
  GOODS_RECEIPT: "Goods received",
  TRANSFER: "Transfer",
  FX_REVALUATION: "Revaluation",
  DEPRECIATION: "Depreciation",
  ASSET_DISPOSAL: "Asset sale",
};
