import "server-only";
import { prisma } from "./prisma";

export type AuditAction = "CREATE" | "UPDATE" | "DELETE" | "VOID" | "SEND" | "APPROVE" | "REOPEN" | "LINK" | "UNLINK" | "IMPORT";

export const AUDIT_ENTITIES: Record<string, string> = {
  SALES_INVOICE: "Sales invoice",
  CREDIT_NOTE: "Credit note",
  RECEIPT: "Money received",
  BILL: "Bill",
  PAYMENT: "Money paid out",
  JOURNAL: "Manual journal",
  ACCOUNT: "Account",
  PAY_RUN: "Pay run",
  CUSTOMER: "Customer",
  PERIOD_LOCK: "Closed books",
  RECONCILIATION: "Reconciliation",
  QUOTATION: "Quotation",
  MONEY_TRANSFER: "Transfer",
  REVALUATION: "Revaluation",
  IMPORT: "CSV import",
  OPENING_BALANCES: "Opening balances",
  REMINDER: "Payment reminder",
  PURCHASE_ORDER: "Purchase order",
  SUPPLIER_CREDIT: "Supplier credit note",
  GOODS_RECEIPT: "Goods received",
  RECURRING: "Recurring invoice",
};

// Appends a line to the business's audit trail, attributed to the signed-in user.
// A failure here is logged but never blocks the bookkeeping action that triggered it.
export async function audit(
  businessId: string,
  action: AuditAction,
  entityType: keyof typeof AUDIT_ENTITIES,
  entityId: string | null,
  summary: string
) {
  try {
    // Loaded on demand: the session code needs the Next.js request context, which scripts and tests do not have.
    const { getSession } = await import("./session");
    const session = await getSession();
    await prisma.auditLog.create({
      data: {
        businessId,
        userId: session?.userId ?? null,
        userName: session?.name ?? "System",
        action,
        entityType,
        entityId,
        summary,
      },
    });
  } catch (error) {
    console.error("Could not write audit log", error);
  }
}
