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
  label: string; icon: React.ReactNode; rail: string; text: string;
}> = {
  critical: {
    label: 'Crítico',
    icon: <AlertOctagon className="h-3.5 w-3.5" aria-hidden />,
    rail: 'bg-ig-danger',
    text: 'text-ig-danger',
  },
  warning: {
    label: 'Atenção',
    icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden />,
    rail: 'bg-ig-warning',
    text: 'text-ig-warning',
  },
  setup: {
    label: 'Configuração pendente',
    icon: <Settings2 className="h-3.5 w-3.5" aria-hidden />,
    rail: 'bg-ig-accent',
    text: 'text-ig-accent',
  },
  info: {
    label: 'Monitorar',
    icon: <Info className="h-3.5 w-3.5" aria-hidden />,
    rail: 'bg-ig-info',
    text: 'text-ig-info',
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
      <div className={cn('ig-section-plain py-3', className)}>
        <p className="flex items-center gap-2 text-ig-body-sm font-semibold text-ig-fg-strong">
          <CheckCircle2 className="h-4 w-4 text-ig-success" aria-hidden />
          Nada exige atenção agora
        </p>
        <p className="mt-1 text-ig-caption leading-relaxed text-ig-fg-muted">
          {emptyHint ?? 'Todas as dimensões apuradas deste contrato estão regulares.'}
        </p>
      </div>
    );
  }

  /*
    Fila priorizada, não uma pilha de cartões de alerta.
    Cada item era um retângulo de 14px de raio com tinta própria e borda
    própria; três alertas produziam três caixas grandes que empurravam o
    resto do dossiê para fora da primeira tela — e o tamanho da caixa não
    dizia nada sobre a urgência do item, já que todas tinham o mesmo tamanho.
    Agora é uma superfície só, dividida: a severidade fica no trilho e no
    rótulo, e a varredura vertical compara os itens em vez de folheá-los.
  */
  return (
    <div className={cn('ig-rows', className)}>
      {shown.map((item) => {
        const s = SEVERITY[item.severity];
        return (
          <article
            key={item.id}
            className={cn(
              'relative grid gap-x-4 gap-y-1 py-2.5 pl-4 pr-2',
              'md:grid-cols-[110px_1fr_auto_auto] md:items-baseline',
            )}
          >
            {/* Trilho de severidade: indicação não-cromática acompanha o rótulo. */}
            <span className={cn('pointer-events-none absolute inset-y-0 left-0 w-[2px]', s.rail)} aria-hidden />

            <span className={cn('flex items-center gap-1.5 text-ig-caption font-semibold', s.text)}>
              {s.icon}
              {s.label}
            </span>

            <div className="min-w-0">
              <h4 className="truncate text-ig-body-sm font-medium text-ig-fg-strong">{item.title}</h4>
              <p className="truncate text-ig-caption text-ig-fg-muted">{item.reason}</p>
            </div>

            {/* A dimensão do item: idade, ou exposição quando o dado a sustenta. */}
            <span className="ig-tabular shrink-0 text-ig-caption text-ig-fg-muted md:text-right">
              {item.exposure && hasOfficialValue(item.exposure)
                ? BRL.format(item.exposure.value)
                : item.age ?? ''}
            </span>

            {onAction ? (
              <button
                type="button"
                onClick={() => onAction(item.actionKey)}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 justify-self-start text-ig-caption font-medium',
                  'text-ig-accent transition-colors hover:text-ig-accent-strong md:justify-self-end',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ig-border-focus',
                )}
              >
                {item.actionLabel}
                <ArrowRight className="h-3 w-3" aria-hidden />
              </button>
            ) : (
              <span />
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
