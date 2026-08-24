'use client';

/**
 * Requires Attention — inteligência acionável no lugar de badges genéricos.
 *
 * A MD §12 é explícita: o sistema não deve dizer "2 obrigações atrasadas", deve
 * dizer o que está atrasado, por que importa e o que fazer. Cada item aqui traz
 * severidade, razão, dimensão temporal e próxima ação.
 *
 * O impacto financeiro só aparece quando o dado o sustenta — hoje, apenas para
 * faturamento vencido, onde a exposição É a soma dos eventos registrados.
 * Inventar impacto para os demais tornaria o painel persuasivo e errado.
 */

import { cn } from '@/lib/utils';
import { AlertTriangle, AlertOctagon, Info, ArrowRight, CheckCircle2, Settings2 } from 'lucide-react';
import { hasOfficialValue } from '@/lib/contracts/trust/trusted';
import type { AttentionItem, AttentionSeverity, AttentionActionKey } from '@/lib/contracts/trust/attention';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', notation: 'compact',
  minimumFractionDigits: 0, maximumFractionDigits: 1,
});

const SEVERITY: Record<AttentionSeverity, {
  label: string; icon: React.ReactNode; rail: string; text: string; tint: string;
}> = {
  critical: {
    label: 'Crítico',
    icon: <AlertOctagon className="h-3.5 w-3.5" aria-hidden />,
    rail: 'bg-ig-danger',
    text: 'text-ig-danger',
    tint: 'bg-[color-mix(in_oklab,var(--ig-danger)_6%,transparent)]',
  },
  warning: {
    label: 'Atenção',
    icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden />,
    rail: 'bg-ig-warning',
    text: 'text-ig-warning',
    tint: 'bg-[color-mix(in_oklab,var(--ig-warning)_6%,transparent)]',
  },
  setup: {
    label: 'Configuração pendente',
    icon: <Settings2 className="h-3.5 w-3.5" aria-hidden />,
    rail: 'bg-ig-accent',
    text: 'text-ig-accent',
    tint: 'bg-[color-mix(in_oklab,var(--ig-accent)_6%,transparent)]',
  },
  info: {
    label: 'Monitorar',
    icon: <Info className="h-3.5 w-3.5" aria-hidden />,
    rail: 'bg-ig-info',
    text: 'text-ig-info',
    tint: 'bg-transparent',
  },
};

export interface RequiresAttentionProps {
  items: readonly AttentionItem[];
  onAction?: (key: AttentionActionKey) => void;
  /** Fato do próximo marco, para o empty state carregar inteligência (MD §40). */
  emptyHint?: string | null;
  className?: string;
  /** Limita a lista; o Quick Dossier mostra menos que o dossiê completo. */
  max?: number;
}

export function RequiresAttention({
  items, onAction, emptyHint, className, max,
}: RequiresAttentionProps) {
  const shown = max ? items.slice(0, max) : items;
  const hidden = items.length - shown.length;

  // Empty state com inteligência: diz o que está no horizonte, não "nenhum
  // registro" (MD §40).
  if (items.length === 0) {
    return (
      <div
        className={cn(
          'rounded-[14px] border border-[color-mix(in_oklab,var(--ig-success)_26%,transparent)]',
          'bg-[color-mix(in_oklab,var(--ig-success)_5%,transparent)] px-4 py-4',
          className,
        )}
      >
        <p className="flex items-center gap-2 text-ig-body-sm font-semibold text-ig-fg-strong">
          <CheckCircle2 className="h-4 w-4 text-ig-success" aria-hidden />
          Nada exige atenção agora
        </p>
        <p className="mt-1.5 text-ig-body-sm leading-relaxed text-ig-fg-muted">
          {emptyHint ?? 'Todas as dimensões apuradas deste contrato estão regulares.'}
        </p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-2.5', className)}>
      {shown.map((item) => {
        const s = SEVERITY[item.severity];
        return (
          <article
            key={item.id}
            className={cn(
              'group relative overflow-hidden rounded-[14px] border border-ig-border-subtle',
              'pl-4 pr-3.5 py-3.5 transition-colors duration-200',
              s.tint,
              'hover:border-ig-border-focus',
            )}
          >
            {/* Rail de severidade: indicação não-cromática acompanha o rótulo. */}
            <span className={cn('pointer-events-none absolute inset-y-0 left-0 w-[3px]', s.rail)} aria-hidden />

            <header className="flex items-center gap-2">
              <span className={cn('flex items-center gap-1.5 text-ig-label font-semibold uppercase tracking-[0.12em]', s.text)}>
                {s.icon}
                {s.label}
              </span>
              {item.age && (
                <span className="ml-auto shrink-0 text-ig-caption text-ig-fg-muted">{item.age}</span>
              )}
            </header>

            <h4 className="mt-1.5 text-ig-body-sm font-semibold leading-snug text-ig-fg-strong">
              {item.title}
            </h4>
            <p className="mt-1 text-ig-caption leading-relaxed text-ig-fg-muted">{item.reason}</p>

            {/* Impacto SÓ quando dedutível do dado. */}
            {item.exposure && hasOfficialValue(item.exposure) && (
              <p className="mt-2 flex items-baseline gap-1.5">
                <span className="text-ig-caption text-ig-fg-muted">Exposição</span>
                <span className={cn('ig-tabular text-ig-body-sm font-semibold', s.text)}>
                  {BRL.format(item.exposure.value)}
                </span>
              </p>
            )}

            {onAction && (
              <button
                type="button"
                onClick={() => onAction(item.actionKey)}
                className={cn(
                  'mt-2.5 inline-flex items-center gap-1.5 rounded-[8px] border border-ig-border-subtle',
                  'px-2.5 py-1 text-ig-caption font-medium text-ig-fg-strong transition-all',
                  'hover:border-ig-border-focus hover:bg-[color-mix(in_oklab,var(--ig-accent)_8%,transparent)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
                )}
              >
                {item.actionLabel}
                <ArrowRight className="h-3 w-3" aria-hidden />
              </button>
            )}
          </article>
        );
      })}

      {hidden > 0 && (
        <p className="px-1 text-ig-caption text-ig-fg-subtle">
          + {hidden} outro(s) item(ns) no dossiê completo
        </p>
      )}
    </div>
  );
}
