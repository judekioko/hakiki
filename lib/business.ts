import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { requireSession, type SessionPayload } from "./session";
import { ensureBooks } from "./books";

export const ACTIVE_BUSINESS_COOKIE = "hakiki_business";

export async function listMyBusinesses(userId: string) {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    include: { business: true },
    orderBy: { business: { name: "asc" } },
  });
  return memberships.map((m) => ({ ...m.business, role: m.role }));
}

// The business the signed-in user is working on. Accountants switch between client businesses.
export async function getActiveBusiness(session: SessionPayload) {
  const cookieStore = await cookies();
  const wanted = cookieStore.get(ACTIVE_BUSINESS_COOKIE)?.value;
  const businesses = await listMyBusinesses(session.userId);
  return businesses.find((b) => b.id === wanted) ?? businesses[0] ?? null;
}

export async function requireBusiness() {
  const session = await requireSession();
  const business = await getActiveBusiness(session);
  if (!business) redirect("/app/businesses");
  await ensureBooks(business);
  return { session, business };
}

export async function setActiveBusiness(businessId: string) {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_BUSINESS_COOKIE, businessId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
