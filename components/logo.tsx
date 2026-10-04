import Link from "next/link";
import { APP_NAME } from "@/lib/brand";

export function Logo({ compact = false, href = "/app" }: { compact?: boolean; href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-700 text-white">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
          <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {compact ? null : (
        <span className="leading-tight">
          <span className="block text-base font-bold text-slate-900">{APP_NAME}</span>
          <span className="block text-[11px] text-slate-500">Accounting for Africa</span>
        </span>
      )}
    </Link>
  );
}
