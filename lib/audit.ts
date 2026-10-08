import "server-only";
import { prisma } from "./prisma";
import { getSession } from "./session";

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
