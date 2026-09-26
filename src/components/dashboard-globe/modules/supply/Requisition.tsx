'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, FileText } from 'lucide-react';
import {
  PLAN_VERB, REQUISITIONS_URL, canCreateRequisition, dayMonth, liveRequisitions, planToRequisition, qtyText, remainingToBuy, requisitionBody,
  requisitionPreview, siteLocationId,
} from '../model';
import { StateNote } from '../shared';
import { newIntentKey, useSupplyAct } from './act';
import type { FlowCtx } from './types';
import { Signal, SupplyConfirm } from './ui';

/** Tom do status da solicitação (os estados de `REQUISITION_STATUS_LABEL`). */
const REQ_TONE: Record<string, 'info' | 'accent' | 'success' | 'neutral' | 'warning'> = {
  SUBMITTED: 'warning', SOURCING: 'info', ORDERED: 'success', CLOSED: 'neutral', CANCELLED: 'neutral',
};

/**
 * ETAPA 4 — SOLICITAÇÃO DE COMPRA: as solicitações vivas do requisito em foco
 * (número, status, quantidade, necessidade) e, quando ainda sobra falta para
 * requisitar (pelo plano E pelo banco — uma solicitação antiga não esconde a
 * falta que cresceu), "Criar solicitação de compra" → POST
 * /api/supply/procurement/requisitions (a requisição NASCE DA FALTA), atrás
 * da confirmação e da permissão de requisitar. A quantidade dita é a que o
 * BANCO vai pedir.
 */
export function RequisitionStep({ ctx, onCreate }: { ctx: FlowCtx; onCreate: () => void }) {
  const { data } = ctx;
  if (data.procurement.state === 'restricted') return <StateNote kind="restricted" title="Restrito">Seu perfil não lê as solicitações de compra.</StateNote>;
  if (data.procurement.state === 'error') return <StateNote kind="error" title="As solicitações de compra não carregaram">{data.procurement.message}</StateNote>;
  const reqs = liveRequisitions(data.procurement);
  const unit = data.focus?.item?.unit ?? null;
  const create = canCreateRequisition(data);
  const list = reqs.length > 0 ? (
    <div className="dgs-reqs" data-testid="dg-supply-requisition">
      {reqs.map((r) => (
        <div key={r.id} className="dgs-tile dgs-req">
          <div className="dgs-req-top">
            <FileText size={16} aria-hidden />
            <b className="num">{r.number}</b>
            <Signal tone={REQ_TONE[r.status] ?? 'info'} label={r.statusLabel} />
          </div>
          <dl className="dgs-kv">
            <div><dt>Quantidade</dt><dd className="num">{qtyText(r.qty, r.unit ?? unit) ?? '—'}</dd></div>
            <div><dt>Necessário até</dt><dd className="num">{r.requiredBy ? dayMonth(r.requiredBy) : '—'}</dd></div>
            <div><dt>Cotações</dt><dd className="num">{r.rfqs.filter((q) => q.status !== 'CANCELLED').length || 'nenhuma'}</dd></div>
          </dl>
          <Link className="dgm-textbtn" href={r.href}>Abrir em Compras<ArrowUpRight size={13} aria-hidden /></Link>
        </div>
      ))}
    </div>
  ) : null;
  if (create) {
    const toReq = planToRequisition(data);
    const { qty, extra } = requisitionPreview(data);
    return (
      <>
        {list}
        <div className="dgs-req-new" data-testid={list ? 'dg-supply-requisition-more' : 'dg-supply-requisition'}>
          <p className="dgs-lead">
            {list ? 'A necessidade cresceu: ' : ''}Falta requisitar <b className="num">{qtyText(toReq, unit) ?? '—'}</b>. A solicitação nasce da falta (com o rastro do requisito) e segue para cotação em Compras.
          </p>
          {extra > 0 && (
            <p className="dgs-hint" data-testid="dg-supply-requisition-extra">
              {`Aberta agora, ela pede ${qtyText(qty, unit) ?? '—'} (a falta sem cobertura de hoje): faça antes o que o plano sugere acima, ou ${qtyText(extra, unit) ?? 'a diferença'} a mais vão para a compra.`}
            </p>
          )}
          <button type="button" className="dgm-btn dgm-btn-wide" onClick={onCreate} data-testid="dg-supply-requisition-create">
            <FileText size={17} aria-hidden />Criar solicitação de compra
          </button>
        </div>
      </>
    );
  }
  if (list) return list;
  const left = remainingToBuy(data);
  if (left !== null && left <= 0) return <StateNote kind="empty" title="Não há o que comprar">A rede de estoque cobre a falta — o plano reserva e transfere.</StateNote>;
  return (
    <StateNote kind="empty" title="Nenhuma solicitação de compra ainda">
      {data.capabilities.request ? 'Sem falta registrada para comprar neste momento.' : 'Criar a solicitação cabe a quem tem a permissão de requisitar compras.'}
    </StateNote>
  );
}

/**
 * A confirmação de "Criar solicitação de compra" — o corpo exato da rota
 * (canteiro como local de entrega quando conhecido) e a quantidade que o
 * BANCO vai requisitar (falta viva − já requisitado em aberto), nunca a do
 * plano depois de reservas/transferências só sugeridas. Com passo sugerido
 * ainda aberto, o aviso: faça antes o que está acima.
 */
export function RequisitionConfirm({ ctx, onClose, onDone }: { ctx: FlowCtx; onClose: () => void; onDone: (title: string) => void }) {
  const { data } = ctx;
  // Uma intenção por abertura: a repetição (rede/5xx) reusa a MESMA chave e não duplica a solicitação.
  const [key] = useState(newIntentKey);
  const act = useSupplyAct();
  const focus = data.focus;
  if (!focus) return null;
  const unit = focus.item?.unit ?? null;
  const { qty, planQty, extra, openSteps } = requisitionPreview(data);
  const location = siteLocationId(data);
  const confirm = async () => {
    const r = await act.run(REQUISITIONS_URL, requisitionBody(focus, location, key));
    if (r.ok) {
      const n = typeof r.result.requisition_number === 'string' ? r.result.requisition_number : null;
      onDone(r.replayed ? `Já estava registrada${n ? ` — ${n}` : ''}` : n ? `Solicitação ${n} criada` : 'Solicitação criada');
      ctx.afterAct();
    }
  };
  const steps = openSteps.map((s) => `${PLAN_VERB[s.kind].toLowerCase()} ${qtyText(s.qty, s.unit ?? unit) ?? ''}`.trim()).join(' e ');
  return (
    <SupplyConfirm title="Criar solicitação de compra" kind="Solicitação de compra" amount={qtyText(qty, unit)}
      what={focus.title}
      consequence={`A solicitação nasce da falta sem cobertura do requisito${qty !== null ? ` — hoje ${qtyText(qty, unit)}` : ''} (rastro por requisito)${location ? ', com entrega no canteiro deste projeto' : ''}, e segue para cotação em Compras. Nada é comprado agora.`}
      confirmLabel="Criar solicitação" busy={act.busy} error={act.error}
      onConfirm={() => void confirm()} onCancel={() => { if (!act.busy) onClose(); }} testId="dg-supply-requisition-confirm">
      {extra > 0 && (
        <p className="dgs-confirm-warn" role="note" data-testid="dg-supply-requisition-warn">
          <b>Faça antes o que está acima.</b>
          {` O plano ainda sugere ${steps || 'reservar/transferir'}: depois disso, a compra seria de ${qtyText(planQty, unit) ?? '—'}. Aberta agora, a solicitação pede ${qtyText(qty, unit) ?? '—'} — ${qtyText(extra, unit) ?? 'a diferença'} a mais.`}
        </p>
      )}
    </SupplyConfirm>
  );
}
