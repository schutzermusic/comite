'use client';

/**
 * Cabeçalho de seção SEM contêiner.
 *
 * O módulo de Contratos usava `HudPanel` para praticamente tudo, inclusive
 * quando o painel não acrescentava nada além de uma borda em volta de um
 * título. O resultado eram caixas dentro de caixas dentro de caixas.
 *
 * Aqui a hierarquia vem da tipografia e do espaço, não da moldura: título forte,
 * contagem tabular ao lado, dica em texto secundário, ação à direita. Use
 * `SectionHeader` + conteúdo solto; reserve `HudPanel` para quando a superfície
 * realmente precisa se destacar do fundo.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SectionHeaderProps {
  title: ReactNode;
  /** Contagem do conjunto. `0` é exibido — zero é informação, não vazio. */
  count?: number;
  /** Texto secundário curto. Não use para explicar o modelo de dados. */
  hint?: ReactNode;
  /** Ação à direita — no máximo uma, terciária por padrão. */
  action?: ReactNode;
  /** `h2` em regiões de página, `h3` dentro de abas (padrão). */
  as?: 'h2' | 'h3' | 'h4';
  className?: string;
}

export function SectionHeader({
  title,
  count,
  hint,
  action,
  as: Heading = 'h3',
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn('mb-2.5 flex items-baseline justify-between gap-3', className)}>
      <div className="flex min-w-0 items-baseline gap-2">
        <Heading className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">
          {title}
        </Heading>
        {count !== undefined && (
          <span className="ig-tabular shrink-0 text-ig-caption text-ig-fg-muted">{count}</span>
        )}
        {hint && (
          <span className="hidden truncate text-ig-caption text-ig-fg-subtle sm:inline">
            {hint}
          </span>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
