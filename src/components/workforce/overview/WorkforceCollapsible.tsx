'use client';

/**
 * Bloco recolhível do cockpit.
 *
 * Extraído do `CollapsibleDetailPanel`, onde vivia como componente local. Dois
 * consumidores agora precisam do mesmo comportamento — o Detalhamento e o
 * Ajuste manual de quadro — e duplicar a marcação garantiria que os dois
 * divergissem no primeiro ajuste de espaçamento.
 *
 * Fica fechado por padrão: é conteúdo de consulta, não de leitura corrida.
 */

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';

interface WorkforceCollapsibleProps {
  title: string;
  /** Ícone à esquerda do título. */
  icon?: ReactNode;
  /** Contador ao lado do título (nº de linhas, competências…). */
  count?: number;
  /** Linha de apoio sob o título — some quando o bloco está aberto. */
  hint?: string;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}

export function WorkforceCollapsible({
  title,
  icon,
  count,
  hint,
  defaultOpen = false,
  className,
  children,
}: WorkforceCollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={cn('overflow-hidden rounded-xl border border-ig-border-subtle', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 bg-ig-panel px-4 py-3 text-left transition-colors hover:bg-ig-panel-hover"
      >
        <span className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate text-sm font-medium text-ig-fg-strong">{title}</span>
          {count !== undefined && (
            <span className="rounded border border-ig-border-subtle bg-ig-panel-hover px-1.5 py-0.5 text-xs text-ig-fg-subtle">
              {count}
            </span>
          )}
          {hint && !open && (
            <span className="hidden truncate text-[11px] text-ig-fg-muted sm:inline">— {hint}</span>
          )}
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-ig-fg-muted" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-ig-fg-muted" />
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="border-t border-ig-border-subtle bg-ig-bg px-4 pb-4 pt-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
