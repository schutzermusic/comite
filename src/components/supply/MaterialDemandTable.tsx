'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { HudButton, HudDrawer } from '@/components/hud';
import type { MaterialDemandRow } from '@/lib/supply/read-model';
import { COVERAGE_STATUS_LABEL, REQUIREMENT_PRIORITY_LABEL, SUPPLY_RISK_LABEL, type SupplyRisk } from '@/lib/supply/coverage';
import { DataTable, EmptyNote, GovernanceNote, Segments, StatePill, Toolbar, day, matches, type Tone } from '@/components/operations/ui';
import { CoverageBar, formatQty } from './CoverageBar';
import { DemandActions } from './DemandActions';

const RISK_TONE: Record<SupplyRisk, Tone> = { critical: 'danger', high: 'warning', medium: 'info', low: 'success' };

export interface DemandCapabilities { plan: boolean; reserve: boolean; requestPurchase: boolean }

/**
 * DEMANDA × COBERTURA — a matriz do plano: projeto, data de necessidade,
 * requerido, coberto, reservado, entrando, falta, risco. A gaveta abre o
 * requisito: demanda, cobertura, alternativas e ações governadas.
 */
export function MaterialDemandTable({
  demand, today, capabilities, showProject = true, renderActions, onChanged,
}: {
  demand: MaterialDemandRow[]; today: string; capabilities: DemandCapabilities; showProject?: boolean;
  renderActions?: (row: MaterialDemandRow) => React.ReactNode; onChanged?: () => void;
}) {
  const [filter, setFilter] = useState<'short' | 'critical' | 'all'>('short');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<MaterialDemandRow | null>(null);
  const rows = useMemo(() => demand
    .filter((d) => filter === 'all' || (filter === 'critical' ? d.risk === 'critical' : d.coverage.shortage > 0))
    .filter((d) => !search || matches(search, d.title, d.project, d.itemCode, d.itemDescription, d.activity)),
  [demand, filter, search]);

  return (
    <>
      <Toolbar search={search} onSearch={setSearch} placeholder="Buscar material, código, projeto ou atividade">
        <Segments label="Recorte da demanda" value={filter} onChange={(v) => setFilter(v as typeof filter)}
          options={[
            { value: 'short', label: 'Com falta', count: demand.filter((d) => d.coverage.shortage > 0).length },
            { value: 'critical', label: 'Críticos', count: demand.filter((d) => d.risk === 'critical').length },
            { value: 'all', label: 'Toda a demanda', count: demand.length },
          ]} />
      </Toolbar>
      <DataTable
        label="Demanda de material e cobertura"
        columns={[...(showProject ? ['Projeto'] : []), 'Necessário em', 'Material', 'Cobertura', 'Risco', '']}
        count={rows.length}
        footer="Cobertura derivada das alocações ao requisito — nada é digitado"
        empty={<EmptyNote title={demand.length ? 'Nada neste recorte' : 'Nenhuma demanda de material confirmada'}
          description={demand.length ? 'Mude o recorte ou a busca.'
            : 'As necessidades aparecerão aqui quando o Planejamento do Projeto confirmar materiais e datas de necessidade.'}
          action={!demand.length ? <Link href="/operacoes/planejamento"><HudButton variant="primary" size="sm">Abrir Planejamento</HudButton></Link> : undefined} />}
      >
        {rows.map((d) => (
          <tr key={d.requirementId} data-testid="demand-row">
            {showProject && <td><Link href={`/projetos/${encodeURIComponent(d.projectId)}?tab=supply`}>{d.project}</Link>
              {d.activity && <p className="crm-muted">{d.activity}</p>}</td>}
            <td className={d.daysToNeed !== null && d.daysToNeed < 0 && d.coverage.shortage > 0 ? 'crm-tone-danger tabular-nums' : 'tabular-nums'}>
              {day(d.requiredBy)}
              {d.daysToNeed !== null && <p className="crm-muted">{d.daysToNeed < 0 ? `${-d.daysToNeed} dia(s) atrás` : `em ${d.daysToNeed} dia(s)`}</p>}
            </td>
            <td><p><b>{d.itemCode ?? '—'}</b> {d.itemDescription ?? d.title}</p>
              {!showProject && d.activity && <p className="crm-muted">{d.activity}</p>}</td>
            <td><CoverageBar coverage={d.coverage} unit={d.unit} /></td>
            <td><StatePill tone={RISK_TONE[d.risk]}>{SUPPLY_RISK_LABEL[d.risk]}</StatePill></td>
            <td><HudButton variant="ghost" size="sm" onClick={() => setOpen(d)}>Detalhar</HudButton></td>
          </tr>
        ))}
      </DataTable>
      <GovernanceNote>
        Disponível nunca é o estoque físico: é o que está em mão menos o que já está reservado. Um requisito pode ser coberto
        por várias fontes ao mesmo tempo — reserva, transferência e compra.
      </GovernanceNote>

      <HudDrawer isOpen={Boolean(open)} onClose={() => setOpen(null)} title={open?.itemDescription ?? open?.title ?? 'Material'}
        subtitle={open ? `${open.project}${open.activity ? ` · ${open.activity}` : ''}` : undefined} width="min(560px, 100vw)">
        {open && (
          <div className="crm-workspace ops-workspace" data-testid="demand-drawer">
            <section aria-label="Demanda">
              <p className="crm-eyebrow" style={{ padding: '0 14px' }}>Demanda</p>
              <dl className="sup-kv">
                <div><dt>Necessário em</dt><dd>{day(open.requiredBy)}</dd></div>
                <div><dt>Requerido</dt><dd>{formatQty(open.coverage.required)} {open.unit}</dd></div>
                <div><dt>Prioridade</dt><dd>{REQUIREMENT_PRIORITY_LABEL[open.priority] ?? open.priority}</dd></div>
              </dl>
            </section>
            <section aria-label="Cobertura">
              <p className="crm-eyebrow" style={{ padding: '0 14px' }}>Cobertura · {COVERAGE_STATUS_LABEL[open.coverage.status]}</p>
              <dl className="sup-kv">
                <div><dt>Reservado</dt><dd>{formatQty(open.coverage.reserved)}</dd></div>
                <div><dt>Consumido</dt><dd>{formatQty(open.coverage.consumed)}</dd></div>
                <div><dt>Em trânsito</dt><dd>{formatQty(open.coverage.inTransit)}</dd></div>
                <div><dt>Em pedido</dt><dd>{formatQty(open.coverage.onOrder)}</dd></div>
                <div><dt>Requisitado</dt><dd>{formatQty(open.coverage.requested)}</dd></div>
                <div><dt>Em inspeção</dt><dd>{formatQty(open.coverage.inspection)}</dd></div>
                <div><dt>Livre em estoque</dt><dd>{formatQty(open.stock.reduce((a, s) => a + s.available, 0))}</dd></div>
                <div><dt>Falta</dt><dd className={open.coverage.shortage ? 'sup-short' : undefined}>{formatQty(open.coverage.shortage)}</dd></div>
              </dl>
            </section>
            {renderActions ? renderActions(open) : (
              <DemandActions row={open} canAct={capabilities.reserve} canRequest={capabilities.requestPurchase}
                onChanged={() => { setOpen(null); onChanged?.(); }} />
            )}
            <p style={{ padding: '0 14px' }}>
              <Link href={`/projetos/${encodeURIComponent(open.projectId)}?tab=timeline`} className="crm-row-open">Abrir o plano do projeto</Link>
            </p>
          </div>
        )}
      </HudDrawer>
      <span hidden data-today={today} />
    </>
  );
}
