'use client';

import { useMemo, useState } from 'react';
import { HudButton, HudModal, useHudToast } from '@/components/hud';
import type { ProjectPlanningModel } from '@/lib/operations/planning/read-model';
import {
  REQUIREMENT_TYPE_LABEL, SUPPLY_COVERED_TYPES, type RequirementType,
} from '@/lib/operations/planning/readiness';
import { REQUIREMENT_TYPES } from '@/lib/operations/planning/validation';
import {
  DataTable, EmptyNote, GovernanceNote, Panel, ResourceState, Segments, StatePill, day, useOperationsResource,
} from '../ui';
import { DIMENSION_LABEL, MATRIX_DIMENSIONS, ReadinessCell, ReadinessPill } from './shared';

type Payload = ProjectPlanningModel & { ok: true; capabilities: { manage: boolean } };
type Req = Payload['requirements'][number];

const SOURCE_LABEL: Record<string, string> = {
  ACTIVITY: 'Atividade', SERVICE_ORDER: 'OS', MANUAL: 'Manual', IMPORTED_PLAN: 'Plano importado', AI_PROPOSAL: 'Proposta da IA',
};

async function send(url: string, method: string, body: unknown) {
  const response = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  return response.ok && payload.ok ? { ok: true as const, payload } : { ok: false as const, error: payload?.error ?? 'Operação recusada.' };
}

/**
 * REQUISITOS DO PROJETO — sob o cronograma, porque é dele que eles dependem.
 *
 * Matriz de prontidão por atividade primeiro (o que falta para cada frente
 * começar), a lista de requisitos depois. Material mostra COBERTURA do Supply
 * — não há botão "coberto" para material; para documento, cliente, equipe e
 * equipamento, "atendido" é um ato com nota.
 */
export function ProjectRequirementsPanel({ projectId }: { projectId: string }) {
  const { data, state, message, refresh } = useOperationsResource<Payload>(
    `/api/operations/projects/${encodeURIComponent(projectId)}/requirements`);
  const [filter, setFilter] = useState<'open' | 'all' | 'constraints'>('open');
  const [editing, setEditing] = useState<Req | 'new' | null>(null);
  const [acting, setActing] = useState<{ req: Req; kind: 'cancel' | 'satisfy' } | null>(null);
  const [busy, setBusy] = useState(false);
  const { success, error: notifyError } = useHudToast();

  const rows = useMemo(() => (data?.requirements ?? []).filter((r) =>
    filter === 'all' ? true : filter === 'constraints' ? r.constraints.length > 0 : r.status === 'PLANNED' || r.status === 'CONFIRMED'),
  [data, filter]);

  if (state !== 'ready' || !data) return <ResourceState state={state} message={message} />;
  const manage = data.capabilities.manage;

  const act = async (label: string, url: string, method: string, body: unknown) => {
    setBusy(true);
    try {
      const out = await send(url, method, body);
      if (!out.ok) { notifyError(`${label}: recusado`, out.error); return false; }
      success(label); refresh(); return true;
    } finally { setBusy(false); }
  };

  const live = data.requirements.filter((r) => r.status === 'PLANNED' || r.status === 'CONFIRMED');
  const withConstraints = data.requirements.filter((r) => r.constraints.length > 0);

  return (
    <section className="crm-workspace ops-workspace mt-4" aria-label="Requisitos de execução" data-testid="project-requirements">
      {data.readinessByActivity.length > 0 && (
        <Panel title="Prontidão por atividade" note="O pior requisito de cada frente decide — derivado, nunca digitado">
          <div className="crm-table-scroll" role="region" aria-label="Matriz de prontidão" tabIndex={0}>
            <table className="ops-matrix">
              <thead><tr><th scope="col">Atividade</th>{MATRIX_DIMENSIONS.map((d) => <th key={d} scope="col">{DIMENSION_LABEL[d]}</th>)}
                <th scope="col">Geral</th></tr></thead>
              <tbody>
                {data.readinessByActivity.map((a) => (
                  <tr key={a.activityId}>
                    <td>{a.title}{a.start && <p className="crm-muted">Início {day(a.start)}</p>}</td>
                    {MATRIX_DIMENSIONS.map((d) => <td key={d}><ReadinessCell value={a.cells[d]} /></td>)}
                    <td><ReadinessPill value={a.overall} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel
        title="Requisitos de execução"
        note={`${live.length} vivo(s) · ${live.filter((r) => r.status === 'PLANNED').length} a confirmar · ${withConstraints.length} com exceção de plano`}
        aside={manage ? (
          <div className="flex flex-wrap gap-2">
            {data.serviceOrders.map((o) => (
              <HudButton key={o.id} variant="ghost" size="sm" disabled={busy}
                onClick={() => act(`Requisitos trazidos da OS ${o.os_number}`,
                  `/api/operations/projects/${encodeURIComponent(projectId)}/requirements/import`, 'POST', { serviceOrderId: o.id })}>
                Trazer da OS {o.os_number}
              </HudButton>
            ))}
            <HudButton variant="primary" size="sm" onClick={() => setEditing('new')}>Novo requisito</HudButton>
          </div>
        ) : undefined}
      >
        <div style={{ padding: '10px 14px 0' }}>
          <Segments label="Filtrar requisitos" value={filter} onChange={(v) => setFilter(v as typeof filter)}
            options={[{ value: 'open', label: 'Vivos', count: live.length },
              { value: 'constraints', label: 'Com exceção', count: withConstraints.length },
              { value: 'all', label: 'Todos', count: data.requirements.length }]} />
        </div>
        <DataTable
          label="Requisitos do projeto"
          columns={['Requisito', 'Atividade', 'Necessário em', 'Quantidade', 'Prontidão', 'Origem', 'Ações']}
          count={rows.length}
          footer="Cobertura de material vem do Supply; o requisito nunca guarda 'coberto'"
          empty={<EmptyNote title="Nenhum requisito" description={data.serviceOrders.length
            ? 'Traga os materiais e dependências da OS emitida ou registre o requisito da atividade.'
            : 'Registre o que cada atividade precisa: material, equipamento, equipe, documento ou dependência do cliente.'} />}
        >
          {rows.map((r) => (
            <tr key={r.id} data-testid="requirement-row">
              <td>
                <p><b>{r.title}</b></p>
                <p className="crm-muted">{REQUIREMENT_TYPE_LABEL[r.requirement_type]}
                  {r.status !== 'PLANNED' && r.status !== 'CONFIRMED' ? ` · ${r.status === 'CANCELLED' ? 'Cancelado' : 'Substituído'}` : ''}</p>
                {r.constraints.map((c, i) => (
                  <p key={i} className={c.severity === 'danger' ? 'crm-tone-danger text-ig-caption' : c.severity === 'warning' ? 'crm-tone-warning text-ig-caption' : 'crm-muted'}>
                    {c.text}</p>
                ))}
              </td>
              <td>{r.activityTitle ?? <span className="crm-muted">Projeto</span>}</td>
              <td className={r.required_by && r.required_by < data.today && r.readiness !== 'READY' ? 'crm-tone-danger' : undefined}>
                {day(r.required_by)}</td>
              <td className="tabular-nums">{r.quantity ? `${Number(r.quantity).toLocaleString('pt-BR')} ${r.unit ?? ''}` : '—'}
                {r.coverage && <p className="crm-muted">Coberto {r.coverage.covered.toLocaleString('pt-BR')}</p>}</td>
              <td><ReadinessPill value={r.readiness} />
                {r.satisfiedByName && <p className="crm-muted">por {r.satisfiedByName}</p>}</td>
              <td><StatePill tone="neutral" dot={false}>{SOURCE_LABEL[r.source] ?? r.source}</StatePill></td>
              <td>
                {manage && (r.status === 'PLANNED' || r.status === 'CONFIRMED') && (
                  <div className="flex flex-wrap gap-1">
                    {r.status === 'PLANNED' && (
                      <HudButton variant="primary" size="sm" disabled={busy}
                        onClick={() => act('Requisito confirmado', `/api/operations/requirements/${r.id}/transition`, 'POST', { to: 'CONFIRMED' })}>
                        Confirmar</HudButton>
                    )}
                    <HudButton variant="ghost" size="sm" onClick={() => setEditing(r)}>Editar</HudButton>
                    {r.status === 'CONFIRMED' && !SUPPLY_COVERED_TYPES.includes(r.requirement_type) && !r.satisfied_at && (
                      <HudButton variant="ghost" size="sm" onClick={() => setActing({ req: r, kind: 'satisfy' })}>Atendido</HudButton>
                    )}
                    <HudButton variant="ghost" size="sm" onClick={() => setActing({ req: r, kind: 'cancel' })}>Cancelar</HudButton>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      </Panel>
      <GovernanceNote>
        Requisito confirmado promete data (e quantidade, para material) ao Supply. Toda mudança fica na história do requisito,
        e cada requisito diz de onde veio — atividade, OS, registro manual ou proposta confirmada por pessoa.
      </GovernanceNote>

      {editing && (
        <RequirementModal projectId={projectId} requirement={editing === 'new' ? null : editing} activities={data.activities}
          busy={busy} onClose={() => setEditing(null)}
          onSubmit={async (body) => {
            const ok = editing === 'new'
              ? await act('Requisito registrado', '/api/operations/requirements', 'POST', { ...body, projectId })
              : await act('Requisito atualizado', `/api/operations/requirements/${editing.id}`, 'PATCH', body);
            if (ok) setEditing(null);
          }} />
      )}
      {acting && (
        <ReasonModal title={acting.kind === 'cancel' ? 'Cancelar requisito' : 'Registrar atendimento'}
          label={acting.kind === 'cancel' ? 'Motivo do cancelamento' : 'Como foi atendido (nota)'}
          busy={busy} onClose={() => setActing(null)}
          onSubmit={async (text) => {
            const ok = acting.kind === 'cancel'
              ? await act('Requisito cancelado', `/api/operations/requirements/${acting.req.id}/transition`, 'POST', { to: 'CANCELLED', reason: text })
              : await act('Atendimento registrado', `/api/operations/requirements/${acting.req.id}/satisfy`, 'POST', { note: text });
            if (ok) setActing(null);
          }} />
      )}
    </section>
  );
}

function RequirementModal({ projectId, requirement, activities, busy, onClose, onSubmit }: {
  projectId: string; requirement: Req | null; activities: Payload['activities']; busy: boolean;
  onClose: () => void; onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [type, setType] = useState<RequirementType>(requirement?.requirement_type ?? 'MATERIAL');
  const [title, setTitle] = useState(requirement?.title ?? '');
  const [activityId, setActivityId] = useState(requirement?.activity_id ?? '');
  const [quantity, setQuantity] = useState(requirement?.quantity ? String(Number(requirement.quantity)) : '');
  const [unit, setUnit] = useState(requirement?.unit ?? '');
  const [requiredBy, setRequiredBy] = useState(requirement?.required_by ?? '');
  const [priority, setPriority] = useState(requirement?.priority ?? 'medium');
  const [location, setLocation] = useState(requirement?.delivery_location_label ?? '');
  const locked = requirement?.status === 'CONFIRMED';
  const body: Record<string, unknown> = {
    title: title.trim(), activityId: activityId || null, requiredBy: requiredBy || null, priority,
    deliveryLocationLabel: location.trim() || null,
    quantity: quantity ? Number(quantity) : null, unit: unit.trim() || null,
  };
  if (!locked) body.requirementType = type;
  void projectId;
  return (
    <HudModal isOpen onClose={onClose} size="md" title={requirement ? 'Editar requisito' : 'Novo requisito'}
      subtitle={locked ? 'Requisito confirmado: a mudança fica na história e o Supply replaneja contra ela.' : 'Nasce planejado; confirmar é um ato à parte.'}
      footer={<div className="flex justify-end gap-2">
        <HudButton variant="ghost" onClick={onClose}>Cancelar</HudButton>
        <HudButton variant="primary" disabled={busy || !title.trim() || (quantity !== '' && !unit.trim())} onClick={() => onSubmit(body)}>Salvar</HudButton>
      </div>}>
      <div className="ops-form" data-testid="requirement-form">
        <div className="ops-form-row">
          <label>Tipo
            <select value={type} disabled={locked} onChange={(e) => setType(e.target.value as RequirementType)}>
              {REQUIREMENT_TYPES.map((t) => <option key={t} value={t}>{REQUIREMENT_TYPE_LABEL[t]}</option>)}
            </select>
          </label>
          <label>Prioridade
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="low">Baixa</option><option value="medium">Média</option>
              <option value="high">Alta</option><option value="critical">Crítica</option>
            </select>
          </label>
        </div>
        <label>Título<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Cabo 35 mm" /></label>
        <label>Atividade
          <select value={activityId} onChange={(e) => setActivityId(e.target.value)}>
            <option value="">Do projeto (sem atividade)</option>
            {activities.map((a) => <option key={a.id} value={a.id}>{a.wbs ? `${a.wbs} · ` : ''}{a.title}</option>)}
          </select>
        </label>
        <div className="ops-form-row">
          <label>Quantidade<input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(',', '.'))} /></label>
          <label>Unidade<input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="m, un, kg" /></label>
          <label>Necessário em<input type="date" value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} /></label>
        </div>
        <label>Local de entrega<input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Canteiro, almoxarifado…" /></label>
      </div>
    </HudModal>
  );
}

function ReasonModal({ title, label, busy, onClose, onSubmit }: {
  title: string; label: string; busy: boolean; onClose: () => void; onSubmit: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  return (
    <HudModal isOpen onClose={onClose} size="sm" title={title}
      footer={<div className="flex justify-end gap-2">
        <HudButton variant="ghost" onClick={onClose}>Voltar</HudButton>
        <HudButton variant="primary" disabled={busy || text.trim().length < 3} onClick={() => onSubmit(text.trim())}>Registrar</HudButton>
      </div>}>
      <div className="ops-form"><label>{label}<textarea value={text} onChange={(e) => setText(e.target.value)} /></label></div>
    </HudModal>
  );
}
