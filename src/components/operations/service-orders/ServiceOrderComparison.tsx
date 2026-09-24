'use client';

import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  DIMENSION_LABEL, DIMENSION_ORDER, STATUS_LABEL, buildServiceOrderComparison, comparisonCounts,
  type ComparisonDimension, type ComparisonRow, type ComparisonSide, type ComparisonStatus, type PackageFact,
} from '@/lib/operations/service-orders/comparison';
import type { ServiceOrderDivergence, ServiceOrderItem, ServiceOrderItemKind } from '@/lib/operations/service-orders/types';
import { Chip, EmptyState, Filters, Plane, pct, type Tone } from '@/components/ax';

const STATUS_TONE: Record<ComparisonStatus, Tone> = {
  conflicting: 'danger', uncertain: 'warning', missing: 'warning', additional: 'info', aligned: 'success',
};
const STATUS_ORDER: ComparisonStatus[] = ['conflicting', 'uncertain', 'missing', 'additional', 'aligned'];
const DIMENSION_KIND: Record<ComparisonDimension, ServiceOrderItemKind> = {
  scope: 'SCOPE', deliverables: 'DELIVERABLE', resources: 'MATERIAL', dependencies: 'CUSTOMER_DEPENDENCY', exclusions: 'EXCLUSION',
  dates: 'MILESTONE', commercial: 'COMMERCIAL_REFERENCE', other: 'RISK',
};

/**
 * A COMPARAÇÃO OS × PT × PC — lado a lado, por dimensão (valor, escopo,
 * entregáveis, materiais, datas, dependências, exclusões). Cada linha diz em
 * que situação está e o que fazer: confirmar a leitura, decidir o conflito,
 * trazer para a OS o que a proposta declara. O trecho de origem fica recolhido.
 */
export function ServiceOrderComparison({
  items, facts, divergences, authorizedValue, currency, editable, canResolve, onDecide, onAdd, onResolve, hasPackage,
}: {
  items: ServiceOrderItem[]; facts?: PackageFact[] | null; divergences: ServiceOrderDivergence[];
  authorizedValue: string | null; currency: string | null; editable: boolean; canResolve: boolean; hasPackage: boolean;
  onDecide: (decisions: Array<{ itemId: string; decision: 'CONFIRMED' | 'REJECTED' }>) => Promise<void>;
  onAdd: (kind: ServiceOrderItemKind, title: string, detail: string) => Promise<void>;
  onResolve: (divergenceId: string) => void;
}) {
  const rows = useMemo(() => buildServiceOrderComparison({ items, facts, divergences, authorizedValue, currency }),
    [items, facts, divergences, authorizedValue, currency]);
  const counts = comparisonCounts(rows);
  const [filter, setFilter] = useState<'all' | ComparisonStatus>('all');
  const [busy, setBusy] = useState(false);
  const shown = rows.filter((r) => filter === 'all' || r.status === filter);
  const groups = DIMENSION_ORDER.map((d) => ({ d, rows: shown.filter((r) => r.dimension === d) })).filter((g) => g.rows.length);
  const act = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  return (
    <Plane flush testId="os-comparison" title="Comparação OS × PT × PC"
      subtitle={hasPackage ? 'O que a OS traz contra o que a PT e a PC aceitas declaram — conflito e incerteza primeiro'
        : 'Sem pacote de proposta regente: só as divergências registradas e as linhas da OS entram na comparação'}
      bar={<Filters<'all' | ComparisonStatus> label="Situação da comparação" value={filter} onChange={setFilter} options={[
        { id: 'all', label: 'Tudo', count: rows.length },
        ...STATUS_ORDER.filter((s) => counts[s]).map((s) => ({ id: s, label: STATUS_LABEL[s], count: counts[s] })),
      ]} />}>
      {rows.length > 0 && (
        <div className="ax-cmp-summary">
          <div className="ax-statusbar" role="img" aria-label={STATUS_ORDER.map((s) => `${STATUS_LABEL[s]}: ${counts[s]}`).join(', ')}>
            {STATUS_ORDER.filter((s) => counts[s]).map((s) => <i key={s} className={`cmp-${s}`} style={{ flexGrow: counts[s] }} />)}
          </div>
          <p>{counts.conflicting + counts.uncertain + counts.missing === 0
            ? 'Sem conflito, incerteza ou falta: a OS reflete o pacote aceito.'
            : [counts.conflicting ? `${counts.conflicting} em conflito` : null, counts.uncertain ? `${counts.uncertain} de leitura incerta` : null,
              counts.missing ? `${counts.missing} declarada(s) na proposta e ausente(s) na OS` : null].filter(Boolean).join(' · ')}</p>
        </div>
      )}
      {groups.length === 0 ? (
        <EmptyState compact title={rows.length ? 'Nada nesta situação' : 'Nada a comparar ainda'}>
          {rows.length ? 'Mude o filtro.' : 'A OS não tem linhas e o pacote não tem fatos lidos. Traga o escopo do pacote ou importe o documento.'}
        </EmptyState>
      ) : groups.map((g) => (
        <section key={g.d} className="ax-cmp-group" aria-label={DIMENSION_LABEL[g.d]}>
          <header>{DIMENSION_LABEL[g.d]}<span className="ax-subtle">{g.rows.length}</span></header>
          <div className="ax-cmp-row head" aria-hidden><span>Situação</span><span>OS</span><span>PT</span><span>PC</span></div>
          {g.rows.map((r) => (
            <div key={r.id} className="ax-cmp-row" data-status={r.status} data-testid="comparison-row">
              <div className="ax-cmp-status">
                <Chip tone={STATUS_TONE[r.status]}>{r.severity === 'BLOCKING' ? 'Conflito bloqueante' : STATUS_LABEL[r.status]}</Chip>
                <small>{r.note}</small>
                <RowActions r={r} editable={editable} canResolve={canResolve} busy={busy}
                  onConfirm={() => act(() => onDecide([{ itemId: r.itemId!, decision: 'CONFIRMED' }]))}
                  onWithdraw={() => act(() => onDecide([{ itemId: r.itemId!, decision: 'REJECTED' }]))}
                  onResolve={() => onResolve(r.divergenceId!)}
                  onInclude={() => { const src = r.pt ?? r.pc; if (src) void act(() => onAdd(DIMENSION_KIND[r.dimension], src.label, src.value ?? '')); }} />
              </div>
              <Side side={r.os} label="OS" empty={r.status === 'missing' ? 'não traz' : '—'} />
              <Side side={r.pt} label="PT" empty={r.pc ? '' : r.os ? 'não declara' : '—'} />
              <Side side={r.pc} label="PC" empty={r.pt ? '' : r.os ? 'não declara' : '—'} />
            </div>
          ))}
        </section>
      ))}
    </Plane>
  );
}

function RowActions({ r, editable, canResolve, busy, onConfirm, onWithdraw, onResolve, onInclude }: {
  r: ComparisonRow; editable: boolean; canResolve: boolean; busy: boolean;
  onConfirm: () => void; onWithdraw: () => void; onResolve: () => void; onInclude: () => void;
}) {
  const buttons = [];
  if (r.divergenceId && canResolve) buttons.push(<button key="d" type="button" className="ax-btn primary sm" onClick={onResolve}>Decidir</button>);
  if (editable && r.itemId && r.itemState === 'UNCONFIRMED') {
    buttons.push(<button key="c" type="button" className="ax-btn sm" disabled={busy} onClick={onConfirm}>Confirmar</button>);
    buttons.push(<button key="w" type="button" className="ax-btn ghost sm" disabled={busy} onClick={onWithdraw}>Retirar</button>);
  }
  if (editable && r.status === 'missing' && !r.itemId && (r.pt || r.pc)) {
    buttons.push(<button key="i" type="button" className="ax-btn sm" disabled={busy} onClick={onInclude}><Plus size={12} aria-hidden />Incluir na OS</button>);
  }
  return buttons.length ? <div className="ax-inline" style={{ flexWrap: 'wrap' }}>{buttons}</div> : null;
}

function Side({ side, label, empty }: { side: ComparisonSide | null; label: string; empty: string }) {
  if (!side) return <div className="ax-cmp-side empty" data-label={label}>{empty && <span className="ax-subtle">{empty}</span>}</div>;
  return (
    <div className="ax-cmp-side" data-label={label}>
      <strong>{side.label}</strong>
      {side.value && <span>{side.value}</span>}
      {(side.page || side.confidence !== null || side.quote) && (
        <span className="ax-prov">
          {side.page && <span>p. {side.page}</span>}
          {side.confidence !== null && <span>leitura {pct(side.confidence)}</span>}
          {side.quote && <details><summary>trecho</summary><q>{side.quote}</q>{side.model && <small> · {side.model}</small>}</details>}
        </span>
      )}
    </div>
  );
}
