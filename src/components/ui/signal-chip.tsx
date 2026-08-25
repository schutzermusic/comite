'use client';

import * as React from 'react';
import Link from 'next/link';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * SIGNAL CHIP
 * ===========
 * Primitivo de estado operacional. Substitui as cápsulas outline genéricas
 * (`rounded-full` + `border`) por uma anatomia de sala de controle:
 *
 *   [ponto/ícone semântico] [rótulo caixa alta, peso alto]
 *
 * Anatomia:
 *  - Fundo: tinta baixa do próprio tom, nunca preenchimento chapado.
 *  - Contorno: hairline interno de 1px em alpha muito baixo. Não há borda
 *    visível competindo com o texto — o tom lê pelo fundo e pelo ponto.
 *  - Raio 7px. É o que separa um sinal de um badge de SaaS.
 *  - Tipografia: bold, caixa alta, tracking largo, numerais tabulares.
 *
 * Todo o tom vem de `--sig-tone`, aplicado inline. Os tokens `--ig-*` já
 * trocam de valor entre dark/light, então não existe regra por tema aqui.
 */

export type SignalChipTone =
  | 'neutral'
  | 'info'
  | 'success'
  | 'warning'
  | 'critical'
  | 'live'
  | 'accent';

const TONE_VAR: Record<SignalChipTone, string> = {
  neutral: 'var(--ig-tone-neutral)',
  info: 'var(--ig-info)',
  success: 'var(--ig-success)',
  warning: 'var(--ig-warning)',
  critical: 'var(--ig-danger)',
  live: 'var(--ig-success)',
  accent: 'var(--ig-accent)',
};

/**
 * Intensidade de fundo e hairline por estado. Vai inline em vez de utility
 * class porque duas declarações de custom property na mesma camada resolvem
 * por ordem de folha de estilo, não por ordem no atributo `class`.
 */
const FILL = { rest: '11%', hover: '18%', active: '22%' } as const;
const RING = { rest: '14%', hover: '26%', active: '34%' } as const;

const signalChipVariants = cva(
  [
    'relative inline-flex shrink-0 items-center align-middle whitespace-nowrap',
    'rounded-[7px] font-bold uppercase leading-none tabular-nums',
    // Tinta do tom sobre a superfície do painel — some no glass, não flutua.
    'bg-[color-mix(in_oklab,var(--sig-tone)_var(--sig-fill),transparent)]',
    // Rótulo puxado para o foreground forte, com viés tonal apenas o
    // suficiente para identificar a severidade sem perder contraste.
    'text-[color-mix(in_oklab,var(--sig-tone)_30%,var(--ig-fg-strong))]',
    // Hairline interno: presença estrutural, zero peso visual.
    'shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--sig-tone)_var(--sig-ring),transparent)]',
    'transition-[background-color,box-shadow,color] duration-150 ease-out',
  ].join(' '),
  {
    variants: {
      size: {
        xs: 'gap-[5px] px-[6px] py-[3px] text-[9px] tracking-[0.1em]',
        sm: 'gap-1.5 px-2 py-[4px] text-[9.5px] tracking-[0.11em]',
        md: 'gap-1.5 px-2.5 py-[5px] text-[10.5px] tracking-[0.12em]',
      },
      interactive: {
        true: [
          'cursor-pointer',
          'hover:bg-[color-mix(in_oklab,var(--sig-tone)_var(--sig-fill-hover),transparent)]',
          'hover:text-[color-mix(in_oklab,var(--sig-tone)_18%,var(--ig-fg-strong))]',
          'hover:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--sig-tone)_var(--sig-ring-hover),transparent)]',
          'focus-visible:outline-none focus-visible:ring-2',
          'focus-visible:ring-[color-mix(in_oklab,var(--sig-tone)_45%,transparent)]',
        ].join(' '),
        false: '',
      },
    },
    defaultVariants: { size: 'sm', interactive: false },
  },
);

const DOT_SIZE = {
  xs: 'h-[4px] w-[4px]',
  sm: 'h-[5px] w-[5px]',
  md: 'h-[6px] w-[6px]',
} as const;

const ICON_SIZE = {
  xs: '[&_svg]:h-[9px] [&_svg]:w-[9px]',
  sm: '[&_svg]:h-[10px] [&_svg]:w-[10px]',
  md: '[&_svg]:h-3 [&_svg]:w-3',
} as const;

type SignalChipSize = keyof typeof DOT_SIZE;

export interface SignalChipProps
  extends Omit<VariantProps<typeof signalChipVariants>, 'interactive'> {
  /** Rótulo do sinal. Renderizado em caixa alta pelo primitivo. */
  label: React.ReactNode;
  tone?: SignalChipTone;
  size?: SignalChipSize;
  /** Substitui o ponto por um ícone, que herda o tom. */
  icon?: React.ReactNode;
  /** Remove o indicador à esquerda (rótulo puro). */
  hideDot?: boolean;
  /** Pulsa o indicador. Ligado por padrão no tom `live`. */
  pulse?: boolean;
  /** Estado selecionado — eleva fundo e hairline. Para uso como filtro. */
  active?: boolean;
  href?: string;
  onClick?: () => void;
  title?: string;
  'aria-label'?: string;
  className?: string;
}

export function SignalChip({
  label,
  tone = 'neutral',
  size = 'sm',
  icon,
  hideDot = false,
  pulse,
  active = false,
  href,
  onClick,
  title,
  className,
  ...rest
}: SignalChipProps) {
  const interactive = Boolean(href || onClick);
  const shouldPulse = pulse ?? tone === 'live';

  const style = {
    '--sig-tone': TONE_VAR[tone],
    '--sig-fill': active ? FILL.active : FILL.rest,
    '--sig-ring': active ? RING.active : RING.rest,
    '--sig-fill-hover': active ? FILL.active : FILL.hover,
    '--sig-ring-hover': active ? RING.active : RING.hover,
  } as React.CSSProperties;

  const classes = cn(signalChipVariants({ size, interactive }), className);

  const indicator = icon ? (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center text-[color:var(--sig-tone)]',
        ICON_SIZE[size],
        shouldPulse && 'animate-pulse motion-reduce:animate-none',
      )}
    >
      {icon}
    </span>
  ) : !hideDot ? (
    <span
      aria-hidden
      className={cn(
        'shrink-0 rounded-full bg-[color:var(--sig-tone)]',
        'shadow-[0_0_0_2px_color-mix(in_oklab,var(--sig-tone)_20%,transparent)]',
        DOT_SIZE[size],
        shouldPulse && 'animate-pulse motion-reduce:animate-none',
      )}
    />
  ) : null;

  const inner = (
    <>
      {indicator}
      <span className="min-w-0 truncate">{label}</span>
    </>
  );

  if (href) {
    return (
      <Link href={href} title={title} style={style} className={classes} {...rest}>
        {inner}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-pressed={active}
        style={style}
        className={classes}
        {...rest}
      >
        {inner}
      </button>
    );
  }

  return (
    <span title={title} style={style} className={classes} {...rest}>
      {inner}
    </span>
  );
}

export { signalChipVariants };
