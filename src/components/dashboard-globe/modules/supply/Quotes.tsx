'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Lock, Radar, Scale, SendHorizontal, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { QuoteOption, RfqView, SupplyDecision } from '@/lib/dashboard/types';
import {
  PO_SUBMIT_BODY, abPair, activeRfq, arrivalText, dayMonth, decideBody, defaultRationale, govStep, leadText, missingDeliveryLocation, pctText, poUpdateBody,
  poUrl, rationaleState, recommendationLine, rfqUrl, siteLocationId,
} from '../model';
import { StateNote } from '../shared';
import { postGoverned, useSupplyAct } from './act';
import { DecisionCard } from './Decision';
import { flowRequisition } from './Suppliers';
import type { FlowCtx } from './types';
import { ActNotice, Signal, SupplyConfirm } from './ui';

/**
 * ETAPA 6 — COTAÇÕES A × B (a comparação do filme): duas propostas lado a
 * lado — A é a recomendada pela Apex —, com total, preço unitário, prazo,
 * chegada contra a necessidade e pontualidade; a caixa da recomendação com a
 * diferença calculada dos totais REAIS; e o próximo ato governado PARA ESTA
 * PESSOA: quem cota decide o fornecedor e envia o pedido para aprovação;
 * quem tem a alçada aprova a compra pelo MESMO ato de Decisões.
 */
export function QuotesStep({ ctx }: { ctx: FlowCtx }) {
  const { data } = ctx;
  if (data.procurement.state === 'restricted') return <StateNote kind="restricted" title="Restrito">Seu perfil não lê as cotações de compra.</StateNote>;
  if (data.procurement.state === 'error') return <StateNote kind="error" title="As cotações não carregaram">{data.procurement.message}</StateNote>;
  const req = flowRequisition(ctx);
  const rfq = activeRfq(req);
  if (!rfq) return <StateNote kind="empty" title="Nenhuma cotação aberta ainda">Convide fornecedores homologados na etapa 5 — as propostas aparecem aqui, lado a lado.</StateNote>;
  if (rfq.quotes.length === 0) {
    return (
      <StateNote kind="empty" title={`Cotação ${rfq.number}: aguardando propostas`}>
        {`${rfq.invited.length} ${rfq.invited.length === 1 ? 'fornecedor convidado' : 'fornecedores convidados'}${rfq.responseDue ? ` · resposta até ${dayMonth(rfq.responseDue)}` : ''}. A comparação A × B aparece quando as propostas chegam.`}
      </StateNote>
    );
  }
  return <Comparison ctx={ctx} rfq={rfq} />;
}

function Comparison({ ctx, rfq }: { ctx: FlowCtx; rfq: RfqView }) {
  const pair = abPair(rfq);
  if (!pair) return null;
  const unit = ctx.data.focus?.item?.unit ?? null;
  // "Apex recomenda A" só quando A É a recomendada (uma recomendação sobre proposta que saiu da lista não vale para A).
  const rec = recommendationLine(pair, Boolean(rfq.recommendation?.quoteId) && rfq.recommendation?.quoteId === pair.a.quoteId);
  return (
    <div className="dgs-cmp" data-testid="dg-supply-ab">
      <p className="dgs-lead"><Scale size={15} aria-hidden />Cotação <b className="num">{rfq.number}</b> · {rfq.quotes.length} {rfq.quotes.length === 1 ? 'proposta' : 'propostas'}</p>
      <div className="dgs-ab" data-count={pair.b ? 2 : 1}>
        <QuoteCard letter="A" q={pair.a} unit={unit} rec={pair.a.quoteId === rfq.recommendation?.quoteId} chosen={rfq.decision?.quoteId === pair.a.quoteId} />
        {pair.b && <QuoteCard letter="B" q={pair.b} unit={unit} rec={false} chosen={rfq.decision?.quoteId === pair.b.quoteId} />}
      </div>
      {pair.more > 0 && <p className="dgs-hint">{`+ ${pair.more} ${pair.more === 1 ? 'outra proposta' : 'outras propostas'} na cotação em Compras.`}</p>}
      <div className="dgs-rec" data-testid="dg-supply-recommendation" data-caveat={rec.caveat ? 'true' : undefined}>
        <p className="dgs-rec-line"><Radar size={16} aria-hidden /><span>{rec.head}</span></p>
        {rec.detail && <p className="dgs-rec-detail">{rec.detail}</p>}
        {(rec.plus || rec.minus) && (
          <p className="dgs-rec-m num">{rec.plus && <span data-tone="cost">{rec.plus}</span>}{rec.minus && <span data-tone="ok">{rec.minus}</span>}</p>
        )}
        {rec.caveat && <p className="dgs-rec-caveat" data-testid="dg-supply-rec-caveat"><TriangleAlert size={14} aria-hidden /><span>{rec.caveat}</span></p>}
      </div>
      <Governance ctx={ctx} rfq={rfq} />
      <Link className="dgm-textbtn" href={rfq.href}>Abrir a cotação em Compras<ArrowUpRight size={13} aria-hidden /></Link>
    </div>
  );
}

function QuoteCard({ letter, q, unit, rec, chosen }: { letter: 'A' | 'B'; q: QuoteOption; unit: string | null; rec: boolean; chosen: boolean }) {
  const arrival = arrivalText(q);
  const pct = pctText(q.supplier.onTimeRate);
  return (
    <article className="dgs-quote" data-rec={rec ? 'true' : undefined} data-late={arrival.tone === 'warning' ? 'true' : undefined}
      data-chosen={chosen ? 'true' : undefined} aria-label={`Proposta ${letter}: ${q.supplier.name}`}>
      <header className="dgs-q-head">
        <span className="dgs-letter" aria-hidden>{letter}</span>
        <b>{q.supplier.name}</b>
      </header>
      <div className="dgs-q-flags dgs-sigwrap">
        {rec && <Signal tone="accent" label="Recomendada pela Apex" />}
        {chosen && <Signal tone="success" label="Escolhida" />}
        {!q.supplier.homologated && <Signal tone="warning" label="Não homologado" />}
      </div>
      <div className="dgs-q-total num" data-muted={q.totalText ? undefined : 'true'}>
        {q.totalText ?? <><Lock size={14} aria-hidden />Restrito</>}
      </div>
      <small className="dgs-q-unit num">{q.unitPriceText ? `${q.unitPriceText}${unit ? ` / ${unit}` : ''} · total posto` : q.totalText ? 'total posto (preço + frete + impostos)' : 'valor restrito ao seu perfil'}</small>
      <dl className="dgs-q-kv">
        <div><dt>Prazo</dt><dd className="num">{leadText(q.leadDays) ?? '—'}</dd></div>
        <div><dt>Chegada</dt><dd className="num">{q.eta ? dayMonth(q.eta) : '—'}</dd></div>
        <div><dt>Pontualidade</dt><dd className="num">{pct ?? 'sem histórico'}</dd></div>
      </dl>
      <p className="dgs-q-arrival dgs-sigwrap"><Signal tone={arrival.tone} label={arrival.text} title={arrival.text} /></p>
      {q.verdict && <p className="dgs-q-verdict">{q.verdict}</p>}
    </article>
  );
}

/* ── O próximo ato governado para ESTA pessoa ───────────────────────────── */

function Governance({ ctx, rfq }: { ctx: FlowCtx; rfq: RfqView }) {
  const { data, today } = ctx;
  const g = govStep(rfq, data.capabilities);
  const [decide, setDecide] = useState(false);
  const [submit, setSubmit] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning'; title: string; text: string } | null>(null);

  const chosen = rfq.decision ? rfq.quotes.find((q) => q.quoteId === rfq.decision?.quoteId) ?? null : null;
  const decided = rfq.decision ? (
    <p className="dgm-policy"><ShieldCheck size={15} aria-hidden />
      <span>Fornecedor decidido: <b>{chosen?.supplier.name ?? 'proposta registrada'}</b> — {rfq.decision.followsRecommendation ? 'segue a recomendação da Apex' : 'contra a recomendação, com justificativa registrada'}.</span>
    </p>
  ) : null;

  let body: ReactNode = null;
  switch (g.kind) {
    case 'decide':
      body = (
        <button type="button" className="dgm-btn dgm-btn-wide" onClick={() => setDecide(true)} data-testid="dg-supply-decide">
          <Scale size={17} aria-hidden />Decidir fornecedor
        </button>
      );
      break;
    case 'wait-decision':
      body = <p className="dgs-gov-line"><Signal tone="warning" label="Aguardando a decisão de Compras" /><span>Quem cota decide o fornecedor; a aprovação vem depois, pela alçada.</span></p>;
      break;
    case 'submit':
      body = (
        <>
          <p className="dgs-gov-line"><Signal tone="warning" label={`Pedido ${g.poNumber ?? ''} em rascunho`.replace('  ', ' ')} /><span>Falta enviar para a aprovação de quem tem a alçada.</span></p>
          <button type="button" className="dgm-btn dgm-btn-wide" onClick={() => setSubmit(true)} data-testid="dg-supply-submit">
            <SendHorizontal size={17} aria-hidden />Enviar para aprovação
          </button>
        </>
      );
      break;
    case 'draft':
      body = <p className="dgs-gov-line"><Signal tone="warning" label={`Pedido ${g.poNumber ?? ''} em rascunho`.replace('  ', ' ')} /><span>Compras envia para a aprovação.</span></p>;
      break;
    case 'approve': {
      const inbox = data.decisions.state === 'ok' ? data.decisions.data.find((x) => x.key === g.decisionKey) : undefined;
      const decision: SupplyDecision = inbox ?? {
        key: g.decisionKey, href: `/decisoes?d=${encodeURIComponent(g.decisionKey)}`, kindLabel: 'Compra',
        title: g.poNumber ? `Pedido de compra ${g.poNumber}` : 'Pedido de compra', amountText: chosen?.totalText ?? null,
        amountRestricted: chosen ? chosen.totalText === null : false, due: null, overdue: false, poId: rfq.decision?.poId ?? null,
      };
      body = <DecisionCard decision={decision} today={today} onChanged={ctx.afterAct} />;
      break;
    }
    case 'awaiting':
      body = <p className="dgs-gov-line"><Signal tone="warning" label="Em aprovação" /><span>{`O pedido${g.poNumber ? ` ${g.poNumber}` : ''} aguarda quem tem a alçada pela política de compras.`}</span></p>;
      break;
    case 'settled':
      body = <p className="dgs-gov-line"><Signal tone="success" label={g.label} /><span>{`Pedido${g.poNumber ? ` ${g.poNumber}` : ''} — acompanhe a entrega em Compras.`}</span></p>;
      break;
    default:
      body = null;
  }

  return (
    <div className="dgs-gov" data-testid="dg-supply-governance">
      {decided}
      <div className="dgm-live" role="status" aria-live="polite">
        {notice && <ActNotice tone={notice.tone} title={notice.title}>{notice.text}</ActNotice>}
      </div>
      {body}
      {decide && <DecideDialog ctx={ctx} rfq={rfq} onClose={() => setDecide(false)}
        onDone={(n) => { setDecide(false); setNotice(n); }} />}
      {submit && g.kind === 'submit' && <SubmitDialog ctx={ctx} poId={g.poId} poNumber={g.poNumber} amount={chosen?.totalText ?? null}
        onClose={() => setSubmit(false)} onDone={(n) => { setSubmit(false); setNotice(n); }} />}
    </div>
  );
}

type Notice = { tone: 'success' | 'warning'; title: string; text: string };

/** "Decidir fornecedor": a escolha (A pré-marcada), a justificativa (escrita quando segue a recomendação) → POST {action:'decide'}. */
function DecideDialog({ ctx, rfq, onClose, onDone }: { ctx: FlowCtx; rfq: RfqView; onClose: () => void; onDone: (n: Notice) => void }) {
  const pair = abPair(rfq);
  const first = rfq.recommendation?.quoteId ?? pair?.a.quoteId ?? rfq.quotes[0]?.quoteId ?? '';
  const [quoteId, setQuoteId] = useState(first);
  const [rationale, setRationale] = useState(() => defaultRationale(rfq, first));
  const act = useSupplyAct();
  const st = rationaleState(rfq, quoteId, rationale);
  const picked = rfq.quotes.find((q) => q.quoteId === quoteId) ?? null;
  const ordered = pair ? [pair.a, ...(pair.b ? [pair.b] : []), ...rfq.quotes.filter((q) => q.quoteId !== pair.a.quoteId && q.quoteId !== pair.b?.quoteId)] : rfq.quotes;
  const letter = (q: QuoteOption) => (q.quoteId === pair?.a.quoteId ? 'A' : q.quoteId === pair?.b?.quoteId ? 'B' : '·');

  const choose = (id: string) => {
    // Trocar a escolha só reescreve a justificativa que ainda é a sugerida (nunca apaga o que a pessoa escreveu).
    if (rationale.trim() === '' || rationale === defaultRationale(rfq, quoteId)) setRationale(defaultRationale(rfq, id));
    setQuoteId(id);
  };
  const confirm = async () => {
    const r = await act.run(rfqUrl(rfq.id), decideBody(rfq, quoteId, rationale));
    if (r.ok) {
      const po = typeof r.result.po_number === 'string' ? r.result.po_number : typeof r.result.purchase_order_number === 'string' ? r.result.purchase_order_number : null;
      onDone({ tone: 'success', title: 'Fornecedor decidido', text: `${po ? `O pedido ${po}` : 'O pedido'} nasceu em rascunho — envie para aprovação de quem tem a alçada.` });
      ctx.afterAct();
    }
  };
  return (
    <SupplyConfirm title="Decidir fornecedor" kind={`Cotação ${rfq.number}`} amount={picked?.totalText ?? null} what={picked?.supplier.name ?? 'Escolha a proposta'}
      consequence="A decisão gera o pedido em rascunho e fica registrada com a comparação que a sustentou. A aprovação vem depois, por quem tem a alçada — a Apex só recomenda."
      confirmLabel="Decidir e gerar pedido" busy={act.busy} error={act.error} canConfirm={Boolean(quoteId) && st.ok} hint={st.hint}
      onConfirm={() => void confirm()} onCancel={() => { if (!act.busy) onClose(); }} testId="dg-supply-decide-confirm">
      <fieldset className="dgs-choice" disabled={act.busy}>
        <legend>Proposta escolhida</legend>
        {ordered.map((q) => {
          const arr = arrivalText(q);
          return (
            <label key={q.quoteId} className="dgs-choice-opt" data-on={q.quoteId === quoteId ? 'true' : undefined}>
              <input type="radio" name={`decide-${rfq.id}`} checked={q.quoteId === quoteId} onChange={() => choose(q.quoteId)} />
              <span><b>{letter(q)} · {q.supplier.name}</b><small className="num">{[q.totalText ?? 'valor restrito', arr.text, q.quoteId === rfq.recommendation?.quoteId ? 'recomendada' : null].filter(Boolean).join(' · ')}</small></span>
            </label>
          );
        })}
      </fieldset>
      <label className="ax-field dgs-field">
        <span>{st.against ? 'Justificativa (obrigatória — contra a recomendação)' : 'Justificativa (obrigatória)'}</span>
        <textarea rows={3} maxLength={2000} value={rationale} onChange={(e) => setRationale(e.target.value)} readOnly={act.busy} aria-invalid={!st.ok || undefined} />
      </label>
    </SupplyConfirm>
  );
}

/**
 * "Enviar para aprovação": POST {action:'submit'}. Se o banco recusar por
 * falta de local de entrega e o canteiro deste projeto é conhecido, grava o
 * canteiro como entrega ({action:'update'}) e submete de novo — o que a
 * pessoa já confirmou no diálogo.
 */
function SubmitDialog({ ctx, poId, poNumber, amount, onClose, onDone }: {
  ctx: FlowCtx; poId: string; poNumber: string | null; amount: string | null; onClose: () => void; onDone: (n: Notice) => void;
}) {
  const act = useSupplyAct();
  const location = siteLocationId(ctx.data);
  const confirm = async () => {
    act.setBusy(true);
    act.setError(null);
    try {
      let r = await postGoverned(poUrl(poId), PO_SUBMIT_BODY);
      if (!r.ok && location && missingDeliveryLocation(r.message)) {
        const u = await postGoverned(poUrl(poId), poUpdateBody(location));
        r = u.ok ? await postGoverned(poUrl(poId), PO_SUBMIT_BODY) : u;
      }
      if (!r.ok) { act.setError(r.message); return; }
      onDone({ tone: 'success', title: 'Enviado para aprovação', text: `${poNumber ? `O pedido ${poNumber}` : 'O pedido'} aguarda quem tem a alçada pela política de compras.` });
      ctx.afterAct();
    } finally {
      act.setBusy(false);
    }
  };
  return (
    <SupplyConfirm title="Enviar para aprovação" kind="Pedido de compra" amount={amount} what={poNumber ? `Pedido ${poNumber}` : 'Pedido em rascunho'}
      consequence={`O pedido segue para a aprovação de quem tem a alçada pela política de compras.${location ? ' Sem local de entrega definido, a entrega fica no canteiro deste projeto.' : ''} Quem criou ou submeteu o pedido não o aprova.`}
      confirmLabel="Enviar para aprovação" busy={act.busy} error={act.error}
      onConfirm={() => void confirm()} onCancel={() => { if (!act.busy) onClose(); }} testId="dg-supply-submit-confirm" />
  );
}
