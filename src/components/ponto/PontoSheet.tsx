'use client';

/**
 * Folha inferior do Portal de Ponto.
 *
 * Construída sobre o Radix Dialog que o Insight Apex já usa — daí vêm de
 * graça o foco preso, o Esc, o `aria-modal` e o retorno do foco ao
 * fechar. A pele é dos tokens `--ig-*`; a animação só roda quando o
 * sistema não pede movimento reduzido (`motion-safe`).
 */

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PontoSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Some visualmente, mas continua anunciado pelo leitor de tela. */
  hideTitle?: boolean;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Ocupa a tela toda — usado pela câmera. */
  fullscreen?: boolean;
  className?: string;
}

export function PontoSheet({
  open,
  onOpenChange,
  title,
  hideTitle,
  description,
  children,
  footer,
  fullscreen,
  className,
}: PontoSheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-[70] bg-black/60 backdrop-blur-[2px]',
            'motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0',
            'motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:fade-out-0',
          )}
        />
        <Dialog.Content
          // A folha renderiza em portal, fora da casca — precisa carregar o
          // escopo da marca para herdar os tokens da paleta.
          data-ponto-theme
          className={cn(
            'fixed inset-x-0 bottom-0 z-[71] mx-auto flex w-full max-w-md flex-col',
            'rounded-t-[var(--ig-radius-xl)] border-t border-ig-border-strong bg-ig-overlay',
            'shadow-[var(--ig-shadow-e4)] focus:outline-none',
            fullscreen ? 'top-0 rounded-none border-t-0' : 'max-h-[92dvh]',
            'motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:slide-in-from-bottom-4',
            'motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:slide-out-to-bottom-4',
            'motion-safe:duration-200',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 px-5 pb-2 pt-5">
            <div className={cn('min-w-0', hideTitle && 'sr-only')}>
              <Dialog.Title className="text-ig-h2 text-ig-fg-strong">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-ig-body-sm text-ig-fg-muted">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            {!description && hideTitle ? (
              <Dialog.Description className="sr-only">{title}</Dialog.Description>
            ) : null}
            <Dialog.Close
              className={cn(
                'ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--ig-radius-md)]',
                'text-ig-fg-subtle transition-colors hover:bg-ig-panel-hover hover:text-ig-fg-strong',
                'focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]',
              )}
              aria-label="Fechar"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-2">{children}</div>

          {footer ? (
            <div className="border-t border-ig-border px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
              {footer}
            </div>
          ) : (
            <div className="pb-[max(1.25rem,env(safe-area-inset-bottom))]" />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
