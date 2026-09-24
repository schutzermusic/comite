'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, Check, ChevronRight, CircleDashed, FileText } from 'lucide-react';
import { useHudToast } from '@/components/hud';
import type { ServiceOrderWorkspace as Workspace } from '@/lib/operations/service-orders/read-model';
import type { ServiceOrderItemKind } from '@/lib/operations/service-orders/types';
import { buildServiceOrderComparison, comparisonCounts } from '@/lib/operations/service-orders/comparison';
import { itemKindLabels, originLabels, proposalKindShort, serviceOrderStatusLabels } from '@/lib/operations/service-orders/labels';
import { ServiceOrderProjectModal } from '@/components/contracts/service-orders/ServiceOrderProjectModal';
import type { ServiceOrderRow } from '@/components/contracts/service-orders/ServiceOrdersWorkbench';
import {
  AxPage, Busy, Chip, CommandHeader, EmptyState, KV, Plane, Resource, SidePanel, Tabs, date, dateTime, href, money, notifyChanged, plural,
  useResource, useUrlParam, useUrlParams, type Tone,
} from '@/components/ax';
import { ServiceOrderContent } from './ServiceOrderContent';
import { ServiceOrderDivergences } from './ServiceOrderDivergences';
import { ServiceOrderComparison } from './ServiceOrderComparison';

type Payload = Workspace & { ok: true; capabilities: {
  manage: boolean; override: boolean; bindProject: boolean; ingest: boolean; resolveDivergences: boolean;
  issueNormally: boolean; issueWithException: boolean;
} };
type TabId = 'resumo' | 'comparacao' | 'conteudo' | 'divergencias' | 'documentos' | 'projeto' | 'historico';

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
const NEXT_TONE: Record<string, Tone> = { danger: 'danger', warning: 'warning', accent: 'accent', success: 'success', neutral: 'neutral' };
const STATUS_TONE = (s: string): Tone => (s === 'PENDING_CONFIRMATION' ? 'warning' : s === 'ISSUED' || s === 'IN_EXECUTION' ? 'success'
  : s === 'CANCELLED' || s === 'SUSPENDED' ? 'danger' : 'neutral');

async function send(url: string, method: string, body?: unknown): Promise<{ ok: boolean; error?: string } & Record<string, unknown>> {
  const response = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = await response.json().catch(() => ({ ok: false, error: 'Resposta inválida.' }));
  return response.ok && payload.ok ? payload : { ok: false, error: payload?.error ?? 'Operação recusada.' };
}

/**
 * WORKSPACE DA OS INTERNA — a ponte entre o Comercial e a Operação.
 *
 * O cabeçalho responde sem abrir aba: qual OS, de qual cliente, de qual
 * pacote EXATO (PT e PC com revisão), sob qual autorização, em que estado,
 * com o que a segura, com qual projeto — e a próxima ação. A comparação
 * OS × PT × PC mostra o que diverge, falta, sobra ou é incerto.
 */
export function ServiceOrderWorkspace({ id }: { id: string }) {
  const resource = useResource<Payload>(`/api/operations/service-orders/${id}`);
  return (
    <AxPage testId="os-workspace">
      <Resource {...resource}>{(data) => <OsWorkspace id={id} data={data} refresh={resource.refresh} />}</Resource>
    </AxPage>
  );
}

function OsWorkspace({ id, data, refresh }: { id: string; data: Payload; refresh: () => void }) {
  const [tab, setTab] = useUrlParam<TabId>('tab', 'resumo');
  const patch = useUrlParams();
  const [focusDivergence, setFocusDivergence] = useState<string | null>(null);
  const [modal, setModal] = useState<'exception' | 'amend' | 'project' | null>(null);
  const [busy, setBusy] = useState(false);
  const { success, error: notifyError } = useHudToast();
  const os = data.order;
  const caps = data.capabilities;
  const editable = caps.manage && EDITABLE.has(os.status);
  const issued = ['ISSUED', 'IN_EXECUTION', 'SUSPENDED'].includes(os.status);
  const openDiv = data.divergences.filter((d) => d.state === 'OPEN' || d.state === 'ACKNOWLEDGED');
  const pkg = data.package;
  const cmp = comparisonCounts(buildServiceOrderComparison({ items: data.items, facts: data.packageFacts, divergences: data.divergences,
    authorizedValue: os.authorized_value, currency: os.currency }));

  const act = async (label: string, url: string, method: string, body?: unknown) => {
    setBusy(true);
    try {
      const out = await send(url, method, body);
      if (!out.ok) { notifyError(`${label}: recusado`, out.error); return false; }
      success(label); notifyChanged(); refresh();
      return true;
    } finally { setBusy(false); }
  };
  const decide = async (decisions: Array<{ itemId: string; decision: 'CONFIRMED' | 'REJECTED' | 'UNCONFIRMED' }>) => {
    await act('Revisão registrada', `/api/operations/service-orders/${id}/items`, 'PUT', { decisions });
  };
  const addLine = async (kind: ServiceOrderItemKind, title: string, detail: string) => {
    await act('Linha adicionada', `/api/operations/service-orders/${id}/items`, 'POST', { kind, title: title.trim(), detail: detail.trim() || null });
  };
  const projectRow: ServiceOrderRow = {
    id: os.id, engagement_id: os.engagement_id, os_number: os.os_number, title: os.title, origin: os.origin,
    status: os.status, authorized_value: os.authorized_value, currency: os.currency, scope_summary: os.scope_summary,
    planned_start: os.planned_start, planned_finish: os.planned_finish, project_id: os.project_id,
    source_proposal_revision_id: os.source_proposal_revision_id, document_id: os.document_id,
    issued_at: os.issued_at, created_at: os.created_at,
  };
  const next = data.nextAction;
  const nextButton = next.code === 'ISSUE' && caps.manage && caps.issueNormally
    ? <button type="button" className="ax-btn primary" disabled={busy} onClick={() => act('OS emitida', `/api/operations/service-orders/${id}/issue`, 'POST', { mode: 'normal' })}>
      <Busy on={busy}>Emitir OS</Busy></button>
    : next.code === 'LINK_PROJECT' && caps.bindProject
      ? <button type="button" className="ax-btn primary" onClick={() => setModal('project')}>Criar ou vincular projeto</button>
      : next.code === 'REVIEW_CONTENT' ? <button type="button" className="ax-btn primary" onClick={() => setTab('comparacao')}>Revisar linhas</button>
        : next.code === 'RESOLVE_BLOCKING' || next.code === 'REVIEW_WARNINGS'
          ? <button type="button" className="ax-btn primary" onClick={() => setTab('divergencias')}>Abrir divergências</button>
          : os.project_id ? <Link className="ax-btn" href={href.project(os.project_id)}>Abrir projeto<ArrowUpRight size={14} aria-hidden /></Link> : null;

  return (
    <>
      <Link href="/operacoes/ordens-servico" className="ax-back"><ArrowLeft size={13} aria-hidden /> Ordens de Serviço</Link>
      <CommandHeader domain="operations" area={`OS interna · ${originLabels[os.origin]}`} title={`${os.os_number} · ${os.title}`}
        context={<>
          <Chip tone={STATUS_TONE(os.status)}>{serviceOrderStatusLabels[os.status]}</Chip>
          <span><strong>{data.engagement?.counterparty_name ?? 'Cliente não informado'}</strong></span>
          <span className={NEXT_TONE[next.tone] === 'danger' ? 'ax-danger-text' : undefined}>Próxima ação: {next.label}</span>
        </>}
        actions={nextButton} />

      <nav className="ax-bridge" aria-label="Da proposta aceita à obra">
        <BridgeNode label="Aceite do cliente" state={pkg.acceptedAt ? 'ok' : 'pending'}
          main={pkg.acceptedAt ? date(pkg.acceptedAt) : 'não registrado'}
          sub={pkg.acceptedAt ? [pkg.acceptanceSource ? ACCEPTANCE_SOURCE[pkg.acceptanceSource] ?? pkg.acceptanceSource : null, pkg.acceptanceExternalRef].filter(Boolean).join(' · ') : 'o aceite nasce no Comercial'} />
        {[pkg.technical, pkg.commercial, pkg.combined].filter(Boolean).map((r) => (
          <BridgeNode key={r!.revisionId} label={`${proposalKindShort[r!.kind]} regente`} state={r!.status === 'ACCEPTED' ? 'ok' : 'warn'}
            main={`${r!.proposalNumber} R${String(r!.revision).padStart(2, '0')}`}
            sub={`${r!.status === 'ACCEPTED' ? 'aceita' : r!.status.toLowerCase()}${pkg.fromAuthorization ? ' · pela autorização' : ''}`} />
        ))}
        {!pkg.technical && !pkg.commercial && !pkg.combined && <BridgeNode label="Pacote" state="pending" main="sem pacote de proposta" sub="OS avulsa ou importada" />}
        <BridgeNode label="Autorização" state={data.governingAuthorization ? 'ok' : 'pending'}
          main={data.governingAuthorization?.authorized_value ? money(Number(data.governingAuthorization.authorized_value), data.governingAuthorization.currency ?? 'BRL') : 'sem fonte regente'}
          sub={data.governingAuthorization ? (data.governingAuthorization.source_kind === 'accepted_proposal' ? 'proposta aceita' : data.governingAuthorization.source_kind) : 'registre no Comercial'} />
        <BridgeNode label="OS interna" state={data.counts.blockingOpen ? 'danger' : data.counts.unreviewedItems || openDiv.length ? 'warn' : issued ? 'ok' : 'pending'}
          main={serviceOrderStatusLabels[os.status]}
          sub={data.counts.blockingOpen ? plural(data.counts.blockingOpen, 'bloqueante', 'bloqueantes') : data.counts.unreviewedItems ? `${data.counts.unreviewedItems} a revisar`
            : openDiv.length ? plural(openDiv.length, 'aviso', 'avisos') : issued ? `emitida ${os.issued_at ? date(os.issued_at) : ''}` : 'pronta para emitir'} />
        <BridgeNode label="Projeto" state={os.project_id ? 'ok' : issued ? 'warn' : 'pending'} last
          main={os.project_id && data.project ? <Link className="ax-link" href={href.project(os.project_id)}>{data.project.name}</Link> : 'sem projeto'}
          sub={os.project_id ? 'contexto de execução' : issued ? 'crie ou vincule' : 'nasce da OS emitida'} />
      </nav>

      <Tabs<TabId> label="Áreas da OS" value={tab} onChange={setTab} tabs={[
        { id: 'resumo', label: 'Resumo' },
        { id: 'comparacao', label: 'Comparação OS × PT × PC', count: cmp.conflicting + cmp.uncertain + cmp.missing, tone: cmp.conflicting ? 'danger' : 'warning' },
        { id: 'conteudo', label: 'Conteúdo', count: data.counts.unreviewedItems, tone: 'warning' },
        { id: 'divergencias', label: 'Divergências', count: openDiv.length, tone: data.counts.blockingOpen ? 'danger' : 'warning' },
        { id: 'documentos', label: 'Documentos', count: data.documents.length },
        { id: 'projeto', label: 'Projeto' },
        { id: 'historico', label: 'Histórico' },
      ]} />

      <div role="tabpanel" aria-labelledby={`ax-tab-${tab}`} className="ax-stack">
        {tab === 'resumo' && (
          <>
            <div className="ax-grid main-side">
              <Plane title={issued ? 'Emitida' : 'Portão de emissão'} subtitle={issued ? 'Campos materiais só mudam por emenda — cada emenda vira revisão.' : 'Os mesmos portões que o banco aplica.'}>
                {!issued ? (
                  <>
                    <ul className="ax-gates">
                      <Gate ok={data.counts.unreviewedItems === 0} label="Conteúdo revisado por pessoa"
                        detail={data.counts.unreviewedItems ? `${data.counts.unreviewedItems} linha(s) lida(s) aguardando revisão` : `${data.counts.items} linha(s) revisada(s)`} />
                      <Gate ok={data.counts.blockingOpen === 0} label="Sem divergência bloqueante"
                        detail={data.counts.blockingOpen ? `${data.counts.blockingOpen} bloqueante(s) em aberto` : openDiv.length ? `${openDiv.length} aviso(s) para conferir` : 'Confrontada com a fonte regente'} />
                      <Gate ok={!!data.governingAuthorization} label="Trabalho com autorização regente"
                        detail={data.governingAuthorization ? undefined : 'Registre a fonte de autorização no Comercial'} />
                    </ul>
                    {caps.manage && (
                      <div className="ax-inline" style={{ flexWrap: 'wrap', marginTop: 12 }}>
                        <button type="button" className="ax-btn primary" disabled={!caps.issueNormally || busy}
                          onClick={() => act('OS emitida', `/api/operations/service-orders/${id}/issue`, 'POST', { mode: 'normal' })}>Emitir OS</button>
                        {caps.issueWithException && <button type="button" className="ax-btn" disabled={busy} onClick={() => setModal('exception')}>Emitir sob exceção…</button>}
                        {data.counts.items === 0 && (pkg.technical || pkg.commercial || pkg.combined) && (
                          <button type="button" className="ax-btn ghost" disabled={busy}
                            onClick={() => act('Conteúdo trazido do pacote', `/api/operations/service-orders/${id}/seed`, 'POST')}>Trazer escopo do pacote</button>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="ax-stack" style={{ gap: 10 }}>
                    <p style={{ margin: 0 }}>{data.exceptions.length
                      ? `Emitida sob exceção governada por ${data.exceptions[0].authorizedByName ?? 'usuário'}: ${String(data.exceptions[0].reason)}`
                      : 'Emitida pelo caminho normal: conteúdo revisado e sem divergência bloqueante.'}</p>
                    <div className="ax-inline" style={{ flexWrap: 'wrap' }}>
                      {caps.manage && os.status !== 'CLOSED' && <button type="button" className="ax-btn" onClick={() => setModal('amend')}>Emendar OS…</button>}
                      {!os.project_id && caps.bindProject && <button type="button" className="ax-btn primary" onClick={() => setModal('project')}>Criar ou vincular projeto</button>}
                    </div>
                  </div>
                )}
              </Plane>
              <Plane title="A OS">
                <KV items={[
                  ['Valor autorizado', os.authorized_value ? money(Number(os.authorized_value), os.currency ?? 'BRL') : '—'],
                  ['Período planejado', os.planned_start || os.planned_finish
                    ? `${os.planned_start ? date(os.planned_start) : 'início a definir'} → ${os.planned_finish ? date(os.planned_finish) : 'fim a definir'}` : 'não definido'],
                  ['Local', os.site_label ?? '—'],
                  ['Responsável', os.responsible_user_id ? data.people[os.responsible_user_id] ?? '—' : '—'],
                  ['Emitida', os.issued_at ? `${date(os.issued_at)} por ${os.issued_by ? data.people[os.issued_by] ?? 'usuário' : '—'}` : 'não emitida'],
                  ['Revisão vigente', data.revisions[0] ? `R${data.revisions[0].revision} (${data.revisions[0].kind === 'AMENDMENT' ? 'emenda' : 'emissão'})` : 'nasce na emissão'],
                  ['Comparação', `${cmp.aligned} alinhada(s) · ${cmp.conflicting} conflito(s) · ${cmp.missing} faltando · ${cmp.additional} adicional(is) · ${cmp.uncertain} incerta(s)`],
                ]} />
                {os.scope_summary && <p className="ax-note" style={{ marginBottom: 0 }}>{os.scope_summary}</p>}
              </Plane>
            </div>
            <ServiceOrderContent items={data.items} editable={editable} people={data.people} onDecide={decide} onlyPending testId="os-pending"
              title="O que falta revisar" subtitle="Linhas lidas que ninguém confirmou — a emissão espera por elas" />
          </>
        )}

        {tab === 'comparacao' && (
          <ServiceOrderComparison items={data.items} facts={data.packageFacts} divergences={data.divergences} authorizedValue={os.authorized_value}
            currency={os.currency} editable={editable} canResolve={caps.resolveDivergences} onDecide={decide} onAdd={addLine}
            hasPackage={Boolean(pkg.technical || pkg.commercial || pkg.combined)}
            onResolve={(divergenceId) => { setFocusDivergence(divergenceId); patch({ tab: 'divergencias' }); }} />
        )}

        {tab === 'conteudo' && (
          <ServiceOrderContent items={data.items} editable={editable} people={data.people} onDecide={decide} onAdd={editable ? addLine : undefined}
            title="Conteúdo da OS" />
        )}

        {tab === 'divergencias' && (
          <ServiceOrderDivergences divergences={data.divergences} canResolve={caps.resolveDivergences} canCompare={caps.manage} focus={focusDivergence}
            currency={os.currency}
            onCompare={async (ai) => {
              const out = await send(`/api/operations/service-orders/${id}/compare`, 'POST', { ai });
              if (!out.ok) notifyError('Confronto recusado', out.error);
              else {
                const aiOut = out.ai as { compared?: boolean; recorded?: number } | null;
                success(ai ? (aiOut?.compared ? `Confronto assistido: ${aiOut.recorded ?? 0} candidata(s)` : 'Sem fatos lidos dos dois lados para comparar') : 'Confronto concluído');
              }
              refresh();
            }}
            onResolve={async (divergenceId, prevailing, note) => {
              const out = await send(`/api/commercial/divergences/${divergenceId}/resolve`, 'POST', { prevailingSource: prevailing, note });
              if (!out.ok) return out.error ?? 'Decisão recusada.';
              success('Decisão registrada'); refresh();
              return null;
            }} />
        )}

        {tab === 'documentos' && (
          <Plane flush title="Documentos" subtitle="Acervo canônico — o mesmo documento que o Comercial e os Contratos enxergam">
            {data.documents.length ? (
              <ul className="ax-loclist" style={{ padding: '0 16px 8px' }}>
                {data.documents.map((d) => (
                  <li key={d.id}><span><FileText size={13} aria-hidden /> {d.title}<br /><small className="ax-subtle">
                    {d.role === 'service_order' ? 'PDF da OS importada' : 'documento do pacote aceito'} · v{d.version} · {date(d.created_at)}</small></span>
                    <em>{d.document_type.replace(/_/g, ' ')}</em><strong /></li>
                ))}
              </ul>
            ) : <EmptyState compact title="Sem documentos">Nenhum PDF ligado a esta OS ou ao pacote dela.</EmptyState>}
          </Plane>
        )}

        {tab === 'projeto' && (
          <Plane title="Projeto de execução">
            {os.project_id && data.project ? (
              <div className="ax-stack" style={{ gap: 10 }}>
                <strong>{data.project.name}</strong>
                <p className="ax-muted" style={{ margin: 0 }}>O projeto é o contexto de execução desta OS: cronograma, requisitos, medições e supply leem as mesmas identidades.</p>
                <div><Link className="ax-btn primary" href={href.project(os.project_id)}>Abrir projeto<ArrowUpRight size={14} aria-hidden /></Link></div>
              </div>
            ) : (
              <EmptyState compact title={issued ? 'OS emitida sem projeto' : 'O projeto nasce da OS emitida'}
                action={issued && caps.bindProject ? <button type="button" className="ax-btn primary sm" onClick={() => setModal('project')}>Criar ou vincular projeto</button> : undefined}>
                {issued ? 'Crie o projeto a partir da OS ou vincule um existente. Repetir a ação não cria um segundo projeto.'
                  : 'Enquanto a OS não for emitida, abrir projeto seria executar sob duas verdades.'}
              </EmptyState>
            )}
          </Plane>
        )}

        {tab === 'historico' && (
          <div className="ax-grid halves">
            <Plane title="Revisões da OS" subtitle="Instantâneo do que foi emitido e de cada emenda — append-only">
              {data.revisions.length ? (
                <ol className="ax-timeline">{data.revisions.map((r) => (
                  <li key={r.id}><span className="ax-timeline-dot" aria-hidden /><div className="ax-cellstack">
                    <span><b>R{r.revision} · {r.kind === 'ISSUE' ? 'Emissão' : r.kind === 'AMENDMENT' ? 'Emenda' : 'Instantâneo inicial'}</b></span>
                    <small>{r.actorName ?? 'Sistema'} · {dateTime(r.created_at)}{r.reason ? ` · ${r.reason}` : ''}</small></div></li>
                ))}</ol>
              ) : <EmptyState compact title="Sem revisões">A revisão 1 é gravada no momento da emissão.</EmptyState>}
            </Plane>
            <Plane title="Linha do tempo do trabalho">
              <ol className="ax-timeline">{data.history.map((h) => (
                <li key={String(h.id)}><span className="ax-timeline-dot" aria-hidden /><div className="ax-cellstack">
                  <span><b>{HISTORY_LABEL[String(h.transition)] ?? String(h.transition)}</b></span>
                  <small>{h.actorName ?? 'Sistema'} · {dateTime(String(h.occurred_at))}{h.note ? ` · ${String(h.note)}` : ''}</small></div></li>
              ))}</ol>
            </Plane>
          </div>
        )}
      </div>

      {modal === 'exception' && (
        <ExceptionPanel blocking={data.counts.blockingOpen} busy={busy} onClose={() => setModal(null)}
          onSubmit={async (reason) => { if (await act('OS emitida sob exceção', `/api/operations/service-orders/${id}/issue`, 'POST', { mode: 'exception', reason })) setModal(null); }} />
      )}
      {modal === 'amend' && (
        <AmendPanel busy={busy} onClose={() => setModal(null)} current={{ site: os.site_label, start: os.planned_start, finish: os.planned_finish }}
          onSubmit={async (body) => { if (await act('Emenda registrada', `/api/operations/service-orders/${id}/amend`, 'POST', body)) setModal(null); }} />
      )}
      {modal === 'project' && (
        <ServiceOrderProjectModal order={projectRow} onClose={() => setModal(null)}
          onDone={async () => { setModal(null); success('Projeto vinculado'); notifyChanged(); refresh(); }} />
      )}
    </>
  );
}

function BridgeNode({ label, main, sub, state, last }: { label: string; main: ReactNode; sub?: ReactNode; state: 'ok' | 'warn' | 'danger' | 'pending'; last?: boolean }) {
  return (
    <div className="ax-bridge-node" data-state={state}>
      <span className="ax-bridge-label"><i aria-hidden />{label}</span>
      <strong>{main}</strong>
      {sub && <small>{sub}</small>}
      {!last && <ChevronRight size={14} className="ax-bridge-arrow" aria-hidden />}
    </div>
  );
}

function Gate({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <li className="ax-gate" data-ok={ok}>
      <span aria-hidden>{ok ? <Check size={14} /> : <CircleDashed size={14} />}</span>
      <div className="ax-cellstack"><span>{label}</span>{detail && <small>{detail}</small>}</div>
    </li>
  );
}

function ExceptionPanel({ blocking, busy, onClose, onSubmit }: { blocking: number; busy: boolean; onClose: () => void; onSubmit: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  return (
    <SidePanel open onClose={onClose} testId="os-exception-form" eyebrow="Emissão governada" title="Emitir sob exceção"
      meta={<span>{plural(blocking, 'divergência bloqueante continua registrada', 'divergências bloqueantes continuam registradas')}. A exceção fica no livro com o seu nome, a permissão e o motivo.</span>}
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="ax-btn primary" disabled={busy || reason.trim().length < 20} onClick={() => onSubmit(reason.trim())}><Busy on={busy}>Emitir sob exceção</Busy></button>
      </>}>
      <label className="ax-field"><span>Motivo (mínimo 20 caracteres)</span>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: cliente confirmou por ata de 12/05 que o valor da OS prevalece até o aditivo." /></label>
    </SidePanel>
  );
}

function AmendPanel({ busy, current, onClose, onSubmit }: {
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
    <SidePanel open onClose={onClose} testId="os-amend-form" eyebrow="OS emitida" title="Emendar OS"
      meta={<span>A revisão emitida continua provada. A emenda grava uma nova revisão com o instantâneo e o motivo.</span>}
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="ax-btn primary" disabled={busy || !changes || reason.trim().length < 5} onClick={() => onSubmit(body)}><Busy on={busy}>Registrar emenda</Busy></button>
      </>}>
      <div className="ax-form">
        <label className="ax-field"><span>Local</span><input value={site} onChange={(e) => setSite(e.target.value)} /></label>
        <div className="ax-field-row">
          <label className="ax-field"><span>Início planejado</span><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label className="ax-field"><span>Término planejado</span><input type="date" value={finish} onChange={(e) => setFinish(e.target.value)} /></label>
        </div>
        <div className="ax-field-row">
          <label className="ax-field"><span>Nova linha — tipo</span>
            <select value={lineKind} onChange={(e) => setLineKind(e.target.value as ServiceOrderItemKind)}>
              {(['ACTIVITY', 'DELIVERABLE', 'MATERIAL', 'EQUIPMENT', 'CUSTOMER_DEPENDENCY', 'TEST'] as ServiceOrderItemKind[])
                .map((k) => <option key={k} value={k}>{itemKindLabels[k]}</option>)}</select></label>
          <label className="ax-field"><span>Nova linha — título</span><input value={lineTitle} onChange={(e) => setLineTitle(e.target.value)} /></label>
        </div>
        <label className="ax-field"><span>Motivo da emenda</span><textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="O que mudou e quem pediu" /></label>
      </div>
    </SidePanel>
  );
}
