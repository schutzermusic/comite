'use client';

/**
 * Alternância de tema claro/escuro.
 *
 * Não é um interruptor de estado oculto: são duas opções nomeadas com
 * `aria-pressed`, para o leitor de tela anunciar qual está ativa. No
 * campo isso importa — o colaborador troca para o claro sob sol forte e
 * para o escuro à noite, e precisa saber onde está.
 */

import * as React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { cn } from '@/lib/utils';

const OPTIONS = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Escuro', icon: Moon },
] as const;

export function ThemeToggle({
  variant = 'compact',
  className,
}: {
  /** `compact` = só ícones (cabeçalho); `full` = com rótulo (Perfil). */
  variant?: 'compact' | 'full';
  className?: string;
}) {
  const { theme, setTheme } = useTheme();
  const full = variant === 'full';

  return (
    <div
      role="group"
      aria-label="Aparência do aplicativo"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full border border-ig-border bg-ig-panel p-0.5',
        full && 'w-full',
        className,
      )}
    >
      {OPTIONS.map((option) => {
        const active = theme === option.value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => setTheme(option.value)}
            title={full ? undefined : `Tema ${option.label.toLowerCase()}`}
            className={cn(
              'flex min-h-[44px] items-center justify-center gap-2 rounded-full transition-colors',
              'text-ig-body-sm font-semibold',
              'focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]',
              full ? 'flex-1 px-4' : 'min-w-[44px] px-3',
              active
                ? 'bg-ig-accent text-[var(--ig-accent-fg,#fff)]'
                : 'text-ig-fg-subtle hover:text-ig-fg-strong',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className={full ? undefined : 'sr-only'}>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
