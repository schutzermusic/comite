'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Radar } from 'lucide-react';
import {
  FLOW_ORDER, FLOW_SETTLE_MS, PLAN_STAGGER_MS, PLAN_VERB, activeRfq, currentPurchaseStep, flowStates, liveRequisitions, panelScrollTarget,
  planSteps, planToRequisition, qtyText, type FlowStepId,
} from '../model';
import { FlowSection, ActNotice, StepEyebrow } from './ui';
import { FollowUp, followSummary } from './FollowUp';
import { PlanSteps } from './Plan';
import { QuotesStep } from './Quotes';
import { RequisitionConfirm, RequisitionStep } from './Requisition';
import { SuppliersStep, flowRequisition, type SentNotice } from './Suppliers';
import type { FlowCtx } from './types';

type SectionId = FlowStepId | 'follow';

const RAIL_LABEL: Record<FlowStepId, string> = { plan: 'Plano', requisition: 'Solicitação', suppliers: 'Fornecedores', quotes: 'Cotação' };

const reducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/** Rola o PAINEL (nunca a página, no desktop) até a etapa — inteira quando cabe; senão o bloco em foco no pé. */
function scrollPanelTo(section: HTMLElement, focus: HTMLElement | null, pageFallback: boolean): void {
  const behavior: ScrollBehavior = reducedMotion() ? 'auto' : 'smooth';
  const scroller = section.closest('.dgm-panel-in');
  const canScroll = scroller instanceof HTMLElement && scroller.scrollHeight > scroller.clientHeight + 1
    && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY);
  if (canScroll) {
    const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
    const s = section.getBoundingClientRect();
    const f = focus?.getBoundingClientRect() ?? null;
    const top = panelScrollTarget({
      secTop: s.top - base, secBottom: s.bottom - base, focusBottom: f ? f.bottom - base : null,
      viewH: scroller.clientHeight, scrollMax: scroller.scrollHeight - scroller.clientHeight,
    });
    if (Math.abs(top - scroller.scrollTop) > 2) scroller.scrollTo({ top, behavior });
    return;
  }
  // Celular (o painel não rola por dentro): só o atalho de quem veio decidir leva a página até a decisão.
  if (pageFallback) (focus ?? section).scrollIntoView({ block: focus ? 'center' : 'start', behavior });
}

/**
 * O painel da direita depois da varredura: o PLANO DO APEX e a compra que
 * nasce dele, como um fluxo guiado — o trilho no topo (Plano · Solicitação ·
 * Fornecedores · Cotação, o `supply.flow` do filme) e as etapas 3 a 6, cada
 * uma com o estado pelo DADO. Pela varredura, o plano abre (é o que ela
 * revela); quando o fluxo ASSENTA (o plano entrou e deu tempo de ler), o plano
 * já feito fecha e a etapa "agora" vem à vista dentro do painel — como no
 * filme, que põe a comparação na tela. Pelo atalho de quem veio decidir, a
 * decisão aparece de saída.
 */
export function SupplyFlowPanel({ ctx, entry = 'scan' }: {
  ctx: FlowCtx;
  /** Como a pessoa chegou: pela varredura (o plano abre — é o que ela revela) ou pelo atalho de quem veio decidir (o plano fecha; a etapa atual aparece sem rolar). */
  entry?: 'scan' | 'direct';
}) {
  const { data } = ctx;
  const uid = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const states = flowStates(data);
  const [touched, setTouched] = useState<Partial<Record<SectionId, boolean>>>({});
  const [reqDialog, setReqDialog] = useState(false);
  const [reqNotice, setReqNotice] = useState<string | null>(null);
  const [sent, setSent] = useState<SentNotice | null>(null);
  // O fluxo "assentou": pelo atalho, de saída; pela varredura, depois que os passos do plano entraram (e deu tempo de ler).
  const [settled, setSettled] = useState(entry === 'direct');
  // A pessoa já mexeu no painel (clicou, rolou, teclou): a tela não rola nem fecha nada por ela.
  const handsOn = useRef(false);

  const req = flowRequisition(ctx);
  const rfq = activeRfq(req);
  const started = liveRequisitions(data.procurement).length > 0;
  const rfqKey = rfq?.decision?.decisionKey ?? null;
  const skipKeys = rfqKey ? [rfqKey] : [];
  const otherDecisions = data.decisions.state === 'ok' ? data.decisions.data.filter((d) => !skipKeys.includes(d.key)).length : 0;
  // Uma leitura do acompanhamento que falhou abre a etapa: falha nunca fica escondida atrás de um resumo calmo.
  const followFailed = [data.decisions, data.orders, data.apex].some((s) => s.state === 'error');

  const defaults: Record<SectionId, boolean> = {
    // O plano aberto: enquanto a varredura o revela; ou quando ELE é a etapa da vez (nada requisitado ainda); ou falhou.
    plan: (entry === 'scan' && !settled) || (states.plan === 'current' && !started) || states.plan === 'error',
    requisition: states.requisition === 'current' || states.requisition === 'error' || reqNotice !== null,
    suppliers: states.suppliers === 'current' || sent !== null,
    quotes: states.quotes === 'current' || (states.quotes === 'done' && Boolean(rfq?.quotes.length)),
    follow: otherDecisions > 0 || followFailed,
  };
  const isOpen = (id: SectionId) => touched[id] ?? defaults[id];
  const toggle = (id: SectionId) => {
    handsOn.current = true;
    setTouched((t) => ({ ...t, [id]: !(t[id] ?? defaults[id]) }));
  };
  const reveal = (id: FlowStepId) => {
    handsOn.current = true;
    setTouched((t) => ({ ...t, [id]: true }));
    const el = typeof document !== 'undefined' ? document.getElementById(`${uid}-${id}`) : null;
    el?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  };
  const openRequisition = () => { handsOn.current = true; setReqNotice(null); setReqDialog(true); };

  // Varredura: os passos do plano entram um a um (0,32 s) e ficam um instante; então o fluxo assenta.
  const planCount = data.plan.state === 'ok' ? data.plan.data.steps.length : 0;
  useEffect(() => {
    if (settled) return undefined;
    const ms = reducedMotion() ? 0 : Math.max(0, planCount - 1) * PLAN_STAGGER_MS + FLOW_SETTLE_MS;
    const t = window.setTimeout(() => {
      // Quem já está mexendo no painel não vê o plano fechar sozinho: fica como está.
      if (handsOn.current) setTouched((prev) => ({ plan: true, ...prev }));
      setSettled(true);
    }, ms);
    return () => window.clearTimeout(t);
  }, [settled, planCount]);

  // Qualquer gesto da pessoa no painel suspende a rolagem automática.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const off = () => { handsOn.current = true; };
    const scroller = el.closest('.dgm-panel-in') ?? el;
    scroller.addEventListener('wheel', off, { passive: true });
    scroller.addEventListener('touchstart', off, { passive: true });
    scroller.addEventListener('pointerdown', off);
    scroller.addEventListener('keydown', off);
    return () => {
      scroller.removeEventListener('wheel', off);
      scroller.removeEventListener('touchstart', off);
      scroller.removeEventListener('pointerdown', off);
      scroller.removeEventListener('keydown', off);
    };
  }, []);

  // Assentou: a etapa da vez à vista DENTRO do painel. Quem veio decidir vê a decisão (a comparação e o botão).
  const target: SectionId | null = entry === 'direct'
    ? (rfq && rfq.quotes.length > 0 ? 'quotes' : otherDecisions > 0 ? 'follow' : currentPurchaseStep(states))
    : currentPurchaseStep(states);
  const scrolled = useRef(false);
  useEffect(() => {
    if (!settled || scrolled.current || !target || handsOn.current) return undefined;
    // Um quadro depois: o plano que fechou já saiu do layout. (A marca de "feito" mora no quadro: o efeito pode rodar duas vezes.)
    const raf = window.requestAnimationFrame(() => {
      scrolled.current = true;
      if (handsOn.current) return;
      const section = document.getElementById(`${uid}-${target}`);
      if (!section) return;
      const focus = target === 'quotes' ? section.querySelector<HTMLElement>('[data-testid="dg-supply-governance"]') : null;
      scrollPanelTo(section, focus, entry === 'direct');
    });
    return () => window.cancelAnimationFrame(raf);
  }, [settled, target, uid, entry]);

  const unit = data.focus?.item?.unit ?? null;
  const procUnread = data.procurement.state === 'restricted' ? 'Restrito' : data.procurement.state === 'error' ? 'não carregou' : null;
  const toReq = planToRequisition(data);
  const summaries: Record<SectionId, string | null> = {
    plan: data.plan.state === 'ok'
      ? planSteps(data.plan.data).map((s) => `${PLAN_VERB[s.kind]} ${qtyText(s.qty, s.unit) ?? ''}`.trim()).join(' · ') || 'nada a fazer'
      : data.plan.state === 'restricted' ? 'Restrito' : 'não carregou',
    requisition: procUnread
      ?? (states.requisition === 'current' && toReq !== null && toReq > 0
        ? `falta requisitar ${qtyText(toReq, unit) ?? '—'}${req ? ` · ${req.number} ${req.statusLabel.toLowerCase()}` : ''}`
        : req ? `${req.number} · ${req.statusLabel}`
          : states.requisition === 'skip' ? 'a rede cobre a falta' : 'nenhuma solicitação'),
    suppliers: rfq ? `${rfq.invited.length} ${rfq.invited.length === 1 ? 'convidado' : 'convidados'} · ${rfq.quotes.length > 0
      ? `${rfq.quotes.length} ${rfq.quotes.length === 1 ? 'proposta recebida' : 'propostas recebidas'}`
      : `${rfq.invited.filter((i) => i.sentAt).length} com cotação enviada`}`
      : data.suppliers.state === 'ok' ? `${data.suppliers.data.length} ${data.suppliers.data.length === 1 ? 'homologado candidato' : 'homologados candidatos'}`
        : data.suppliers.state === 'restricted' ? 'Restrito' : 'não carregou',
    // Sem a leitura de compras, "nenhuma cotação" seria mentira: Restrito / não carregou.
    quotes: procUnread
      ?? (rfq ? `${rfq.number} · ${rfq.quotes.length} ${rfq.quotes.length === 1 ? 'proposta' : 'propostas'}` : states.quotes === 'skip' ? 'não precisa' : 'nenhuma cotação ainda'),
    follow: followSummary(ctx, skipKeys),
  };

  return (
    <div className="dgs-flow-in" ref={rootRef}>
      <header className="dgs-flow-head">
        <StepEyebrow icon={<Radar size={15} />}>Plano do Apex</StepEyebrow>
        {data.plan.state === 'ok' && data.plan.data.basis && <p className="dgs-basis">{data.plan.data.basis}</p>}
        <ol className="dgs-rail" aria-label="Etapas da compra">
          {FLOW_ORDER.map((id, i) => (
            <li key={id} data-state={states[id]}>
              <button type="button" onClick={() => reveal(id)} aria-current={states[id] === 'current' ? 'step' : undefined}>
                <i aria-hidden />
                <span className="dgs-rail-l"><em className="num">{String(i + 3).padStart(2, '0')}</em><span className="dgs-rail-t">{RAIL_LABEL[id]}</span></span>
              </button>
            </li>
          ))}
        </ol>
      </header>

      <div id={`${uid}-plan`}>
        <FlowSection n={3} title="Plano do Apex" summary={summaries.plan} state={states.plan} open={isOpen('plan')} onToggle={() => toggle('plan')} testId="dg-supply-step-plan">
          <PlanSteps ctx={ctx} onBuy={openRequisition} />
        </FlowSection>
      </div>
      <div id={`${uid}-requisition`}>
        <FlowSection n={4} title="Solicitação de compra" summary={summaries.requisition} state={states.requisition} open={isOpen('requisition')}
          onToggle={() => toggle('requisition')} testId="dg-supply-step-requisition">
          {reqNotice && <div className="dgm-live" role="status"><ActNotice tone="success" title={reqNotice}>Segue para cotação em Compras — convide fornecedores na etapa 5.</ActNotice></div>}
          <RequisitionStep ctx={ctx} onCreate={openRequisition} />
        </FlowSection>
      </div>
      <div id={`${uid}-suppliers`}>
        <FlowSection n={5} title="Fornecedores" summary={summaries.suppliers} state={states.suppliers} open={isOpen('suppliers')}
          onToggle={() => toggle('suppliers')} testId="dg-supply-step-suppliers">
          <SuppliersStep ctx={ctx} sent={sent} onSent={setSent} />
        </FlowSection>
      </div>
      <div id={`${uid}-quotes`}>
        <FlowSection n={6} title="Cotações — A × B" summary={summaries.quotes} state={states.quotes} open={isOpen('quotes')}
          onToggle={() => toggle('quotes')} testId="dg-supply-step-quotes">
          <QuotesStep ctx={ctx} />
        </FlowSection>
      </div>
      <div id={`${uid}-follow`}>
        <FlowSection title="Acompanhamento" summary={summaries.follow} state={otherDecisions > 0 ? 'current' : followFailed ? 'error' : 'pending'}
          signal={otherDecisions > 0 ? { tone: 'warning', label: `${otherDecisions} para você` }
            : followFailed ? { tone: 'danger', label: 'Não carregou' } : { tone: 'neutral', label: 'Consulta' }} open={isOpen('follow')}
          onToggle={() => toggle('follow')} testId="dg-supply-step-follow">
          <FollowUp ctx={ctx} skipKeys={skipKeys} />
        </FlowSection>
      </div>

      {reqDialog && (
        <RequisitionConfirm ctx={ctx} onClose={() => setReqDialog(false)}
          onDone={(title) => { setReqDialog(false); setReqNotice(title); setTouched((t) => ({ ...t, requisition: true })); }} />
      )}
      {liveRequisitions(data.procurement).length > 1 && (
        <p className="dgm-foot">Há mais de uma solicitação viva para este requisito — veja todas em Compras.</p>
      )}
    </div>
  );
}
