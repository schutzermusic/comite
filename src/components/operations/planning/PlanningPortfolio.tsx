'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ChevronDown } from 'lucide-react';
import type { PortfolioPlanningModel } from '@/lib/operations/planning/read-model';
import { READINESS_LABEL, SUPPLY_COVERED_TYPES } from '@/lib/operations/planning/readiness';
import {
  AxPage, CommandHeader, EmptyState, Filters, HorizonTimeline, Plane, Resource, SearchBox, SignalStrip, Tabs, dateShort, href, plural,
  relativeDue, useResource, useUrlParam, useUrlParams, type HorizonLane, type Tone,
} from '@/components/ax';
import {
  DIMENSION_LABEL, DIMENSION_SHORT, MATRIX_DIMENSIONS, READINESS_TONE, ReadinessChip, ReadinessMark, ReadinessStrip, RequirementLine,
} from './shared';

type Payload = PortfolioPlanningModel & { ok: true };
type Front = Payload['fronts'][number];
type Req = Payload['requirements'][number];
type Focus = 'frentes' | 'critical' | 'dependencies' | 'needs';
type NeedFilter = 'late' | '14' | '30' | '60' | 'all' | 'material' | 'unconfirmed';

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const hit = (q: string, ...parts: Array<string | null | undefined>) => !q || norm(parts.filter(Boolean).join(' ')).includes(norm(q));

/** Tom da frente: o pior requisito decide; frente perto de começar SEM nenhuma necessidade registrada também é aviso. */
function frontTone(f: Front): Tone {
  if (f.critical || f.overall === 'SHORTAGE' || f.overall === 'OVERDUE') return 'danger';
  if (f.overall === 'PARTIAL' || f.overall === 'UNCONFIRMED' || f.overall === 'PENDING') return 'warning';
  if (!f.overall && f.daysToStart !== null && f.daysToStart <= 14) return 'warning';
  return 'neutral';
}

/**
 * PLANEJAMENTO — o que a execução precisa, e quando.
 *
 * A unidade é a FRENTE (atividade do cronograma canônico): cada uma mostra o
 * que precisa (equipe, material, equipamento, documento, cliente), para
 * quando — a menor entre a data declarada e o início da atividade —, quanto
 * está coberto e o que trava. Nada aqui é digitado: prontidão e cobertura são
 * derivadas; o atendimento acontece onde ele é governado (Supply, projeto).
 */
export function PlanningPortfolio() {
  const resource = useResource<Payload>('/api/operations/planning');
  return <AxPage testId="planning-portfolio"><Resource {...resource}>{(data) => <Planning data={data} />}</Resource></AxPage>;
}

function Planning({ data }: { data: Payload }) {
  const [focus, setFocus] = useUrlParam<Focus>('focus', 'frentes');
  const [needFilter, setNeedFilter] = useUrlParam<NeedFilter>('need', '30');
  const setParams = useUrlParams();
  const [search, setSearch] = useState('');
  const today = data.today;
  const reqById = useMemo(() => new Map(data.requirements.map((r) => [r.id, r])), [data.requirements]);

  const critical = data.fronts.filter((f) => f.critical);
  const soon = data.fronts.filter((f) => !f.started && f.daysToStart !== null && f.daysToStart <= 14);
  const soonNotReady = soon.filter((f) => f.overall !== 'READY');
  const materialShort = data.requirements.filter((r) => SUPPLY_COVERED_TYPES.includes(r.requirement_type)
    && (r.readiness === 'SHORTAGE' || r.readiness === 'PARTIAL'));
  const dependencies = data.requirements.filter((r) => r.requirement_type === 'CUSTOMER_DEPENDENCY' && !r.satisfied_at);
  const dependenciesOverdue = dependencies.filter((r) => r.readiness === 'OVERDUE');
  const unconfirmed = data.requirements.filter((r) => r.status === 'PLANNED');
  const dangerExceptions = data.constraints.filter((c) => c.severity === 'danger').length;

  return (
    <>
      <CommandHeader domain="operations" area="Planejamento" title="O que a execução precisa, e quando"
        context={<>
          <span><strong>{soon.length}</strong> {soon.length === 1 ? 'frente começa' : 'frentes começam'} em 14 dias</span>
          <span className={soonNotReady.length ? 'ax-warn-text' : undefined}><strong>{soonNotReady.length}</strong> sem prontidão</span>
          <span className={dangerExceptions ? 'ax-danger-text' : undefined}><strong>{data.constraints.length}</strong> {data.constraints.length === 1 ? 'exceção' : 'exceções'} de plano</span>
        </>} />

      <SignalStrip label="Sinais do planejamento" items={[
        { label: 'Atividades críticas', value: data.criticalActivities, hint: 'prioridade crítica, atrasadas ou vencidas',
          tone: data.criticalActivities ? 'danger' : undefined, onClick: () => setFocus('critical') },
        { label: 'Começam em 14 dias', value: soon.length, hint: soonNotReady.length ? `${plural(soonNotReady.length, 'sem prontidão', 'sem prontidão')}` : 'todas prontas',
          tone: soonNotReady.length ? 'warning' : undefined, onClick: () => setFocus('frentes') },
        { label: 'Material sem cobertura', value: materialShort.length, hint: 'falta ou cobertura parcial do Supply',
          tone: materialShort.length ? 'danger' : undefined, onClick: () => setParams({ focus: 'needs', need: 'material' }) },
        { label: 'Dependências do cliente', value: dependencies.length,
          hint: dependenciesOverdue.length ? plural(dependenciesOverdue.length, 'vencida', 'vencidas') : 'nenhuma vencida',
          tone: dependenciesOverdue.length ? 'danger' : undefined, onClick: () => setFocus('dependencies') },
        { label: 'A confirmar', value: unconfirmed.length, hint: 'planejados — sem data ou quantidade prometida',
          tone: unconfirmed.length ? 'warning' : undefined, onClick: () => setParams({ focus: 'needs', need: 'unconfirmed' }) },
      ]} />

      <div className="ax-grid main-side">
        <div className="ax-stack">
          <Tabs<Focus> label="Recortes do planejamento" value={focus} onChange={setFocus} tabs={[
            { id: 'frentes', label: 'Frentes', count: soonNotReady.length, tone: 'warning' },
            { id: 'critical', label: 'Críticas', count: critical.length, tone: 'danger' },
            { id: 'dependencies', label: 'Cliente', count: dependenciesOverdue.length, tone: 'danger' },
            { id: 'needs', label: 'Necessidades por data' },
          ]} />
          {focus === 'frentes' && <Fronts fronts={data.fronts} reqById={reqById} today={today} search={search} setSearch={setSearch} />}
          {focus === 'critical' && <Fronts fronts={critical} reqById={reqById} today={today} search={search} setSearch={setSearch} critical />}
          {focus === 'dependencies' && <Dependencies rows={dependencies} today={today} />}
          {focus === 'needs' && <Needs rows={data.requirements} today={today} filter={needFilter} setFilter={setNeedFilter} search={search} setSearch={setSearch} />}
        </div>
        <div className="ax-stack">
          <Exceptions data={data} onAll={() => setParams({ focus: 'needs', need: 'all' })} />
          <ReadinessByProject data={data} />
        </div>
      </div>

      <Plane title="Os próximos 30 dias" subtitle="● início da frente · ▲ data de necessidade · ◆ marco — a cor é a prontidão">
        <Horizon data={data} />
      </Plane>
      <p className="ax-note">O plano de execução é o cronograma canônico do projeto; as necessidades pendem das atividades dele. Nenhum estado de cobertura é
        digitado: material lê o Supply, e o resto é atendido por ato nomeado no projeto.</p>
    </>
  );
}

function Fronts({ fronts, reqById, today, search, setSearch, critical }: {
  fronts: Front[]; reqById: Map<string, Req>; today: string; search: string; setSearch: (v: string) => void; critical?: boolean;
}) {
  const shown = fronts.filter((f) => hit(search, f.title, f.project, f.client, f.wbs,
    ...f.requirementIds.map((id) => reqById.get(id)?.title)));
  // Abertas por padrão: as frentes que já estão (ou logo estarão) em campo e ainda não estão prontas.
  const [open, setOpen] = useState<Set<string>>(() => new Set(fronts.filter((f) => f.requirementIds.length > 0 && f.overall !== 'READY'
    && (critical || f.started || (f.daysToStart ?? 99) <= 14)).map((f) => f.activityId)));
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const groups = critical ? [{ id: 'all', label: '', rows: shown }] : [
    { id: 'now', label: 'Em execução', rows: shown.filter((f) => f.started) },
    { id: '14', label: 'Começam em até 14 dias', rows: shown.filter((f) => !f.started && (f.daysToStart ?? 999) <= 14) },
    { id: '30', label: 'De 15 a 30 dias', rows: shown.filter((f) => !f.started && (f.daysToStart ?? 999) > 14 && (f.daysToStart ?? 999) <= 30) },
    { id: 'later', label: 'Depois de 30 dias', rows: shown.filter((f) => !f.started && (f.daysToStart === null || f.daysToStart > 30)) },
  ].filter((g) => g.rows.length);

  return (
    <Plane flush testId="planning-fronts" title={critical ? 'Atividades críticas' : 'Frentes de trabalho'} count={shown.length}
      subtitle={critical ? 'A mesma definição da Visão Geral: prioridade crítica, atraso sinalizado ou término vencido — com o que cada uma ainda precisa'
        : 'Atividade → o que precisa → para quando → quanto está coberto → o que trava'}
      bar={<SearchBox value={search} onChange={setSearch} placeholder="Atividade, projeto ou necessidade" label="Buscar frente" />}>
      {shown.length === 0 ? (
        <EmptyState compact title={fronts.length ? 'Nada nesta busca' : critical ? 'Nenhuma atividade crítica' : 'Nenhuma frente no horizonte'}>
          {fronts.length ? 'Mude a busca.' : critical ? 'Nenhuma atividade aberta com prioridade crítica, atraso ou término vencido.'
            : 'Nenhuma atividade começa nos próximos 30 dias e nenhuma necessidade está registrada.'}
        </EmptyState>
      ) : groups.map((g) => (
        <section key={g.id} className="ax-front-group" aria-label={g.label || 'Atividades críticas'}>
          {g.label && <header>{g.label}<span className="ax-subtle">{g.rows.length}</span></header>}
          {g.rows.map((f) => <FrontRow key={f.activityId} f={f} reqs={f.requirementIds.map((id) => reqById.get(id)!).filter(Boolean)}
            today={today} open={open.has(f.activityId)} onToggle={() => toggle(f.activityId)} />)}
        </section>
      ))}
    </Plane>
  );
}

function FrontRow({ f, reqs, today, open, onToggle }: { f: Front; reqs: Req[]; today: string; open: boolean; onToggle: () => void }) {
  const tone = frontTone(f);
  const start = relativeDue(f.start, today);
  // A próxima data que ainda trava: só conta necessidade que não está pronta.
  const pendingNeed = reqs.filter((r) => r.readiness !== 'READY').map((r) => r.needBy).filter((d): d is string => Boolean(d)).sort()[0] ?? null;
  const firstNeed = pendingNeed ? relativeDue(pendingNeed, today) : null;
  const allReady = reqs.length > 0 && reqs.every((r) => r.readiness === 'READY');
  const panelId = `front-${f.activityId}`;
  return (
    <article className="ax-front" data-tone={tone} data-testid="planning-front">
      <div className="ax-front-when">
        <strong>{f.start ? dateShort(f.start) : '—'}</strong>
        <small>{f.started ? (f.percent !== null && f.percent !== undefined ? `${f.percent}% feito` : 'em execução') : f.start ? start.text : 'sem data'}</small>
      </div>
      <div className="ax-front-main">
        <span className="ax-row-eyebrow">
          <span className="ax-kind">{f.milestone ? 'Marco' : f.wbs ? `EAP ${f.wbs}` : 'Atividade'}</span>
          <span className="ax-row-where">{f.project}{f.client ? ` · ${f.client}` : ''}</span>
        </span>
        <Link className="ax-row-object ax-link" style={{ color: 'var(--ax-fg-strong)' }} href={href.projectSchedule(f.projectId)}>{f.title}</Link>
        <span className="ax-row-issue">
          {f.critical && <strong className="ax-danger-text">Crítica — {f.criticalReasons.join(', ')}. </strong>}
          {reqs.length
            ? <>{plural(reqs.length, 'necessidade', 'necessidades')}{allReady ? ' · tudo pronto'
              : firstNeed ? <> · a próxima pendente {firstNeed.late ? 'venceu' : 'vence'} {firstNeed.text}</> : null}
              {f.constraints ? <> · <span className="ax-warn-text">{plural(f.constraints, 'exceção', 'exceções')}</span></> : null}</>
            : f.started ? 'Nenhuma necessidade registrada.' : 'Nenhuma necessidade registrada — planeje antes do início.'}
        </span>
        <ReadinessStrip cells={f.cells} label={`Prontidão de ${f.title}`} />
      </div>
      <div className="ax-front-state">
        <ReadinessChip value={f.overall} />
        {reqs.length > 0 ? (
          <button type="button" className="ax-btn ghost sm" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
            {open ? 'Recolher' : 'Necessidades'}<ChevronDown size={13} aria-hidden style={{ transform: open ? 'rotate(180deg)' : undefined }} />
          </button>
        ) : (
          <Link className="ax-btn ghost sm" href={href.projectSchedule(f.projectId)}>Planejar<ArrowUpRight size={13} aria-hidden /></Link>
        )}
      </div>
      {open && reqs.length > 0 && (
        <div className="ax-front-reqs" id={panelId}>
          {reqs.map((r) => <RequirementLine key={r.id} r={r} today={today} />)}
        </div>
      )}
    </article>
  );
}

function Dependencies({ rows, today }: { rows: Req[]; today: string }) {
  const sorted = [...rows].sort((a, b) => (a.readiness === 'OVERDUE' ? 0 : 1) - (b.readiness === 'OVERDUE' ? 0 : 1)
    || (a.needBy ?? '9999').localeCompare(b.needBy ?? '9999'));
  return (
    <Plane flush testId="planning-dependencies" title="Dependências do cliente" count={rows.length}
      countTone={rows.some((r) => r.readiness === 'OVERDUE') ? 'danger' : undefined}
      subtitle="O que o cliente precisa entregar para a frente andar — vencidas primeiro. Atender é um ato com nota, no projeto">
      {sorted.length === 0 ? (
        <EmptyState compact title="Nenhuma dependência do cliente em aberto">Liberações, acessos e aprovações do cliente aparecem aqui quando registradas no plano.</EmptyState>
      ) : sorted.map((r) => (
        <RequirementLine key={r.id} r={r} today={today} showProject
          actions={<Link className="ax-btn sm" href={href.projectSchedule(r.project_id)}>{r.readiness === 'OVERDUE' ? 'Cobrar e registrar' : 'Abrir no projeto'}</Link>} />
      ))}
    </Plane>
  );
}

function Needs({ rows, today, filter, setFilter, search, setSearch }: {
  rows: Req[]; today: string; filter: NeedFilter; setFilter: (f: NeedFilter) => void; search: string; setSearch: (v: string) => void;
}) {
  const inWindow = (r: Req, days: number) => r.daysToNeed !== null && r.daysToNeed >= 0 && r.daysToNeed <= days;
  const late = (r: Req) => r.daysToNeed !== null && r.daysToNeed < 0 && r.readiness !== 'READY';
  const FILTER: Record<NeedFilter, (r: Req) => boolean> = {
    late, '14': (r) => inWindow(r, 14), '30': (r) => inWindow(r, 30), '60': (r) => inWindow(r, 60), all: () => true,
    material: (r) => SUPPLY_COVERED_TYPES.includes(r.requirement_type) && (r.readiness === 'SHORTAGE' || r.readiness === 'PARTIAL'),
    unconfirmed: (r) => r.status === 'PLANNED',
  };
  const count = (f: NeedFilter) => rows.filter(FILTER[f]).length;
  const shown = rows.filter(FILTER[filter] ?? FILTER.all).filter((r) => hit(search, r.title, r.project, r.client, r.activityTitle))
    .sort((a, b) => (a.needBy ?? '9999').localeCompare(b.needBy ?? '9999'));
  return (
    <Plane flush testId="planning-needs" title="Necessidades por data" count={shown.length}
      subtitle="Pela data que vale: a menor entre a declarada e o início da frente"
      bar={<div className="ax-toolbar">
        <Filters<NeedFilter> label="Janela de necessidade" value={filter} onChange={setFilter} options={[
          { id: 'late', label: 'Vencidas', count: count('late') }, { id: '14', label: '14 dias', count: count('14') },
          { id: '30', label: '30 dias', count: count('30') }, { id: '60', label: '60 dias', count: count('60') },
          { id: 'all', label: 'Todas', count: rows.length }, { id: 'material', label: 'Material sem cobertura', count: count('material') },
          { id: 'unconfirmed', label: 'A confirmar', count: count('unconfirmed') },
        ]} />
        <SearchBox value={search} onChange={setSearch} placeholder="Necessidade, projeto ou atividade" label="Buscar necessidade" />
      </div>}>
      {shown.length === 0 ? (
        <EmptyState compact title="Nada neste recorte">Necessidades nascem no planejamento do projeto (Cronograma) ou da OS emitida.</EmptyState>
      ) : shown.map((r) => <RequirementLine key={r.id} r={r} today={today} showProject />)}
    </Plane>
  );
}

function Exceptions({ data, onAll }: { data: Payload; onAll: () => void }) {
  // Uma entrada por necessidade, com todas as exceções dela — o nome não se repete.
  const grouped = Array.from(data.constraints.reduce((m, c) => {
    const g = m.get(c.requirementId) ?? { ...c, texts: [] as string[] };
    g.texts.push(c.text);
    if (c.severity === 'danger') g.severity = 'danger';
    else if (c.severity === 'warning' && g.severity === 'info') g.severity = 'warning';
    return m.set(c.requirementId, g);
  }, new Map<string, Payload['constraints'][number] & { texts: string[] }>()).values());
  const shown = grouped.slice(0, 8);
  return (
    <Plane flush testId="plan-exceptions" title="Exceções de plano" count={data.constraints.length}
      countTone={data.constraints.some((c) => c.severity === 'danger') ? 'danger' : data.constraints.length ? 'warning' : undefined}
      subtitle="Datas do cronograma × datas de necessidade × cobertura — o que o plano vê antes da obra"
      action={grouped.length > shown.length ? <button type="button" className="ax-btn ghost sm" onClick={onAll}>Ver todas</button> : undefined}>
      {shown.length === 0 ? (
        <EmptyState compact title="Nenhuma exceção de plano">Nenhuma dependência vencida, necessidade depois do início ou material sem cobertura perto da data.</EmptyState>
      ) : (
        <ul className="ax-exceptions">
          {shown.map((c) => (
            <li key={c.requirementId} data-severity={c.severity}>
              <Link href={href.projectSchedule(c.projectId)} className="ax-link">
                <strong>{c.requirement}</strong>
                {c.texts.map((t) => <span key={t}>{t}</span>)}
                <small>{[c.project, c.activity].filter(Boolean).join(' · ')}</small>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Plane>
  );
}

function ReadinessByProject({ data }: { data: Payload }) {
  return (
    <Plane flush title="Prontidão por projeto" subtitle="O pior requisito de cada dimensão decide">
      {data.matrix.length === 0 ? <EmptyState compact title="Nenhum projeto com necessidade registrada" /> : (
        <div className="ax-table-wrap">
          <table className="ax-heat ax-readiness-matrix">
            <caption className="sr-only-ax">Prontidão por projeto e dimensão</caption>
            <thead><tr><th scope="col">Projeto</th>{MATRIX_DIMENSIONS.map((d) => (
              <th key={d} scope="col" title={DIMENSION_LABEL[d]}><span aria-hidden>{DIMENSION_SHORT[d]}</span><span className="sr-only-ax">{DIMENSION_LABEL[d]}</span></th>))}</tr></thead>
            <tbody>
              {data.matrix.map((m) => (
                <tr key={m.projectId} data-tone={m.overall ? READINESS_TONE[m.overall] : undefined}>
                  <th scope="row">
                    <Link className="ax-link" href={href.projectSchedule(m.projectId)}>{m.project}</Link>
                    <small className="ax-subtle">{plural(m.open, 'necessidade', 'necessidades')}</small>
                  </th>
                  {MATRIX_DIMENSIONS.map((d) => <td key={d}><ReadinessMark value={m.cells[d]} label={`${m.project} — ${DIMENSION_LABEL[d]}`} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Plane>
  );
}

function Horizon({ data }: { data: Payload }) {
  const lanes: HorizonLane[] = useMemo(() => {
    const byProject = new Map<string, HorizonLane>();
    const lane = (id: string, label: string) => byProject.get(id) ?? (byProject.set(id, { id, label, items: [] }), byProject.get(id)!);
    for (const f of data.fronts) {
      if (!f.start || f.started || (f.daysToStart ?? 99) > 30) continue;
      lane(f.projectId, f.project).items.push({ id: `a:${f.activityId}`, date: f.start, title: `${f.title} — ${f.overall ? READINESS_LABEL[f.overall].toLowerCase() : 'sem necessidade registrada'}`,
        kind: f.milestone ? 'milestone' : 'activity', tone: f.overall ? READINESS_TONE[f.overall] : 'neutral', href: href.projectSchedule(f.projectId) });
    }
    for (const r of data.requirements) {
      if (!r.needBy || r.daysToNeed === null || r.daysToNeed < 0 || r.daysToNeed > 30) continue;
      lane(r.project_id, r.project).items.push({ id: `r:${r.id}`, date: r.needBy, title: r.title, kind: 'need',
        tone: r.readiness ? READINESS_TONE[r.readiness] : 'neutral', href: href.projectSchedule(r.project_id) });
    }
    return Array.from(byProject.values()).slice(0, 8);
  }, [data]);
  if (!lanes.length) return <EmptyState compact title="Nada nos próximos 30 dias">Nenhuma frente começa e nenhuma necessidade vence neste horizonte.</EmptyState>;
  return <HorizonTimeline today={data.today} days={30} lanes={lanes} />;
}
