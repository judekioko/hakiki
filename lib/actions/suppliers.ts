"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { normaliseAlias } from "@/lib/matching";
import { learnAlias } from "@/lib/suppliers";
import { toWhatsAppNumber } from "@/lib/kra";
import { buildInvoiceRequestMessage } from "@/lib/invoice-request";
import { firstError, supplierSchema } from "@/lib/validators";
import type { ActionState } from "./types";

export async function createSupplier(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const parsed = supplierSchema.safeParse({
    name: formData.get("name"),
    kraPin: formData.get("kraPin") ?? "",
    phone: formData.get("phone") ?? "",
  });
  if (!parsed.success) return { error: firstError(parsed.error) };

  const supplier = await prisma.supplier.create({
    data: { businessId: business.id, ...parsed.data, aliases: [normaliseAlias(parsed.data.name)] },
  });

  // A payment page can create a supplier for the person it was paid to.
  const paymentId = formData.get("paymentId");
  if (typeof paymentId === "string" && paymentId) {
    const payment = await prisma.payment.findFirst({ where: { id: paymentId, businessId: business.id } });
    if (payment) {
      await prisma.payment.update({ where: { id: payment.id }, data: { supplierId: supplier.id } });
      await learnAlias(business.id, supplier.id, payment.counterparty);
    }
    revalidatePath("/app", "layout");
    redirect(`/app/payments/${paymentId}`);
  }
  revalidatePath("/app", "layout");
  redirect(`/app/suppliers/${supplier.id}`);
}

export async function updateSupplier(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const parsed = supplierSchema.safeParse({
    name: formData.get("name"),
    kraPin: formData.get("kraPin") ?? "",
    phone: formData.get("phone") ?? "",
  });
  if (!parsed.success) return { error: firstError(parsed.error) };

  await prisma.supplier.updateMany({
    where: { id: String(formData.get("supplierId")), businessId: business.id },
    data: { name: parsed.data.name, kraPin: parsed.data.kraPin ?? null, phone: parsed.data.phone ?? null },
  });
  revalidatePath("/app", "layout");
  return { success: "Supplier saved" };
}

export async function linkPaymentToSupplier(formData: FormData) {
  const { business } = await requireBusiness();
  const paymentId = String(formData.get("paymentId"));
  const supplierId = String(formData.get("supplierId"));
  const [payment, supplier] = await Promise.all([
    prisma.payment.findFirst({ where: { id: paymentId, businessId: business.id } }),
    prisma.supplier.findFirst({ where: { id: supplierId, businessId: business.id } }),
  ]);
  if (!payment || !supplier) return;

  await prisma.payment.update({ where: { id: payment.id }, data: { supplierId: supplier.id } });
  await learnAlias(business.id, supplier.id, payment.counterparty);
  revalidatePath("/app", "layout");
}

// Records that the supplier was asked, then opens WhatsApp with the message ready to send.
export async function requestInvoicesOnWhatsApp(formData: FormData) {
  const { business } = await requireBusiness();
  const supplierId = String(formData.get("supplierId"));
  const { supplier, missing, text } = await buildInvoiceRequestMessage(business.id, supplierId);
  const phone = toWhatsAppNumber(supplier.phone);
  if (!phone || missing.length === 0) redirect(`/app/suppliers/${supplierId}`);

  await prisma.payment.updateMany({
    where: { id: { in: missing.map((m) => m.id) }, businessId: business.id },
    data: { invoiceRequestedAt: new Date() },
  });
  revalidatePath("/app", "layout");
  redirect(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`);
}
