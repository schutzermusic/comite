'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import {
  PO_ACTION_LABEL, PO_STATUS_LABEL, PO_STATUS_TONE, REQUISITION_STATUS_LABEL, purchaseOrderActions, type PoAction, type ReleaseCause,
  type RequisitionStatus,
} from '@/lib/supply/procurement';
import { decideApprovalStep, getViewerEligibility, listApprovalRequestsForSubject } from '@/lib/platform/approvals/approval-service';
import type { ApprovalRequestView, ViewerEligibility } from '@/lib/platform/approvals/types';
import { useHudToast } from '@/components/hud';
import {
  Busy, Chain, Chip, KV, Meter, Section, SidePanel, date, dateShort, dateTime, href, money, qty, useGovernedAction, type ChainNode,
} from '@/components/ax';
import { RELEASE_CAUSE_TEXT, exactQty, type ProcurementModel } from './shared';

type Order = ProcurementModel['purchaseOrders'][number];
/** O que aconteceu, em português — o código técnico fica só como reserva. */
const TRANSITION_LABEL: Record<string, string> = {
  created: 'Criado', edited: 'Editado', submitted: 'Submetido à aprovação', approved: 'Aprovado', rejected: 'Rejeitado',
  issued: 'Emitido', partially_received: 'Recebido em parte', received: 'Recebido', inspection_rejected: 'Rejeitado na inspeção',
  cancelled: 'Cancelado', closed: 'Encerrado', reopened: 'Reaberto', approval_stale: 'Aprovação desatualizada pelo pedido',
};

export function governanceLabel(o: Pick<Order, 'governance' | 'status'>): string {
  if (o.status === 'DRAFT') return 'Rascunho — ainda não submetido';
  if (o.governance === 'POLICY') return 'Política do motor de aprovação';
  if (o.governance === 'AUTHORITY') return 'Alçada de compra declarada';
  return '—';
}

const numOf = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};
const strOf = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const rowsOf = (v: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(v) ? v : []).filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object');
const reqStatus = (s: unknown) => REQUISITION_STATUS_LABEL[s as RequisitionStatus] ?? String(s ?? '—');

/**
 * O aviso de "Cancelar pedido" sai do que o BANCO devolveu (248), nunca do
 * que foi pedido: por requisito, quanto voltou a ser requisitado e quanto foi
 * liberado — com a unidade e o porquê, sem somar itens ou unidades; por
 * requisição, o status de → para; na repetição, que nada foi duplicado (o
 * desfecho é o gravado no cancelamento — o anterior a 248 não tem detalhe).
 */
export function cancelOutcomeNotice(result: Record<string, unknown> | null | undefined, order: Pick<Order, 'number' | 'lines'>): {
  title: string; detail: string;
} {
  const r = result ?? {};
  const titles = new Map(order.lines.flatMap((l) => (l.requirements ?? []).map((q) => [q.requirementId, q.title] as const)));
  const codes = new Map(order.lines.map((l) => [l.itemId, l.itemCode] as const));
  const requirements = rowsOf(r.requirements).map((x) => {
    const id = strOf(x.requirement_id);
    const label = (id ? titles.get(id) : undefined) ?? codes.get(String(x.item_id)) ?? 'Requisito';
    const unit = strOf(x.unit);
    const reopened = numOf(x.reopened_qty) ?? 0;
    const released = numOf(x.released_qty) ?? 0;
    const why = RELEASE_CAUSE_TEXT[x.cause as ReleaseCause] ?? null;
    // Exatos (`exactQty`): 59,99997 reabertos e 0,00003 liberados nunca viram "60" e "0".
    const parts = [
      reopened > 0 ? `${exactQty(reopened, unit)} reabertos para cotação` : null,
      released > 0 ? `${exactQty(released, unit)} liberados${why ? ` (${why})` : ''}` : null,
    ].filter(Boolean);
    // Antes da emissão o pedido não tirava nada do requisitado: nada reabre, e nada é liberado se o requisito segue ativo.
    return `${label}: ${parts.length ? parts.join(' e ') : 'segue requisitado — nada foi liberado'}`;
  });
  const requisitions = rowsOf(r.requisitions).map((x) => {
    const n = strOf(x.requisition_number) ?? 'requisição';
    return x.status_from === x.status_to ? `${n} segue ${reqStatus(x.status_to).toLowerCase()}`
      : `${n}: ${reqStatus(x.status_from)} → ${reqStatus(x.status_to)}`;
  });
  const outcome = [
    requirements.length ? `${requirements.join('; ')}.` : null,
    requisitions.length ? `${requisitions.length === 1 ? 'Requisição' : 'Requisições'} ${requisitions.join('; ')}.` : null,
    r.approval_request_status === 'CANCELLED' ? 'O pedido de aprovação no motor também foi cancelado.' : null,
  ].filter(Boolean).join(' ');
  return {
    title: `Pedido ${order.number} cancelado`,
    detail: r.replayed === true ? `Já estava cancelado — nada foi duplicado.${outcome ? ` ${outcome}` : ''}`
      : outcome || 'Nenhuma requisição ligada a este pedido mudou.',
  };
}

/** A mensagem do ato "Cancelar pedido": a recusa leva o nome do ato; o sucesso, o desfecho do banco (`cancelOutcomeNotice`). */
export function cancelNotice(order: Pick<Order, 'number' | 'lines'>) {
  return { title: PO_ACTION_LABEL.cancel, done: (result: Record<string, unknown>) => cancelOutcomeNotice(result, order) };
}

/**
 * O PEDIDO aberto: o que foi comprado (linhas, recebido), POR QUE (a cadeia até
 * o requisito e o projeto), sob QUE REGRA é aprovado, e os atos possíveis na
 * sua alçada — quem criou ou submeteu não aprova.
 */
export function OrderPanel({ order, data, onClose, onChanged }: { order: Order; data: ProcurementModel; onClose: () => void; onChanged: () => void }) {
  const [mode, setMode] = useState<PoAction | 'update' | null>(null);
  const { run, busy } = useGovernedAction(() => { setMode(null); onChanged(); });
  const caps = data.capabilities;
  const actions = purchaseOrderActions({ status: order.status, governance: order.governance, createdBy: order.createdById,
    submittedBy: order.submittedById }, caps, data.viewerId);
  const segregatedOut = order.status === 'APPROVAL_REQUIRED' && order.governance === 'AUTHORITY' && caps.approve
    && (data.viewerId === order.createdById || data.viewerId === order.submittedById);
  const url = `/api/supply/procurement/purchase-orders/${order.id}`;
  const immediate: PoAction[] = ['issue', 'sync'];
  const act = (a: PoAction | 'update', body: Record<string, unknown>, title: string) =>
    run(`po:${a}:${order.id}`, url, { action: a, ...body }, a === 'cancel' ? cancelNotice(order) : { title }, { idempotent: false });

  // Por que compramos isto: pedido → decisão → cotação → requisição(ões) → requisitos → projeto(s).
  const rfq = order.decisionId ? data.rfqs.find((r) => r.decision?.id === order.decisionId) ?? null : null;
  const reqLineIds = new Set((rfq?.lines ?? []).map((l) => l.requisitionLineId).filter(Boolean) as string[]);
  const requisitions = data.requisitions.filter((r) => r.lines.some((l) => reqLineIds.has(l.id)));
  const requirements = Array.from(new Map(order.lines.flatMap((l) => l.requirements ?? []).map((r) => [r.requirementId, r])).values());
  const projects = Array.from(new Map(requirements.filter((r) => r.projectId).map((r) => [r.projectId!, r.project ?? r.projectId!])).entries());
  const trace: ChainNode[] = [
    { label: order.supplier, href: href.supplier(order.supplierId) },
    { label: order.number },
    ...(rfq ? [{ label: `decisão da ${rfq.number}`, href: href.rfq(rfq.id) }] : []),
    ...requisitions.map((r) => ({ label: r.number, href: href.requisition(r.id) })),
    ...requirements.slice(0, 3).map((r) => ({ label: r.title, href: href.requirement(r.requirementId) })),
    ...projects.map(([id, name]) => ({ label: name, href: href.project(id, 'supply'), end: true })),
  ];
  const needBy = requirements.map((r) => r.requiredBy).filter(Boolean).sort()[0] ?? null;

  return (
    <SidePanel open onClose={onClose} wide testId="po-drawer" eyebrow={`Pedido de compra · ${order.supplier}`} title={order.number}
      meta={<><Chip tone={PO_STATUS_TONE[order.status]}>{PO_STATUS_LABEL[order.status]}</Chip>
        <strong>{money(order.total, order.currency)}</strong><span>{governanceLabel(order)}</span></>}
      footer={actions.length > 0 || (order.status === 'DRAFT' && caps.source) ? <>
        {order.status === 'DRAFT' && caps.source && <button type="button" className="ax-btn ghost" onClick={() => setMode('update')}>Editar entrega</button>}
        {actions.map((a) => (
          <button key={a} type="button" className={a === 'cancel' || a === 'reject' || a === 'close' ? 'ax-btn ghost' : 'ax-btn primary'} disabled={busy !== null}
            onClick={() => (immediate.includes(a) ? act(a, {}, PO_ACTION_LABEL[a]) : setMode(a))}>
            <Busy on={busy !== null && immediate.includes(a)}>{PO_ACTION_LABEL[a]}</Busy></button>
        ))}
      </> : undefined}>
      <Section title="Por que compramos isto">
        <Chain nodes={trace} label="Do pedido ao projeto" />
        {needBy && <p className="ax-note" style={{ marginTop: 8 }}>A necessidade mais cedo coberta por este pedido é {date(needBy)}.</p>}
      </Section>

      <Section title="O que foi comprado">
        <div className="ax-table-wrap">
          <table className="ax-table cards">
            <caption className="sr-only-ax">Linhas do pedido</caption>
            <thead><tr><th>Item</th><th className="num">Quantidade</th><th className="num">Preço</th><th className="num">Subtotal</th><th style={{ width: '22%' }}>Recebido</th></tr></thead>
            <tbody>
              {order.lines.map((l) => (
                <tr key={l.id}>
                  <td className="lead" data-label=""><div className="ax-cellstack"><span><b>{l.itemCode}</b> {l.itemDescription}</span>
                    {(l.requirements ?? []).length > 0 && <small>para {(l.requirements ?? []).map((r) => `${r.title} (${qty(r.quantity)})`).join(' · ')}</small>}
                    {l.expectedDate && <small>promessa {dateShort(l.expectedDate)}</small>}</div></td>
                  <td className="num" data-label="Quantidade">{qty(l.quantity, l.unit)}</td>
                  <td className="num" data-label="Preço">{money(l.unitPrice, order.currency, { cents: true })}</td>
                  <td className="num" data-label="Subtotal">{money(l.unitPrice * l.quantity, order.currency)}</td>
                  <td data-label="Recebido"><div className="ax-cellstack"><span className="ax-num">{qty(l.received)} de {qty(l.quantity)}</span>
                    <Meter value={l.quantity ? l.received / l.quantity : 0} tone={l.received >= l.quantity ? 'success' : undefined} label={`${l.itemCode} recebido`} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ height: 12 }} aria-hidden />
        <KV items={[
          ['Itens', money(order.goods, order.currency)], ['Frete', money(order.freight, order.currency)], ['Impostos', money(order.tax, order.currency)],
          ['Entrega', `${order.expectedDelivery ? date(order.expectedDelivery) : 'sem data'} · ${order.deliveryLocation ?? 'sem local'}`],
          ['Condição de pagamento', order.paymentTerms ?? '—'],
        ]} />
      </Section>

      {order.status === 'APPROVAL_REQUIRED' && order.governance === 'POLICY' && (
        <Section title="Aprovação por política">
          <PolicyApproval orderId={order.id} onDecided={() => act('sync', {}, 'Desfecho aplicado')} />
        </Section>
      )}
      {order.status === 'APPROVAL_REQUIRED' && order.governance === 'AUTHORITY' && (
        <Section title="Aprovação por alçada">
          <p className="ax-note" style={{ margin: 0 }}><ShieldCheck size={13} aria-hidden />
            Sem política no motor de aprovação: aprova quem tem alçada de compra declarada, com evidência, para este valor
            ({money(order.total, order.currency)}). Quem criou ou submeteu o pedido não aprova.
            {segregatedOut && ' Você criou ou submeteu este pedido — outra pessoa precisa decidir.'}</p>
        </Section>
      )}

      <Section title="Histórico">
        <ol className="ax-timeline">
          {order.history.map((h) => (
            <li key={h.id}><span className="ax-timeline-dot" aria-hidden />
              <div className="ax-cellstack"><span><b>{TRANSITION_LABEL[h.transition] ?? h.transition}</b>{h.to ? ` → ${PO_STATUS_LABEL[h.to as keyof typeof PO_STATUS_LABEL] ?? h.to}` : ''}</span>
                <small>{h.actor ?? '—'} · {dateTime(h.at)}{h.reason ? ` · ${h.reason}` : ''}</small></div></li>
          ))}
        </ol>
      </Section>

      {mode && !immediate.includes(mode as PoAction) && (
        <ActPanel order={order} mode={mode as Exclude<PoAction, 'issue' | 'sync'> | 'update'} data={data} busy={busy !== null}
          onClose={() => setMode(null)} onConfirm={(body) => act(mode, body, mode === 'update' ? 'Pedido atualizado' : PO_ACTION_LABEL[mode as PoAction])} />
      )}
      {rfq && <p className="ax-note">Comparação e decisão: <Link className="ax-link" href={href.rfq(rfq.id)}>{rfq.number}</Link></p>}
    </SidePanel>
  );
}

export function ActPanel({ order, mode, data, busy, onClose, onConfirm }: {
  order: Order; mode: 'submit' | 'approve' | 'reject' | 'cancel' | 'close' | 'update'; data: ProcurementModel; busy: boolean;
  onClose: () => void; onConfirm: (body: Record<string, unknown>) => void;
}) {
  const [text, setText] = useState('');
  const [location, setLocation] = useState(order.deliveryLocationId ?? '');
  const [expected, setExpected] = useState(order.expectedDelivery ?? '');
  const open = order.lines.reduce((a, l) => a + Math.max(0, l.quantity - l.received), 0);
  const needsText = mode === 'reject' || mode === 'cancel' || (mode === 'close' && open > 0);
  const title = mode === 'update' ? 'Editar entrega' : PO_ACTION_LABEL[mode];
  const body = mode === 'update' ? { deliveryLocationId: location || null, expectedDelivery: expected || null }
    : mode === 'cancel' || mode === 'close' ? { reason: text.trim() || undefined } : { note: text.trim() || null };
  return (
    <SidePanel open onClose={onClose} testId="po-act-form" eyebrow={`${order.number} · ${money(order.total, order.currency)}`} title={title}
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onClose}>Voltar</button>
        <button type="button" className="ax-btn primary" disabled={(needsText && text.trim().length < 3) || busy} onClick={() => onConfirm(body)}>
          <Busy on={busy}>{title}</Busy></button>
      </>}>
      <div className="ax-form">
        {mode === 'update' ? (
          <>
            <label className="ax-field"><span>Local de entrega</span><select value={location} onChange={(e) => setLocation(e.target.value)}><option value="">—</option>
              {data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
            <label className="ax-field"><span>Entrega prevista</span><input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></label>
          </>
        ) : (
          <>
            {mode === 'submit' && <p className="ax-muted">O pedido é conferido contra o motor de aprovação: com política, vai para a decisão da
              política; sem política, espera quem tem alçada declarada.</p>}
            {mode === 'approve' && <p className="ax-muted">A aprovação grava a impressão digital do pedido e a alçada usada.</p>}
            {mode === 'cancel' && <p className="ax-muted" data-testid="po-cancel-effect">A requisição volta para cotação só com o que ainda está sem
              cobertura (contando estoque, transferências e as outras compras): o resto é liberado e fica registrado na requisição — sem nada
              em aberto, ela é encerrada. Uma exceção de cobertura não passa adiante: comprar de novo a parte pendente pede outra exceção.
              Cancelar com aprovação pendente também cancela o pedido de aprovação no motor — nenhuma decisão fica órfã.</p>}
            {mode === 'close' && <p className="ax-muted">{open > 0
              ? `Ainda faltam ${qty(open)} unidade(s): encerrar faz o saldo deixar de ser esperado — a falta volta ao plano.`
              : 'Tudo recebido. Encerrar arquiva o pedido.'}</p>}
            <label className="ax-field"><span>{needsText ? 'Motivo' : 'Observação (opcional)'}</span>
              <input value={text} onChange={(e) => setText(e.target.value)} /></label>
          </>
        )}
      </div>
    </SidePanel>
  );
}

/**
 * Pedido governado por POLÍTICA: as etapas e decisões são do motor da
 * plataforma (as mesmas do Contratos). Decidir aqui chama `approval_decide`
 * com o usuário autenticado; depois, o desfecho é aplicado ao pedido.
 */
function PolicyApproval({ orderId, onDecided }: { orderId: string; onDecided: () => void }) {
  const [requests, setRequests] = useState<ApprovalRequestView[] | null>(null);
  const [eligibility, setEligibility] = useState<Record<string, ViewerEligibility>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const { error: notifyError } = useHudToast();
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listApprovalRequestsForSubject('purchase_order', orderId);
        if (cancelled) return;
        setRequests(list);
        const open = list.flatMap((r) => (r.steps ?? []).filter((s) => s.status === 'OPEN'));
        const entries = await Promise.all(open.map(async (s) => [s.step_id, await getViewerEligibility(s.step_id)] as const));
        if (!cancelled) setEligibility(Object.fromEntries(entries));
      } catch (e) {
        if (!cancelled) setRequests([]);
        notifyError('Aprovação indisponível', (e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [orderId, notifyError]);
  if (!requests) return <p className="ax-muted" style={{ margin: 0 }}>Carregando a política de aprovação…</p>;
  const req = requests.find((r) => r.status === 'PENDING') ?? requests[0];
  if (!req) return <p className="ax-note" style={{ margin: 0 }}>Pedido de aprovação não encontrado no motor. Use “Sincronizar desfecho da aprovação”.</p>;
  const openSteps = (req.steps ?? []).filter((s) => s.status === 'OPEN');
  const decide = async (stepId: string, decision: 'APPROVED' | 'REJECTED') => {
    setBusy(true);
    try {
      await decideApprovalStep({ stepId, decision, reason: reason.trim() || null, idempotencyKey: `po:${orderId}:${stepId}:${decision}`,
        expectedFingerprint: req.subject_fingerprint });
      onDecided();
    } catch (e) {
      notifyError('Decisão recusada', (e as Error).message);
    } finally { setBusy(false); }
  };
  return (
    <div data-testid="po-policy-approval" className="ax-stack" style={{ gap: 10 }}>
      <p className="ax-subtle" style={{ margin: 0 }}>Política {req.policy_key} v{req.policy_version_no} · estágio {req.current_stage_no ?? '—'}</p>
      {openSteps.map((s) => {
        const el = eligibility[s.step_id];
        return (
          <div key={s.step_id} className="ax-option">
            <span className="ax-option-icon" aria-hidden><ShieldCheck size={16} /></span>
            <div className="ax-option-body"><b>{s.name}</b><p>{el ? (el.eligible ? 'Você pode decidir esta etapa.' : el.detail ?? el.code) : '…'}</p></div>
            {el?.eligible && (
              <div className="ax-inline">
                <button type="button" className="ax-btn primary sm" disabled={busy} onClick={() => decide(s.step_id, 'APPROVED')}>Aprovar</button>
                <button type="button" className="ax-btn ghost sm" disabled={busy || reason.trim().length < 3} onClick={() => decide(s.step_id, 'REJECTED')}>Rejeitar</button>
              </div>
            )}
          </div>
        );
      })}
      {openSteps.some((s) => eligibility[s.step_id]?.eligible) && (
        <label className="ax-field"><span>Motivo (obrigatório para rejeitar)</span><input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      )}
    </div>
  );
}
