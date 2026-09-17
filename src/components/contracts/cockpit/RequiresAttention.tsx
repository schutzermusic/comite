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
  /**
   * `compact` é a densidade do painel lateral.
   *
   * A grade larga (coluna de 110px para o rótulo de severidade + título +
   * dimensão + ação) foi desenhada para a largura do dossiê. Dentro de um
   * drawer de 500px ela colapsa: o título perde metade da linha, a ação quebra
   * e o bloco parece quebrado. Aqui a severidade volta a ser o ÍCONE sobre o
   * trilho — a informação é a mesma, em um terço da largura.
   */
  compact?: boolean;
}

export function RequiresAttention({
  items, onAction, emptyHint, className, max, compact = false,
}: RequiresAttentionProps) {
  const shown = max ? items.slice(0, max) : items;
  const hidden = items.length - shown.length;

  // Empty state com inteligência: diz o que está no horizonte, não "nenhum
  // registro" (MD §40).
  if (items.length === 0) {
    return (
      <div className={cn('ig-section-plain', compact ? 'py-2' : 'py-3', className)}>
        <p className="flex items-center gap-2 text-ig-body-sm font-semibold text-ig-fg-strong">
          <CheckCircle2 className="h-4 w-4 text-ig-success" aria-hidden />
          Nada exige atenção agora
        </p>
        <p className={cn('mt-1 text-ig-caption text-ig-fg-muted', compact ? 'line-clamp-2' : 'leading-relaxed')}>
          {emptyHint ?? 'Todas as dimensões apuradas deste contrato estão regulares.'}
        </p>
      </div>
    );
  }

  /*
    ── Densidade compacta ──────────────────────────────────────────────────
    Uma linha de duas alturas: título curto e forte, razão menor e apagada em
    UMA linha. A severidade é o ícone sobre o trilho (forma, não só cor) e a
    ação é um botão fantasma alinhado ao centro da linha — presente, mas sem
    disputar peso com o título.
  */
  if (compact) {
    return (
      <div className={cn('ig-rows', className)}>
        {shown.map((item) => {
          const s = SEVERITY[item.severity];
          const dimension = item.exposure && hasOfficialValue(item.exposure)
            ? BRL.format(item.exposure.value)
            : item.age;
          return (
            <article key={item.id} className="relative flex items-center gap-2.5 py-2 pl-3 pr-1">
              <span className={cn('pointer-events-none absolute inset-y-0 left-0 w-[2px]', s.rail)} aria-hidden />
              <span className={cn('shrink-0', s.text)}>
                {s.icon}
                <span className="sr-only">{s.label}</span>
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <h4 className="min-w-0 flex-1 truncate text-ig-body-sm font-semibold text-ig-fg-strong">
                    {item.title}
                  </h4>
                  {dimension && (
                    <span className="ig-tabular shrink-0 text-ig-caption text-ig-fg-subtle">{dimension}</span>
                  )}
                </div>
                <p className="line-clamp-1 text-ig-caption text-ig-fg-muted" title={item.reason}>
                  {item.reason}
                </p>
              </div>

              {onAction && (
                <button
                  type="button"
                  onClick={() => onAction(item.actionKey)}
                  title={item.actionLabel}
                  className={cn(
                    'inline-flex h-7 max-w-[9.5rem] shrink-0 items-center gap-1 rounded-md px-2 text-ig-caption font-semibold',
                    'text-ig-fg-muted transition-colors',
                    'hover:bg-[color-mix(in_oklab,var(--ig-accent)_10%,transparent)] hover:text-ig-accent',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
                  )}
                >
                  <span className="truncate">{item.actionLabel}</span>
                  <ArrowRight className="h-3 w-3 shrink-0" aria-hidden />
                </button>
              )}
            </article>
          );
        })}

        {hidden > 0 && (
          <p className="px-3 py-1.5 text-ig-caption text-ig-fg-subtle">
            + {hidden} no dossiê completo
          </p>
        )}
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
