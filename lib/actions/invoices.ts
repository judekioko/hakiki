"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { requireBusiness } from "@/lib/business";
import { blockedByLock } from "@/lib/lock-guard";
import { lockMessage } from "@/lib/period-lock";
import { findOrCreateSupplier } from "@/lib/suppliers";
import { runAutoMatch } from "@/lib/auto-match";
import { postBill, postPayment } from "@/lib/ledger";
import { firstError, invoiceSchema, linesSchema, parseJsonField, taxIdFor } from "@/lib/validators";
import { priceLines, priceLinesFx, totals, totalsFx, type PricedLineFx } from "@/lib/document-lines";
import { CURRENCIES } from "@/lib/currencies";
import { orderUsesAccrual } from "@/lib/purchase-orders";
import { round2 } from "@/lib/money";
import { accountIdsByKey } from "@/lib/ledger";
import type { ActionState } from "./types";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export async function createInvoice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const parsed = invoiceSchema.safeParse({
    invoiceNumber: formData.get("invoiceNumber"),
    supplierId: formData.get("supplierId") ?? "",
    supplierName: formData.get("supplierName") ?? "",
    supplierPin: formData.get("supplierPin") ?? "",
    invoiceDate: formData.get("invoiceDate"),
    dueDate: formData.get("dueDate") ?? "",
    totalAmount: formData.get("totalAmount") || 0,
    vatAmount: formData.get("vatAmount") || 0,
    description: formData.get("description") ?? "",
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const data = parsed.data;
  const billLock = lockMessage(business, new Date(`${data.invoiceDate}T00:00:00Z`));
  if (billLock) return { error: billLock };
  const pin = taxIdFor(business.country).safeParse(data.supplierPin ?? "");
  if (!pin.success) return { error: firstError(pin.error) };
  const supplierPin = pin.data;

  // Bills can be entered as a single total (quick capture) or line by line (needed for stock purchases).
  const keys = await accountIdsByKey(business.id);
  const categoryValue = String(formData.get("categoryAccountId") ?? "");
  const category = categoryValue
    ? await prisma.account.findFirst({ where: { id: categoryValue, businessId: business.id, moneyKind: null } })
    : null;
  // A bill can be in a foreign currency: it is entered in that currency and kept in the books in the business currency
  // at the rate given.
  const currency = String(formData.get("currency") ?? "").trim().toUpperCase();
  const foreign = !!currency && currency !== business.currency;
  const rate = foreign ? Number(formData.get("exchangeRate")) : 1;
  if (foreign && !CURRENCIES.some((c) => c.code === currency)) return { error: "Choose a currency from the list" };
  if (foreign && (!Number.isFinite(rate) || rate <= 0)) {
    return { error: `Enter the exchange rate: how many ${business.currency} one ${currency} is worth` };
  }
  let amounts = foreign
    ? { totalAmount: round2(data.totalAmount * rate), vatAmount: round2(data.vatAmount * rate) }
    : { totalAmount: data.totalAmount, vatAmount: data.vatAmount };
  let foreignAmounts = foreign ? { foreignTotalAmount: data.totalAmount, foreignVatAmount: data.vatAmount } : null;
  let lineRows: (NonNullable<Awaited<ReturnType<typeof priceLines>>["lines"]>[number] & { purchaseOrderLineId?: string | null })[] = [];
  const purchaseOrderId = String(formData.get("purchaseOrderId") ?? "");
  const orderLines = purchaseOrderId
    ? await prisma.purchaseOrderLine.findMany({ where: { orderId: purchaseOrderId, order: { businessId: business.id } }, select: { id: true } })
    : [];
  if (purchaseOrderId && orderLines.length === 0) return { error: "Purchase order not found" };
  const rawLines = formData.get("lines");
  if (typeof rawLines === "string" && rawLines !== "" && rawLines !== "[]") {
    const lineInput = parseJsonField(rawLines, linesSchema);
    if (lineInput.error) return { error: lineInput.error };
    const fallbackAccount = category?.id ?? keys.UNCATEGORISED_EXPENSE;
    const priced = foreign
      ? await priceLinesFx(business.id, lineInput.data!, "purchase", fallbackAccount, true, rate)
      : await priceLines(business.id, lineInput.data!, "purchase", fallbackAccount, true);
    if (priced.error) return { error: priced.error };
    lineRows = priced.lines!.map((l, i) => {
      const poLineId = lineInput.data![i].poLineId;
      return { ...l, purchaseOrderLineId: poLineId && orderLines.some((o) => o.id === poLineId) ? poLineId : null };
    });
    const sums = totals(lineRows);
    amounts = { totalAmount: sums.total, vatAmount: sums.taxTotal };
    if (foreign) {
      const fx = totalsFx(priced.lines as PricedLineFx[]);
      foreignAmounts = { foreignTotalAmount: fx.foreignTotal, foreignVatAmount: fx.foreignTaxTotal };
    }
  }
  if (amounts.totalAmount <= 0) return { error: "Enter the bill total or add lines" };
  if (amounts.vatAmount > amounts.totalAmount) return { error: "VAT cannot be more than the invoice total" };

  let supplier = data.supplierId
    ? await prisma.supplier.findFirst({ where: { id: data.supplierId, businessId: business.id } })
    : null;
  if (!supplier) {
    if (!data.supplierName) return { error: "Choose a supplier or type the supplier's name" };
    supplier = await findOrCreateSupplier(business.id, data.supplierName, supplierPin);
  } else if (supplierPin && !supplier.kraPin) {
    supplier = await prisma.supplier.update({ where: { id: supplier.id }, data: { kraPin: supplierPin } });
  }

  const invoiceNumber = data.invoiceNumber.toUpperCase();
  const duplicate = await prisma.invoice.findUnique({
    where: { businessId_invoiceNumber: { businessId: business.id, invoiceNumber } },
  });
  if (duplicate) return { error: `Invoice ${invoiceNumber} has already been added` };

  const file = formData.get("file");
  let fileFields = {};
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) return { error: "The invoice file is larger than 5 MB" };
    if (!ALLOWED_TYPES.includes(file.type)) return { error: "Attach a PDF, JPG, PNG or WEBP file" };
    fileFields = {
      fileName: file.name,
      fileType: file.type,
      fileData: new Uint8Array(await file.arrayBuffer()),
    };
  }

  const invoice = await prisma.invoice.create({
    data: {
      businessId: business.id,
      supplierId: supplier.id,
      invoiceNumber,
      supplierName: supplier.name,
      supplierPin: supplierPin ?? supplier.kraPin,
      invoiceDate: new Date(`${data.invoiceDate}T00:00:00Z`),
      dueDate: data.dueDate ? new Date(`${data.dueDate}T00:00:00Z`) : null,
      totalAmount: amounts.totalAmount,
      vatAmount: amounts.vatAmount,
      description: data.description,
      categoryAccountId: category?.id ?? null,
      purchaseOrderId: purchaseOrderId || null,
      usesGrni: purchaseOrderId ? await orderUsesAccrual(purchaseOrderId) : false,
      currency: foreign ? currency : null,
      exchangeRate: foreign ? rate : null,
      foreignTotalAmount: foreignAmounts?.foreignTotalAmount ?? null,
      foreignVatAmount: foreignAmounts?.foreignVatAmount ?? null,
      lines: { create: lineRows },
      ...fileFields,
    },
  });

  await postBill(invoice.id);
  await runAutoMatch(business.id);
  await audit(business.id, "CREATE", "BILL", invoice.id, `Recorded bill ${invoice.invoiceNumber} from ${supplier.name} (${amounts.totalAmount.toFixed(2)})${purchaseOrderId ? " against a purchase order" : ""}`);
  revalidatePath("/app", "layout");

  const paymentId = formData.get("paymentId");
  if (typeof paymentId === "string" && paymentId) redirect(`/app/payments/${paymentId}`);
  redirect(`/app/invoices/${invoice.id}`);
}

export async function setInvoiceStatus(formData: FormData) {
  const { business } = await requireBusiness();
  const status = String(formData.get("status"));
  if (!["UNVERIFIED", "VERIFIED", "REJECTED"].includes(status)) return;

  const invoiceId = String(formData.get("invoiceId"));
  if (status === "REJECTED") {
    // Rejecting releases the payments matched to the bill, so none of them may be in closed books.
    const matched = await prisma.allocation.findMany({ where: { invoiceId, invoice: { businessId: business.id } } });
    for (const a of matched) if (await blockedByLock(business, "payment", a.paymentId)) return;
  }
  await prisma.invoice.updateMany({
    where: { id: invoiceId, businessId: business.id },
    data: { status: status as "UNVERIFIED" | "VERIFIED" | "REJECTED" },
  });
  await audit(business.id, "UPDATE", "BILL", invoiceId, `Marked bill as ${status.toLowerCase()}`);
  // A rejected invoice cannot back an expense, so release its payments.
  if (status === "REJECTED") {
    const released = await prisma.allocation.findMany({ where: { invoiceId, invoice: { businessId: business.id } } });
    await prisma.allocation.deleteMany({ where: { id: { in: released.map((a) => a.id) } } });
    for (const a of released) await postPayment(a.paymentId);
  }
  revalidatePath("/app", "layout");
}

export async function deleteInvoice(formData: FormData) {
  const { business } = await requireBusiness();
  const invoiceId = String(formData.get("invoiceId"));
  const affected = await prisma.allocation.findMany({ where: { invoiceId, invoice: { businessId: business.id } } });
  if (await blockedByLock(business, "bill", invoiceId)) return;
  for (const a of affected) if (await blockedByLock(business, "payment", a.paymentId)) return;
  const deleted = await prisma.invoice.deleteMany({ where: { id: invoiceId, businessId: business.id } });
  if (deleted.count) {
    await audit(business.id, "DELETE", "BILL", invoiceId, "Deleted a supplier bill");
    await postBill(invoiceId);
    for (const a of affected) await postPayment(a.paymentId);
  }
  revalidatePath("/app", "layout");
  redirect("/app/invoices");
}
