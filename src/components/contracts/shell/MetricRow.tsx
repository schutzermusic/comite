'use client';

/**
 * Grupo de métricas alinhadas, separadas por espaço e divisória — não por caixas.
 *
 * Substitui o padrão "uma métrica = um card com borda". Quatro valores
 * financeiros de um contrato são UMA seção financeira, não quatro objetos: a
 * moldura individual sugeria uma independência que eles não têm e gastava
 * ~60px de altura por número.
 *
 * A divisória vertical só aparece a partir de `sm`; empilhado, o próprio
 * espaçamento separa. Não recebe borda externa: quem posiciona é o chamador.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface MetricRowItem {
  id: string;
  label: ReactNode;
  /** Normalmente um `<TrustedValue>` — a métrica preserva sua proveniência. */
  value: ReactNode;
  /** Linha de apoio curta (ex.: "3 eventos"). */
  sub?: ReactNode;
  onClick?: () => void;
  /** Realce de seleção, para métricas que também filtram. */
  active?: boolean;
}

export interface MetricRowProps {
  items: MetricRowItem[];
  /** Colunas em telas largas. Padrão: uma coluna por item. */
  columns?: 2 | 3 | 4 | 5 | 6;
  className?: string;
  /** Nome acessível do grupo, quando ele representa um conjunto nomeado. */
  label?: string;
}

const COLS: Record<number, string> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
  5: 'sm:grid-cols-3 lg:grid-cols-5',
  6: 'sm:grid-cols-3 lg:grid-cols-6',
};

export function MetricRow({ items, columns, className, label }: MetricRowProps) {
  const cols = COLS[columns ?? Math.min(Math.max(items.length, 2), 6)] ?? COLS[4];

  return (
    <dl
      aria-label={label}
      className={cn(
        'grid grid-cols-2 gap-x-0 gap-y-4',
        cols,
        // Divisória entre colunas: 1px, só onde há vizinho à esquerda.
        '[&>*+*]:sm:border-l [&>*+*]:sm:border-ig-border-subtle',
        className,
      )}
    >
      {items.map((item) => {
        const Wrapper = item.onClick ? 'button' : 'div';
        return (
          <Wrapper
            key={item.id}
            {...(item.onClick
              ? { type: 'button' as const, onClick: item.onClick, 'aria-pressed': Boolean(item.active) }
              : {})}
            className={cn(
              'min-w-0 px-0 text-left sm:px-4 sm:first:pl-0',
              item.onClick &&
                'rounded-[10px] transition-colors hover:bg-ig-bg-raised/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ig-border-focus',
              item.active && 'bg-ig-accent-weak/40',
            )}
          >
            <dt className="truncate text-ig-caption text-ig-fg-muted">{item.label}</dt>
            <dd className="mt-1 min-w-0">
              {item.value}
              {item.sub && (
                <p className="mt-0.5 truncate text-ig-caption text-ig-fg-subtle">{item.sub}</p>
              )}
            </dd>
          </Wrapper>
        );
      })}
    </dl>
  );
}
