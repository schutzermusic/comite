'use client';

/**
 * Primitivos de tela de Operações e Supply.
 *
 * NÃO é um segundo design system: são os primitivos do Comercial V3
 * (cabeçalho único, métricas com fonte, painel, tabela que vira cartão no
 * celular, estado com texto + cor) reexportados com o nome do lugar onde são
 * usados, mais o CSS do que só Operações desenha (fila de exceção com tom,
 * horizonte, matriz de risco, revisão de linhas lidas).
 */
import type { ReactNode } from 'react';
import './operations.css';

export {
  WorkspaceHeading, StatePill, UnlockHint, Metrics, Panel, Toolbar, Filter, Segments, DataTable,
  EmptyNote, GovernanceNote, moneyTotal, matches, type Tone,
} from '@/components/commercial/workspace';
export {
  useCommercialResource as useOperationsResource, ResourceState, brl, day,
  notifyCommercialChanged as notifyOperationsChanged,
} from '@/components/commercial/shared';

/** Separador do cabeçalho vivo ("3 abertas · 1 bloqueante"). */
export function LiveSep() {
  return <i className="crm-live-sep" aria-hidden />;
}

/** Abas de workspace com semântica de tablist (teclado e leitor de tela). */
export function WorkspaceTabs<T extends string>({
  label, tabs, active, onChange,
}: {
  label: string;
  tabs: Array<{ id: T; label: string; count?: number; tone?: 'danger' | 'warning' }>;
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="ops-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`ops-tab-${tab.id}`}
          aria-selected={tab.id === active}
          aria-controls={`ops-panel-${tab.id}`}
          tabIndex={tab.id === active ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            const i = tabs.findIndex((t) => t.id === active);
            const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
            onChange(next.id);
            document.getElementById(`ops-tab-${next.id}`)?.focus();
          }}
        >
          {tab.label}
          {tab.count !== undefined && tab.count > 0 && (
            <span className={tab.tone ? `ops-tab-count ops-tab-count-${tab.tone}` : 'ops-tab-count'}>{tab.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`ops-panel-${id}`} aria-labelledby={`ops-tab-${id}`} className="ops-tabpanel">
      {children}
    </div>
  );
}

/** Uma checagem de portão: estado + texto + o que falta. */
export function GateCheck({ ok, label, detail }: { ok: boolean | 'warning'; label: string; detail?: ReactNode }) {
  const state = ok === 'warning' ? 'warning' : ok ? 'ok' : 'blocking';
  return (
    <li className={`ops-gate ops-gate-${state}`}>
      <span className="ops-gate-mark" aria-hidden>{state === 'ok' ? '✓' : state === 'warning' ? '!' : '×'}</span>
      <div>
        <strong>{label}</strong>
        {detail && <p className="crm-muted">{detail}</p>}
      </div>
      <span className="sr-only">{state === 'ok' ? 'atendido' : state === 'warning' ? 'atenção' : 'pendente'}</span>
    </li>
  );
}
