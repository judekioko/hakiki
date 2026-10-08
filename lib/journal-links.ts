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
};
