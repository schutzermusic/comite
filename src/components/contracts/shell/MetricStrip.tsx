'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface MetricStripItem {
  label: string;
  /** Já formatado. "Não apurado" e "—" são valores legítimos: ausência ≠ zero. */
  value: React.ReactNode;
  hint?: React.ReactNode;
  /** Realce apenas para o que é de fato o número principal da faixa. */
  emphasis?: boolean;
  tone?: 'default' | 'warning' | 'danger' | 'success';
}

export interface MetricStripProps {
  items: MetricStripItem[];
  /** Colunas no desktop. Acima de 4 a faixa vira parede de números. */
  columns?: 2 | 3 | 4;
  className?: string;
}

const TONE: Record<NonNullable<MetricStripItem['tone']>, string> = {
  default: 'text-ig-fg-numeric',
  warning: 'text-ig-warning',
  danger: 'text-ig-danger',
  success: 'text-ig-success',
};

/**
 * Métricas como COLUNAS ALINHADAS, não como cartões.
 *
 * Oito KPIs em oito retângulos com borda produziam oito molduras para dizer
 * oito números — e, pior, oito linhas de base diferentes: o olho não
 * conseguia varrer os valores em coluna porque cada um começava onde a caixa
 * dele começava. Aqui os rótulos alinham entre si e os valores também, que é
 * o que torna a faixa comparável.
 */
export function MetricStrip({ items, columns = 4, className }: MetricStripProps) {
  const cols = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-2 lg:grid-cols-3',
    4: 'sm:grid-cols-2 lg:grid-cols-4',
  }[columns];

  return (
    <dl
      className={cn(
        'grid grid-cols-1 gap-x-6 gap-y-4',
        cols,
        // O divisor vertical separa sem emoldurar: um fio entre colunas em vez
        // de uma caixa por métrica.
        'lg:divide-x lg:divide-ig-border-subtle',
        className,
      )}
    >
      {items.map((item, index) => (
        <div key={item.label} className={cn('min-w-0', index > 0 && 'lg:pl-6')}>
          <dt className="truncate text-ig-caption text-ig-fg-muted">{item.label}</dt>
          <dd
            className={cn(
              'ig-tabular mt-0.5 truncate font-semibold',
              item.emphasis ? 'text-ig-h3' : 'text-ig-body',
              TONE[item.tone ?? 'default'],
            )}
          >
            {item.value}
          </dd>
          {item.hint && (
            <p className="mt-0.5 truncate text-ig-caption text-ig-fg-subtle">{item.hint}</p>
          )}
        </div>
      ))}
    </dl>
  );
}
