import { cn } from "@/lib/cn";
import type { HTMLAttributes } from "react";

export function Alert({
  className,
  variant = "error",
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant?: "error" | "success" | "info" }) {
  const variantClasses = {
    error: "bg-rose-50 text-rose-700 border-rose-200",
    success: "bg-teal-50 text-teal-700 border-teal-200",
    info: "bg-slate-50 text-slate-700 border-slate-200",
  }[variant];

  return (
    <div
      role="alert"
      className={cn("rounded-md border px-3 py-2 text-sm", variantClasses, className)}
      {...props}
    />
  );
}
