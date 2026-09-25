'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight, CalendarClock, ChevronRight, Package, Radar, ShieldCheck, ShoppingCart } from 'lucide-react';
import { useResource } from '@/components/ax';
import { ConfirmActDialog } from '@/components/decisions/ConfirmActDialog';
import { useDecisionAct } from '@/components/decisions/useDecisionAct';
import { accessNote, amountText, orderedActions, outcomeLine } from '@/components/decisions/view';
import { ACTION_LABEL, kindLabel, parseDecisionKey } from '@/lib/decisions/model';
import type { DecisionAction, DecisionDetail } from '@/lib/decisions/types';
import type {
  ApexNote, InboundOrder, MaterialBalance, SectionState, SiteSupplyData, SiteSupplyResponse, SupplyDecision,
} from '@/lib/dashboard/types';
import type { MapLayer, ModuleProps } from '../contract';
import { balanceRows, coverageSegments, dayMonth, orderTiming, qtyText, supplyMapLayer } from './model';
import { Eyebrow, ModulePanel, SkeletonLines, StateNote, siteApi, usePublishLayer } from './shared';
import '@/components/decisions/decisions.css';
import './modules.css';

type SupplyOk = Extract<SiteSupplyResponse, { ok: true }>;
type DetailOk = DecisionDetail & { ok: true };

/**
 * SUPPLY CHAIN — o material em foco (balanço da cobertura viva, à esquerda)
 * e o que se faz com ele (à direita): o plano da Apex (achados abertos com
 * evidência), os pedidos a caminho e a DECISÃO que está na caixa desta
 * pessoa — aprovada aqui pelo MESMO ato de Decisões. No mapa: arcos de cada
 * posição do item até o canteiro e o enquadramento canteiro + almoxarifados.
 */
export function SupplyModule({ projectId, today, enter, onMapLayer, onExplain, onChanged }: ModuleProps) {
  const res = useResource<SupplyOk>(siteApi(projectId, 'supply'));
  const payload = res.data;
  const supply = payload?.supply;
  const data = supply?.state === 'ok' ? supply.data : null;

  // Identidade estável enquanto o CONTEÚDO da camada não muda: uma releitura igual não refaz o voo.
  const layerJson = useMemo(() => (data ? JSON.stringify(supplyMapLayer(data)) : null), [data]);
  const layer = useMemo(() => (layerJson ? (JSON.parse(layerJson) as MapLayer) : null), [layerJson]);
  usePublishLayer(onMapLayer, layer);

  const day = payload?.today ?? today;
  const loading = !payload && res.state === 'loading';

  let left: ReactNode;
  if (loading) {
    left = <><Eyebrow icon={<Package size={16} />}>Material</Eyebrow><SkeletonLines lines={7} label="Carregando o material…" /></>;
  } else if (!payload) {
    left = <StateNote kind="error" title="O Supply Chain não carregou" onRetry={res.refresh}>{res.message ?? 'O servidor não respondeu. Tente de novo em instantes.'}</StateNote>;
  } else if (supply?.state === 'restricted') {
    left = <><Eyebrow icon={<Package size={16} />}>Material</Eyebrow><StateNote kind="restricted" title="Restrito">Seu perfil não lê a cobertura de materiais deste projeto.</StateNote></>;
  } else if (supply?.state === 'error') {
    left = <><Eyebrow icon={<Package size={16} />}>Material</Eyebrow><StateNote kind="error" title="A cobertura de materiais não carregou" onRetry={res.refresh}>{supply.message}</StateNote></>;
  } else if (data) {
    left = <MaterialPanel data={data} today={day} onExplain={onExplain} />;
  }

  return (
    <div className="dgm dgm-supply" data-testid="dg-supply">
      <ModulePanel enter={enter} className="dgm-mat" label="Material em foco" testId="dg-supply-material">
        {left}
      </ModulePanel>
      {(loading || (data && data.focus)) && (
        <ModulePanel enter={enter} className="dgm-plan-panel" label="Plano do Apex, pedidos e decisão" testId="dg-supply-plan">
          {loading ? (
            <><Eyebrow icon={<Radar size={15} />}>Plano do Apex</Eyebrow><SkeletonLines lines={6} /></>
          ) : data ? (
            <PlanPanel data={data} today={day} onChanged={onChanged} />
          ) : null}
        </ModulePanel>
      )}
    </div>
  );
}

/* ── ESQUERDA: o balanço do material em foco ───────────────────────────── */

function MaterialPanel({ data, today, onExplain }: { data: SiteSupplyData; today: string; onExplain: ModuleProps['onExplain'] }) {
  const m = data.focus;
  if (!m) {
    return (
      <>
        <Eyebrow icon={<Package size={16} />}>Material</Eyebrow>
        {data.materials.length === 0
          ? <StateNote kind="empty" title="Nenhuma falta de material neste projeto">A cobertura viva não mostra requisito com falta{data.truncated ? ' na parte lida' : ''}.</StateNote>
          : <StateNote kind="empty" title="Nenhum material em falta">{`${data.materials.length.toLocaleString('pt-BR')} ${data.materials.length === 1 ? 'material acompanhado' : 'materiais acompanhados'} pela cobertura viva.`}</StateNote>}
      </>
    );
  }
  const others = data.materials.filter((x) => x.requirementId !== m.requirementId && x.shortage > 0).length;
  return (
    <>
      <Eyebrow icon={<Package size={16} />}>{m.activity ? `Material · ${m.activity.title}` : 'Material'}</Eyebrow>
      <h3 className="dgm-title">{m.title}</h3>
      <p className="dgm-sub">{specLine(m)}</p>
      {m.needBy && (
        <p className="dgm-need-by"><CalendarClock size={16} aria-hidden />Necessário até <b className="num">{dayMonth(m.needBy)}</b>
          {m.needBy < today && <small className="dgm-late"> · data já passou</small>}
        </p>
      )}
      <dl className="dgm-eq" data-testid="dg-supply-balance">
        {balanceRows(m).map((r) => (
          <div key={r.key} data-tone={r.tone}>
            <dt>{r.label}</dt>
            <dd className="num">{r.text}</dd>
          </div>
        ))}
      </dl>
      <CoverageBar m={m} />
      <div className="dgm-actions">
        <button type="button" className="dgm-textbtn" onClick={() => onExplain(`mat:${m.requirementId}`)}>Entender a falta</button>
        <Link className="dgm-textbtn" href={m.href}>Abrir no Supply<ArrowUpRight size={13} aria-hidden /></Link>
      </div>
      {(others > 0 || data.truncated) && (
        <p className="dgm-foot">
          {others > 0 ? `Mais ${others.toLocaleString('pt-BR')} ${others === 1 ? 'material com falta' : 'materiais com falta'} neste projeto.` : ''}
          {data.truncated ? ' Leitura parcial: há mais requisitos do que os mostrados.' : ''}
        </p>
      )}
    </>
  );
}

function specLine(m: MaterialBalance): string {
  const parts = [m.item?.code, m.item?.description].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Item sem cadastro no Supply';
}

function CoverageBar({ m }: { m: MaterialBalance }) {
  const segs = coverageSegments(m);
  if (segs.length === 0) return null;
  return (
    <div className="dgm-lots" role="img" aria-label={`Cobertura: ${segs.map((s) => s.text).join(', ')}`}>
      {segs.map((s) => <span key={s.key} data-k={s.key} style={{ flexGrow: s.qty }} title={s.text}>{s.text}</span>)}
    </div>
  );
}

/* ── DIREITA: plano do Apex · pedidos · decisão ────────────────────────── */

function PlanPanel({ data, today, onChanged }: { data: SiteSupplyData; today: string; onChanged: () => void }) {
  const needBy = data.focus?.needBy ?? null;
  return (
    <>
      <Eyebrow icon={<Radar size={15} />}>Plano do Apex</Eyebrow>
      <ApexNotes section={data.apex} />

      <Eyebrow icon={<ShoppingCart size={15} />}>Pedidos</Eyebrow>
      <Orders section={data.orders} needBy={needBy} unit={data.focus?.item?.unit ?? null} />

      <Eyebrow icon={<ShieldCheck size={15} />}>Decisão</Eyebrow>
      <Decisions section={data.decisions} today={today} onChanged={onChanged} />
    </>
  );
}

function ApexNotes({ section }: { section: SectionState<ApexNote[]> }) {
  if (section.state === 'restricted') return <StateNote kind="restricted" title="Restrito">Seu perfil não lê os achados da Apex.</StateNote>;
  if (section.state === 'error') return <StateNote kind="error" title="Os achados da Apex não carregaram">{section.message}</StateNote>;
  if (section.data.length === 0) return <StateNote kind="empty" title="Nenhum achado aberto da Apex para este material." />;
  return (
    <ul className="dgm-steps" data-testid="dg-supply-apex">
      {section.data.map((n) => (
        <li key={n.signalId} className="dgm-step" data-sev={n.severity} data-stale={n.stale ? 'true' : undefined}>
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

function Orders({ section, needBy, unit }: { section: SectionState<InboundOrder[]>; needBy: string | null; unit: string | null }) {
  if (section.state === 'restricted') return <StateNote kind="restricted" title="Restrito">Seu perfil não lê os pedidos de compra.</StateNote>;
  if (section.state === 'error') return <StateNote kind="error" title="Os pedidos não carregaram">{section.message}</StateNote>;
  if (section.data.length === 0) return <StateNote kind="empty" title="Nenhum pedido aberto para este material." />;
  return (
    <div className="dgm-orders" data-testid="dg-supply-orders">
      {section.data.map((o) => {
        const t = orderTiming(o, needBy);
        return (
          <Link key={o.poId} href={o.href} className="dgm-order" data-late={t.tone === 'late' ? 'true' : undefined}>
            <div className="dgm-order-head">
              <b>{o.supplier?.name ?? 'Fornecedor não informado'}</b>
              <span className="dgm-chip" data-tone={t.tone === 'late' ? 'danger' : t.tone === 'ok' ? 'ok' : 'neutral'}><i />{t.text}</span>
            </div>
            <div className="dgm-order-main num">{o.expected ? `Previsão ${dayMonth(o.expected)}` : 'Sem previsão'}</div>
            <small className="num">
              {[o.number ? `Pedido ${o.number}` : null, o.statusLabel, qtyText(o.qty, unit), o.amountText]
                .filter(Boolean).join(' · ')}
            </small>
          </Link>
        );
      })}
    </div>
  );
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

/** Uma decisão da caixa desta pessoa: o detalhe vem de GET /api/decisions/[chave]; o ato é o de Decisões. */
function DecisionCard({ decision, today, onChanged }: { decision: SupplyDecision; today: string; onChanged: () => void }) {
  if (!parseDecisionKey(decision.key)) {
    return (
      <div className="dgm-gov" data-testid="dg-supply-decision">
        <StateNote kind="error" title="Endereço da decisão inválido">Abra a decisão pela caixa de Decisões.</StateNote>
        <Link className="dgm-textbtn" href={decision.href}>Abrir em Decisões<ArrowUpRight size={13} aria-hidden /></Link>
      </div>
    );
  }
  return <LoadedDecision decision={decision} today={today} onChanged={onChanged} />;
}

function LoadedDecision({ decision, today, onChanged }: { decision: SupplyDecision; today: string; onChanged: () => void }) {
  const res = useResource<DetailOk>(`/api/decisions/${encodeURIComponent(decision.key)}`);
  const d = res.data;
  // Depois de um desfecho, os atos somem até o detalhe voltar do servidor — sem segundo clique no dado velho.
  const [settledOn, setSettledOn] = useState<DetailOk | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const act = useDecisionAct({ noticeRef, onSettled: () => { setSettledOn(d); onChanged(); } });

  const due = decision.due ? (
    <span className={decision.overdue ? 'dgm-late' : undefined}>Decidir até {dayMonth(decision.due)}{decision.overdue ? ' · vencida' : decision.due === today ? ' · hoje' : ''}</span>
  ) : null;
  const amount = decision.amountRestricted ? 'Restrito' : decision.amountText;

  const head = (
    <div className="dgm-gov-head">
      <small>{decision.kindLabel}</small>
      <b>{decision.title}</b>
      {amount && <strong className="num" data-muted={decision.amountRestricted ? 'true' : undefined}>{amount}</strong>}
      {due && <p className="dgm-gov-due">{due}</p>}
    </div>
  );

  if (!d) {
    return (
      <div className="dgm-gov" data-testid="dg-supply-decision">
        {head}
        {res.state === 'loading'
          ? <SkeletonLines lines={2} label="Carregando a decisão…" />
          : <StateNote kind="error" title="A decisão não carregou" onRetry={res.refresh}>{res.message ?? 'Abra a decisão pela caixa de Decisões.'}</StateNote>}
        <Link className="dgm-textbtn" href={decision.href}>Abrir em Decisões<ArrowUpRight size={13} aria-hidden /></Link>
      </div>
    );
  }

  const r = d.resolved;
  const kind = d.item?.kindLabel ?? kindLabel(r.subjectType);
  const actions: DecisionAction[] = d.canAct && r.open && settledOn !== d ? orderedActions(d.actions) : [];
  const note = accessNote(d);
  const policy = d.why.slice(0, 2);

  return (
    <div className="dgm-gov" data-testid="dg-supply-decision">
      {head}
      {policy.map((f) => (
        <p key={f.label} className="dgm-policy"><ShieldCheck size={15} aria-hidden /><span>{f.label} · <b>{f.value}</b></span></p>
      ))}

      <div className="dgm-live" role="status" aria-live="polite">
        {act.notice && (
          <div ref={noticeRef} tabIndex={-1} className="dgm-notice" data-tone={act.notice.tone} data-testid="dg-supply-decision-notice">
            <strong>{act.notice.title}</strong>
            <p>{act.notice.text}</p>
          </div>
        )}
      </div>

      {!r.open && <p className="dgm-policy"><ShieldCheck size={15} aria-hidden /><span>{outcomeLine(r.status, r.closedBy, r.closedAt)}</span></p>}
      {note && <p className="dgm-foot">{note}</p>}

      {actions.length > 0 && (
        <div className="dgm-gov-actions" role="group" aria-label="Atos desta decisão">
          {actions.map((a) => (
            <button key={a} type="button" data-testid={`dg-decision-act-${a.toLowerCase()}`} data-action={a}
              className={a === 'APPROVE' ? 'dgm-btn dgm-btn-wide' : 'dgm-btn-quiet'}
              onClick={() => act.open(a)}>
              {a === 'APPROVE' ? <><ShieldCheck size={17} strokeWidth={2.2} aria-hidden />{approveLabel(r.subjectType)}</> : ACTION_LABEL[a]}
            </button>
          ))}
        </div>
      )}
      <Link className="dgm-textbtn" href={decision.href}>Ver a decisão completa<ChevronRight size={13} aria-hidden /></Link>

      {act.confirm && (
        <ConfirmActDialog action={act.confirm.action} subjectType={r.subjectType} kind={kind}
          amount={r.amount === null ? 'Sem valor declarado' : amountText(r.amount, r.currency)} title={r.title}
          reasonRequired={d.reasonRequired} reason={act.reason} onReason={act.setReason} busy={act.busy} error={act.error} locked={act.uncertain}
          onConfirm={() => void act.submit(d)} onCancel={act.cancel} onClosedFocus={act.closedFocus} />
      )}
    </div>
  );
}

function approveLabel(subjectType: string): string {
  return subjectType === 'purchase_order' ? 'Aprovar compra' : ACTION_LABEL.APPROVE;
}
