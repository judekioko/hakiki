"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { findOrCreateSupplier } from "@/lib/suppliers";
import { runAutoMatch } from "@/lib/auto-match";
import { firstError, invoiceSchema } from "@/lib/validators";
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
    totalAmount: formData.get("totalAmount"),
    vatAmount: formData.get("vatAmount") || 0,
    description: formData.get("description") ?? "",
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const data = parsed.data;

  if (data.vatAmount > data.totalAmount) return { error: "VAT cannot be more than the invoice total" };

  let supplier = data.supplierId
    ? await prisma.supplier.findFirst({ where: { id: data.supplierId, businessId: business.id } })
    : null;
  if (!supplier) {
    if (!data.supplierName) return { error: "Choose a supplier or type the supplier's name" };
    supplier = await findOrCreateSupplier(business.id, data.supplierName, data.supplierPin);
  } else if (data.supplierPin && !supplier.kraPin) {
    supplier = await prisma.supplier.update({ where: { id: supplier.id }, data: { kraPin: data.supplierPin } });
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
      supplierPin: data.supplierPin ?? supplier.kraPin,
      invoiceDate: new Date(`${data.invoiceDate}T00:00:00Z`),
      totalAmount: data.totalAmount,
      vatAmount: data.vatAmount,
      description: data.description,
      ...fileFields,
    },
  });

  await runAutoMatch(business.id);
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
  await prisma.invoice.updateMany({
    where: { id: invoiceId, businessId: business.id },
    data: { status: status as "UNVERIFIED" | "VERIFIED" | "REJECTED" },
  });
  // A rejected invoice cannot back an expense, so release its payments.
  if (status === "REJECTED") {
    await prisma.allocation.deleteMany({ where: { invoiceId, invoice: { businessId: business.id } } });
  }
  revalidatePath("/app", "layout");
}

export async function deleteInvoice(formData: FormData) {
  const { business } = await requireBusiness();
  await prisma.invoice.deleteMany({ where: { id: String(formData.get("invoiceId")), businessId: business.id } });
  revalidatePath("/app", "layout");
  redirect("/app/invoices");
}
