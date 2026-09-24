'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { PortfolioPlanningModel } from '@/lib/operations/planning/read-model';
import { REQUIREMENT_TYPE_LABEL } from '@/lib/operations/planning/readiness';
import { daysBetween } from '@/lib/operations/overview-rules';
import {
  DataTable, EmptyNote, GovernanceNote, LiveSep, Metrics, Panel, ResourceState, Segments, Toolbar, WorkspaceHeading,
  day, matches, useOperationsResource,
} from '../ui';
import { DIMENSION_LABEL, MATRIX_DIMENSIONS, ReadinessCell, ReadinessPill } from './shared';

type Payload = PortfolioPlanningModel & { ok: true };
type Window = 'all' | '14' | '30' | '60' | 'late';

/**
 * PLANEJAMENTO — o que a execução precisa, quando, e o que ainda não está pronto.
 *
 * Exceções de plano primeiro (dependência do cliente vencida, necessidade
 * depois do início, requisito não confirmado com a frente começando, material
 * sem cobertura perto da data). Depois a matriz de prontidão por projeto e as
 * necessidades por data.
 */
export function PlanningPortfolio() {
  const { data, state, message } = useOperationsResource<Payload>('/api/operations/planning');
  const [window, setWindow] = useState<Window>('30');
  const [search, setSearch] = useState('');
  const rows = useMemo(() => (data?.requirements ?? []).filter((r) => {
    if (search && !matches(search, r.title, r.project, r.client, r.activityTitle)) return false;
    if (window === 'all') return true;
    if (!r.required_by) return false;
    const d = daysBetween(data!.today, r.required_by);
    return window === 'late' ? d < 0 && r.readiness !== 'READY' : d >= 0 && d <= Number(window);
  }), [data, window, search]);
  if (state !== 'ready' || !data) return <ResourceState state={state} message={message} />;

  const reqs = data.requirements;
  const unconfirmed = reqs.filter((r) => r.status === 'PLANNED').length;
  const shortage = reqs.filter((r) => r.readiness === 'SHORTAGE' || r.readiness === 'PARTIAL').length;
  const overdue = reqs.filter((r) => r.readiness === 'OVERDUE' || (r.required_by && r.required_by < data.today && r.readiness !== 'READY')).length;
  const danger = data.constraints.filter((c) => c.severity === 'danger').length;

  return (
    <section className="crm-workspace ops-workspace" aria-label="Planejamento" data-testid="planning-portfolio">
      <WorkspaceHeading
        eyebrow="Operações · Planejamento"
        title="O que a execução precisa, e quando"
        description={<><span><b>{reqs.length}</b> requisito(s) vivo(s)</span><LiveSep />
          <span className={danger ? 'crm-tone-danger' : undefined}><b>{data.constraints.length}</b> exceção(ões) de plano</span></>}
      />
      <Metrics items={[
        { label: 'Confirmados', value: reqs.length - unconfirmed, hint: 'Data prometida ao Supply e à equipe', accent: true },
        { label: 'A confirmar', value: unconfirmed, tone: unconfirmed ? 'warning' : 'neutral', hint: 'Planejados sem data ou quantidade prometida' },
        { label: 'Material sem cobertura', value: shortage, tone: shortage ? 'danger' : 'neutral', hint: 'Falta ou cobertura parcial do Supply' },
        { label: 'Vencidos', value: overdue, tone: overdue ? 'danger' : 'neutral', hint: 'Data de necessidade passou sem atender' },
      ]} />

      <div className="crm-split">
        <Panel title="Exceções de plano" note="Determinísticas — datas do cronograma × datas de necessidade × cobertura">
          {data.constraints.length ? (
            <div className="ops-attention">
              {data.constraints.slice(0, 30).map((c, i) => (
                <div key={`${c.requirementId}:${c.code}:${i}`} className="ops-attention-row" data-tone={c.severity === 'danger' ? 'danger' : c.severity === 'warning' ? 'warning' : 'accent'}>
                  <div className="min-w-0"><strong>{c.text}</strong><p className="ops-attention-meta"><span>{c.project}</span></p></div>
                  <Link href={`/projetos/${encodeURIComponent(c.projectId)}?tab=timeline`} className="crm-row-open text-ig-caption">Abrir plano</Link>
                </div>
              ))}
            </div>
          ) : <EmptyNote title="Nenhuma exceção de plano" description="Nenhuma dependência vencida, necessidade depois do início ou material sem cobertura perto da data." />}
        </Panel>
        <Panel title="Prontidão por projeto" note="O pior requisito de cada frente decide">
          {data.matrix.length ? (
            <div className="crm-table-scroll" role="region" aria-label="Prontidão por projeto" tabIndex={0}>
              <table className="ops-matrix">
                <thead><tr><th scope="col">Projeto</th>{MATRIX_DIMENSIONS.map((d) => <th key={d} scope="col">{DIMENSION_LABEL[d]}</th>)}</tr></thead>
                <tbody>
                  {data.matrix.map((m) => (
                    <tr key={m.projectId}>
                      <td><Link href={`/projetos/${encodeURIComponent(m.projectId)}?tab=timeline`}>{m.project}</Link>
                        <p className="crm-muted">{m.open} requisito(s)</p></td>
                      {MATRIX_DIMENSIONS.map((d) => <td key={d}><ReadinessCell value={m.cells[d]} /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="crm-section-empty">Nenhum projeto com requisito registrado.</div>}
        </Panel>
      </div>

      <Toolbar search={search} onSearch={setSearch} placeholder="Buscar requisito, projeto ou atividade">
        <Segments label="Janela de necessidade" value={window} onChange={(v) => setWindow(v as Window)}
          options={[{ value: 'late', label: 'Vencidos' }, { value: '14', label: '14 dias' }, { value: '30', label: '30 dias' },
            { value: '60', label: '60 dias' }, { value: 'all', label: 'Todos' }]} />
      </Toolbar>
      <DataTable
        label="Necessidades por data"
        columns={['Necessário em', 'Requisito', 'Projeto / atividade', 'Quantidade', 'Prontidão']}
        count={rows.length}
        footer="Requisitos confirmados e planejados — a cobertura de material vem do Supply"
        empty={<EmptyNote title="Nada nesta janela" description="Requisitos nascem no Planejamento do projeto (Cronograma / Planejamento) ou da OS emitida." />}
      >
        {rows.map((r) => (
          <tr key={r.id}>
            <td className={r.required_by && r.required_by < data.today && r.readiness !== 'READY' ? 'crm-tone-danger tabular-nums' : 'tabular-nums'}>{day(r.required_by)}</td>
            <td><p><b>{r.title}</b></p><p className="crm-muted">{REQUIREMENT_TYPE_LABEL[r.requirement_type]}</p></td>
            <td><Link href={`/projetos/${encodeURIComponent(r.project_id)}?tab=timeline`}>{r.project}</Link>
              {r.activityTitle && <p className="crm-muted">{r.activityTitle}</p>}</td>
            <td className="tabular-nums">{r.quantity ? `${Number(r.quantity).toLocaleString('pt-BR')} ${r.unit ?? ''}` : '—'}</td>
            <td><ReadinessPill value={r.readiness} /></td>
          </tr>
        ))}
      </DataTable>
      <GovernanceNote>
        O plano de execução é o cronograma canônico do projeto; requisitos pendem das atividades dele. Nenhum estado de
        cobertura é digitado: material lê o Supply, e o resto é atendido por ato nomeado.
      </GovernanceNote>
    </section>
  );
}
