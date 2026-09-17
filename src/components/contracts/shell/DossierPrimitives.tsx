'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type DossierTone = 'positive' | 'attention' | 'unknown' | 'disconnected' | 'critical';

/** Presentation only: callers supply the state from the governed read model. */
export function DossierStatus({ tone = 'unknown', children }: { tone?: DossierTone; children: ReactNode }) {
  return <span className="dossier-status" data-tone={tone}><i aria-hidden />{children}</span>;
}

export function DossierSection({ title, hint, action, children, className }: {
  title: string; hint?: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return <section className={cn('dossier-surface', className)}>
    <header className="dossier-section-head"><div><h3>{title}</h3>{hint && <p>{hint}</p>}</div>{action}</header>
    <div className="dossier-section-body">{children}</div>
  </section>;
}

export function DossierDisclosure({ title, count, children, open = false }: {
  title: string; count?: number; children: ReactNode; open?: boolean;
}) {
  return <details className="dossier-disclosure" open={open || undefined}>
    <summary><span>{title}</span>{count !== undefined && <span className="dossier-count">{count}</span>}<ChevronDown aria-hidden className="ml-auto h-4 w-4" /></summary>
    <div className="dossier-disclosure-body">{children}</div>
  </details>;
}

/** One accessible detail surface: focus trap, Escape, close and focus restoration. */
export function DossierDetailDrawer({ isOpen, onClose, title, subtitle, children, footer }: {
  isOpen: boolean; onClose: () => void; title: string; subtitle?: string;
  children: ReactNode; footer?: ReactNode;
}) {
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => { if (isOpen) opener.current = document.activeElement as HTMLElement; }, [isOpen]);
  return <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="dossier-detail-overlay" />
      <Dialog.Content className="ig-dossier-theme dossier-detail" onCloseAutoFocus={(event) => {
        event.preventDefault(); opener.current?.focus();
      }}>
        <header className="dossier-detail-head">
          <div><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{subtitle ?? 'Detalhes e origem do registro'}</Dialog.Description></div>
          <Dialog.Close className="dossier-icon-button" aria-label="Fechar detalhes"><X className="h-5 w-5" /></Dialog.Close>
        </header>
        <div className="dossier-detail-body">{children}</div>
        {footer && <footer className="dossier-detail-footer">{footer}</footer>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
