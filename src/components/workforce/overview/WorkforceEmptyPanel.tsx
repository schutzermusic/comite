'use client';

/**
 * O estado vazio de uma seção — desenhado, não deixado em branco.
 *
 * "Empty states must still look elegant" é o requisito, mas a razão é mais
 * dura que estética: neste módulo o vazio é informação. Uma seção que some ou
 * vira um retângulo cinza ensina o leitor a ignorá-la; uma seção que explica
 * POR QUE não pôde apurar transforma a lacuna em pauta — geralmente uma
 * integração a configurar ou um lançamento que ninguém fez.
 *
 * Por isso o texto pede um motivo específico, nunca "sem dados".
 */

import type { ReactNode } from 'react';
import { CircleDashed } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WorkforceEmptyPanelProps {
  title: string;
  /** O motivo concreto. Evite "sem dados": diga o que falta e por quê. */
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Altura mínima, para a seção manter o ritmo vertical da página. */
  minHeight?: number;
}

export function WorkforceEmptyPanel({
  title,
  description,
  icon,
  action,
  className,
  minHeight = 180,
}: WorkforceEmptyPanelProps) {
  return (
    <div
      style={{ minHeight }}
      className={cn(
        'relative flex flex-col items-center justify-center overflow-hidden rounded-2xl',
        'border border-dashed border-ig-border-subtle bg-ig-panel/40 px-6 py-8 text-center',
        className,
      )}
    >
      {/* Malha discreta: dá superfície ao vazio sem competir com o texto. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            'linear-gradient(color-mix(in oklab, var(--ig-border-subtle) 60%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklab, var(--ig-border-subtle) 60%, transparent) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          maskImage: 'radial-gradient(ellipse at center, black 10%, transparent 72%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, black 10%, transparent 72%)',
        }}
      />

      <div className="relative z-10 flex max-w-md flex-col items-center gap-2">
        <span className="rounded-xl border border-ig-border-subtle bg-ig-bg-raised/60 p-2.5 text-ig-fg-subtle">
          {icon ?? <CircleDashed className="h-5 w-5" />}
        </span>
        <p className="text-[13px] font-semibold text-ig-fg-strong">{title}</p>
        <p className="text-[11.5px] leading-relaxed text-ig-fg-muted">{description}</p>
        {action && <div className="mt-1.5">{action}</div>}
      </div>
    </div>
  );
}
