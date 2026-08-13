'use client';

import React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * SIGNAL CHIP
 * ===========
 * Peça única de status do produto. Substitui as cápsulas antigas (dot + texto
 * + contagem) por uma anatomia própria, na linguagem da Executive Band:
 *
 *   [trilho de tom 2px] [micro-rótulo caixa alta] │ [número tabular tonal]
 *
 * Regras do sistema:
 *  - O rótulo é NEUTRO. A cor semântica vive só no trilho e no número, onde
 *    carrega informação — isso preserva contraste e evita o efeito arco-íris.
 *  - Raio 7px (nunca cápsula). É o que separa um sinal de um badge.
 *  - Superfície de vidro: gradiente 135° com tinta baixa + realce interno.
 *  - Tudo em tokens --ig-*, que já trocam de valor entre dark/light. Nenhuma
 *    regra por tema é necessária.
 *
 * Serve tanto isolado (célula de tabela, linha de lista, card) quanto em série
 * num cabeçalho de módulo — vários chips lado a lado, com gap.
 */

export type HudSignalTone =
  | 'critical'
  | 'danger'
  | 'warning'
  | 'success'
  | 'info'
  | 'accent'
  | 'neutral'
  | 'live';

/** Cada tom resolve para uma única CSS var, consumida como `--sig-tone`. */
const TONE_VAR: Record<HudSignalTone, string> = {
  critical: 'var(--ig-danger)',
  danger: 'var(--ig-danger)',
  warning: 'var(--ig-warning)',
  success: 'var(--ig-success)',
  info: 'var(--ig-info)',
  accent: 'var(--ig-accent)',
  live: 'var(--ig-success)',
  neutral: 'var(--ig-fg-subtle)',
};

/** Tons que não devem tingir o número (ruído sem informação). */
const IS_MUTED = (tone: HudSignalTone) => tone === 'neutral';

export function signalToneStyle(tone: HudSignalTone): React.CSSProperties {
  return { ['--sig-tone' as string]: TONE_VAR[tone] };
}

/* ------------------------------------------------------------------ */
/* Átomo                                                               */
/* ------------------------------------------------------------------ */

export interface HudSignalProps {
  /** Rótulo do sinal. Renderizado em caixa alta, neutro. */
  label: React.ReactNode;
  /** Dado à direita, separado por fio (contagem, prazo, percentual). */
  value?: React.ReactNode;
  tone?: HudSignalTone;
  /** Ícone opcional antes do rótulo, herda o tom. */
  icon?: React.ReactNode;
  size?: 'sm' | 'md';
  href?: string;
  onClick?: () => void;
  /** Estado selecionado (uso como filtro). */
  active?: boolean;
  /** Pulsa o trilho — reservado para sinal ao vivo. */
  pulse?: boolean;
  title?: string;
  className?: string;
}

const ATOM_SIZE = {
  sm: { label: 'px-2.5 py-1 pl-3 text-[9.5px] tracking-[0.12em]', value: 'px-2 py-1 text-[9.5px]', icon: '[&_svg]:h-2.5 [&_svg]:w-2.5' },
  md: { label: 'px-2.5 py-[7px] pl-3 text-[10.5px] tracking-[0.13em]', value: 'px-2.5 py-[7px] text-[10.5px]', icon: '[&_svg]:h-3 [&_svg]:w-3' },
} as const;

const ATOM_SURFACE =
  'relative isolate inline-flex items-stretch overflow-hidden rounded-[7px] border leading-none ' +
  'border-[color-mix(in_oklab,var(--sig-tone)_26%,var(--ig-border-strong))] ' +
  'bg-[linear-gradient(135deg,color-mix(in_oklab,var(--sig-tone)_9%,var(--ig-bg-raised)),color-mix(in_oklab,var(--ig-bg-raised)_88%,transparent))] ' +
  'shadow-[inset_0_1px_0_color-mix(in_oklab,var(--ig-border-strong)_75%,transparent)] ' +
  'transition-[transform,border-color,box-shadow] duration-200 ease-out';

export function HudSignal({
  label,
  value,
  tone = 'accent',
  icon,
  size = 'md',
  href,
  onClick,
  active = false,
  pulse = false,
  title,
  className,
}: HudSignalProps) {
  const s = ATOM_SIZE[size];
  const muted = IS_MUTED(tone);
  const interactive = Boolean(href || onClick);
  const livePulse = pulse || tone === 'live';

  const inner = (
    <>
      {/* Trilho de tom — substitui o ponto colorido */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-0 w-[2px] bg-[color:var(--sig-tone)]',
          'shadow-[0_0_10px_color-mix(in_oklab,var(--sig-tone)_75%,transparent)]',
          livePulse && 'animate-pulse motion-reduce:animate-none',
        )}
      />
      <span
        className={cn(
          'flex min-w-0 items-center gap-1.5 font-bold uppercase',
          muted ? 'text-ig-fg-muted' : 'text-ig-fg-strong',
          s.label,
        )}
      >
        {icon && (
          <span className={cn('flex shrink-0 items-center text-[color:var(--sig-tone)]', s.icon)}>{icon}</span>
        )}
        <span className="truncate">{label}</span>
      </span>
      {value !== undefined && value !== null && (
        <span
          className={cn(
            'flex shrink-0 items-center font-extrabold tabular-nums',
            'border-l border-[color-mix(in_oklab,var(--sig-tone)_22%,var(--ig-border-strong))]',
            'bg-[color-mix(in_oklab,var(--sig-tone)_8%,transparent)]',
            muted ? 'text-ig-fg-muted' : 'text-[color:var(--sig-tone)]',
            s.value,
          )}
        >
          {value}
        </span>
      )}
    </>
  );

  const classes = cn(
    ATOM_SURFACE,
    interactive && [
      'cursor-pointer hover:-translate-y-px',
      'hover:border-[color-mix(in_oklab,var(--sig-tone)_45%,transparent)]',
      'hover:shadow-[0_8px_20px_-14px_color-mix(in_oklab,var(--sig-tone)_60%,transparent),inset_0_1px_0_color-mix(in_oklab,var(--ig-border-strong)_75%,transparent)]',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--sig-tone)_45%,transparent)]',
      'active:translate-y-0',
    ],
    active && 'border-[color-mix(in_oklab,var(--sig-tone)_55%,transparent)] bg-[color-mix(in_oklab,var(--sig-tone)_14%,var(--ig-bg-raised))]',
    className,
  );

  const style = signalToneStyle(tone);

  if (href) {
    return (
      <Link href={href} title={title} style={style} className={classes}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title} aria-pressed={active} style={style} className={classes}>
        {inner}
      </button>
    );
  }
  return (
    <span title={title} style={style} className={classes}>
      {inner}
    </span>
  );
}
