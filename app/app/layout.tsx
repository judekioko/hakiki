import { DashboardShell } from "@/components/dashboard-shell";
import { requireSession } from "@/lib/session";
import { getActiveBusiness, listMyBusinesses } from "@/lib/business";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const [businesses, active] = await Promise.all([listMyBusinesses(session.userId), getActiveBusiness(session)]);

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
