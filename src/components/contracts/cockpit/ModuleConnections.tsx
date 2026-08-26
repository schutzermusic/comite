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
  const operating = connections.filter(
    (c) => c.state === 'healthy' || c.state === 'attention' || c.state === 'critical',
  );
  const awaiting = connections.filter((c) => c.state === 'unmeasured');
  const detached = connections.filter((c) => c.state === 'not-integrated');

  const total = connections.length;

  return (
    <div className={cn('relative', className)}>
      {/*
        O NÓ e a espinha.

        A espinha sozinha era um traço; faltava a origem. O nó nomeia o que está
        no topo da relação — o contrato — e é dele que a linha desce até cada
        banda. É a diferença entre uma lista com um enfeite vertical e uma
        superfície que afirma quem orquestra quem.

        Some abaixo de `sm`: em coluna única a leitura de hierarquia se perde e
        o traço vira ruído.
      */}
      <div className="relative mb-2.5 hidden items-center gap-2 sm:flex">
        <span
          className="relative z-10 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-ig-accent/60 bg-ig-bg-panel"
          aria-hidden
        >
          <span className="h-1.5 w-1.5 rounded-full bg-ig-accent" />
        </span>
        <span className="text-ig-label uppercase tracking-[0.14em] text-ig-fg-muted">
          Contrato
        </span>
        <span className="h-px flex-1 bg-[linear-gradient(90deg,color-mix(in_oklab,var(--ig-accent)_40%,transparent),transparent)]" aria-hidden />
        <span className="shrink-0 text-ig-caption text-ig-fg-subtle">
          {total} módulos
        </span>
      </div>

      <span
        className="pointer-events-none absolute bottom-3 left-[7px] top-1 hidden w-px bg-[linear-gradient(180deg,color-mix(in_oklab,var(--ig-accent)_45%,transparent),color-mix(in_oklab,var(--ig-border-strong)_60%,transparent))] sm:block"
        aria-hidden
      />

      <div className="space-y-3">
        {operating.length > 0 && (
          <Band label="Em operação" count={operating.length}>
            <div className="grid gap-3 sm:grid-cols-2">
              {operating.map((conn) => (
                <ConnectionCard key={conn.key} connection={conn} onNavigate={onNavigate} />
              ))}
            </div>
          </Band>
        )}

        {awaiting.length > 0 && (
          <Band label="Aguardando registro" count={awaiting.length}>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {awaiting.map((conn) => (
                <CompactRow key={conn.key} connection={conn} onNavigate={onNavigate} />
              ))}
            </ul>
          </Band>
        )}

        {detached.length > 0 && (
          <Band label="Não integrado" count={detached.length} muted>
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
              {detached.map((conn) => (
                <li key={conn.key} className="flex items-center gap-1.5 text-ig-caption text-ig-fg-subtle">
                  <Unplug className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="font-medium">{conn.label}</span>
                  {conn.note && <span className="text-ig-fg-subtle/80">— {conn.note}</span>}
                </li>
              ))}
            </ul>
          </Band>
        )}
      </div>
    </div>
  );
}

/** Uma banda da espinha: rótulo à esquerda, conteúdo à direita. */
function Band({
  label, count, muted = false, children,
}: {
  label: string; count: number; muted?: boolean; children: React.ReactNode;
}) {
  return (
    <section className="relative sm:pl-7">
      {/* Cotovelo: liga a espinha ao rótulo da banda. */}
      <span
        className={cn(
          'pointer-events-none absolute left-[7px] top-[8px] hidden h-px w-3.5 sm:block',
          muted ? 'bg-ig-border-strong' : 'bg-ig-accent/50',
        )}
        aria-hidden
      />
      <span
        className={cn(
          'pointer-events-none absolute left-[4px] top-[5px] hidden h-1.5 w-1.5 rounded-full sm:block',
          muted ? 'bg-ig-border-strong' : 'bg-ig-accent',
        )}
        aria-hidden
      />
      <header className="mb-1.5 flex items-baseline gap-2">
        <span className={cn(
          'text-ig-label uppercase tracking-[0.14em]',
          muted ? 'text-ig-fg-subtle' : 'text-ig-fg-muted',
        )}>
          {label}
        </span>
        <span className="ig-tabular text-ig-caption font-semibold text-ig-fg-subtle">{count}</span>
      </header>
      {children}
    </section>
  );
}

/** Módulo integrado que ainda não tem registro: uma linha, não um card. */
function CompactRow({
  connection: c, onNavigate,
}: {
  connection: ModuleConnection; onNavigate?: (key: ModuleKey) => void;
}) {
  const interactive = Boolean(c.href || onNavigate);
  /*
    Rótulo e estado EMPILHADOS, não lado a lado.

    Em linha, numa coluna estreita, o estado (`shrink-0`) vencia a disputa e o
    nome do módulo truncava para "Fa…" e "Do…" — metadado ilegível é pior que
    metadado ausente, porque ainda ocupa a linha e não informa nada.
  */
  const inner = (
    <>
      <span className="mt-0.5 shrink-0 text-ig-fg-subtle">{ICON[c.key]}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ig-body-sm text-ig-fg-strong">{c.label}</span>
        <span className="mt-0.5 block truncate text-ig-caption text-ig-fg-subtle">
          {c.headline ?? STATE[c.state].label}
        </span>
      </span>
    </>
  );
  const cls = cn(
    'flex w-full items-start gap-2 rounded-[10px] border border-ig-border-subtle bg-ig-panel/40 px-3 py-2 text-left transition-colors',
    interactive && 'hover:border-ig-border-focus hover:bg-ig-panel-hover/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
  );

  return (
    <li>
      {c.href ? (
        <Link href={c.href} className={cls}>{inner}</Link>
      ) : onNavigate ? (
        <button type="button" onClick={() => onNavigate(c.key)} className={cls}>{inner}</button>
      ) : (
        <div className={cls}>{inner}</div>
      )}
    </li>
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
          <p className={cn('ig-tabular text-ig-kpi-md leading-none', notIntegrated ? 'text-ig-fg-subtle' : 'text-ig-fg-strong')}>
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
