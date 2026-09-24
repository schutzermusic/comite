'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { HudButton, HudModal, useHudToast } from '@/components/hud';
import type { ServiceOrderWorkspace as Workspace } from '@/lib/operations/service-orders/read-model';
import type { ServiceOrderItemKind } from '@/lib/operations/service-orders/types';
import {
  itemKindLabels, originLabels, proposalKindShort, serviceOrderStatusLabels,
} from '@/lib/operations/service-orders/labels';
import { ServiceOrderProjectModal } from '@/components/contracts/service-orders/ServiceOrderProjectModal';
import type { ServiceOrderRow } from '@/components/contracts/service-orders/ServiceOrdersWorkbench';
import {
  EmptyNote, GateCheck, GovernanceNote, Panel, ResourceState, StatePill, TabPanel, WorkspaceHeading, WorkspaceTabs,
  brl, day, useOperationsResource, type Tone,
} from '../ui';
import { ServiceOrderContent } from './ServiceOrderContent';
import { ServiceOrderDivergences } from './ServiceOrderDivergences';

type Payload = Workspace & { ok: true; capabilities: {
  manage: boolean; override: boolean; bindProject: boolean; ingest: boolean; resolveDivergences: boolean;
  issueNormally: boolean; issueWithException: boolean;
} };

type TabId = 'summary' | 'scope' | 'resources' | 'divergences' | 'documents' | 'project' | 'history';

const RESOURCE_KINDS: ServiceOrderItemKind[] = ['MATERIAL', 'EQUIPMENT', 'WORKFORCE', 'RESOURCE', 'TECHNICAL_REQUIREMENT'];

const ACCEPTANCE_SOURCE: Record<string, string> = {
  purchase_order: 'pedido de compra', signed_document: 'documento assinado', email: 'e-mail',
  verbal: 'confirmação verbal', formal_contract: 'contrato', customer_portal: 'portal do cliente',
};

const HISTORY_LABEL: Record<string, string> = {
  service_order_created: 'OS criada', service_order_generated_from_package: 'OS gerada do pacote aceito',
  service_order_issued: 'OS emitida', service_order_issue_exception: 'Emissão sob exceção governada',
  service_order_amended: 'OS emendada', service_order_draft_edited: 'Rascunho editado',
  project_created: 'Projeto criado', project_linked: 'Projeto vinculado', divergence_resolved: 'Divergência decidida',
  authorized: 'Trabalho autorizado', authorization_attached: 'Fonte de autorização anexada',
  governing_source_changed: 'Fonte regente trocada',
};

const EDITABLE = new Set(['DRAFT', 'PENDING_CONFIRMATION']);

async function send(url: string, method: string, body?: unknown): Promise<{ ok: boolean; error?: string } & Record<string, unknown>> {
  const response = await fetch(url, { method, headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = await response.json().catch(() => ({ ok: false, error: 'Resposta inválida.' }));
  return response.ok && payload.ok ? payload : { ok: false, error: payload?.error ?? 'Operação recusada.' };
}

/**
 * WORKSPACE DA OS INTERNA.
 *
 * O cabeçalho responde, sem abrir aba nenhuma: qual OS, de qual cliente, de
 * qual pacote EXATO (PT e PC com revisão), sob qual autorização, em que
 * estado, com qual projeto e qual é a próxima ação. As abas são o detalhe.
 */
export function ServiceOrderWorkspace({ id }: { id: string }) {
  const { data, state, message, refresh } = useOperationsResource<Payload>(`/api/operations/service-orders/${id}`);
  const [tab, setTab] = useState<TabId>('summary');
  const [modal, setModal] = useState<'exception' | 'amend' | 'project' | null>(null);
  const [busy, setBusy] = useState(false);
  const { success, error: notifyError } = useHudToast();

  if (state !== 'ready' || !data) return <ResourceState state={state} message={message} />;
  const os = data.order;
  const caps = data.capabilities;
  const editable = caps.manage && EDITABLE.has(os.status);
  const issued = ['ISSUED', 'IN_EXECUTION', 'SUSPENDED'].includes(os.status);
  const openDiv = data.divergences.filter((d) => d.state === 'OPEN' || d.state === 'ACKNOWLEDGED');
  const statusTone: Tone = os.status === 'PENDING_CONFIRMATION' ? 'warning'
    : os.status === 'ISSUED' || os.status === 'IN_EXECUTION' ? 'success'
      : os.status === 'CANCELLED' || os.status === 'SUSPENDED' ? 'danger' : 'neutral';

  const act = async (label: string, url: string, method: string, body?: unknown) => {
    setBusy(true);
    try {
      const out = await send(url, method, body);
      if (!out.ok) { notifyError(`${label}: recusado`, out.error); return false; }
      success(label);
      refresh();
      return true;
    } finally { setBusy(false); }
  };

  const decide = async (decisions: Array<{ itemId: string; decision: 'CONFIRMED' | 'REJECTED' | 'UNCONFIRMED' }>) => {
    await act('Revisão registrada', `/api/operations/service-orders/${id}/items`, 'PUT', { decisions });
  };
  const addLine = async (kind: ServiceOrderItemKind, title: string, detail: string) => {
    await act('Linha adicionada', `/api/operations/service-orders/${id}/items`, 'POST',
      { kind, title: title.trim(), detail: detail.trim() || null });
  };

  const pkg = data.package;
  const pkgRefs = [pkg.technical, pkg.commercial, pkg.combined].filter(Boolean);
  const projectRow: ServiceOrderRow = {
    id: os.id, engagement_id: os.engagement_id, os_number: os.os_number, title: os.title, origin: os.origin,
    status: os.status, authorized_value: os.authorized_value, currency: os.currency, scope_summary: os.scope_summary,
    planned_start: os.planned_start, planned_finish: os.planned_finish, project_id: os.project_id,
    source_proposal_revision_id: os.source_proposal_revision_id, document_id: os.document_id,
    issued_at: os.issued_at, created_at: os.created_at,
  };

  const tabs: Array<{ id: TabId; label: string; count?: number; tone?: 'danger' | 'warning' }> = [
    { id: 'summary', label: 'Resumo' },
    { id: 'scope', label: 'Escopo e atividades', count: data.counts.unreviewedItems, tone: 'warning' },
    { id: 'resources', label: 'Materiais & Recursos', count: data.items.filter((i) => RESOURCE_KINDS.includes(i.kind)).length },
    { id: 'divergences', label: 'Divergências', count: openDiv.length, tone: data.counts.blockingOpen ? 'danger' : 'warning' },
    { id: 'documents', label: 'Documentos', count: data.documents.length },
    { id: 'project', label: 'Projeto' },
    { id: 'history', label: 'Histórico' },
  ];

  return (
    <section className="crm-workspace ops-workspace" aria-label={`OS ${os.os_number}`} data-testid="os-workspace">
      <div>
        <Link href="/operacoes/ordens-servico" className="crm-muted inline-flex items-center gap-1 text-ig-caption">
          <ArrowLeft size={13} /> Ordens de Serviço
        </Link>
      </div>
      <WorkspaceHeading
        eyebrow={`OS interna · ${originLabels[os.origin]}`}
        title={`${os.os_number} · ${os.title}`}
        description={
          <span className="ops-provenance">
            <StatePill tone={statusTone}>{serviceOrderStatusLabels[os.status]}</StatePill>
            <span><b>{data.engagement?.counterparty_name ?? 'Cliente não informado'}</b></span>
            {pkgRefs.map((r) => (
              <span key={r!.revisionId} className="ops-chip" title="Revisão regente do pacote aceito">
                {proposalKindShort[r!.kind]} <b>{r!.proposalNumber}</b> R{String(r!.revision).padStart(2, '0')}
              </span>
            ))}
            {!pkgRefs.length && <span>Sem pacote de proposta vinculado</span>}
            {os.project_id && data.project && (
              <Link href={`/projetos/${encodeURIComponent(os.project_id)}`} className="ops-chip">Projeto <b>{data.project.name}</b></Link>
            )}
          </span>
        }
        action={
          <StatePill tone={data.nextAction.tone === 'danger' ? 'danger' : data.nextAction.tone === 'warning' ? 'warning'
            : data.nextAction.tone === 'success' ? 'success' : 'accent'} dot={false}>
            Próxima ação: {data.nextAction.label}
          </StatePill>
        }
      />

      <WorkspaceTabs label="Áreas da OS" tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'summary' && (
        <TabPanel id="summary">
          <div className="crm-split">
            <Panel title="Resumo">
              <dl className="ops-summary-grid">
                <div><dt>Valor autorizado</dt><dd className="tabular-nums">{brl(os.authorized_value, os.currency ?? 'BRL')}</dd></div>
                <div><dt>Período planejado</dt><dd>{day(os.planned_start)} → {day(os.planned_finish)}</dd></div>
                <div><dt>Local</dt><dd>{os.site_label ?? '—'}</dd></div>
                <div><dt>Responsável</dt><dd>{os.responsible_user_id ? data.people[os.responsible_user_id] ?? '—' : '—'}</dd></div>
                <div><dt>Autorização regente</dt><dd>{data.governingAuthorization
                  ? `${data.governingAuthorization.source_kind === 'accepted_proposal' ? 'Proposta aceita' : data.governingAuthorization.source_kind}`
                  : 'Sem fonte regente'}</dd></div>
                <div><dt>Aceite do pacote</dt><dd>{pkg.acceptedAt
                  ? `${day(pkg.acceptedAt)}${pkg.acceptanceSource ? ` · ${ACCEPTANCE_SOURCE[pkg.acceptanceSource] ?? pkg.acceptanceSource}` : ''}${pkg.acceptanceExternalRef ? ` · ${pkg.acceptanceExternalRef}` : ''}`
                  : '—'}</dd></div>
                <div><dt>Emitida</dt><dd>{os.issued_at ? `${day(os.issued_at)} por ${os.issued_by ? data.people[os.issued_by] ?? 'usuário' : '—'}` : 'Não emitida'}</dd></div>
                <div><dt>Revisão vigente</dt><dd>{data.revisions[0] ? `R${data.revisions[0].revision} (${data.revisions[0].kind === 'AMENDMENT' ? 'emenda' : 'emissão'})` : '—'}</dd></div>
              </dl>
              {os.scope_summary && (
                <p className="text-ig-body-sm" style={{ padding: '10px 14px', borderTop: '1px solid var(--ops-line)' }}>{os.scope_summary}</p>
              )}
            </Panel>

            <Panel title={issued ? 'Emitida' : 'Portão de emissão'}
              note={issued ? 'Campos materiais só mudam por emenda — cada emenda vira revisão.' : 'Os mesmos portões que o banco aplica.'}>
              {!issued ? (
                <>
                  <ul className="ops-gates">
                    <GateCheck ok={data.counts.unreviewedItems === 0} label="Conteúdo revisado por pessoa"
                      detail={data.counts.unreviewedItems ? `${data.counts.unreviewedItems} linha(s) lida(s) aguardando revisão` : `${data.counts.items} linha(s) revisada(s)`} />
                    <GateCheck ok={data.counts.blockingOpen === 0} label="Sem divergência bloqueante"
                      detail={data.counts.blockingOpen ? `${data.counts.blockingOpen} bloqueante(s) em aberto` : openDiv.length ? `${openDiv.length} aviso(s) para conferir` : 'Confrontada com a fonte regente'} />
                    <GateCheck ok={!!data.governingAuthorization} label="Trabalho com autorização regente"
                      detail={data.governingAuthorization ? undefined : 'Registre a fonte de autorização no Comercial'} />
                  </ul>
                  {caps.manage && (
                    <div className="flex flex-wrap gap-2" style={{ padding: '10px 14px' }}>
                      <HudButton variant="primary" size="sm" disabled={!caps.issueNormally || busy}
                        onClick={() => act('OS emitida', `/api/operations/service-orders/${id}/issue`, 'POST', { mode: 'normal' })}>
                        Emitir OS
                      </HudButton>
                      {caps.issueWithException && (
                        <HudButton variant="secondary" size="sm" disabled={busy} onClick={() => setModal('exception')}>
                          Emitir sob exceção…
                        </HudButton>
                      )}
                      {data.counts.items === 0 && pkgRefs.length > 0 && (
                        <HudButton variant="ghost" size="sm" disabled={busy}
                          onClick={() => act('Conteúdo trazido do pacote', `/api/operations/service-orders/${id}/seed`, 'POST')}>
                          Trazer escopo do pacote
                        </HudButton>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="grid gap-2" style={{ padding: '10px 14px' }}>
                  <p className="text-ig-body-sm">{data.exceptions.length
                    ? `Emitida sob exceção governada por ${data.exceptions[0].authorizedByName ?? 'usuário'}: ${data.exceptions[0].reason}`
                    : 'Emitida pelo caminho normal: conteúdo revisado e sem divergência bloqueante.'}</p>
                  <div className="flex flex-wrap gap-2">
                    {caps.manage && os.status !== 'CLOSED' && (
                      <HudButton variant="secondary" size="sm" onClick={() => setModal('amend')}>Emendar OS…</HudButton>
                    )}
                    {!os.project_id && caps.bindProject && (
                      <HudButton variant="primary" size="sm" onClick={() => setModal('project')}>Criar ou vincular projeto</HudButton>
                    )}
                  </div>
                </div>
              )}
            </Panel>
          </div>
          <ServiceOrderContent items={data.items} editable={editable} people={data.people} onDecide={decide}
            onAdd={editable ? addLine : undefined} title="Conteúdo da OS" />
        </TabPanel>
      )}

      {tab === 'scope' && (
        <TabPanel id="scope">
          <ServiceOrderContent items={data.items} editable={editable} people={data.people} onDecide={decide}
            onAdd={editable ? addLine : undefined}
            kinds={['SCOPE', 'DELIVERABLE', 'MILESTONE', 'ACTIVITY', 'TEST', 'CUSTOMER_DEPENDENCY', 'ASSUMPTION', 'EXCLUSION', 'RISK',
              'MEASUREMENT_CONDITION', 'COMMERCIAL_REFERENCE', 'DOCUMENT']}
            title="Escopo, atividades e condições" />
        </TabPanel>
      )}

      {tab === 'resources' && (
        <TabPanel id="resources">
          <ServiceOrderContent items={data.items} editable={editable} people={data.people} onDecide={decide}
            onAdd={editable ? addLine : undefined} kinds={RESOURCE_KINDS} title="Materiais & Recursos" />
          <GovernanceNote>
            Materiais e recursos da OS são o que a proposta aceita declara. Eles viram demanda de supply quando o
            Planejamento do projeto confirmar o requisito com data de necessidade.
          </GovernanceNote>
        </TabPanel>
      )}

      {tab === 'divergences' && (
        <TabPanel id="divergences">
          <ServiceOrderDivergences
            divergences={data.divergences}
            canResolve={caps.resolveDivergences}
            canCompare={caps.manage}
            onCompare={async (ai) => {
              const out = await send(`/api/operations/service-orders/${id}/compare`, 'POST', { ai });
              if (!out.ok) notifyError('Confronto recusado', out.error);
              else {
                const aiOut = out.ai as { compared?: boolean; recorded?: number; reason?: string } | null;
                success(ai ? (aiOut?.compared ? `Confronto assistido: ${aiOut.recorded ?? 0} candidata(s)`
                  : 'Sem fatos lidos dos dois lados para comparar') : 'Confronto concluído');
              }
              refresh();
            }}
            onResolve={async (divergenceId, prevailing, note) => {
              const out = await send(`/api/commercial/divergences/${divergenceId}/resolve`, 'POST', { prevailingSource: prevailing, note });
              if (!out.ok) return out.error ?? 'Decisão recusada.';
              success('Decisão registrada');
              refresh();
              return null;
            }}
          />
        </TabPanel>
      )}

      {tab === 'documents' && (
        <TabPanel id="documents">
          <Panel title="Documentos" note="Acervo canônico — o mesmo documento que o Comercial e os Contratos enxergam">
            {data.documents.length ? (
              <ul className="crm-linked-list">
                {data.documents.map((d) => (
                  <li key={d.id}>
                    <div>
                      <p>{d.title}</p>
                      <p className="crm-muted">{d.role === 'service_order' ? 'PDF da OS importada' : 'Documento do pacote aceito'} · v{d.version} · {day(d.created_at)}</p>
                    </div>
                    <StatePill tone="neutral">{d.document_type.replace(/_/g, ' ')}</StatePill>
                  </li>
                ))}
              </ul>
            ) : <EmptyNote title="Sem documentos" description="Nenhum PDF ligado a esta OS ou ao pacote dela." />}
          </Panel>
        </TabPanel>
      )}

      {tab === 'project' && (
        <TabPanel id="project">
          <Panel title="Projeto de execução">
            {os.project_id && data.project ? (
              <div className="grid gap-2" style={{ padding: '12px 14px' }}>
                <p className="text-ig-body-sm"><b>{data.project.name}</b></p>
                <p className="crm-muted">O projeto é o contexto de execução desta OS: cronograma, requisitos, medições e supply leem as mesmas identidades.</p>
                <div><Link href={`/projetos/${encodeURIComponent(os.project_id)}`}>
                  <HudButton variant="primary" size="sm">Abrir projeto <ArrowUpRight size={13} /></HudButton></Link></div>
              </div>
            ) : (
              <EmptyNote
                title={issued ? 'OS emitida sem projeto' : 'O projeto nasce da OS emitida'}
                description={issued ? 'Crie o projeto a partir da OS ou vincule um existente. Repetir a ação não cria um segundo projeto.'
                  : 'Enquanto a OS não for emitida, abrir projeto seria executar sob duas verdades.'}
                action={issued && caps.bindProject ? (
                  <HudButton variant="primary" size="sm" onClick={() => setModal('project')}>Criar ou vincular projeto</HudButton>
                ) : undefined}
              />
            )}
          </Panel>
        </TabPanel>
      )}

      {tab === 'history' && (
        <TabPanel id="history">
          <Panel title="Revisões da OS" note="Instantâneo do que foi emitido e de cada emenda — append-only">
            {data.revisions.length ? (
              <ul className="ops-history">
                {data.revisions.map((r) => (
                  <li key={r.id}>
                    <time>{day(r.created_at)}</time>
                    <div>
                      <b>R{r.revision} · {r.kind === 'ISSUE' ? 'Emissão' : r.kind === 'AMENDMENT' ? 'Emenda' : 'Instantâneo inicial'}</b>
                      <p className="crm-muted">{r.actorName ?? 'Sistema'}{r.reason ? ` — ${r.reason}` : ''}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <EmptyNote title="Sem revisões" description="A revisão 1 é gravada no momento da emissão." />}
          </Panel>
          <Panel title="Linha do tempo">
            <ul className="ops-history">
              {data.history.map((h) => (
                <li key={String(h.id)}>
                  <time>{day(String(h.occurred_at))}</time>
                  <div>
                    <b>{HISTORY_LABEL[String(h.transition)] ?? String(h.transition)}</b>
                    <p className="crm-muted">{h.actorName ?? 'Sistema'}{h.note ? ` — ${String(h.note)}` : ''}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </TabPanel>
      )}

      {modal === 'exception' && (
        <ExceptionModal blocking={data.counts.blockingOpen} busy={busy} onClose={() => setModal(null)}
          onSubmit={async (reason) => {
            const ok = await act('OS emitida sob exceção', `/api/operations/service-orders/${id}/issue`, 'POST', { mode: 'exception', reason });
            if (ok) setModal(null);
          }} />
      )}
      {modal === 'amend' && (
        <AmendModal busy={busy} onClose={() => setModal(null)} current={{ site: os.site_label, start: os.planned_start, finish: os.planned_finish }}
          onSubmit={async (body) => {
            const ok = await act('Emenda registrada', `/api/operations/service-orders/${id}/amend`, 'POST', body);
            if (ok) setModal(null);
          }} />
      )}
      {modal === 'project' && (
        <ServiceOrderProjectModal order={projectRow} onClose={() => setModal(null)}
          onDone={async () => { setModal(null); success('Projeto vinculado'); refresh(); }} />
      )}
    </section>
  );
}

function ExceptionModal({ blocking, busy, onClose, onSubmit }: {
  blocking: number; busy: boolean; onClose: () => void; onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  return (
    <HudModal isOpen onClose={onClose} size="md" title="Emitir sob exceção governada"
      subtitle={`${blocking} divergência(s) bloqueante(s) continuam registradas. A exceção fica no livro com o seu nome, a permissão e o motivo.`}
      footer={<div className="flex justify-end gap-2">
        <HudButton variant="ghost" onClick={onClose}>Cancelar</HudButton>
        <HudButton variant="primary" disabled={busy || reason.trim().length < 20} onClick={() => onSubmit(reason.trim())}>
          Emitir sob exceção
        </HudButton>
      </div>}>
      <div className="ops-form">
        <label>Motivo (mínimo 20 caracteres)
          <textarea value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Ex.: cliente confirmou por ata de 12/05 que o valor da OS prevalece até o aditivo." />
        </label>
      </div>
    </HudModal>
  );
}

function AmendModal({ busy, current, onClose, onSubmit }: {
  busy: boolean; current: { site: string | null; start: string | null; finish: string | null };
  onClose: () => void; onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [site, setSite] = useState(current.site ?? '');
  const [start, setStart] = useState(current.start ?? '');
  const [finish, setFinish] = useState(current.finish ?? '');
  const [lineKind, setLineKind] = useState<ServiceOrderItemKind>('ACTIVITY');
  const [lineTitle, setLineTitle] = useState('');
  const body: Record<string, unknown> = { reason: reason.trim() };
  if (site !== (current.site ?? '')) body.siteLabel = site || null;
  if (start !== (current.start ?? '')) body.plannedStart = start || null;
  if (finish !== (current.finish ?? '')) body.plannedFinish = finish || null;
  if (lineTitle.trim()) body.addItems = [{ kind: lineKind, title: lineTitle.trim() }];
  const changes = Object.keys(body).length > 1;
  return (
    <HudModal isOpen onClose={onClose} size="md" title="Emendar OS emitida"
      subtitle="A revisão emitida continua provada. A emenda grava uma nova revisão com o instantâneo e o motivo."
      footer={<div className="flex justify-end gap-2">
        <HudButton variant="ghost" onClick={onClose}>Cancelar</HudButton>
        <HudButton variant="primary" disabled={busy || !changes || reason.trim().length < 5} onClick={() => onSubmit(body)}>
          Registrar emenda
        </HudButton>
      </div>}>
      <div className="ops-form">
        <div className="ops-form-row">
          <label>Local<input value={site} onChange={(e) => setSite(e.target.value)} /></label>
          <label>Início planejado<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label>Término planejado<input type="date" value={finish} onChange={(e) => setFinish(e.target.value)} /></label>
        </div>
        <div className="ops-form-row">
          <label>Nova linha — tipo
            <select value={lineKind} onChange={(e) => setLineKind(e.target.value as ServiceOrderItemKind)}>
              {(['ACTIVITY', 'DELIVERABLE', 'MATERIAL', 'EQUIPMENT', 'CUSTOMER_DEPENDENCY', 'TEST'] as ServiceOrderItemKind[])
                .map((k) => <option key={k} value={k}>{itemKindLabels[k]}</option>)}
            </select>
          </label>
          <label>Nova linha — título<input value={lineTitle} onChange={(e) => setLineTitle(e.target.value)} /></label>
        </div>
        <label>Motivo da emenda
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="O que mudou e quem pediu" />
        </label>
      </div>
    </HudModal>
  );
}
