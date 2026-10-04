import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-100 px-4 py-10">
      <Logo href="/" />
      {children}
    </div>
  );
}
