'use client';

import { useState, type CSSProperties } from 'react';
import { PackageCheck, ShoppingCart, Truck } from 'lucide-react';
import type { PlanStepKind, SupplyCapabilities, SupplyPlanStep } from '@/lib/dashboard/types';
import { PLAN_STATUS, PLAN_VERB, REQUISITIONS_URL, planActionBody, planSteps, qtyText } from '../model';
import { StateNote } from '../shared';
import { newIntentKey, useSupplyAct } from './act';
import type { FlowCtx } from './types';
import { ActNotice, Signal, SupplyConfirm } from './ui';

const ICON: Record<PlanStepKind, typeof Truck> = { reserve: PackageCheck, transfer: Truck, buy: ShoppingCart };
const ACT_LABEL: Record<PlanStepKind, string> = { reserve: 'Reservar', transfer: 'Pedir a transferência', buy: 'Criar solicitação' };
const NO_RIGHT: Record<PlanStepKind, keyof SupplyCapabilities> = { reserve: 'reserve', transfer: 'transfer', buy: 'request' };
const NO_RIGHT_TEXT: Record<PlanStepKind, string> = {
  reserve: 'Reservar cabe a quem tem a permissão de estoque.',
  transfer: 'Transferir cabe a quem tem a permissão de estoque.',
  buy: 'Requisitar a compra cabe a quem tem a permissão de requisitar.',
};

/**
 * ETAPA 3 — O PLANO DO APEX: reservar → transferir → comprar, na ordem do
 * filme, cada passo entrando 0,32 s depois do anterior. Cada um diz o estado
 * (sugerido / feito / bloqueado, com o porquê) e, quando o servidor devolve a
 * ação, o botão da ROTA GOVERNADA — confirmação com a frase do servidor.
 * "Comprar" leva à solicitação de compra (etapa 4), o mesmo ato.
 */
export function PlanSteps({ ctx, onBuy }: { ctx: FlowCtx; onBuy: () => void }) {
  const { data } = ctx;
  const [open, setOpen] = useState<{ step: SupplyPlanStep; key: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const act = useSupplyAct();

  if (data.plan.state === 'restricted') return <StateNote kind="restricted" title="Restrito">Seu perfil não lê o plano de cobertura deste material.</StateNote>;
  if (data.plan.state === 'error') return <StateNote kind="error" title="O plano da Apex não carregou">{data.plan.message}</StateNote>;
  const steps = planSteps(data.plan.data);
  if (steps.length === 0) return <StateNote kind="empty" title="Nada a fazer: a cobertura viva já atende a necessidade." />;

  const confirm = async () => {
    if (!open?.step.action) return;
    const body = planActionBody(open.step, open.key);
    if (!body) return;
    const r = await act.run(open.step.action.href, body);
    if (r.ok) {
      const what = `${PLAN_VERB[open.step.kind]} ${qtyText(open.step.qty, open.step.unit) ?? ''}`.trim();
      // Repetição da MESMA intenção: o servidor devolve o ato já registrado — dito como é.
      setDone(r.replayed ? `${what} — já estava registrado` : `${what} — registrado`);
      setOpen(null);
      ctx.afterAct();
    }
  };

  return (
    <>
      <ol className="dgs-steps" data-testid="dg-supply-plan-steps">
        {steps.map((s) => {
          const Icon = ICON[s.kind] ?? ShoppingCart;
          const st = PLAN_STATUS[s.status] ?? PLAN_STATUS.suggested;
          const where = s.kind === 'buy' ? 'o que a rede não cobre' : s.from?.name ?? '';
          const canAct = s.status === 'suggested' && s.action !== null;
          const style = { '--d': `${s.delayMs}ms` } as CSSProperties;
          return (
            <li key={s.key} className="dgs-step" data-kind={s.kind} data-status={s.status} style={style} title={s.label}>
              <i className="dgs-step-ico" aria-hidden><Icon size={18} strokeWidth={2} /></i>
              <div className="dgs-step-main">
                <div className="dgs-step-top">
                  <b>{PLAN_VERB[s.kind]}</b>
                  <span className="num">{qtyText(s.qty, s.unit) ?? '—'}</span>
                  <Signal tone={st.tone} label={st.label} />
                </div>
                <small>{s.kind === 'transfer' && s.from ? `de ${where} até o canteiro` : where}</small>
                {s.reason && <p className="dgs-step-why">{s.reason}</p>}
                {s.status === 'suggested' && !s.action && !data.capabilities[NO_RIGHT[s.kind]] && (
                  <p className="dgs-step-why">{NO_RIGHT_TEXT[s.kind]}</p>
                )}
              </div>
              {canAct && (
                <button type="button" className="dgm-btn-quiet dgs-step-act" data-testid={`dg-plan-act-${s.kind}`}
                  onClick={() => {
                    if (s.kind === 'buy' && s.action?.href === REQUISITIONS_URL) { onBuy(); return; }
                    act.reset();
                    setOpen({ step: s, key: newIntentKey() });
                  }}>
                  {ACT_LABEL[s.kind]}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      <div className="dgm-live" role="status" aria-live="polite">
        {done && <ActNotice tone="success" title={done}>A cobertura viva foi relida; o plano abaixo já reflete o ato.</ActNotice>}
      </div>
      {open?.step.action && (
        <SupplyConfirm title={`${PLAN_VERB[open.step.kind]} ${qtyText(open.step.qty, open.step.unit) ?? ''}`.trim()} kind="Plano do Apex"
          amount={qtyText(open.step.qty, open.step.unit)} what={open.step.label} consequence={open.step.action.confirm}
          confirmLabel={ACT_LABEL[open.step.kind]} busy={act.busy} error={act.error}
          onConfirm={() => void confirm()} onCancel={() => { if (!act.busy) setOpen(null); }} testId="dg-supply-plan-confirm" />
      )}
    </>
  );
}
