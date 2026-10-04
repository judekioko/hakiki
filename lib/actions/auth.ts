"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createSession, destroySession } from "@/lib/session";
import { setActiveBusiness } from "@/lib/business";
import { firstError, loginSchema, signupSchema, taxIdFor } from "@/lib/validators";
import { COUNTRIES, countryPack } from "@/lib/countries";
import type { ActionState } from "./types";

function safeRedirectTarget(value: FormDataEntryValue | null): string {
  const target = typeof value === "string" ? value : "";
  return target.startsWith("/app") ? target : "/app";
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: firstError(parsed.error) };

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return { error: "Invalid email or password" };
  }

  await createSession({ userId: user.id, name: user.name, email: user.email });
  redirect(safeRedirectTarget(formData.get("from")));
}

export async function signupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    businessName: formData.get("businessName"),
    country: formData.get("country") ?? "KE",
    taxId: String(formData.get("taxId") ?? ""),
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const data = parsed.data;
  if (!COUNTRIES.some((c) => c.code === data.country)) return { error: "Choose a country" };
  const taxId = taxIdFor(data.country).safeParse(data.taxId ?? "");
  if (!taxId.success) return { error: firstError(taxId.error) };
  const pack = countryPack(data.country);

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) return { error: "An account with this email already exists. Sign in instead." };

  const user = await prisma.user.create({
    data: {
      email: data.email,
      name: data.name,
      passwordHash: await bcrypt.hash(data.password, 10),
      memberships: {
        create: {
          role: "OWNER",
          business: {
            create: {
              name: data.businessName,
              kraPin: taxId.data ?? null,
              country: pack.code,
              currency: pack.currency,
              incomeTaxRate: pack.corporateTaxRate,
            },
          },
        },
      },
    },
    include: { memberships: true },
  });

  await createSession({ userId: user.id, name: user.name, email: user.email });
  await setActiveBusiness(user.memberships[0].businessId);
  redirect("/app");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
