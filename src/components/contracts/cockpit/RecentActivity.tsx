'use client';

/**
 * Atividade recente — a partir de `audit_logs`, a fonte autoritativa.
 *
 * Nenhum store paralelo de atividade: os eventos são os mesmos que a aba
 * Auditoria mostra, apenas recortados. Até P0.4 esta informação existia no
 * banco e não era lida por ninguém; a timeline exibida era fabricada, incluindo
 * um ator chamado "INSIGHT AI mock".
 */

import { cn } from '@/lib/utils';
import { History, AlertTriangle, ArrowRight } from 'lucide-react';
import type { ContractAuditEventRow } from '@/lib/contracts/contract-service';
import { AUDIT_ACTION_LABELS, auditActionLabel } from '@/lib/contracts/audit-labels';

export { AUDIT_ACTION_LABELS };

/* Mapa de rótulos: fonte única em `@/lib/contracts/audit-labels`. */

function relativeTime(iso: string, now: Date): string {
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ontem';
  if (days < 7) return `há ${days} dias`;
  return then.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export interface RecentActivityProps {
  events: readonly ContractAuditEventRow[];
  error?: string | null;
  max?: number;
  onViewAll?: () => void;
  now?: Date;
  className?: string;
}

export function RecentActivity({
  events, error, max = 4, onViewAll, now = new Date(), className,
}: RecentActivityProps) {
  if (error) {
    return (
      <p className={cn('flex items-center gap-1.5 text-ig-body-sm text-ig-danger', className)}>
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Falha ao ler o histórico de auditoria.
      </p>
    );
  }

  if (events.length === 0) {
    return (
      <p className={cn('text-ig-body-sm text-ig-fg-subtle', className)}>
        Nenhum evento registrado para este contrato.
      </p>
    );
  }

  const shown = events.slice(0, max);

  return (
    <div className={cn('space-y-2', className)}>
      <ol className="space-y-0">
        {shown.map((event, index) => (
          <li key={event.id} className="relative flex gap-3 pb-2.5 last:pb-0">
            {/* Fio vertical da timeline — para de desenhar no último item. */}
            {index < shown.length - 1 && (
              <span className="absolute left-[3px] top-3 h-full w-px bg-ig-border-subtle" aria-hidden />
            )}
            <span className="relative mt-1.5 h-[7px] w-[7px] shrink-0 rounded-full bg-ig-accent/70" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-ig-body-sm text-ig-fg-strong">
                {auditActionLabel(event.action)}
              </p>
              <p className="text-ig-caption text-ig-fg-subtle">
                {relativeTime(event.created_at, now)}
                {event.actor_user_id ? ' · usuário autenticado' : ' · sistema'}
              </p>
            </div>
          </li>
        ))}
      </ol>

      {onViewAll && events.length > max && (
        <button
          type="button"
          onClick={onViewAll}
          className={cn(
            'inline-flex items-center gap-1 text-ig-caption font-medium text-ig-accent',
            'hover:underline focus-visible:outline-none focus-visible:ring-2',
            'focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)] rounded',
          )}
        >
          Ver histórico completo ({events.length})
          <ArrowRight className="h-3 w-3" aria-hidden />
        </button>
      )}
    </div>
  );
}

export { History as RecentActivityIcon };
