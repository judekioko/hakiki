"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBusiness, setActiveBusiness } from "@/lib/business";
import { businessSchema, firstError } from "@/lib/validators";
import type { ActionState } from "./types";

function readBusinessForm(formData: FormData) {
  return businessSchema.safeParse({
    name: formData.get("name"),
    kraPin: formData.get("kraPin") ?? "",
    incomeTaxRate: formData.get("incomeTaxRate") ?? 30,
    yearEndMonth: formData.get("yearEndMonth") ?? 12,
  });
}

export async function createBusiness(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const parsed = readBusinessForm(formData);
  if (!parsed.success) return { error: firstError(parsed.error) };

  const role = formData.get("role") === "ACCOUNTANT" ? "ACCOUNTANT" : "OWNER";
  const business = await prisma.business.create({
    data: { ...parsed.data, memberships: { create: { userId: session.userId, role } } },
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

export async function updateBusiness(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const parsed = readBusinessForm(formData);
  if (!parsed.success) return { error: firstError(parsed.error) };

  await prisma.business.update({ where: { id: business.id }, data: parsed.data });
  revalidatePath("/app", "layout");
  return { success: "Business details saved" };
}
