'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

/**
 * Painel lateral de detalhe/ato sobre o Radix Dialog: papel de diálogo, foco
 * preso dentro, Esc fecha, o foco VOLTA ao elemento que abriu, e o título é o
 * nome acessível. No celular ocupa a tela, com a ação principal fixa embaixo.
 */
export function SidePanel({ open, onClose, eyebrow, title, meta, children, footer, testId, wide }: {
  open: boolean; onClose: () => void; eyebrow?: ReactNode; title: string; meta?: ReactNode;
  children: ReactNode; footer?: ReactNode; testId?: string; wide?: boolean;
}) {
  /*
    O painel abre pela URL (sem Dialog.Trigger), então o Radix não sabe a quem
    devolver o foco. Guarda-se quem tinha o foco ao abrir e devolve-se a ele —
    senão o foco cai no <body> e o teclado recomeça do topo da página.
  */
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open && typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) opener.current = document.activeElement;
  }, [open]);
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="ax-overlay" />
        <Dialog.Content className={wide ? 'ax ax-sheet wide' : 'ax ax-sheet'} data-testid={testId}
          onCloseAutoFocus={(e) => {
            const el = opener.current;
            if (el && el.isConnected) { e.preventDefault(); el.focus(); }
          }}>
          <div className="ax-sheet-head">
            <div className="ax-between">
              {eyebrow ? <span className="ax-eyebrow">{eyebrow}</span> : <span />}
              <Dialog.Close className="ax-btn ghost sm icon" aria-label="Fechar painel"><X size={16} /></Dialog.Close>
            </div>
            <Dialog.Title asChild><h2>{title}</h2></Dialog.Title>
            {meta ? <Dialog.Description asChild><div className="ax-context">{meta}</div></Dialog.Description>
              : <Dialog.Description className="sr-only-ax">{title}</Dialog.Description>}
          </div>
          <div className="ax-sheet-body">{children}</div>
          {footer && <div className="ax-sheet-foot">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="ax-section" aria-label={title}>
      <div className="ax-between"><h4>{title}</h4>{action}</div>
      {children}
    </section>
  );
}
