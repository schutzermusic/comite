import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SettingRowProps {
  label: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function SettingRow({
  label,
  description,
  children,
  className,
}: SettingRowProps) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-8 border-b border-ig-border-subtle py-4 last:border-b-0",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-ig-body-sm font-medium text-ig-fg-strong">{label}</p>
        {description && (
          <p className="mt-0.5 text-ig-caption leading-relaxed text-ig-fg-muted">
            {description}
          </p>
        )}
      </div>
      <div className="flex flex-shrink-0 items-center">{children}</div>
    </div>
  );
}
