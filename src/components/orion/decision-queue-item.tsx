'use client';

import { cn } from '@/lib/utils';
import { OrionStatusBadge } from './status-badge';
import { 
  Clock, 
  User, 
  FileText, 
  PlayCircle,
  Eye,
  ChevronRight,
  AlertTriangle,
  CheckCircle
} from 'lucide-react';

type SeverityLevel = 'critical' | 'high' | 'medium' | 'low';

interface DecisionQueueItemProps {
  id: string;
  title: string;
  description?: string;
  severity: SeverityLevel;
  daysOpen: number;
  slaStatus: 'on_track' | 'at_risk' | 'breached';
  owner: {
    name: string;
    avatar?: string;
  };
  committee?: string;
  onOpenPackage?: () => void;
  onViewMinutes?: () => void;
  onStartVote?: () => void;
  className?: string;
}

const severityConfig: Record<SeverityLevel, { 
  label: string; 
  color: string;
  bgColor: string;
  borderColor: string;
}> = {
  critical: { 
    label: 'Crítico', 
    color: 'text-semantic-error-DEFAULT', 
    bgColor: 'bg-semantic-error-DEFAULT/10',
    borderColor: 'border-l-semantic-error-DEFAULT'
  },
  high: { 
    label: 'Alto', 
    color: 'text-semantic-warning-DEFAULT', 
    bgColor: 'bg-semantic-warning-DEFAULT/10',
    borderColor: 'border-l-semantic-warning-DEFAULT'
  },
  medium: { 
    label: 'Médio', 
    color: 'text-semantic-info-DEFAULT', 
    bgColor: 'bg-semantic-info-DEFAULT/10',
    borderColor: 'border-l-semantic-info-DEFAULT'
  },
  low: { 
    label: 'Baixo', 
    color: 'text-orion-text-secondary', 
    bgColor: 'bg-orion-bg-elevated',
    borderColor: 'border-l-orion-border-strong'
  },
};

const slaConfig = {
  on_track: { status: 'success' as const, label: 'No Prazo' },
  at_risk: { status: 'warning' as const, label: 'Em Risco' },
  breached: { status: 'critical' as const, label: 'SLA Excedido' },
};

export function DecisionQueueItem({
  title,
  description,
  severity,
  daysOpen,
  slaStatus,
  owner,
  committee,
  onOpenPackage,
  onViewMinutes,
  onStartVote,
  className,
}: DecisionQueueItemProps) {
  const config = severityConfig[severity];
  const sla = slaConfig[slaStatus];

  return (
    <div
      className={cn(
        'group relative rounded-lg overflow-hidden',
        'bg-orion-bg-secondary/60 backdrop-blur-sm',
        'border border-orion-border-DEFAULT border-l-4',
        config.borderColor,
        'hover:bg-orion-bg-tertiary/80 hover:border-orion-border-strong',
        'transition-all duration-200',
        'cursor-pointer',
        className
      )}
    >
      <div className="p-4">
        {/* Top row: severity, SLA, days */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className={cn(
              'px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider',
              config.bgColor,
              config.color
            )}>
              {config.label}
            </span>
            <OrionStatusBadge status={sla.status} label={sla.label} size="sm" />
          </div>
          
          <div className="flex items-center gap-1.5 text-orion-text-muted text-xs">
            <Clock className="w-3.5 h-3.5" />
            <span>{daysOpen} {daysOpen === 1 ? 'dia' : 'dias'}</span>
          </div>
        </div>

        {/* Title and description */}
        <h4 className="text-sm font-semibold text-white mb-1 line-clamp-1 group-hover:text-semantic-info-light transition-colors">
          {title}
        </h4>
        {description && (
          <p className="text-xs text-orion-text-tertiary line-clamp-2 mb-3">
            {description}
          </p>
        )}

        {/* Bottom row: owner, committee, actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Owner */}
            <div className="flex items-center gap-1.5">
              {owner.avatar ? (
                <img 
                  src={owner.avatar} 
                  alt={owner.name}
                  className="w-5 h-5 rounded-full"
                />
              ) : (
                <div className="w-5 h-5 rounded-full bg-orion-bg-elevated flex items-center justify-center">
                  <User className="w-3 h-3 text-orion-text-muted" />
                </div>
              )}
              <span className="text-xs text-orion-text-secondary">{owner.name}</span>
            </div>

            {/* Committee */}
            {committee && (
              <span className="text-xs text-orion-text-muted">
                • {committee}
              </span>
            )}
          </div>

          {/* Quick actions */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {onOpenPackage && (
              <button
                onClick={(e) => { e.stopPropagation(); onOpenPackage(); }}
                className="p-1.5 rounded-md hover:bg-glass-medium transition-colors"
                title="Abrir Pacote"
              >
                <FileText className="w-3.5 h-3.5 text-orion-text-secondary hover:text-white" />
              </button>
            )}
            {onViewMinutes && (
              <button
                onClick={(e) => { e.stopPropagation(); onViewMinutes(); }}
                className="p-1.5 rounded-md hover:bg-glass-medium transition-colors"
                title="Ver Ata"
              >
                <Eye className="w-3.5 h-3.5 text-orion-text-secondary hover:text-white" />
              </button>
            )}
            {onStartVote && (
              <button
                onClick={(e) => { e.stopPropagation(); onStartVote(); }}
                className="p-1.5 rounded-md hover:bg-semantic-info-DEFAULT/20 transition-colors"
                title="Iniciar Votação"
              >
                <PlayCircle className="w-3.5 h-3.5 text-semantic-info-DEFAULT" />
              </button>
            )}
            <ChevronRight className="w-4 h-4 text-orion-text-muted" />
          </div>
        </div>
      </div>
    </div>
  );
}

// Decision Queue container component
interface DecisionQueueProps {
  items: Array<DecisionQueueItemProps>;
  title?: string;
  emptyMessage?: string;
  className?: string;
}

export function DecisionQueue({
  items,
  title = 'Fila de Decisões',
  emptyMessage = 'Nenhuma decisão pendente',
  className,
}: DecisionQueueProps) {
  return (
    <div className={cn('space-y-3', className)}>
      {title && (
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white uppercase tracking-wider">
            {title}
          </h3>
          <span className="text-xs text-orion-text-muted">
            {items.length} {items.length !== 1 ? 'itens' : 'item'}
          </span>
        </div>
      )}

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-orion-text-muted">
          <CheckCircle className="w-8 h-8 mb-2 opacity-50" />
          <p className="text-sm">{emptyMessage}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <DecisionQueueItem key={item.id} {...item} />
          ))}
        </div>
      )}
    </div>
  );
}

