'use client';

/**
 * Connected Operations — o contrato como objeto central conectado ao resto do
 * Insight (MD §10 do adendo).
 *
 * Cada linha mostra a relação E o seu estado atual, e leva ao módulo que é dono
 * daquele domínio. Nenhuma linha cria fonte de verdade paralela: os números vêm
 * das relações do próprio contrato, e o clique entrega o assunto a quem o
 * governa.
 *
 * Uma linha cujo estado não pôde ser apurado diz isso — não desaparece nem
 * mostra zero, que sugeriria "verificado e vazio". E uma linha cuja integração
 * não existe diz "Não integrado", que é uma afirmação sobre o produto, não
 * sobre a operação do contrato.
 */

import { cn } from '@/lib/utils';
import {
  Workflow, Receipt, ClipboardCheck, Archive, ShieldAlert, ShieldCheck,
  ChevronRight, AlertTriangle, CalendarClock, History, Wallet, Unplug, Ruler, Scale,
} from 'lucide-react';
import type { TrustedContract } from '@/lib/contracts/trust/read-model';
import {
  buildConnectedRows, type ConnectedContext, type ConnectedOperationKey,
  type ConnectedRow, type ConnectedTone,
} from '@/lib/contracts/trust/connected';

export type { ConnectedOperationKey, ConnectedContext };

const ICON: Record<ConnectedOperationKey, React.ReactNode> = {
  project: <Workflow className="h-4 w-4" aria-hidden />,
  tasks: <CalendarClock className="h-4 w-4" aria-hidden />,
  obligations: <ClipboardCheck className="h-4 w-4" aria-hidden />,
  measurement: <Ruler className="h-4 w-4" aria-hidden />,
  billing: <Receipt className="h-4 w-4" aria-hidden />,
  documents: <Archive className="h-4 w-4" aria-hidden />,
  risks: <ShieldAlert className="h-4 w-4" aria-hidden />,
  clauses: <Scale className="h-4 w-4" aria-hidden />,
  approvals: <ShieldCheck className="h-4 w-4" aria-hidden />,
  audit: <History className="h-4 w-4" aria-hidden />,
  finance: <Wallet className="h-4 w-4" aria-hidden />,
};

const TONE_TEXT: Record<ConnectedTone, string> = {
  neutral: 'text-ig-fg-strong',
  success: 'text-ig-success',
  warning: 'text-ig-warning',
  danger: 'text-ig-danger',
};

export interface ConnectedOperationsProps {
  contract: TrustedContract;
  /** Contagens vindas dos módulos donos (Agenda, Auditoria). */
  context?: ConnectedContext;
  onNavigate?: (key: ConnectedOperationKey) => void;
  className?: string;
}

export function ConnectedOperations({
  contract, context, onNavigate, className,
}: ConnectedOperationsProps) {
  const rows = buildConnectedRows(contract, context);

  return (
    <ul className={cn('divide-y divide-ig-border-subtle overflow-hidden rounded-[14px] border border-ig-border-subtle', className)}>
      {rows.map((row) => (
        <ConnectedOperationRow key={row.key} row={row} onNavigate={onNavigate} />
      ))}
    </ul>
  );
}

function ConnectedOperationRow({
  row, onNavigate,
}: { row: ConnectedRow; onNavigate?: (key: ConnectedOperationKey) => void }) {
  const interactive = Boolean(onNavigate);
  const Comp: React.ElementType = interactive ? 'button' : 'div';

  return (
    <li>
      <Comp
        type={interactive ? 'button' : undefined}
        onClick={interactive ? () => onNavigate?.(row.key) : undefined}
        title={row.note ?? undefined}
        className={cn(
          'group flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors',
          interactive && [
            'cursor-pointer hover:bg-[color-mix(in_oklab,var(--ig-accent)_6%,transparent)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
          ],
        )}
      >
        <span className={cn(
          'shrink-0 transition-colors',
          row.notIntegrated ? 'text-ig-fg-subtle/60' : 'text-ig-fg-subtle group-hover:text-ig-accent',
        )}>
          {ICON[row.key]}
        </span>

        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-ig-body-sm text-ig-fg-muted">{row.label}</span>
          {/*
            O módulo dono, para que ninguém confunda leitura com posse do dado —
            e só quando ele acrescenta informação. "Riscos / Riscos" é ruído.
          */}
          {row.owner !== 'Contratos' && !row.owner.startsWith(row.label) && (
            <span className="truncate text-ig-label text-ig-fg-subtle">{row.owner}</span>
          )}
        </span>

        {row.notIntegrated ? (
          <span className="flex shrink-0 items-center gap-1 text-ig-caption font-medium text-ig-fg-subtle">
            <Unplug className="h-3 w-3" aria-hidden />
            Não integrado
          </span>
        ) : row.errored ? (
          <span className="flex shrink-0 items-center gap-1 text-ig-caption font-medium text-ig-danger">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            Indisponível
          </span>
        ) : row.state === null ? (
          <span className="shrink-0 text-ig-caption text-ig-fg-subtle">Não apurado</span>
        ) : (
          <span className={cn('shrink-0 truncate text-ig-body-sm font-semibold', TONE_TEXT[row.tone])}>
            {row.state}
          </span>
        )}

        {interactive && (
          <ChevronRight
            className="h-3.5 w-3.5 shrink-0 text-ig-fg-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-ig-accent"
            aria-hidden
          />
        )}
      </Comp>
    </li>
  );
}
