import { cn } from "@/lib/utils";
import { Badge } from "./badge";

type StatusVariant = 
  | 'draft' | 'pending' | 'under_review' | 'approved' | 'rejected' | 'archived'
  | 'not_started' | 'in_progress' | 'completed' | 'delayed' | 'cancelled'
  | 'open' | 'mitigating' | 'resolved'
  | 'active' | 'expiring_soon' | 'expired'
  | 'low' | 'medium' | 'high' | 'critical';

const statusConfig: Record<StatusVariant, { label: string; className: string }> = {
  // Workflow states
  draft: { label: 'Rascunho', className: 'bg-slate-100 text-slate-700 border-slate-200' },
  pending: { label: 'Pendente', className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  under_review: { label: 'Em Revisão', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  approved: { label: 'Aprovado', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  rejected: { label: 'Rejeitado', className: 'bg-red-100 text-red-700 border-red-200' },
  archived: { label: 'Arquivado', className: 'bg-zinc-100 text-zinc-600 border-zinc-200' },
  
  // Task states
  not_started: { label: 'Não Iniciado', className: 'bg-slate-100 text-slate-600 border-slate-200' },
  in_progress: { label: 'Em Andamento', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  completed: { label: 'Concluído', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  delayed: { label: 'Atrasado', className: 'bg-red-100 text-red-700 border-red-200' },
  cancelled: { label: 'Cancelado', className: 'bg-zinc-100 text-zinc-600 border-zinc-200' },
  
  // Risk/Contract states
  open: { label: 'Aberto', className: 'bg-orange-100 text-orange-700 border-orange-200' },
  mitigating: { label: 'Mitigando', className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  resolved: { label: 'Resolvido', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  active: { label: 'Ativo', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  expiring_soon: { label: 'Expirando', className: 'bg-orange-100 text-orange-700 border-orange-200' },
  expired: { label: 'Expirado', className: 'bg-red-100 text-red-700 border-red-200' },
  
  // Severity levels
  low: { label: 'Baixo', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  medium: { label: 'Médio', className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  high: { label: 'Alto', className: 'bg-orange-100 text-orange-700 border-orange-200' },
  critical: { label: 'Crítico', className: 'bg-red-100 text-red-700 border-red-200' },
};

interface StatusBadgeProps {
  status: StatusVariant;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.pending;
  
  // Fallback if status is not in config
  if (!config) {
    return (
      <Badge 
        variant="outline" 
        className={cn(
          "text-[11px] font-medium tracking-wide border",
          "bg-slate-100 text-slate-700 border-slate-200",
          className
        )}
      >
        {status}
      </Badge>
    );
  }
  
  return (
    <Badge 
      variant="outline" 
      className={cn(
        "text-[11px] font-medium tracking-wide border",
        config.className,
        className
      )}
    >
      {config.label}
    </Badge>
  );
}

