'use client';

/**
 * Cabeçalho de seção do cockpit.
 *
 * Extraído da página, com uma adição: `eyebrow` numera a seção. O cockpit tem
 * sete blocos e uma ordem de leitura deliberada — resumo, eficiência,
 * dinâmica, custo, risco, conformidade, simulação. A numeração torna essa
 * ordem visível em vez de deixá-la implícita no scroll.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface WorkforceSectionHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}

export function WorkforceSectionHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  className,
}: WorkforceSectionHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 h-8 w-0.5 shrink-0 rounded-full bg-gradient-to-b from-ig-accent to-transparent" />
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-ig-fg-subtle">
              {eyebrow}
            </p>
          )}
          <h2 className="text-[15px] font-semibold tracking-tight text-ig-fg-strong">{title}</h2>
          {subtitle && (
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-ig-fg-muted">{subtitle}</p>
          )}
        </div>
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}
