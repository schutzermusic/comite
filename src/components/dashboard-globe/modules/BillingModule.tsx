'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  BadgeCheck, Ban, CalendarCheck, CalendarClock, Check, ChevronRight, CircleDashed, Clock3, FileText, Landmark, Lock,
  Receipt, TriangleAlert, X,
} from 'lucide-react';
import { useResource } from '@/components/ax';
import type { ChainLink, EventogramRow, ExplainResponse, SiteBillingData, SiteBillingResponse } from '@/lib/dashboard/types';
import type { ModuleProps } from '../contract';
import { STEP_STATE_LABEL, billingRef, eventContext, eventTone, stepState, type StepState } from './model';
import { Eyebrow, ModulePanel, SkeletonLines, StateNote, siteApi, usePublishLayer } from './shared';
import './modules.css';

type BillingOk = Extract<SiteBillingResponse, { ok: true }>;
type ExplainOk = Extract<ExplainResponse, { ok: true }>;

const CONTRACTS_BILLING = '/contratos?view=faturamento';

/**
 * FATURAMENTO — o eventograma do(s) contrato(s) vinculado(s) ao projeto (à
 * esquerda) e a cadeia do evento em foco (à direita), lida do "Entender"
 * (`bill:<id>`) e desenhada como o stepper do protótipo. Nada é faturado
 * aqui: "Abrir em Contratos ›". Nada no mapa.
 */
export function BillingModule({ projectId, enter, onMapLayer, onExplain }: ModuleProps) {
  const res = useResource<BillingOk>(siteApi(projectId, 'billing'));
  usePublishLayer(onMapLayer, null);
  const [picked, setPicked] = useState<string | null>(null);

  const payload = res.data;
  const billing = payload?.billing;
  const data = billing?.state === 'ok' ? billing.data : null;
  const selectedId = data
    ? (picked && data.rows.some((r) => r.billingEventId === picked) ? picked : data.focus ?? data.rows[0]?.billingEventId ?? null)
    : null;
  const row = data?.rows.find((r) => r.billingEventId === selectedId) ?? null;
  const ref = data ? billingRef(data, selectedId) : null;
  const loading = !payload && res.state === 'loading';

  let left: ReactNode;
  if (loading) {
    left = <><Eyebrow icon={<CalendarCheck size={15} />}>Eventograma</Eyebrow><SkeletonLines lines={7} label="Carregando o eventograma…" /></>;
  } else if (!payload) {
    left = <StateNote kind="error" title="O faturamento não carregou" onRetry={res.refresh}>{res.message ?? 'O servidor não respondeu. Tente de novo em instantes.'}</StateNote>;
  } else if (billing?.state === 'restricted') {
    left = <><Eyebrow icon={<CalendarCheck size={15} />}>Eventograma</Eyebrow><StateNote kind="restricted" title="Restrito">Seu perfil não lê o faturamento dos contratos deste projeto.</StateNote></>;
  } else if (billing?.state === 'error') {
    left = <><Eyebrow icon={<CalendarCheck size={15} />}>Eventograma</Eyebrow><StateNote kind="error" title="O eventograma não carregou" onRetry={res.refresh}>{billing.message}</StateNote></>;
  } else if (data) {
    left = <Eventogram data={data} selectedId={selectedId} onSelect={setPicked} />;
  }

  return (
    <div className="dgm dgm-billing" data-testid="dg-billing">
      <ModulePanel enter={enter} className="dgm-eg" label="Eventograma" testId="dg-billing-eventogram">
        {left}
      </ModulePanel>
      {row && (
        <ModulePanel enter={enter} className="dgm-bill" label="Cadeia do evento" testId="dg-billing-chain">
          <EventPanel row={row} reference={ref} onExplain={onExplain} />
        </ModulePanel>
      )}
    </div>
  );
}

/* ── ESQUERDA: o eventograma ───────────────────────────────────────────── */

function Eventogram({ data, selectedId, onSelect }: { data: SiteBillingData; selectedId: string | null; onSelect: (id: string) => void }) {
  const labels = data.contracts.map((c) => c.label).filter(Boolean);
  const eyebrow = labels.length === 0 ? 'Eventograma'
    : labels.length === 1 ? `Eventograma · ${labels[0]}` : `Eventograma · ${labels.length.toLocaleString('pt-BR')} contratos`;
  if (data.contracts.length === 0) {
    return (
      <>
        <Eyebrow icon={<CalendarCheck size={15} />}>Eventograma</Eyebrow>
        <StateNote kind="empty" title="Projeto sem contrato vinculado — o eventograma nasce do contrato" testId="dg-billing-empty">
          Quando um contrato for vinculado ao projeto em Contratos, os eventos de faturamento aparecem aqui.
        </StateNote>
        <Link className="dgm-link dgm-link-quiet" href={CONTRACTS_BILLING}>Abrir em Contratos<ChevronRight size={15} strokeWidth={2.2} aria-hidden /></Link>
      </>
    );
  }
  const n = data.rows.length;
  return (
    <>
      <Eyebrow icon={<CalendarCheck size={15} />}>{eyebrow}</Eyebrow>
      <h3 className="dgm-title num">{data.total ?? (labels.length === 1 ? labels[0] : 'Direito contratual')}</h3>
      <p className="dgm-sub">
        Direito contratual · {n === 1 ? '1 evento' : `${n.toLocaleString('pt-BR')} eventos`}
        {!data.total && n > 0 ? ' · valor total restrito ou não informado' : ''}
      </p>
      {labels.length > 1 && <p className="dgm-foot">{labels.join(' · ')}</p>}
      {n === 0 ? (
        <StateNote kind="empty" title="Nenhum evento de faturamento nos contratos vinculados." />
      ) : (
        <div className="dgm-evs" role="group" aria-label="Eventos de faturamento">
          {data.rows.map((r) => {
            const tone = eventTone(r.state);
            const ctx = eventContext(r);
            const on = r.billingEventId === selectedId;
            return (
              <button key={r.billingEventId} type="button" aria-pressed={on} className="dgm-ev" data-on={on ? 'true' : undefined}
                data-tone={tone} onClick={() => onSelect(r.billingEventId)} data-testid="dg-billing-event">
                <div><b>{r.title}</b>{ctx && <small>{ctx}</small>}</div>
                <span className="num" title={r.amount ? undefined : 'Valor restrito ao seu perfil ou não informado'}>{r.amount ?? '—'}</span>
                <em data-tone={tone}>{r.stateLabel}</em>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ── DIREITA: o evento em foco e a sua cadeia ──────────────────────────── */

function EventPanel({ row, reference, onExplain }: { row: EventogramRow; reference: string | null; onExplain: ModuleProps['onExplain'] }) {
  return (
    <>
      <Eyebrow icon={<Receipt size={15} />}>Evento de faturamento</Eyebrow>
      <h3 className="dgm-title">{row.title}</h3>
      <div className="dgm-bill-v">
        <small>Direito contratual</small>
        {row.amount ? <b className="num">{row.amount}</b> : <span>Valor restrito ao seu perfil ou não informado</span>}
      </div>
      {reference ? <Chain reference={reference} key={reference} /> : (
        <StateNote kind="restricted" title="Cadeia restrita">Seu perfil não lê a cadeia deste evento (medição → faturamento → NF → recebível).</StateNote>
      )}
      <div className="dgm-actions">
        <Link className="dgm-link" href={row.href || CONTRACTS_BILLING} data-testid="dg-billing-open">
          <Receipt size={15} aria-hidden />Abrir em Contratos<ChevronRight size={15} strokeWidth={2.2} aria-hidden />
        </Link>
        {reference && <button type="button" className="dgm-textbtn" onClick={() => onExplain(reference)}>Ver evidência</button>}
      </div>
    </>
  );
}

const STAGE_ICON: Record<string, ReactNode> = {
  'Medição': <BadgeCheck size={14} strokeWidth={2.2} />,
  'Faturamento': <CalendarCheck size={14} strokeWidth={2.2} />,
  'NF': <FileText size={14} strokeWidth={2.2} />,
  'Recebível': <CalendarClock size={14} strokeWidth={2.2} />,
  'Caixa': <Landmark size={14} strokeWidth={2.2} />,
};

function stepIcon(state: StepState, stage: string): ReactNode {
  switch (state) {
    case 'done': return <Check size={14} strokeWidth={2.4} />;
    case 'wait': return <Clock3 size={14} strokeWidth={2.2} />;
    case 'attention': return <TriangleAlert size={14} strokeWidth={2.2} />;
    case 'danger': return <X size={14} strokeWidth={2.4} />;
    case 'restricted': return <Lock size={13} strokeWidth={2.2} />;
    case 'none': return <Ban size={13} strokeWidth={2.2} />;
    default: return STAGE_ICON[stage] ?? <CircleDashed size={14} strokeWidth={2.2} />;
  }
}

/** A cadeia do evento (explain `bill:`): cada elo com o seu estado — Restrito, "ainda não nasceu", "sem vínculo" — nunca inventado. */
function Chain({ reference }: { reference: string }) {
  const res = useResource<ExplainOk>(`/api/dashboard/explain?ref=${encodeURIComponent(reference)}`);
  const data = res.data;
  if (!data) {
    return res.state === 'loading'
      ? <SkeletonLines lines={4} label="Carregando a cadeia…" />
      : <StateNote kind="error" title="A cadeia do evento não carregou" onRetry={res.refresh}>{res.message ?? 'Tente de novo em instantes.'}</StateNote>;
  }
  if (data.chain.length === 0) return <StateNote kind="empty" title="Sem elos registrados para este evento." />;
  return (
    <>
      <ol className="dgm-chain" aria-label="Da medição ao caixa" data-testid="dg-billing-steps">
        {data.chain.map((link, i) => <Step key={`${link.stage}-${i}`} link={link} />)}
      </ol>
      {data.relation && <p className="dgm-foot">{data.relation}</p>}
    </>
  );
}

function Step({ link }: { link: ChainLink }) {
  const st = stepState(link);
  const body = (
    <>
      <i aria-hidden>{stepIcon(st, link.stage)}</i>
      <div>
        <b>{link.stage}</b>
        {link.detail && <small title={link.detail}>{link.detail}</small>}
      </div>
      <span>{st === 'restricted' ? 'Restrito' : link.label}</span>
      <span className="sr-only-ax"> — {STEP_STATE_LABEL[st]}</span>
    </>
  );
  return (
    <li className="dgm-cs" data-state={st} data-testid="dg-billing-step">
      {link.href ? <Link href={link.href} className="dgm-cs-in">{body}</Link> : <div className="dgm-cs-in">{body}</div>}
    </li>
  );
}
