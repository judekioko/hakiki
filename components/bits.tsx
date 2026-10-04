import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE, type PaymentStatus } from "@/lib/coverage";

export function StatusBadge({ status }: { status: PaymentStatus }) {
  return <Badge tone={PAYMENT_STATUS_TONE[status]}>{PAYMENT_STATUS_LABEL[status]}</Badge>;
}

export function YearPicker({
  years,
  current,
  basePath,
  extra = {},
}: {
  years: number[];
  current: number;
  basePath: string;
  extra?: Record<string, string | undefined>;
}) {
  return (
    <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 print:hidden">
      {years.map((year) => {
        const params = new URLSearchParams({ ...stripEmpty(extra), year: String(year) });
        return (
          <Link
            key={year}
            href={`${basePath}?${params}`}
            className={cn(
              "rounded px-3 py-1 text-sm font-medium",
              year === current ? "bg-teal-700 text-white" : "text-slate-600 hover:bg-slate-100"
            )}
          >
            FY {year}
          </Link>
        );
      })}
    </div>
  );
}

export function FilterTabs({
  options,
  current,
  basePath,
  extra = {},
}: {
  options: { value: string; label: string; count?: number }[];
  current: string;
  basePath: string;
  extra?: Record<string, string | undefined>;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => {
        const params = new URLSearchParams({ ...stripEmpty(extra), status: o.value });
        return (
          <Link
            key={o.value}
            href={`${basePath}?${params}`}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              o.value === current
                ? "border-teal-700 bg-teal-50 font-medium text-teal-800"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            )}
          >
            {o.label}
            {o.count !== undefined ? <span className="ml-1.5 text-xs text-slate-400">{o.count}</span> : null}
          </Link>
        );
      })}
    </div>
  );
}

function stripEmpty(values: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter((e): e is [string, string] => !!e[1]));
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <p className="font-medium text-slate-800">{title}</p>
      {children ? <div className="mt-2 text-sm text-slate-500">{children}</div> : null}
    </div>
  );
}

export function LinkButton({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary";
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium",
        variant === "primary"
          ? "bg-teal-700 text-white hover:bg-teal-800"
          : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      )}
    >
      {children}
    </Link>
  );
}
