'use client';

/**
 * Operações conectadas no nível da carteira.
 *
 * Torna visível que o contrato é o objeto central da operação:
 *
 *   Contrato → Projeto → Obrigação → Medição → Faturamento → Financeiro
 *            → Risco → Aprovação → Auditoria
 *
 * Cada card responde três coisas — estado atual, se aquele estado é apurado, e
 * para onde ir. Nenhuma conexão decorativa: um "Financeiro ✓" que não diz nada
 * e não leva a lugar nenhum ocupa atenção e devolve zero, então o módulo não
 * integrado é declarado como tal, com o motivo.
 */

import Link from 'next/link';
import { cn } from '@/lib/utils';
import {
  Workflow, Wallet, Receipt, ClipboardCheck, Archive, ShieldAlert,
  ShieldCheck, CalendarClock, History, ArrowUpRight, AlertTriangle, Unplug,
} from 'lucide-react';
import type { ModuleConnection, ModuleKey, ModuleLinkState } from '@/lib/contracts/trust/command-center';

const ICON: Record<ModuleKey, React.ReactNode> = {
  projetos: <Workflow className="h-4 w-4" aria-hidden />,
  financeiro: <Wallet className="h-4 w-4" aria-hidden />,
  faturamento: <Receipt className="h-4 w-4" aria-hidden />,
  obrigacoes: <ClipboardCheck className="h-4 w-4" aria-hidden />,
  documentos: <Archive className="h-4 w-4" aria-hidden />,
  riscos: <ShieldAlert className="h-4 w-4" aria-hidden />,
  aprovacoes: <ShieldCheck className="h-4 w-4" aria-hidden />,
  tarefas: <CalendarClock className="h-4 w-4" aria-hidden />,
  auditoria: <History className="h-4 w-4" aria-hidden />,
};

const STATE: Record<ModuleLinkState, { rail: string; text: string; label: string }> = {
  healthy: { rail: 'bg-ig-success', text: 'text-ig-success', label: 'Regular' },
  attention: { rail: 'bg-ig-warning', text: 'text-ig-warning', label: 'Atenção' },
  critical: { rail: 'bg-ig-danger', text: 'text-ig-danger', label: 'Crítico' },
  unmeasured: { rail: 'bg-ig-border-strong', text: 'text-ig-fg-subtle', label: 'Não apurado' },
  'not-integrated': { rail: 'bg-ig-border-strong', text: 'text-ig-fg-subtle', label: 'Não integrado' },
};

export interface ModuleConnectionsProps {
  connections: readonly ModuleConnection[];
  onNavigate?: (key: ModuleKey) => void;
  className?: string;
}

export function ModuleConnections({ connections, onNavigate, className }: ModuleConnectionsProps) {
  return (
    <div className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-3', className)}>
      {connections.map((conn) => (
        <ConnectionCard key={conn.key} connection={conn} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

function ConnectionCard({
  connection: c,
  onNavigate,
}: {
  connection: ModuleConnection;
  onNavigate?: (key: ModuleKey) => void;
}) {
  const s = STATE[c.state];
  const notIntegrated = c.state === 'not-integrated';
  const interactive = Boolean(c.href || onNavigate) && !notIntegrated;

  const body = (
    <>
      <span className={cn('pointer-events-none absolute inset-y-0 left-0 w-[3px]', s.rail)} aria-hidden />

      <header className="flex items-center gap-2">
        <span className={cn('shrink-0 transition-colors', notIntegrated ? 'text-ig-fg-subtle' : 'text-ig-fg-muted group-hover:text-ig-accent')}>
          {ICON[c.key]}
        </span>
        <span className="min-w-0 flex-1 truncate text-ig-body-sm font-medium text-ig-fg-strong">
          {c.label}
        </span>
        {interactive && (
          <ArrowUpRight
            className="h-3.5 w-3.5 shrink-0 text-ig-fg-subtle opacity-0 transition-all group-hover:opacity-100 group-hover:text-ig-accent"
            aria-hidden
          />
        )}
      </header>

      {/* Métrica principal, ou a declaração de que não há. */}
      <div className="mt-2.5 min-h-[38px]">
        {c.headline ? (
          <p className={cn('ig-tabular text-[24px] font-semibold leading-none', notIntegrated ? 'text-ig-fg-subtle' : 'text-ig-fg-strong')}>
            {c.headline}
          </p>
        ) : (
          <p className={cn('flex items-center gap-1.5 text-ig-body-sm font-medium', s.text)}>
            {c.state === 'critical' && <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            {notIntegrated && <Unplug className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            {s.label}
          </p>
        )}
        {c.detail && (
          <p className="mt-1 line-clamp-2 text-ig-caption leading-relaxed text-ig-fg-muted">{c.detail}</p>
        )}
      </div>

      {/*
        O motivo aparece na própria superfície, não num tooltip: quem lê um
        painel de carteira precisa saber por que um módulo está mudo sem ter de
        descobrir que existe um tooltip ali.
      */}
      {c.note && (
        <p className="mt-2 border-t border-ig-border-subtle pt-2 text-ig-caption leading-relaxed text-ig-fg-subtle">
          {c.note}
        </p>
      )}
    </>
  );

  const shell = cn(
    'group relative flex flex-col overflow-hidden rounded-[16px] border px-4 py-3.5 text-left transition-all duration-200',
    notIntegrated
      ? 'border-dashed border-ig-border-subtle bg-transparent'
      : 'border-ig-border-subtle bg-[color-mix(in_oklab,var(--ig-bg-raised)_50%,transparent)]',
    interactive && [
      'cursor-pointer hover:-translate-y-px hover:border-ig-border-focus',
      'hover:shadow-[0_10px_28px_-14px_color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
    ],
  );

  if (c.href && interactive) {
    return <Link href={c.href} className={shell}>{body}</Link>;
  }
  if (interactive && onNavigate) {
    return (
      <button type="button" onClick={() => onNavigate(c.key)} className={shell}>
        {body}
      </button>
    );
  }
  return <div className={shell}>{body}</div>;
}
