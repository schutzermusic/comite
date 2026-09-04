'use client';

/**
 * Estado vazio de UMA LINHA.
 *
 * Os vazios do módulo ocupavam 250–350px explicando o modelo de dados inteiro
 * ("Sem marco, a etapa 'Medido' da cadeia até o caixa não pode ser apurada — e
 * o faturamento não tem lastro de medição."). Numa carteira nova, a tela era
 * quase toda feita de parágrafos didáticos.
 *
 * A honestidade semântica não muda: ausência continua sendo ausência, e nunca
 * zero. O que muda é o volume — o porquê vive em `help`, disponível no
 * `title`/`aria-describedby`, em vez de gritar em todo carregamento.
 */

import type { ReactNode } from 'react';
import { useId } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface InlineEmptyProps {
  /** O que não existe. Ex.: "Nenhum marco de medição registrado". */
  message: ReactNode;
  /** Consequência/explicação. Vira tooltip, não parágrafo. */
  help?: string;
  /** Ação única para resolver a ausência. */
  action?: { label: string; onClick: () => void };
  className?: string;
}

export function InlineEmpty({ message, help, action, className }: InlineEmptyProps) {
  const helpId = useId();

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 py-2 text-ig-body-sm text-ig-fg-muted',
        className,
      )}
    >
      <span aria-describedby={help ? helpId : undefined}>{message}</span>

      {help && (
        <>
          <Info
            className="h-3.5 w-3.5 shrink-0 text-ig-fg-subtle"
            aria-hidden
            /* title no ícone dá o tooltip nativo ao mouse... */
            {...{ title: help }}
          />
          {/* ...e este nó, invisível, dá o mesmo texto ao leitor de tela. */}
          <span id={helpId} className="sr-only">
            {help}
          </span>
        </>
      )}

      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="ml-auto shrink-0 rounded-[8px] px-2 py-1 text-ig-caption font-medium text-ig-accent transition-colors hover:bg-ig-accent-weak focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ig-border-focus"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
