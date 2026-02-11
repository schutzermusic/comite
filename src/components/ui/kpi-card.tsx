import { cn } from "@/lib/utils";
import { Card } from "./card";
import { LucideIcon } from "lucide-react";

interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  trend?: {
    value: string;
    positive?: boolean;
  };
  className?: string;
}

export function KpiCard({ title, value, subtitle, icon: Icon, trend, className }: KpiCardProps) {
  return (
    <Card className={cn("p-6 border-slate-200 bg-white/80 backdrop-blur-sm", className)}>
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-600">{title}</p>
          <p className="text-3xl font-bold text-slate-900">{value}</p>
          {subtitle && (
            <p className="text-xs text-slate-500">{subtitle}</p>
          )}
          {trend && (
            <div className={cn(
              "text-xs font-medium inline-flex items-center gap-1",
              trend.positive ? "text-emerald-600" : "text-red-600"
            )}>
              <span>{trend.positive ? "↑" : "↓"}</span>
              <span>{trend.value}</span>
            </div>
          )}
        </div>
        
        {Icon && (
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <Icon className="w-5 h-5 text-slate-600" />
          </div>
        )}
      </div>
    </Card>
  );
}

