'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { HudButton, HudDrawer, useHudToast } from '@/components/hud';
import {
  PO_ACTION_LABEL, PO_STATUS_LABEL, PO_STATUS_TONE, purchaseOrderActions, type PoAction,
} from '@/lib/supply/procurement';
import {
  decideApprovalStep, getViewerEligibility, listApprovalRequestsForSubject,
} from '@/lib/platform/approvals/approval-service';
import type { ApprovalRequestView, ViewerEligibility } from '@/lib/platform/approvals/types';
import { DataTable, EmptyNote, GovernanceNote, Segments, StatePill, day } from '@/components/operations/ui';
import { ActModal, qty, useInventoryAct } from '../inventory/shared';
import { brlOf, type ProcurementModel } from './shared';

type Order = ProcurementModel['purchaseOrders'][number];
const OPEN = ['DRAFT', 'APPROVAL_REQUIRED', 'APPROVED', 'ISSUED', 'PARTIALLY_RECEIVED'];

export function governanceLabel(o: Pick<Order, 'governance' | 'status'>): string {
  if (o.status === 'DRAFT') return 'Rascunho — ainda não submetido';
  if (o.governance === 'POLICY') return 'Política do motor de aprovação';
  if (o.governance === 'AUTHORITY') return 'Alçada de compra declarada';
  return '—';
}

/** PEDIDOS — do rascunho à emissão; o valor é derivado das linhas, a aprovação diz sob que regra. */
export function OrdersTab({ data, onChanged, onlyAwaitingApproval = false }: {
  data: ProcurementModel; onChanged: () => void; onlyAwaitingApproval?: boolean;
}) {
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = data.purchaseOrders.filter((o) => (onlyAwaitingApproval ? o.status === 'APPROVAL_REQUIRED'
    : filter === 'all' || OPEN.includes(o.status)));
  const open = data.purchaseOrders.find((o) => o.id === openId) ?? null;
  return (
    <>
      {!onlyAwaitingApproval && (
        <div className="crm-toolbar">
          <Segments label="Recorte" value={filter} onChange={(v) => setFilter(v as typeof filter)} options={[
            { value: 'open', label: 'Em andamento', count: data.purchaseOrders.filter((o) => OPEN.includes(o.status)).length },
            { value: 'all', label: 'Todos (90 dias)', count: data.purchaseOrders.length },
          ]} />
        </div>
      )}
      <DataTable label={onlyAwaitingApproval ? 'Pedidos em aprovação' : 'Pedidos de compra'}
        columns={['Pedido', 'Fornecedor', 'Projeto', 'Total', 'Entrega', 'Governança', 'Situação', '']} count={rows.length}
        footer="Total = linhas + frete + impostos, recalculado — nunca digitado"
        empty={<EmptyNote title={onlyAwaitingApproval ? 'Nada aguardando aprovação' : 'Nenhum pedido de compra'}
          description={onlyAwaitingApproval ? 'Pedidos submetidos aparecem aqui.' : 'Pedidos nascem da decisão de uma cotação.'} />}>
        {rows.map((o) => (
          <tr key={o.id} data-testid="po-row">
            <td className="tabular-nums"><b>{o.number}</b></td>
            <td>{o.supplier}</td>
            <td>{o.projectId ? <Link href={`/projetos/${encodeURIComponent(o.projectId)}?tab=supply`}>{o.project}</Link> : o.project}</td>
            <td className="tabular-nums">{brlOf(o.total, o.currency)}</td>
            <td>{day(o.expectedDelivery)}<p className="crm-muted">{o.deliveryLocation ?? 'sem local'}</p></td>
            <td>{governanceLabel(o)}</td>
            <td><StatePill tone={PO_STATUS_TONE[o.status]}>{PO_STATUS_LABEL[o.status]}</StatePill></td>
            <td><HudButton size="sm" variant="ghost" onClick={() => setOpenId(o.id)}>Abrir</HudButton></td>
          </tr>
        ))}
      </DataTable>
      <HudDrawer isOpen={Boolean(open)} onClose={() => setOpenId(null)} title={open ? `Pedido ${open.number}` : 'Pedido'}
        subtitle={open?.supplier} width="min(680px, 100vw)">
        {open && <OrderDetail order={open} data={data} onChanged={onChanged} />}
      </HudDrawer>
    </>
  );
}

function OrderDetail({ order, data, onChanged }: { order: Order; data: ProcurementModel; onChanged: () => void }) {
  const [mode, setMode] = useState<PoAction | 'update' | null>(null);
  const { act, busy } = useInventoryAct(() => { setMode(null); onChanged(); });
  const caps = data.capabilities;
  const actions = purchaseOrderActions({ status: order.status, governance: order.governance, createdBy: order.createdById,
    submittedBy: order.submittedById }, caps, data.viewerId);
  const segregatedOut = order.status === 'APPROVAL_REQUIRED' && order.governance === 'AUTHORITY' && caps.approve
    && (data.viewerId === order.createdById || data.viewerId === order.submittedById);
  const url = `/api/supply/procurement/purchase-orders/${order.id}`;
  const immediate: PoAction[] = ['issue', 'sync'];
  return (
    <div className="crm-workspace ops-workspace" data-testid="po-drawer">
      <dl className="sup-kv">
        <div><dt>Situação</dt><dd>{PO_STATUS_LABEL[order.status]}</dd></div>
        <div><dt>Total</dt><dd>{brlOf(order.total, order.currency)}</dd></div>
        <div><dt>Entrega</dt><dd>{day(order.expectedDelivery)}</dd></div>
        <div><dt>Local</dt><dd>{order.deliveryLocation ?? '—'}</dd></div>
        <div><dt>Governança</dt><dd>{governanceLabel(order)}</dd></div>
      </dl>
      <DataTable label="Linhas do pedido" columns={['Item', 'Quantidade', 'Preço', 'Subtotal', 'Recebido']} count={order.lines.length}
        footer={`Itens ${brlOf(order.goods, order.currency)} · frete ${brlOf(order.freight, order.currency)} · impostos ${brlOf(order.tax, order.currency)}`}
        empty={null}>
        {order.lines.map((l) => (
          <tr key={l.id}>
            <td><b>{l.itemCode}</b> {l.itemDescription}</td>
            <td className="tabular-nums">{qty(l.quantity)} {l.unit}</td>
            <td className="tabular-nums">{brlOf(l.unitPrice, order.currency)}</td>
            <td className="tabular-nums">{brlOf(l.unitPrice * l.quantity, order.currency)}</td>
            <td className="tabular-nums">{qty(l.received)}</td>
          </tr>
        ))}
      </DataTable>
      {order.status === 'APPROVAL_REQUIRED' && order.governance === 'POLICY' && (
        <PolicyApprovalPanel orderId={order.id} onDecided={() => act(url, { action: 'sync' }, 'Desfecho aplicado')} />
      )}
      {order.status === 'APPROVAL_REQUIRED' && order.governance === 'AUTHORITY' && (
        <GovernanceNote>
          Sem política no motor de aprovação: aprova quem tem alçada de compra declarada, com evidência, para este valor
          ({brlOf(order.total, order.currency)}). Quem criou ou submeteu o pedido não aprova.
          {segregatedOut && ' Você criou ou submeteu este pedido — outra pessoa precisa decidir.'}
        </GovernanceNote>
      )}
      {(order.status === 'DRAFT' && (caps.source) || actions.length > 0) && (
        <div className="ops-row-actions" style={{ padding: '12px 14px' }}>
          {order.status === 'DRAFT' && caps.source && <HudButton size="sm" variant="ghost" onClick={() => setMode('update')}>Editar entrega</HudButton>}
          {actions.map((a) => (
            <HudButton key={a} size="sm" variant={a === 'cancel' || a === 'reject' || a === 'close' ? 'ghost' : 'primary'} disabled={busy}
              onClick={() => (immediate.includes(a) ? act(url, { action: a }, PO_ACTION_LABEL[a]) : setMode(a))}>{PO_ACTION_LABEL[a]}</HudButton>
          ))}
        </div>
      )}
      <section aria-label="Histórico do pedido" style={{ padding: '0 14px 14px' }}>
        <p className="crm-eyebrow">Histórico</p>
        <ol className="ops-history">
          {order.history.map((h) => (
            <li key={h.id}><b>{h.transition}</b> → {h.to ? PO_STATUS_LABEL[h.to as keyof typeof PO_STATUS_LABEL] ?? h.to : '—'}
              <span className="crm-muted"> · {h.actor ?? '—'} · {new Date(h.at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</span>
              {h.reason && <p className="crm-muted">{h.reason}</p>}</li>
          ))}
        </ol>
      </section>
      {mode && !immediate.includes(mode as PoAction) && (
        <OrderActModal order={order} mode={mode as Exclude<PoAction, 'issue' | 'sync'> | 'update'} data={data} busy={busy}
          onClose={() => setMode(null)} onConfirm={(body) => act(url, { action: mode, ...body },
            mode === 'update' ? 'Pedido atualizado' : PO_ACTION_LABEL[mode as PoAction])} />
      )}
    </div>
  );
}

function OrderActModal({ order, mode, data, busy, onClose, onConfirm }: {
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
    <ActModal title={title} subtitle={`${order.number} · ${brlOf(order.total, order.currency)}`} onClose={onClose} busy={busy}
      disabled={needsText && text.trim().length < 3} confirmLabel={title} onConfirm={() => onConfirm(body)} testId="po-act-form">
      {mode === 'update' ? (
        <>
          <label>Local de entrega<select value={location} onChange={(e) => setLocation(e.target.value)}><option value="">—</option>
            {data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <label>Entrega prevista<input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></label>
        </>
      ) : (
        <>
          {mode === 'submit' && <p className="crm-muted">O pedido é conferido contra o motor de aprovação: com política, vai para a
            decisão da política; sem política, espera quem tem alçada declarada.</p>}
          {mode === 'approve' && <p className="crm-muted">A aprovação grava a impressão digital do pedido e a alçada usada.</p>}
          {mode === 'close' && <p className="crm-muted">{open > 0
            ? `Ainda faltam ${qty(open)} unidade(s): encerrar faz o saldo deixar de ser esperado — a falta volta ao plano.`
            : 'Tudo recebido. Encerrar arquiva o pedido.'}</p>}
          <label>{needsText ? 'Motivo' : 'Observação (opcional)'}<input value={text} onChange={(e) => setText(e.target.value)} /></label>
        </>
      )}
    </ActModal>
  );
}

/**
 * Pedido governado por POLÍTICA: as etapas e decisões são do motor da
 * plataforma (mesmas RPCs do Contratos). Decidir aqui chama `approval_decide`
 * com o usuário autenticado; depois, o desfecho é aplicado ao pedido.
 */
function PolicyApprovalPanel({ orderId, onDecided }: { orderId: string; onDecided: () => void }) {
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
  if (!requests) return <p className="crm-muted" style={{ padding: '0 14px' }}>Carregando a política de aprovação…</p>;
  const req = requests[0];
  if (!req) return <GovernanceNote>Pedido de aprovação não encontrado no motor. Use “Sincronizar desfecho da aprovação”.</GovernanceNote>;
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
    <section aria-label="Aprovação por política" data-testid="po-policy-approval" style={{ padding: '0 14px' }}>
      <p className="crm-eyebrow">Política {req.policy_key} v{req.policy_version_no} · estágio {req.current_stage_no ?? '—'}</p>
      {openSteps.map((s) => {
        const el = eligibility[s.step_id];
        return (
          <div key={s.step_id} className="sup-option">
            <div><b>{s.name}</b><p className="crm-muted">{el ? (el.eligible ? 'Você pode decidir esta etapa.' : el.detail ?? el.code) : '…'}</p></div>
            {el?.eligible && (
              <div className="ops-row-actions">
                <HudButton size="sm" variant="primary" disabled={busy} onClick={() => decide(s.step_id, 'APPROVED')}>Aprovar</HudButton>
                <HudButton size="sm" variant="ghost" disabled={busy || reason.trim().length < 3} onClick={() => decide(s.step_id, 'REJECTED')}>Rejeitar</HudButton>
              </div>
            )}
          </div>
        );
      })}
      {openSteps.some((s) => eligibility[s.step_id]?.eligible) && (
        <label className="ops-form">Motivo (obrigatório para rejeitar)<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      )}
    </section>
  );
}
