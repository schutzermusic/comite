import { cn } from "@/lib/utils";
import { StatusPill } from "./status-pill";

type SeverityLevel = 'low' | 'medium' | 'high' | 'critical';

const severityConfig: Record<SeverityLevel, { label: string; variant: string }> = {
  low: { 
    label: 'Baixo', 
    variant: 'active'
  },
  medium: { 
    label: 'Médio', 
    variant: 'info'
  },
  high: { 
    label: 'Alto', 
    variant: 'warning'
  },
  critical: { 
    label: 'Crítico', 
    variant: 'critical'
  },
};

interface SeverityBadgeProps {
  severity: SeverityLevel;
  score?: number;
  className?: string;
}

export function SeverityBadge({ severity, score, className }: SeverityBadgeProps) {
  const config = severityConfig[severity];
  
  return (
    <StatusPill 
      variant={config.variant}
      className={cn("text-[11px] px-3 py-1", className)}
    >
      {config.label}
      {score !== undefined && <span className="opacity-80 ml-1">• {score}</span>}
    </StatusPill>
  );
}
