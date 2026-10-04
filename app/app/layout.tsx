import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { getActiveBusiness, listMyBusinesses } from "@/lib/business";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const [user, businesses, active] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.userId }, select: { id: true } }),
    listMyBusinesses(session.userId),
    getActiveBusiness(session),
  ]);
  if (!user) redirect("/logout");

  return (
    <DashboardShell
      userName={session.name}
      businesses={businesses.map((b) => ({ id: b.id, name: b.name }))}
      activeBusinessId={active?.id ?? null}
    >
      {children}
    </DashboardShell>
  );
}
