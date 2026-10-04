"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBusiness, setActiveBusiness } from "@/lib/business";
import { countryPack, COUNTRIES } from "@/lib/countries";
import { firstError, newBusinessSchema, taxIdFor } from "@/lib/validators";
import type { ActionState } from "./types";

function readBusinessForm(formData: FormData, country: string) {
  const parsed = newBusinessSchema.safeParse({
    name: formData.get("name"),
    country,
    taxId: String(formData.get("taxId") ?? ""),
    incomeTaxRate: formData.get("incomeTaxRate") || countryPack(country).corporateTaxRate,
    yearEndMonth: formData.get("yearEndMonth") ?? 12,
    vatRegistered: formData.get("vatRegistered") === "on",
    address: formData.get("address") ?? "",
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    invoiceFooter: formData.get("invoiceFooter") ?? "",
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const taxId = taxIdFor(country).safeParse(parsed.data.taxId ?? "");
  if (!taxId.success) return { error: firstError(taxId.error) };
  const d = parsed.data;
  return {
    data: {
      name: d.name,
      kraPin: taxId.data ?? null,
      incomeTaxRate: d.incomeTaxRate,
      yearEndMonth: d.yearEndMonth,
      vatRegistered: d.vatRegistered,
      address: d.address ?? null,
      phone: d.phone ?? null,
      email: d.email ?? null,
      invoiceFooter: d.invoiceFooter ?? null,
    },
  };
}

export async function createBusiness(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const country = String(formData.get("country") ?? "KE");
  if (!COUNTRIES.some((c) => c.code === country)) return { error: "Choose a country" };
  const parsed = readBusinessForm(formData, country);
  if (parsed.error) return { error: parsed.error };

  const role = formData.get("role") === "ACCOUNTANT" ? "ACCOUNTANT" : "OWNER";
  const business = await prisma.business.create({
    data: {
      ...parsed.data!,
      country,
      currency: countryPack(country).currency,
      memberships: { create: { userId: session.userId, role } },
    },
  });
  await setActiveBusiness(business.id);
  redirect("/app");
}

export async function switchBusiness(formData: FormData) {
  const session = await requireSession();
  const businessId = String(formData.get("businessId") ?? "");
  const membership = await prisma.membership.findUnique({
    where: { userId_businessId: { userId: session.userId, businessId } },
  });
  if (membership) await setActiveBusiness(businessId);
  redirect("/app");
}

// Country and currency are fixed once a business exists, so existing amounts never change meaning.
export async function updateBusiness(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const parsed = readBusinessForm(formData, business.country);
  if (parsed.error) return { error: parsed.error };

  await prisma.business.update({ where: { id: business.id }, data: parsed.data! });
  revalidatePath("/app", "layout");
  return { success: "Business details saved" };
}
