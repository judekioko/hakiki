"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { CURRENCIES } from "@/lib/currencies";
import type { ActionState } from "./types";

const isoDay = /^\d{4}-\d{2}-\d{2}$/;

// Saves what one unit of a foreign currency is worth in the business currency on a day. Saving the same currency
// and day again replaces the rate.
export async function saveExchangeRate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const currency = String(formData.get("currency") ?? "").toUpperCase();
  if (currency === business.currency || !CURRENCIES.some((c) => c.code === currency)) return { error: "Choose a foreign currency" };
  const rate = Number(formData.get("rate"));
  if (!Number.isFinite(rate) || rate <= 0) return { error: `Enter how many ${business.currency} one ${currency} is worth` };
  const day = String(formData.get("date") ?? "");
  if (!isoDay.test(day)) return { error: "Choose the date of the rate" };

  const date = new Date(`${day}T00:00:00Z`);
  await prisma.exchangeRate.upsert({
    where: { businessId_currency_date: { businessId: business.id, currency, date } },
    create: { businessId: business.id, currency, date, rate },
    update: { rate },
  });
  revalidatePath("/app", "layout");
  return { success: `Saved 1 ${currency} = ${rate} ${business.currency}` };
}

export async function deleteExchangeRate(formData: FormData) {
  const { business } = await requireBusiness();
  await prisma.exchangeRate.deleteMany({ where: { id: String(formData.get("rateId")), businessId: business.id } });
  revalidatePath("/app", "layout");
}
