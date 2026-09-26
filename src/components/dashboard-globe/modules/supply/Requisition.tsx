'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, FileText, ShieldAlert, Truck } from 'lucide-react';
import type { MaterialBalance } from '@/lib/dashboard/types';
import {
  COVERAGE_EXCEPTION_MAX_REASON, coverageOverrideBody, exceptionReasonState, pendingOverlapText, type PurchaseGate,
} from '@/components/supply/coverage-gate';
import {
  PLAN_VERB, REQUISITIONS_URL, dayMonth, exactQtyText, liveRequisitions, moreToRequisitionLead, pendingTransfersOf, planToRequisition, qtyText,
  releasedQtyOf, remainingToBuy, requisitionBody, requisitionDoneTitle, requisitionGate, requisitionPaths, requisitionPreview, siteLocationId,
} from '../model';
import { StateNote } from '../shared';
import { newIntentKey, useSupplyAct } from './act';
import type { FlowCtx } from './types';
import { Signal, SupplyConfirm } from './ui';

/** Tom do status da solicitação (os estados de `REQUISITION_STATUS_LABEL`). */
const REQ_TONE: Record<string, 'info' | 'accent' | 'success' | 'neutral' | 'warning'> = {
  SUBMITTED: 'warning', SOURCING: 'info', ORDERED: 'success', CLOSED: 'neutral', CANCELLED: 'neutral',
};

/** Qual confirmação abrir: requisitar o comprável, ou a exceção de cobertura (compra também a parte pendente). */
export type RequisitionMode = 'buy' | 'exception';

/**
 * A COBERTURA PENDENTE (regra 246), dita às claras: a transferência pedida e
 * ainda não despachada — a quantidade e cada transferência (número, estado e
 * "Resolver a transferência" no Estoque). Não é cobertura (a falta continua) e
 * não é comprada de novo sem exceção. Depois da exceção (`gate.overlap`), a
 * parte sobreposta JÁ foi comprada: o bloco diz quanto, que chega em dobro se
 * a transferência também for despachada, e que o caminho é cancelá-la.
 */
export function PendingCoverage({ focus, gate }: { focus: MaterialBalance; gate: PurchaseGate }) {
  const unit = focus.item?.unit ?? null;
  const transfers = pendingTransfersOf(focus);
  const overlap = pendingOverlapText(gate, (n) => qtyText(n, unit));
  return (
    <div className="dgs-pending" data-blocked={gate.blocked ? 'true' : undefined} data-overlap={overlap ? 'true' : undefined}
      data-testid="dg-supply-transfer-pending">
      <p className="dgs-pending-h">
        <Truck size={16} aria-hidden />
        <b>Transferência pedida · <span className="num">{qtyText(gate.pending, unit) ?? '—'}</span></b>
      </p>
      {overlap
        ? <p className="dgs-pending-t" data-testid="dg-supply-transfer-overlap">{overlap}</p>
        : <p className="dgs-pending-t">Ainda não saiu da origem: não conta como cobertura (a falta continua) e não é comprada de novo.</p>}
      {transfers.length > 0 && (
        <ul className="dgs-pending-list">
          {transfers.map((t) => (
            <li key={t.transferId}>
              <span className="dgs-pending-id">
                <b className="num">{t.number ?? 'Transferência'}</b>
                <Signal tone="info" label={t.statusLabel || t.status} />
                <span className="num">{qtyText(t.qty, unit) ?? '—'}</span>
              </span>
              <Link className="dgm-textbtn" href={t.href} data-testid="dg-supply-resolve-transfer">Resolver a transferência<ArrowUpRight size={13} aria-hidden /></Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * ETAPA 4 — SOLICITAÇÃO DE COMPRA: as solicitações vivas do requisito em foco
 * (número, status, quantidade EM ABERTO, necessidade e, quando houve, o que
 * foi liberado — não pedido na emissão ou no cancelamento de um pedido) e,
 * quando ainda sobra falta para requisitar (pelo plano E pelo banco — uma
 * solicitação antiga não esconde a falta), "Criar solicitação de compra" → POST
 * /api/supply/procurement/requisitions (a requisição NASCE DA FALTA), atrás
 * da confirmação e da permissão de requisitar. A quantidade dita é a que o
 * BANCO vai pedir (o comprável).
 *
 * Com transferência pedida e sem despacho, a tela diz isso às claras e oferece
 * só os dois caminhos governados: resolver a transferência no Estoque, ou —
 * para quem tem a alçada — a EXCEÇÃO DE COBERTURA, com justificativa.
 */
export function RequisitionStep({ ctx, onCreate, onException }: { ctx: FlowCtx; onCreate: () => void; onException?: () => void }) {
  const { data } = ctx;
  if (data.procurement.state === 'restricted') return <StateNote kind="restricted" title="Restrito">Seu perfil não lê as solicitações de compra.</StateNote>;
  if (data.procurement.state === 'error') return <StateNote kind="error" title="As solicitações de compra não carregaram">{data.procurement.message}</StateNote>;
  const reqs = liveRequisitions(data.procurement);
  const unit = data.focus?.item?.unit ?? null;
  const paths = requisitionPaths(data);
  const gate = requisitionGate(data);
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
            {/* O EM ABERTO para o requisito (248), exato: o liberado não conta — e a nota abaixo diz quanto e onde. */}
            <div><dt>{releasedQtyOf(r) > 0 ? 'Em aberto' : 'Quantidade'}</dt>
              <dd className="num" data-testid="dg-supply-requisition-qty">{exactQtyText(r.qty, r.unit ?? unit) ?? '—'}</dd></div>
            <div><dt>Necessário até</dt><dd className="num">{r.requiredBy ? dayMonth(r.requiredBy) : '—'}</dd></div>
            <div><dt>Cotações</dt><dd className="num">{r.rfqs.filter((q) => q.status !== 'CANCELLED').length || 'nenhuma'}</dd></div>
          </dl>
          {r.releaseNote && <p className="dgs-hint" data-testid="dg-supply-requisition-release">{r.releaseNote}</p>}
          <Link className="dgm-textbtn" href={r.href}>Abrir em Compras<ArrowUpRight size={13} aria-hidden /></Link>
        </div>
      ))}
    </div>
  ) : null;
  const pending = data.focus && gate.pending > 0 ? <PendingCoverage focus={data.focus} gate={gate} /> : null;
  const exceptionBtn = paths.exception && onException ? (
    <button type="button" className="dgm-btn-quiet dgs-exc-btn" onClick={onException} data-testid="dg-supply-coverage-exception">
      <ShieldAlert size={15} aria-hidden />Exceção de cobertura: comprar também {qtyText(gate.exceptionExtra, unit) ?? 'a parte pendente'}
    </button>
  ) : null;

  if (paths.buy) {
    const toReq = planToRequisition(data);
    const { qty, extra } = requisitionPreview(data);
    return (
      <>
        {list}
        <div className="dgs-req-new" data-testid={list ? 'dg-supply-requisition-more' : 'dg-supply-requisition'}>
          <p className="dgs-lead">
            {moreToRequisitionLead(reqs)}Falta requisitar <b className="num">{qtyText(toReq, unit) ?? '—'}</b>. A solicitação nasce da falta (com o rastro do requisito) e segue para cotação em Compras.
          </p>
          {pending}
          {gate.pending > 0 && (
            <p className="dgs-hint" data-testid="dg-supply-requisition-purchasable">
              {`A solicitação compra só o que não está pedido em transferência: ${qtyText(qty, unit) ?? '—'}. Os ${qtyText(gate.pending, unit) ?? '—'} pendentes ficam de fora — se a transferência for cancelada, voltam a ser compráveis.`}
            </p>
          )}
          {extra > 0 && (
            <p className="dgs-hint" data-testid="dg-supply-requisition-extra">
              {`Aberta agora, ela pede ${qtyText(qty, unit) ?? '—'} (o comprável de hoje): faça antes o que o plano sugere acima, ou ${qtyText(extra, unit) ?? 'a diferença'} a mais vão para a compra.`}
            </p>
          )}
          <button type="button" className="dgm-btn dgm-btn-wide" onClick={onCreate} data-testid="dg-supply-requisition-create">
            <FileText size={17} aria-hidden />Criar solicitação de compra
          </button>
          {exceptionBtn}
        </div>
      </>
    );
  }
  if (pending && gate.blocked) {
    // O que falta está pedido em transferência: a compra espera o despacho (a falta cai) ou o cancelamento (volta a ser comprável).
    const open = gate.exceptionQty;
    return (
      <>
        {list}
        <div className="dgs-req-new" data-testid={list ? 'dg-supply-requisition-more' : 'dg-supply-requisition'}>
          {pending}
          <p className="dgs-lead" data-testid="dg-supply-requisition-blocked">
            {list
              ? <>O restante (<b className="num">{qtyText(open, unit) ?? '—'}</b>) está pedido em transferência: comprar mais fica bloqueado até ela ser despachada ou cancelada.</>
              : <>Compra bloqueada: o que falta (<b className="num">{qtyText(open, unit) ?? '—'}</b>) está pedido em transferência. Ela é liberada quando a transferência for despachada (a falta cai) ou cancelada (volta a ser comprável).</>}
          </p>
          {exceptionBtn ?? (data.capabilities.request && (
            <p className="dgs-hint">Comprar também a parte pendente só com exceção de cobertura, por quem tem essa alçada.</p>
          ))}
        </div>
      </>
    );
  }
  const left = remainingToBuy(data);
  const note = list ? null : left !== null && left <= 0
    ? <StateNote kind="empty" title="Não há o que comprar">A rede de estoque cobre a falta — o plano reserva e transfere.</StateNote>
    : (
      <StateNote kind="empty" title="Nenhuma solicitação de compra ainda">
        {data.capabilities.request ? 'Sem falta registrada para comprar neste momento.' : 'Criar a solicitação cabe a quem tem a permissão de requisitar compras.'}
      </StateNote>
    );
  if (!pending) return list ?? note;
  return <>{list}{note}<div className="dgs-req-new">{pending}{exceptionBtn}</div></>;
}

/**
 * A confirmação de "Criar solicitação de compra" — o corpo exato da rota
 * (canteiro como local de entrega quando conhecido) e a quantidade que o
 * BANCO vai requisitar: o comprável (`purchasable_qty`), nunca a do plano
 * depois de reservas/transferências só sugeridas. Com passo sugerido ainda
 * aberto, o aviso: faça antes o que está acima.
 *
 * `mode='exception'` — a EXCEÇÃO DE COBERTURA: compra também a parte pedida em
 * transferência (falta − requisitado), com a justificativa (mín. 20
 * caracteres, contador) em `coverageOverride: { reason }`. O banco confere a
 * permissão `procurement.coverage_override` e registra a exceção; a recusa
 * vem em português, do servidor.
 */
export function RequisitionConfirm({ ctx, mode = 'buy', onClose, onDone }: {
  ctx: FlowCtx; mode?: RequisitionMode; onClose: () => void; onDone: (title: string) => void;
}) {
  const { data } = ctx;
  // Uma intenção por abertura: a repetição (rede/5xx) reusa a MESMA chave e não duplica a solicitação.
  const [key] = useState(newIntentKey);
  const [reason, setReason] = useState('');
  const act = useSupplyAct();
  const focus = data.focus;
  if (!focus) return null;
  const unit = focus.item?.unit ?? null;
  const gate = requisitionGate(data);
  const { qty, planQty, extra, openSteps } = requisitionPreview(data);
  const location = siteLocationId(data);
  const transfers = pendingTransfersOf(focus);
  const trNums = transfers.map((t) => t.number).filter(Boolean).join(', ');
  const exception = mode === 'exception';
  const st = exceptionReasonState(reason);

  const confirm = async () => {
    if (exception && !st.ok) return;
    const body = exception ? { ...requisitionBody(focus, location, key), ...coverageOverrideBody(reason) } : requisitionBody(focus, location, key);
    const r = await act.run(REQUISITIONS_URL, body);
    if (r.ok) {
      // O título sai do que o BANCO devolveu (número, quantidade, exceção usada ou não) — nunca do que foi pedido.
      onDone(requisitionDoneTitle(r.result, mode, unit));
      ctx.afterAct();
    }
  };

  if (exception) {
    const amount = gate.exceptionQty;
    return (
      <SupplyConfirm title="Exceção de cobertura" kind="Solicitação de compra · exceção" amount={qtyText(amount, unit)}
        what={focus.title}
        consequence={`A solicitação compra ${qtyText(amount, unit) ?? 'a falta aberta'} — inclusive ${qtyText(gate.exceptionExtra, unit) ?? 'a parte'} já pedidos em transferência${trNums ? ` (${trNums})` : ''}, que ainda não saíram da origem. ${gate.purchasable !== null && gate.purchasable > 0
          ? `Sem a exceção, a compra seria de ${qtyText(gate.purchasable, unit)}.`
          : 'Sem a exceção, a compra fica bloqueada até a transferência ser despachada ou cancelada.'} A exceção fica registrada com o seu nome, a justificativa e as transferências, e segue para cotação em Compras.`}
        confirmLabel="Registrar a exceção e criar" busy={act.busy} error={act.error} canConfirm={st.ok} hint={st.hint}
        onConfirm={() => void confirm()} onCancel={() => { if (!act.busy) onClose(); }} testId="dg-supply-exception-confirm">
        <p className="dgs-confirm-warn" role="note">
          <b>Se a transferência também for despachada, o material chega em dobro.</b>
          {' Se ela não vai acontecer, o caminho é cancelá-la no Estoque — a falta volta a ser comprável sem exceção.'}
        </p>
        <label className="ax-field dgs-field">
          <span>Justificativa da exceção (obrigatória — mín. 20 caracteres)</span>
          <textarea rows={3} maxLength={COVERAGE_EXCEPTION_MAX_REASON} value={reason} onChange={(e) => setReason(e.target.value)} readOnly={act.busy}
            aria-invalid={!st.ok || undefined} data-testid="dg-supply-exception-reason" />
          <small className="dgs-count num" data-ok={st.ok ? 'true' : undefined} aria-live="polite">{st.counter}</small>
        </label>
      </SupplyConfirm>
    );
  }

  const steps = openSteps.map((s) => `${PLAN_VERB[s.kind].toLowerCase()} ${qtyText(s.qty, s.unit ?? unit) ?? ''}`.trim()).join(' e ');
  return (
    <SupplyConfirm title="Criar solicitação de compra" kind="Solicitação de compra" amount={qtyText(qty, unit)}
      what={focus.title}
      consequence={`A solicitação nasce da falta sem cobertura do requisito${qty !== null ? ` — hoje ${qtyText(qty, unit)} compráveis` : ''} (rastro por requisito)${location ? ', com entrega no canteiro deste projeto' : ''}, e segue para cotação em Compras. Nada é comprado agora.`}
      confirmLabel="Criar solicitação" busy={act.busy} error={act.error}
      onConfirm={() => void confirm()} onCancel={() => { if (!act.busy) onClose(); }} testId="dg-supply-requisition-confirm">
      {gate.pending > 0 && (
        <p className="dgs-confirm-note" role="note" data-testid="dg-supply-requisition-pending-note">
          {`Fora da compra: ${qtyText(gate.pending, unit) ?? '—'} pedidos em transferência${trNums ? ` (${trNums})` : ''}, ainda sem despacho. Se a transferência for cancelada, voltam a ser compráveis.`}
        </p>
      )}
      {extra > 0 && (
        <p className="dgs-confirm-warn" role="note" data-testid="dg-supply-requisition-warn">
          <b>Faça antes o que está acima.</b>
          {` O plano ainda sugere ${steps || 'reservar/transferir'}: depois disso, a compra seria de ${qtyText(planQty, unit) ?? '—'}. Aberta agora, a solicitação pede ${qtyText(qty, unit) ?? '—'} — ${qtyText(extra, unit) ?? 'a diferença'} a mais.`}
        </p>
      )}
    </SupplyConfirm>
  );
}
