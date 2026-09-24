'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Radar } from 'lucide-react';
import type { MaterialDemandRow } from '@/lib/supply/read-model';
import { COVERAGE_STATUS_LABEL, SUPPLY_RISK_LABEL, type CoverageStatus, type SupplyRisk } from '@/lib/supply/coverage';
import {
  Chip, CoverageBar, CoverageLegend, EmptyState, Filters, Plane, Resource, SearchBox, SignalPanel, apexFor, dateShort, plural, qty,
  useApexSignals, useResource, useUrlParam, useUrlParams, type ApexSignal, type Tone,
} from '@/components/ax';
import { RequirementPanel, type DemandCaps } from './RequirementPanel';

export type DemandPayload = { ok: true; today: string; capabilities: DemandCaps; demand: MaterialDemandRow[] };
type Payload = DemandPayload;
export const demandUrl = (projectId?: string) => `/api/supply/material-planning${projectId ? `?project=${encodeURIComponent(projectId)}` : ''}`;
type Filter = 'short' | 'critical' | 'inbound' | 'covered' | 'all';
const RISK_TONE: Record<SupplyRisk, Tone> = { critical: 'danger', high: 'warning', medium: 'info', low: 'success' };
const STATUS_ORDER: CoverageStatus[] = ['SHORT', 'PARTIAL', 'INBOUND', 'COVERED'];
const STATUS_CLS: Record<CoverageStatus, string> = { SHORT: 'short', PARTIAL: 'partial', INBOUND: 'inbound', COVERED: 'covered' };
const APEX_KINDS = ['SHORTAGE', 'ALTERNATE_STOCK', 'ETA_RISK', 'DECISION_PENDING', 'DECISION_STALLED'];
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/**
 * DEMANDA × COBERTURA — a matriz do plano. De cada requisito: quanto é
 * requerido, o que já o cobre (reservado, entrando, em inspeção), o que falta,
 * e do outro lado o ITEM no estoque (em mão, disponível). A linha abre o
 * requisito com as formas de cobrir a falta. O mesmo quadro serve o Supply
 * inteiro e a aba de Materiais do projeto (`projectId`).
 */
export function DemandBoard({ projectId, testId }: { projectId?: string; testId?: string }) {
  const resource = useResource<Payload>(demandUrl(projectId));
  return <Resource {...resource}>{(data) => <DemandBoardView data={data} projectId={projectId} testId={testId} />}</Resource>;
}

export function DemandBoardView({ data, projectId, testId }: { data: Payload; projectId?: string; testId?: string }) {
  const apex = useApexSignals(projectId);
  const [filter, setFilter] = useUrlParam<Filter>('filter', 'short');
  const [openId] = useUrlParam<string>('req', '');
  const patch = useUrlParams();
  const [search, setSearch] = useState('');
  const [apexPanel, setApexPanel] = useState<ApexSignal | null>(null);
  const d = data.demand;
  const counts = useMemo(() => ({
    short: d.filter((x) => x.coverage.shortage > 0).length, critical: d.filter((x) => x.risk === 'critical').length,
    inbound: d.filter((x) => x.coverage.status === 'INBOUND').length, covered: d.filter((x) => x.coverage.status === 'COVERED').length,
    all: d.length,
  }), [d]);
  const byStatus = useMemo(() => STATUS_ORDER.map((s) => ({ s, n: d.filter((x) => x.coverage.status === s).length })), [d]);
  const rows = useMemo(() => d
    .filter((x) => filter === 'all' || (filter === 'short' ? x.coverage.shortage > 0 : filter === 'critical' ? x.risk === 'critical'
      : filter === 'inbound' ? x.coverage.status === 'INBOUND' : x.coverage.status === 'COVERED'))
    .filter((x) => !search || norm([x.title, x.project, x.itemCode, x.itemDescription, x.activity].filter(Boolean).join(' ')).includes(norm(search))),
  [d, filter, search]);
  const open = openId ? d.find((x) => x.requirementId === openId) ?? null : null;
  const showProject = !projectId;
  const caps = data.capabilities;

  if (d.length === 0) {
    return (
      <Plane testId={testId}>
        <EmptyState title="Nenhuma demanda de material confirmada">
          A demanda nasce no Planejamento do projeto: requisito de material confirmado, com item e data de necessidade.
          {' '}<Link className="ax-link" href="/operacoes/planejamento">Abrir o Planejamento</Link>
        </EmptyState>
      </Plane>
    );
  }

  return (
    <div data-testid={testId} className="ax-stack">
      <Plane title="Cobertura da demanda" subtitle={`${plural(d.length, 'requisito confirmado', 'requisitos confirmados')} — cada um na situação que o decide`}
        action={<span className="ax-desktop-only"><CoverageLegend /></span>}>
        <div className="ax-statusbar" role="img" aria-label={byStatus.map((b) => `${COVERAGE_STATUS_LABEL[b.s]}: ${b.n}`).join(', ')}>
          {byStatus.filter((b) => b.n > 0).map((b) => <i key={b.s} className={STATUS_CLS[b.s]} style={{ flexGrow: b.n }} />)}
        </div>
        <div className="ax-statuslegend">
          {byStatus.map((b) => (
            <button key={b.s} type="button" className={STATUS_CLS[b.s]} onClick={() => setFilter(b.s === 'COVERED' ? 'covered' : b.s === 'INBOUND' ? 'inbound' : 'short')}>
              <i aria-hidden /><strong>{b.n}</strong> {COVERAGE_STATUS_LABEL[b.s].toLowerCase()}
            </button>
          ))}
        </div>
      </Plane>

      <Plane flush title="Demanda × cobertura" count={rows.length}
        subtitle="Deste requisito: requerido, reservado, entrando, em inspeção e falta · do item no estoque: em mão e disponível"
        bar={<div className="ax-toolbar">
          <Filters label="Recorte da demanda" value={filter} onChange={setFilter} options={[
            { id: 'short', label: 'Com falta', count: counts.short }, { id: 'critical', label: 'Críticos', count: counts.critical },
            { id: 'inbound', label: 'Coberto com entrada', count: counts.inbound }, { id: 'covered', label: 'Cobertos', count: counts.covered },
            { id: 'all', label: 'Toda a demanda', count: counts.all },
          ]} />
          <SearchBox value={search} onChange={setSearch} placeholder="Material, código, projeto ou atividade" label="Buscar na demanda" />
        </div>}>
        {rows.length === 0 ? <EmptyState compact title="Nada neste recorte">Mude o recorte ou a busca.</EmptyState> : (
          <div className="ax-table-wrap">
            <table className="ax-table cards ax-demand">
              <caption className="sr-only-ax">Demanda de material e cobertura por requisito</caption>
              <thead>
                <tr className="group">
                  <th colSpan={showProject ? 3 : 2} />
                  <th colSpan={5} scope="colgroup">Deste requisito</th>
                  <th colSpan={2} scope="colgroup">Do item no estoque</th>
                  <th />
                </tr>
                <tr>
                  <th scope="col">Material</th>
                  {showProject && <th scope="col">Projeto · atividade</th>}
                  <th scope="col">Necessidade</th>
                  <th scope="col" className="num">Requerido</th>
                  <th scope="col" className="num">Reservado</th>
                  <th scope="col" className="num" title="Em transferência + em pedido">Entrando</th>
                  <th scope="col" className="num">Inspeção</th>
                  <th scope="col" className="num">Falta</th>
                  <th scope="col" className="num">Em mão</th>
                  <th scope="col" className="num">Disponível</th>
                  <th scope="col" className="num">Risco</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => {
                  const c = x.coverage;
                  const signal = apexFor(apex.data, { requirementId: x.requirementId, kinds: APEX_KINDS });
                  const stockHidden = !caps.inventory || !x.itemStock;
                  return (
                    <tr key={x.requirementId} className="clickable" data-testid="demand-row" aria-selected={open?.requirementId === x.requirementId}
                      onClick={() => patch({ req: x.requirementId })}>
                      <td className="lead" data-label="">
                        <div className="ax-cellstack">
                          <button type="button" className="ax-rowlink" onClick={(e) => { e.stopPropagation(); patch({ req: x.requirementId }); }}>
                            {x.itemDescription ?? x.title}
                          </button>
                          <small>{x.itemCode ?? 'sem item'}{signal && <span className="ax-apexmark" title={`Apex: ${signal.action.label}`}><Radar size={11} aria-hidden /> Apex</span>}</small>
                          <CoverageBar showMeta={false} unit={x.unit} parts={{ required: c.required, consumed: c.consumed, reserved: c.reserved,
                            transit: c.inTransit, inspection: c.inspection, onOrder: c.onOrder, shortage: c.shortage }} />
                        </div>
                      </td>
                      {showProject && <td data-label="Projeto" className="proj"><div className="ax-cellstack"><span title={x.project}>{x.project}</span>
                        <small title={x.activity ?? undefined}>{x.activity ?? 'sem atividade'}</small></div></td>}
                      <td data-label="Necessidade"><div className="ax-cellstack"><span className="ax-num">{dateShort(x.needBy)}</span>
                        <small className={x.daysToNeed !== null && x.daysToNeed < 0 && c.shortage > 0 ? 'late' : undefined}>
                          {x.daysToNeed === null ? 'sem data' : x.daysToNeed < 0 ? `vencida há ${-x.daysToNeed} d` : x.daysToNeed === 0 ? 'hoje' : `em ${x.daysToNeed} d`}</small></div></td>
                      <td className="num" data-label="Requerido">{qty(c.required, x.unit)}</td>
                      <td className="num" data-label="Reservado">{qty(c.reserved + c.consumed, x.unit)}</td>
                      <td className="num" data-label="Entrando">{qty(c.inTransit + c.onOrder, x.unit)}</td>
                      <td className="num" data-label="Inspeção">{qty(c.inspection, x.unit)}</td>
                      <td className={c.shortage > 0 ? 'num short' : 'num'} data-label="Falta">{qty(c.shortage, x.unit)}</td>
                      <td className="num muted" data-label="Em mão">{stockHidden ? '—' : qty(x.itemStock!.onHand, x.unit)}</td>
                      <td className="num" data-label="Disponível">{stockHidden ? '—' : qty(x.itemStock!.available, x.unit)}</td>
                      <td className="num" data-label="Risco"><Chip tone={RISK_TONE[x.risk]}>{SUPPLY_RISK_LABEL[x.risk]}</Chip></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Plane>
      <p className="ax-note">Disponível nunca é o estoque físico: é o em mão menos o que já está reservado. Um requisito pode ser coberto por
        várias fontes ao mesmo tempo — reserva, transferência e compra — e nada disso é digitado: é a soma das alocações ao requisito.</p>

      {open && <RequirementPanel row={open} today={data.today} caps={caps} apex={apex.data}
        signal={apexFor(apex.data, { requirementId: open.requirementId, kinds: APEX_KINDS })}
        onClose={() => patch({ req: null })} onApex={setApexPanel} />}
      {apexPanel && <SignalPanel mode="execute" signal={apexPanel} onClose={() => setApexPanel(null)}
        onDone={() => { setApexPanel(null); apex.refresh(); }} />}
    </div>
  );
}
