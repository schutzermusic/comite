'use client';

/**
 * Átomos visuais do Portal de Ponto.
 *
 * Tudo aqui é escrito sobre os tokens `--ig-*` do Insight Apex (cores,
 * raio, sombra, tipografia) — nenhuma cor ou espaçamento arbitrário. Em
 * claro e escuro o tema resolve sozinho, porque as variáveis trocam no
 * `<html>`. Alvos de toque respeitam 44px e o foco é sempre visível.
 */

import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ───────────────────── tom semântico ───────────────────── */

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

/** Cor de texto/ícone por tom. */
export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-ig-fg-muted',
  accent: 'text-ig-accent',
  success: 'text-ig-success',
  warning: 'text-ig-warning',
  danger: 'text-ig-danger',
  info: 'text-ig-info',
};

/** Fundo suave + borda do mesmo tom, para chips e faixas. */
export const TONE_SURFACE: Record<Tone, string> = {
  neutral: 'bg-ig-panel border-ig-border text-ig-fg-muted',
  accent: 'bg-[color-mix(in_oklab,var(--ig-accent)_14%,transparent)] border-[color-mix(in_oklab,var(--ig-accent)_38%,transparent)] text-ig-accent',
  success: 'bg-[color-mix(in_oklab,var(--ig-success)_14%,transparent)] border-[color-mix(in_oklab,var(--ig-success)_38%,transparent)] text-ig-success',
  warning: 'bg-[color-mix(in_oklab,var(--ig-warning)_14%,transparent)] border-[color-mix(in_oklab,var(--ig-warning)_38%,transparent)] text-ig-warning',
  danger: 'bg-[color-mix(in_oklab,var(--ig-danger)_14%,transparent)] border-[color-mix(in_oklab,var(--ig-danger)_38%,transparent)] text-ig-danger',
  info: 'bg-[color-mix(in_oklab,var(--ig-info)_14%,transparent)] border-[color-mix(in_oklab,var(--ig-info)_38%,transparent)] text-ig-info',
};

/* ───────────────────── superfícies ───────────────────── */

export const PontoCard = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { as?: 'div' | 'section' | 'article' }
>(function PontoCard({ className, as: Tag = 'div', ...props }, ref) {
  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement>}
      className={cn(
        'rounded-[var(--ig-radius-lg)] border border-ig-border bg-ig-raised',
        'shadow-[var(--ig-shadow-e1)]',
        className,
      )}
      {...props}
    />
  );
});

/** Rótulo de seção — caixa alta discreta, o padrão das telas do Apex. */
export function SectionLabel({
  children,
  icon: Icon,
  className,
  action,
}: {
  children: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-3', className)}>
      <h2 className="flex items-center gap-1.5 text-ig-label uppercase text-ig-fg-muted">
        {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
        {children}
      </h2>
      {action}
    </div>
  );
}

/* ───────────────────── botões ───────────────────── */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  // `--ig-accent-fg` inverte com o tema: no escuro o verde da marca é claro
  // demais para texto branco (3,6:1) e pede texto escuro; no claro o verde
  // escurece e carrega branco. Branco fixo reprovaria em AA no escuro.
  primary:
    'bg-ig-accent text-[var(--ig-accent-fg,#fff)] border-transparent hover:bg-ig-accent-strong active:bg-ig-accent-strong',
  secondary:
    'bg-ig-panel text-ig-fg-strong border-ig-border-strong hover:bg-ig-panel-hover',
  ghost: 'bg-transparent text-ig-fg-muted border-transparent hover:text-ig-fg-strong',
  danger:
    'bg-transparent text-ig-danger border-[color-mix(in_oklab,var(--ig-danger)_40%,transparent)] hover:bg-[color-mix(in_oklab,var(--ig-danger)_10%,transparent)]',
};

export interface PontoButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: LucideIcon;
  /** Ocupa a largura toda — padrão no mobile. */
  block?: boolean;
  loading?: boolean;
}

export const PontoButton = React.forwardRef<HTMLButtonElement, PontoButtonProps>(
  function PontoButton(
    { className, variant = 'secondary', icon: Icon, block = true, loading, children, disabled, type = 'button', ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(
          'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-[var(--ig-radius-md)] border',
          'px-4 text-ig-h3 transition-colors',
          'focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]',
          'disabled:cursor-not-allowed disabled:opacity-55',
          block && 'w-full',
          BUTTON_VARIANT[variant],
          className,
        )}
        {...props}
      >
        {loading ? <Spinner className="h-4 w-4" /> : Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}
        {children}
      </button>
    );
  },
);

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Carregando"
      className={cn(
        'inline-block animate-spin rounded-full border-2 border-current border-t-transparent opacity-70',
        className ?? 'h-5 w-5',
      )}
    />
  );
}

/* ───────────────────── badge de status ───────────────────── */

export interface StatusBadgeProps {
  label: string;
  tone?: Tone;
  icon?: LucideIcon;
  className?: string;
}

/**
 * Badge do Ponto. O ícone acompanha o texto de propósito: nenhum estado
 * é comunicado apenas pela cor (WCAG 2.2 — 1.4.1).
 */
export function StatusBadge({ label, tone = 'neutral', icon: Icon, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        // `whitespace-nowrap` + `shrink-0`: em 320px o rótulo não pode
        // quebrar no meio ("Em aná / lise") nem ser espremido pelo vizinho.
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1',
        'text-ig-caption font-semibold leading-none',
        TONE_SURFACE[tone],
        className,
      )}
    >
      {Icon ? <Icon className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
      {label}
    </span>
  );
}

/* ───────────────────── vazio / carregando ───────────────────── */

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-10 text-center', className)}>
      {Icon ? (
        <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-ig-border bg-ig-panel">
          <Icon className="h-5 w-5 text-ig-fg-subtle" aria-hidden="true" />
        </span>
      ) : null}
      <p className="text-ig-h3 text-ig-fg-strong">{title}</p>
      {description ? <p className="mt-1.5 max-w-[34ch] text-ig-body-sm text-ig-fg-muted">{description}</p> : null}
      {action ? <div className="mt-5 w-full max-w-[260px]">{action}</div> : null}
    </div>
  );
}

export function PontoSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-[var(--ig-radius-md)] bg-ig-panel', className)}
    />
  );
}

/* ───────────────────── linha rótulo/valor ───────────────────── */

export function DataRow({
  label,
  value,
  tone = 'neutral',
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  tone?: Tone;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="flex items-center gap-1.5 text-ig-body-sm text-ig-fg-muted">
        {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
        {label}
      </span>
      <span className={cn('ig-tabular text-right text-ig-body-sm font-semibold', TONE_TEXT[tone])}>{value}</span>
    </div>
  );
}
