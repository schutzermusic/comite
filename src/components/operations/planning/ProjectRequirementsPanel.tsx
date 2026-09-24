'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import type { ProjectPlanningModel } from '@/lib/operations/planning/read-model';
import {
  REQUIREMENT_TYPE_LABEL, SUPPLY_COVERED_TYPES, type RequirementType,
} from '@/lib/operations/planning/readiness';
import { REQUIREMENT_TYPES } from '@/lib/operations/planning/validation';
import {
  Busy, EmptyState, Filters, Plane, Resource, SidePanel, dateShort, daysBetween, href, plural, relativeDue, useGovernedAction, useResource,
} from '@/components/ax';
import { ReadinessStrip, RequirementLine } from './shared';

type Payload = ProjectPlanningModel & { ok: true; capabilities: { manage: boolean } };
type Req = Payload['requirements'][number];
type Filter = 'open' | 'constraints' | 'all';

/**
 * NECESSIDADES DA EXECUÇÃO do projeto — sob o cronograma, porque é dele que
 * elas dependem. Agrupadas pela FRENTE (atividade): o que cada uma precisa,
 * para quando, quanto está coberto e o que trava. Material mostra COBERTURA
 * do Supply — não existe botão "coberto"; para documento, cliente, equipe e
 * equipamento, "atendido" é um ato com nota.
 */
export function ProjectRequirementsPanel({ projectId }: { projectId: string }) {
  const resource = useResource<Payload>(`/api/operations/projects/${encodeURIComponent(projectId)}/requirements`);
  return (
    <section className="ax ax-stack" aria-label="Necessidades da execução" data-testid="project-requirements" style={{ marginTop: 16 }}>
      <Resource {...resource}>{(data) => <Panel data={data} projectId={projectId} refresh={resource.refresh} />}</Resource>
    </section>
  );
}

function Panel({ data, projectId, refresh }: { data: Payload; projectId: string; refresh: () => void }) {
  const [filter, setFilter] = useState<Filter>('open');
  const [editing, setEditing] = useState<Req | 'new' | null>(null);
  const [acting, setActing] = useState<{ req: Req; kind: 'cancel' | 'satisfy' } | null>(null);
  const { run, busy } = useGovernedAction(refresh);
  const manage = data.capabilities.manage;
  const today = data.today;

  const live = data.requirements.filter((r) => r.status === 'PLANNED' || r.status === 'CONFIRMED');
  const withConstraints = data.requirements.filter((r) => r.constraints.length > 0);
  const rows = data.requirements.filter((r) => (filter === 'all' ? true : filter === 'constraints' ? r.constraints.length > 0
    : r.status === 'PLANNED' || r.status === 'CONFIRMED'));
  const readiness = new Map(data.readinessByActivity.map((a) => [a.activityId, a]));
  const activities = new Map(data.activities.map((a) => [a.id, a]));
  const byActivity = new Map<string, Req[]>();
  for (const r of rows) { const k = r.activity_id ?? '—'; byActivity.set(k, [...(byActivity.get(k) ?? []), r]); }
  const groups = Array.from(byActivity.entries()).map(([id, reqs]) => ({
    id, activity: id === '—' ? null : activities.get(id) ?? null, readiness: id === '—' ? null : readiness.get(id) ?? null,
    reqs: reqs.sort((a, b) => (a.needBy ?? '9999').localeCompare(b.needBy ?? '9999')),
  })).sort((a, b) => (a.activity?.start ?? '9999').localeCompare(b.activity?.start ?? '9999'));
  // Frentes que começam em 30 dias sem NENHUMA necessidade registrada: é aí que o plano está em branco.
  const unplanned = data.activities.filter((a) => a.start && !data.requirements.some((r) => r.activity_id === a.id)
    && daysBetween(today, a.start) >= 0 && daysBetween(today, a.start) <= 30);

  const act = (label: string, url: string, body: Record<string, unknown>, method: 'POST' | 'PATCH' = 'POST') =>
    run(label, url, body, { title: label }, { idempotent: false, method }).then((r) => r.ok);

  const rowActions = (r: Req) => {
    if (!manage || (r.status !== 'PLANNED' && r.status !== 'CONFIRMED')) return null;
    const supply = SUPPLY_COVERED_TYPES.includes(r.requirement_type);
    return (
      <>
        {r.status === 'PLANNED' && (
          <button type="button" className="ax-btn primary sm" disabled={busy !== null}
            onClick={() => act('Requisito confirmado', `/api/operations/requirements/${r.id}/transition`, { to: 'CONFIRMED' })}>Confirmar</button>
        )}
        {r.status === 'CONFIRMED' && !supply && !r.satisfied_at && (
          <button type="button" className="ax-btn sm" onClick={() => setActing({ req: r, kind: 'satisfy' })}>Atendido</button>
        )}
        {r.status === 'CONFIRMED' && supply && r.readiness !== 'READY' && (
          <Link className="ax-btn sm" href={href.requirement(r.id)}>Cobrir no Supply</Link>
        )}
        <button type="button" className="ax-btn ghost sm" onClick={() => setEditing(r)}>Editar</button>
      </>
    );
  };

  return (
    <>
      <Plane flush title="Necessidades da execução" count={live.length}
        subtitle={`${plural(live.filter((r) => r.status === 'PLANNED').length, 'a confirmar', 'a confirmar')} · ${plural(withConstraints.length, 'com exceção de plano', 'com exceção de plano')} · a data que vale é a menor entre a declarada e o início da frente`}
        action={manage ? (
          <div className="ax-inline" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {data.serviceOrders.map((o) => (
              <button key={o.id} type="button" className="ax-btn ghost sm" disabled={busy !== null}
                onClick={() => act(`Requisitos trazidos da OS ${o.os_number}`,
                  `/api/operations/projects/${encodeURIComponent(projectId)}/requirements/import`, { serviceOrderId: o.id })}>
                Trazer da OS {o.os_number}</button>
            ))}
            <button type="button" className="ax-btn primary sm" onClick={() => setEditing('new')}><Plus size={13} aria-hidden />Novo requisito</button>
          </div>
        ) : undefined}
        bar={<Filters<Filter> label="Filtrar requisitos" value={filter} onChange={setFilter} options={[
          { id: 'open', label: 'Vivos', count: live.length },
          { id: 'constraints', label: 'Com exceção', count: withConstraints.length },
          { id: 'all', label: 'Todos', count: data.requirements.length },
        ]} />}>
        {groups.length === 0 ? (
          <EmptyState compact title="Nenhum requisito neste recorte">
            {data.serviceOrders.length ? 'Traga os materiais e dependências da OS emitida ou registre o que cada atividade precisa.'
              : 'Registre o que cada atividade precisa: material, equipamento, equipe, documento ou dependência do cliente.'}
          </EmptyState>
        ) : groups.map((g) => (
          <section key={g.id} className="ax-front-group" aria-label={g.activity?.title ?? 'Sem atividade'}>
            <header className="ax-projfront">
              <span className="ax-projfront-title">
                {g.activity ? <>{g.activity.wbs ? <span className="ax-kind">EAP {g.activity.wbs}</span> : null}<strong>{g.activity.title}</strong></> : <strong>Sem atividade vinculada</strong>}
                {g.activity?.start && <span className="ax-subtle">início {dateShort(g.activity.start)} · {relativeDue(g.activity.start, today).text}</span>}
              </span>
              {g.readiness && <ReadinessStrip cells={g.readiness.cells} label={`Prontidão de ${g.activity?.title ?? 'atividade'}`} />}
            </header>
            {g.reqs.map((r) => <RequirementLine key={r.id} r={r} today={today} actions={rowActions(r)} />)}
          </section>
        ))}
      </Plane>

      {unplanned.length > 0 && (
        <Plane title="Frentes sem necessidade registrada" count={unplanned.length} countTone="warning"
          subtitle="Começam nos próximos 30 dias e ninguém disse o que precisam — equipe, material, documento, liberação do cliente">
          <ul className="ax-exceptions">
            {unplanned.map((a) => (
              <li key={a.id} data-severity="warning">
                <span style={{ display: 'grid', gap: 2, padding: '10px 16px 10px 26px', position: 'relative' }}>
                  <strong>{a.wbs ? `${a.wbs} · ` : ''}{a.title}</strong>
                  <span>início {dateShort(a.start)} · {relativeDue(a.start, today).text}</span>
                </span>
              </li>
            ))}
          </ul>
        </Plane>
      )}

      <p className="ax-note">Requisito confirmado promete data (e quantidade, para material) ao Supply. Toda mudança fica na história do requisito, e
        cada requisito diz de onde veio — atividade, OS, registro manual ou proposta confirmada por pessoa.</p>

      {editing && (
        <RequirementPanel requirement={editing === 'new' ? null : editing} activities={data.activities} busy={busy !== null}
          onClose={() => setEditing(null)}
          onCancelRequirement={editing !== 'new' ? () => { setActing({ req: editing, kind: 'cancel' }); setEditing(null); } : undefined}
          onSubmit={async (body) => {
            const ok = editing === 'new'
              ? await act('Requisito registrado', '/api/operations/requirements', { ...body, projectId })
              : await act('Requisito atualizado', `/api/operations/requirements/${editing.id}`, body, 'PATCH');
            if (ok) setEditing(null);
          }} />
      )}
      {acting && (
        <ReasonPanel kind={acting.kind} req={acting.req} busy={busy !== null} onClose={() => setActing(null)}
          onSubmit={async (text) => {
            const ok = acting.kind === 'cancel'
              ? await act('Requisito cancelado', `/api/operations/requirements/${acting.req.id}/transition`, { to: 'CANCELLED', reason: text })
              : await act('Atendimento registrado', `/api/operations/requirements/${acting.req.id}/satisfy`, { note: text });
            if (ok) setActing(null);
          }} />
      )}
    </>
  );
}

function RequirementPanel({ requirement, activities, busy, onClose, onSubmit, onCancelRequirement }: {
  requirement: Req | null; activities: Payload['activities']; busy: boolean;
  onClose: () => void; onSubmit: (body: Record<string, unknown>) => Promise<void>; onCancelRequirement?: () => void;
}) {
  const [type, setType] = useState<RequirementType>(requirement?.requirement_type ?? 'MATERIAL');
  const [title, setTitle] = useState(requirement?.title ?? '');
  const [activityId, setActivityId] = useState(requirement?.activity_id ?? '');
  const [quantity, setQuantity] = useState(requirement?.quantity ? String(Number(requirement.quantity)) : '');
  const [unit, setUnit] = useState(requirement?.unit ?? '');
  const [requiredBy, setRequiredBy] = useState(requirement?.required_by ?? '');
  const [priority, setPriority] = useState(requirement?.priority ?? 'medium');
  const [location, setLocation] = useState(requirement?.delivery_location_label ?? '');
  const [itemId, setItemId] = useState(requirement?.item_id ?? '');
  const [items, setItems] = useState<Array<{ id: string; code: string; description: string; unit: string }>>([]);
  const locked = requirement?.status === 'CONFIRMED';
  const usesCatalog = type === 'MATERIAL' || type === 'EXTERNAL_SERVICE';
  useEffect(() => {
    if (!usesCatalog) return;
    let cancelled = false;
    fetch('/api/supply/items').then((r) => r.json()).then((p) => { if (!cancelled && p?.ok) setItems(p.items); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [usesCatalog]);
  const chosenItem = items.find((i) => i.id === itemId) ?? null;
  const activity = activities.find((a) => a.id === activityId) ?? null;
  // A data que vale: a menor entre a declarada e o início da frente — mostrada ANTES de salvar.
  const effective = requiredBy && activity?.start ? (requiredBy < activity.start ? requiredBy : activity.start) : requiredBy || activity?.start || null;
  const body: Record<string, unknown> = {
    title: title.trim() || chosenItem?.description || '', activityId: activityId || null, requiredBy: requiredBy || null, priority,
    deliveryLocationLabel: location.trim() || null,
    quantity: quantity ? Number(quantity) : null,
    // Com item de catálogo, a unidade É a do item — o banco recusa outra.
    unit: chosenItem ? chosenItem.unit : unit.trim() || null,
    itemId: usesCatalog ? itemId || null : null,
  };
  if (!locked) body.requirementType = type;
  const invalid = !String(body.title).trim() || (quantity !== '' && !body.unit);

  return (
    <SidePanel open onClose={onClose} testId="requirement-form" eyebrow={requirement ? REQUIREMENT_TYPE_LABEL[requirement.requirement_type] : 'Planejamento'}
      title={requirement ? 'Editar requisito' : 'Novo requisito'}
      meta={<span>{locked ? 'Confirmado: a mudança fica na história e o Supply replaneja contra ela.' : 'Nasce planejado; confirmar é um ato à parte.'}</span>}
      footer={<>
        {onCancelRequirement && requirement && (requirement.status === 'PLANNED' || requirement.status === 'CONFIRMED') && (
          <button type="button" className="ax-btn ghost" onClick={onCancelRequirement} style={{ marginRight: 'auto' }}>Cancelar requisito</button>
        )}
        <button type="button" className="ax-btn ghost" onClick={onClose}>Voltar</button>
        <button type="button" className="ax-btn primary" disabled={busy || invalid} onClick={() => onSubmit(body)}><Busy on={busy}>Salvar</Busy></button>
      </>}>
      <div className="ax-form">
        <div className="ax-field-row">
          <label className="ax-field"><span>Tipo</span>
            <select value={type} disabled={locked} onChange={(e) => setType(e.target.value as RequirementType)}>
              {REQUIREMENT_TYPES.map((t) => <option key={t} value={t}>{REQUIREMENT_TYPE_LABEL[t]}</option>)}
            </select>
          </label>
          <label className="ax-field"><span>Prioridade</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="low">Baixa</option><option value="medium">Média</option>
              <option value="high">Alta</option><option value="critical">Crítica</option>
            </select>
          </label>
        </div>
        {usesCatalog && (
          <label className="ax-field"><span>Item do catálogo</span>
            <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">{type === 'MATERIAL' ? 'Selecione (obrigatório para confirmar)' : 'Sem item'}</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.code} · {i.description} ({i.unit})</option>)}
            </select>
          </label>
        )}
        <label className="ax-field"><span>Título</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={chosenItem?.description ?? 'Ex.: Cabo 35 mm'} /></label>
        <label className="ax-field"><span>Atividade</span>
          <select value={activityId} onChange={(e) => setActivityId(e.target.value)}>
            <option value="">Do projeto (sem atividade)</option>
            {activities.map((a) => <option key={a.id} value={a.id}>{a.wbs ? `${a.wbs} · ` : ''}{a.title}{a.start ? ` — início ${dateShort(a.start)}` : ''}</option>)}
          </select>
        </label>
        <div className="ax-field-row">
          <label className="ax-field"><span>Quantidade</span>
            <input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(',', '.'))} /></label>
          <label className="ax-field"><span>Unidade</span>
            <input value={chosenItem ? chosenItem.unit : unit} disabled={Boolean(chosenItem)} onChange={(e) => setUnit(e.target.value)} placeholder="m, un, kg" /></label>
        </div>
        <label className="ax-field"><span>Necessário em</span>
          <input type="date" value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} /></label>
        {effective && (
          <p className="ax-note" role="status">A data que vale para o Supply e a equipe: <strong>{dateShort(effective)}</strong>
            {activity?.start && requiredBy && requiredBy > activity.start ? ` — a frente começa em ${dateShort(activity.start)}, antes da data declarada.` : ''}</p>
        )}
        <label className="ax-field"><span>Local de entrega</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Canteiro, almoxarifado…" /></label>
      </div>
    </SidePanel>
  );
}

function ReasonPanel({ kind, req, busy, onClose, onSubmit }: {
  kind: 'cancel' | 'satisfy'; req: Req; busy: boolean; onClose: () => void; onSubmit: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  return (
    <SidePanel open onClose={onClose} testId={kind === 'cancel' ? 'requirement-cancel-form' : 'requirement-satisfy-form'}
      eyebrow={REQUIREMENT_TYPE_LABEL[req.requirement_type]} title={kind === 'cancel' ? 'Cancelar requisito' : 'Registrar atendimento'}
      meta={<span>{req.title}</span>}
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onClose}>Voltar</button>
        <button type="button" className="ax-btn primary" disabled={busy || text.trim().length < 3} onClick={() => onSubmit(text.trim())}>
          <Busy on={busy}>Registrar</Busy></button>
      </>}>
      <div className="ax-form">
        <label className="ax-field"><span>{kind === 'cancel' ? 'Motivo do cancelamento' : 'Como foi atendido'}</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)}
            placeholder={kind === 'cancel' ? 'Por que a frente não precisa mais disto' : 'Quem, quando, com qual evidência — ata, e-mail, documento'} /></label>
      </div>
    </SidePanel>
  );
}
