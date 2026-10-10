import "server-only";
import { prisma } from "./prisma";
import { num, round2 } from "./money";
import { audit } from "./audit";
import { formatDate } from "./format";
import { lockMessage } from "./period-lock";
import { postReceipt } from "./ledger";
import { runReceiptAutoMatch } from "./receipt-match";
import { settledAmount } from "./sales";

export type MpesaPaymentInput = {
  kind: "C2B" | "STK";
  // M-Pesa's own receipt number. A notification with a number that has already been recorded is ignored.
  transId: string;
  amount: number;
  receivedAt: Date;
  payer: string;
  billRef?: string | null;
  phone?: string | null;
  // For a payment request made from an invoice: the invoice it was for.
  invoiceId?: string | null;
  checkoutRequestId?: string | null;
};

export type RecordResult = { status: "RECORDED" | "DUPLICATE" | "NEEDS_ATTENTION"; receiptId?: string; note?: string };

// Turns an M-Pesa payment notification into money received, and settles the invoice it was for. If the customer typed
// an invoice number as the account number the payment goes straight onto that invoice; otherwise the usual matching
// (amount and customer name) gets a chance. Anything that cannot be booked is kept for someone to look at rather than
// dropped, because the customer has already paid.
export async function recordMpesaPayment(businessId: string, input: MpesaPaymentInput): Promise<RecordResult> {
  const transId = input.transId.trim().toUpperCase();
  const existing = await prisma.mpesaTransaction.findUnique({ where: { businessId_transId: { businessId, transId } } });
  if (existing && existing.status === "RECORDED") return { status: "DUPLICATE", receiptId: existing.receiptId ?? undefined };

  const [business, config] = await Promise.all([
    prisma.business.findUniqueOrThrow({ where: { id: businessId } }),
    prisma.mpesaConfig.findUnique({ where: { businessId } }),
  ]);

  const remember = async (status: "RECORDED" | "NEEDS_ATTENTION", note: string | null, receiptId?: string, invoiceId?: string | null) => {
    const data = {
      status,
      note,
      transId,
      amount: input.amount,
      phone: input.phone ?? null,
      billRef: input.billRef ?? null,
      receiptId: receiptId ?? null,
      invoiceId: invoiceId ?? input.invoiceId ?? null,
      receivedAt: input.receivedAt,
      payer: input.payer || null,
    };
    if (input.checkoutRequestId) {
      await prisma.mpesaTransaction.upsert({
        where: { checkoutRequestId: input.checkoutRequestId },
        create: { businessId, kind: input.kind, checkoutRequestId: input.checkoutRequestId, ...data },
        update: data,
      });
    } else if (existing) {
      await prisma.mpesaTransaction.update({ where: { id: existing.id }, data });
    } else {
      await prisma.mpesaTransaction.create({ data: { businessId, kind: input.kind, ...data } });
    }
  };

  if (!(input.amount > 0)) {
    await remember("NEEDS_ATTENTION", "The notification had no valid amount");
    return { status: "NEEDS_ATTENTION", note: "No valid amount" };
  }

  // The account the money is recorded into: the one chosen in the M-Pesa settings, else the first mobile money account.
  const account =
    (config?.moneyAccountId
      ? await prisma.account.findFirst({ where: { id: config.moneyAccountId, businessId, moneyKind: { not: null }, currency: null } })
      : null) ?? (await prisma.account.findFirst({ where: { businessId, moneyKind: "MOBILE_MONEY", currency: null, isArchived: false }, orderBy: { code: "asc" } }));
  if (!account) {
    await remember("NEEDS_ATTENTION", "No M-Pesa account to record the payment into. Choose one in the M-Pesa settings.");
    return { status: "NEEDS_ATTENTION", note: "No account" };
  }
  if (lockMessage(business, input.receivedAt)) {
    await remember(
      "NEEDS_ATTENTION",
      `Paid on ${formatDate(input.receivedAt)}, which is in closed books (closed through ${formatDate(business.lockedThrough!)}). Reopen the period under Close the books, then press Try again.`
    );
    return { status: "NEEDS_ATTENTION", note: "Closed period" };
  }

  // An invoice number typed as the account number settles that invoice.
  const ref = (input.billRef ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const invoice = input.invoiceId
    ? await prisma.salesInvoice.findFirst({ where: { id: input.invoiceId, businessId, status: "SENT" } })
    : ref
      ? await prisma.salesInvoice.findFirst({ where: { businessId, status: "SENT", number: { equals: ref, mode: "insensitive" } } })
      : null;

  let receiptId: string;
  try {
    const receipt = await prisma.receipt.create({
      data: {
        businessId,
        customerId: invoice?.customerId ?? null,
        moneyAccountId: account.id,
        source: "MPESA",
        reference: transId,
        receivedAt: input.receivedAt,
        amount: round2(input.amount),
        payer: input.payer || (invoice ? (await prisma.customer.findUnique({ where: { id: invoice.customerId }, select: { name: true } }))?.name : null) || input.phone || "M-Pesa customer",
        details: [input.billRef ? `Account ${input.billRef}` : null, input.phone].filter(Boolean).join(" · ") || null,
      },
    });
    receiptId = receipt.id;
  } catch {
    // The same M-Pesa number already exists as money received (for example from an imported statement).
    const dup = await prisma.receipt.findFirst({ where: { businessId, reference: transId } });
    await remember("RECORDED", "Already recorded as money received", dup?.id);
    return { status: "DUPLICATE", receiptId: dup?.id };
  }

  let allocated = 0;
  if (invoice) {
    const full = await prisma.salesInvoice.findUniqueOrThrow({
      where: { id: invoice.id },
      include: { allocations: { select: { amount: true } }, creditAllocations: { select: { amount: true } } },
    });
    const open = round2(num(full.total) - settledAmount(full));
    allocated = Math.min(open, round2(input.amount));
    if (allocated > 0) await prisma.receiptAllocation.create({ data: { receiptId, invoiceId: invoice.id, amount: allocated } });
  }
  await postReceipt(receiptId);
  if (!invoice) await runReceiptAutoMatch(businessId);
  await remember("RECORDED", invoice ? `Applied ${allocated.toFixed(2)} to invoice ${invoice.number}` : null, receiptId, invoice?.id);
  await audit(
    businessId,
    "CREATE",
    "RECEIPT",
    receiptId,
    `M-Pesa ${transId}: ${round2(input.amount).toFixed(2)} received${invoice ? ` for invoice ${invoice.number}` : ""}`
  );
  return { status: "RECORDED", receiptId };
}
