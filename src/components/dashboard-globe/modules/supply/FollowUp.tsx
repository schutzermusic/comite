'use client';

import Link from 'next/link';
import { Radar, ShieldCheck, ShoppingCart } from 'lucide-react';
import type { ApexNote, InboundOrder, SectionState, SupplyDecision } from '@/lib/dashboard/types';
import { dayMonth, orderTiming, qtyText } from '../model';
import { StateNote } from '../shared';
import { DecisionCard } from './Decision';
import type { FlowCtx } from './types';
import { Signal } from './ui';

/**
 * ACOMPANHAMENTO: os pedidos a caminho (chegada COMPARADA à necessidade), as
 * outras decisões da caixa desta pessoa para este material e os achados
 * persistidos da Apex. Cada leitura com o seu estado honesto.
 */
export function FollowUp({ ctx, skipKeys }: { ctx: FlowCtx; skipKeys: string[] }) {
  const { data, today } = ctx;
  const needBy = data.focus?.needBy ?? null;
  const unit = data.focus?.item?.unit ?? null;
  const decisions: SectionState<SupplyDecision[]> = data.decisions.state === 'ok'
    ? { ...data.decisions, data: data.decisions.data.filter((d) => !skipKeys.includes(d.key)) } : data.decisions;
  return (
    <div className="dgs-follow">
      <div className="dgs-sub-h"><ShieldCheck size={15} aria-hidden /><span>Decisões suas neste material</span></div>
      <Decisions section={decisions} today={today} onChanged={ctx.afterAct} />
      <div className="dgs-sub-h"><ShoppingCart size={15} aria-hidden /><span>Pedidos a caminho</span></div>
      <Orders section={data.orders} needBy={needBy} unit={unit} />
      <div className="dgs-sub-h"><Radar size={15} aria-hidden /><span>Achados abertos da Apex</span></div>
      <ApexNotes section={data.apex} />
    </div>
  );
}

/** Quantas coisas há no acompanhamento (o resumo da etapa fechada); Restrito/erro não viram 0. */
export function followSummary(ctx: FlowCtx, skipKeys: string[]): string {
  const { data } = ctx;
  const part = (s: SectionState<unknown[]>, one: string, many: string) =>
    s.state === 'ok' ? `${s.data.length} ${s.data.length === 1 ? one : many}` : s.state === 'restricted' ? `${many}: Restrito` : `${many}: não carregou`;
  const dec: SectionState<unknown[]> = data.decisions.state === 'ok' ? { state: 'ok', data: data.decisions.data.filter((d) => !skipKeys.includes(d.key)) } : data.decisions;
  return [part(dec, 'decisão', 'decisões'), part(data.orders, 'pedido', 'pedidos'), part(data.apex, 'achado', 'achados')].join(' · ');
}

function Decisions({ section, today, onChanged }: { section: SectionState<SupplyDecision[]>; today: string; onChanged: () => void }) {
  if (section.state === 'restricted') return <StateNote kind="restricted" title="Restrito">Seu perfil não lê a caixa de decisões deste material.</StateNote>;
  if (section.state === 'error') return <StateNote kind="error" title="As decisões não carregaram">{section.message}</StateNote>;
  if (section.data.length === 0) return <StateNote kind="empty" title="Nenhuma decisão sua aguardando para este material." />;
  return (
    <div className="dgm-decisions">
      {section.data.map((d) => <DecisionCard key={d.key} decision={d} today={today} onChanged={onChanged} />)}
    </div>
  );
}

function Orders({ section, needBy, unit }: { section: SectionState<InboundOrder[]>; needBy: string | null; unit: string | null }) {
  if (section.state === 'restricted') return <StateNote kind="restricted" title="Restrito">Seu perfil não lê os pedidos de compra.</StateNote>;
  if (section.state === 'error') return <StateNote kind="error" title="Os pedidos não carregaram">{section.message}</StateNote>;
  if (section.data.length === 0) return <StateNote kind="empty" title="Nenhum pedido aberto para este material." />;
  return (
    <div className="dgm-orders dgs-orders" data-testid="dg-supply-orders">
      {section.data.map((o) => {
        const t = orderTiming(o, needBy);
        return (
          <Link key={o.poId} href={o.href} className="dgm-order dgs-tile" data-late={t.tone === 'late' ? 'true' : undefined}>
            <div className="dgm-order-head">
              <b>{o.supplier?.name ?? 'Fornecedor não informado'}</b>
              <Signal tone={t.tone === 'late' ? 'warning' : t.tone === 'ok' ? 'success' : 'neutral'} label={t.text} />
            </div>
            <div className="dgm-order-main num">{o.expected ? `Previsão ${dayMonth(o.expected)}` : 'Sem previsão'}</div>
            <small className="num">
              {[o.number ? `Pedido ${o.number}` : null, o.statusLabel, qtyText(o.qty, unit), o.amountText].filter(Boolean).join(' · ')}
            </small>
          </Link>
        );
      })}
    </div>
  );
}

function ApexNotes({ section }: { section: SectionState<ApexNote[]> }) {
  if (section.state === 'restricted') return <StateNote kind="restricted" title="Restrito">Seu perfil não lê os achados da Apex.</StateNote>;
  if (section.state === 'error') return <StateNote kind="error" title="Os achados da Apex não carregaram">{section.message}</StateNote>;
  if (section.data.length === 0) return <StateNote kind="empty" title="Nenhum achado aberto da Apex para este material." />;
  return (
    <ul className="dgm-steps dgs-notes" data-testid="dg-supply-apex">
      {section.data.map((n) => (
        <li key={n.signalId} className="dgm-step dgs-tile" data-sev={n.severity} data-stale={n.stale ? 'true' : undefined}>
          <i aria-hidden><Radar size={17} /></i>
          <div>
            <small>{n.lead}</small>
            <b>{n.title}</b>
            {n.rationale && <p title={n.rationale}>{n.rationale}</p>}
            {n.evidence.length > 0 && (
              <ul className="dgm-evidence">
                {n.evidence.slice(0, 3).map((e, i) => <li key={i} title={e.source ?? undefined}><span>{e.label}</span><strong className="num">{e.value}</strong></li>)}
              </ul>
            )}
            {n.stale && <p className="dgm-stale">A leitura ao vivo já não mostra este problema — o achado segue aberto.</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}
