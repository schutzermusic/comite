'use client';

/**
 * A moldura padrão de todo gráfico do cockpit.
 *
 * Existe para que "coerência entre as seções" seja uma propriedade do código e
 * não uma disciplina de quem edita: título, subtítulo, legenda, altura e
 * comportamento de overflow saem daqui, iguais em todas as seções. Antes cada
 * painel montava a própria moldura, e o resultado era sete tipografias de
 * título e três alturas de gráfico na mesma página.
 *
 * `FinanceChartContainer` é obrigatório por baixo: ele traz o `min-w-0` que
 * impede um gráfico denso de alargar a página inteira dentro de um grid.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { FinanceChartContainer } from '@/components/finance/shared';
import { WorkforceEmptyPanel } from './WorkforceEmptyPanel';

export interface WorkforceChartLegendItem {
  label: string;
  color: string;
}

interface WorkforceChartCardProps {
  title: string;
  subtitle?: string;
  /** Altura reservada — evita salto de layout enquanto o SVG mede a largura. */
  height?: number;
  legend?: WorkforceChartLegendItem[];
  actions?: ReactNode;
  /** Quando vazio, o cartão explica a ausência em vez de desenhar eixo vazio. */
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  scrollX?: boolean;
  className?: string;
  children: ReactNode;
}

export function WorkforceChartCard({
  title,
  subtitle,
  height = 260,
  legend,
  actions,
  isEmpty = false,
  emptyTitle,
  emptyDescription,
  scrollX = false,
  className,
  children,
}: WorkforceChartCardProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-2xl border border-ig-border-subtle',
        'bg-gradient-to-br from-ig-panel to-ig-bg-raised/30',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-ig-border-subtle/60 px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-[12.5px] font-semibold tracking-tight text-ig-fg-strong">
            {title}
          </h3>
          {subtitle && (
            <p className="mt-0.5 text-[10.5px] leading-relaxed text-ig-fg-muted">{subtitle}</p>
          )}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>

      {isEmpty ? (
        <WorkforceEmptyPanel
          title={emptyTitle ?? 'Sem dado apurado'}
          description={emptyDescription ?? 'Nenhuma competência do período trouxe este indicador.'}
          minHeight={height}
          className="rounded-none border-0 bg-transparent"
        />
      ) : (
        <div className="min-w-0 flex-1 px-2 pb-2 pt-3">
          <FinanceChartContainer minHeight={height} scrollX={scrollX}>
            {children}
          </FinanceChartContainer>
        </div>
      )}

      {legend && legend.length > 0 && !isEmpty && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-ig-border-subtle/60 px-4 py-2.5">
          {legend.map((item) => (
            <span key={item.label} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: item.color }}
              />
              <span className="text-[10.5px] font-medium text-ig-fg-muted">{item.label}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
