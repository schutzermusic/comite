'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  Calendar, CalendarClock, ChevronRight, CircleCheck, CircleDashed, ClipboardList, Construction, FileText, Handshake,
  HardHat, Package, Radar, TriangleAlert, Wrench,
} from 'lucide-react';
import { useResource } from '@/components/ax';
import type { ActivityNeed, GanttActivity, SectionState, SitePlanData, SitePlanResponse } from '@/lib/dashboard/types';
import type { ModuleProps } from '../contract';
import { Gantt } from './Gantt';
import { dayMonth, focusActivity, needTone, percentOf, qtyText, spanLabel } from './model';
import { Eyebrow, ModulePanel, SkeletonLines, StateNote, siteApi, usePublishLayer } from './shared';
import './modules.css';

type PlanOk = Extract<SitePlanResponse, { ok: true }>;

/**
 * PLANEJAR — o cronograma do local (Gantt, embaixo à esquerda) e o que a
 * atividade em foco exige (painel "Atividade", à direita). A câmera é o
 * preset do local: nada no mapa (`onMapLayer(null)`).
 */
export function PlanModule({ projectId, siteName, today, enter, onMapLayer, onNavigate, onExplain }: ModuleProps) {
  const res = useResource<PlanOk>(siteApi(projectId, 'plan'));
  usePublishLayer(onMapLayer, null);
  const [picked, setPicked] = useState<string | null>(null);

  const payload = res.data;
  const day = payload?.today ?? today;
  const plan = payload?.plan;
  const data = plan?.state === 'ok' ? plan.data : null;
  const focus = data ? focusActivity(data, picked) : null;
  const title = payload?.project.name ?? siteName;

  let body: ReactNode;
  if (!payload) {
    body = res.state === 'loading'
      ? <GanttSkeleton title={title} />
      : <PanelNote><StateNote kind="error" title="O cronograma não carregou" onRetry={res.refresh}>{res.message ?? 'O servidor não respondeu. Tente de novo em instantes.'}</StateNote></PanelNote>;
  } else if (plan?.state === 'restricted') {
    body = <PanelNote><StateNote kind="restricted" title="Restrito">Seu perfil não lê o cronograma deste projeto.</StateNote></PanelNote>;
  } else if (plan?.state === 'error') {
    body = <PanelNote><StateNote kind="error" title="O cronograma não carregou" onRetry={res.refresh}>{plan.message}</StateNote></PanelNote>;
  } else if (!data || data.activities.length === 0) {
    body = <PanelNote><StateNote kind="empty" title="Projeto sem cronograma registrado">Quando o cronograma for importado ou cadastrado, as atividades aparecem aqui.</StateNote></PanelNote>;
  } else {
    body = <Gantt plan={data} today={day} focusId={focus?.id ?? null} onSelect={setPicked} title={title} />;
  }

  return (
    <div className="dgm dgm-plan" data-testid="dg-plan">
      <ModulePanel enter={enter} className="dgm-gantt" label="Cronograma do projeto" testId="dg-plan-gantt">
        {body}
        {data?.truncated && <p className="dgm-foot">Leitura parcial do cronograma: nem todas as atividades aparecem aqui.</p>}
      </ModulePanel>

      {(res.state === 'loading' && !payload) && (
        <ModulePanel enter={enter} className="dgm-act" label="Atividade">
          <Eyebrow icon={<Calendar size={15} />}>Atividade</Eyebrow>
          <SkeletonLines lines={5} />
        </ModulePanel>
      )}
      {data && focus && (
        <ModulePanel enter={enter} className="dgm-act" label="Atividade em foco" testId="dg-plan-activity" tone={focus.critical ? 'warn' : undefined}>
          <ActivityPanel activity={focus} needs={data.needsByActivity?.[focus.id]} today={day} onNavigate={onNavigate} onExplain={onExplain} />
        </ModulePanel>
      )}
    </div>
  );
}

function PanelNote({ children }: { children: ReactNode }) {
  return <div className="dgm-gantt-note">{children}</div>;
}

function GanttSkeleton({ title }: { title: string }) {
  return (
    <div className="dgm-gantt-in">
      <header className="dgm-gantt-head">
        <div>
          <div className="dgm-gantt-eyebrow"><b>Projeto</b> · Cronograma</div>
          <div className="dgm-gantt-title"><em>{title}</em></div>
        </div>
      </header>
      <div className="dgm-gantt-note"><SkeletonLines lines={6} label="Carregando o cronograma…" /></div>
    </div>
  );
}

const NEED_ICON: Record<string, ReactNode> = {
  MATERIAL: <Package size={18} strokeWidth={1.8} />,
  EQUIPMENT: <Construction size={18} strokeWidth={1.8} />,
  WORKFORCE: <HardHat size={18} strokeWidth={1.8} />,
  DOCUMENT: <FileText size={18} strokeWidth={1.8} />,
  CUSTOMER_DEPENDENCY: <Handshake size={18} strokeWidth={1.8} />,
  SERVICE: <Wrench size={18} strokeWidth={1.8} />,
};

/**
 * "ATIVIDADE" (o painel direito do Planejar): janela, avanço, a data de
 * necessidade e cada necessidade com o estado da cobertura viva. Atividade em
 * risco → "Resolver no Supply Chain ›".
 */
function ActivityPanel({ activity: a, needs, today, onNavigate, onExplain }: {
  activity: GanttActivity; needs: SectionState<ActivityNeed[]> | undefined; today: string;
  onNavigate: ModuleProps['onNavigate']; onExplain: ModuleProps['onExplain'];
}) {
  const p = percentOf(a.percent);
  const flags = [a.overdue && 'Vencida', a.blocked && 'Bloqueada', a.atRisk && 'Necessidade em risco'].filter(Boolean) as string[];
  return (
    <>
      <Eyebrow icon={a.critical ? <TriangleAlert size={15} /> : <Calendar size={15} />} tone={a.critical ? 'warn' : undefined}>
        {a.critical ? 'Atividade crítica' : a.isMilestone ? 'Marco' : 'Atividade'}
      </Eyebrow>
      <h3 className="dgm-title">{a.title}</h3>
      <p className="dgm-sub num">
        {spanLabel(a.start, a.finish)} · {p === null ? 'avanço não informado' : `${Math.round(p)}% concluído`}
        {a.statusLabel ? ` · ${a.statusLabel}` : ''}
      </p>
      {flags.length > 0 && <p className="dgm-flags">{flags.map((f) => <span key={f}>{f}</span>)}</p>}
      {a.needBy && (
        <p className="dgm-need-by"><CalendarClock size={16} aria-hidden />Necessário até <b className="num">{dayMonth(a.needBy)}</b></p>
      )}

      <NeedList needs={needs} today={today} />

      <div className="dgm-actions">
        {a.atRisk && (
          <button type="button" className="dgm-link" onClick={() => onNavigate('supply')} data-testid="dg-plan-resolve">
            <Radar size={15} aria-hidden />Resolver no Supply Chain<ChevronRight size={15} strokeWidth={2.2} aria-hidden />
          </button>
        )}
        <Link className="dgm-link dgm-link-quiet" href={a.href}>
          <Calendar size={15} aria-hidden />Abrir no cronograma<ChevronRight size={15} strokeWidth={2.2} aria-hidden />
        </Link>
        {a.atRisk && (
          <button type="button" className="dgm-textbtn" onClick={() => onExplain(`act:${a.id}`)}>Entender</button>
        )}
      </div>
    </>
  );
}

function NeedList({ needs, today }: { needs: SectionState<ActivityNeed[]> | undefined; today: string }) {
  if (!needs) return <StateNote kind="empty" title="Nenhuma necessidade registrada para esta atividade." />;
  if (needs.state === 'restricted') return <StateNote kind="restricted" title="Restrito">Seu perfil não lê as necessidades desta atividade.</StateNote>;
  if (needs.state === 'error') return <StateNote kind="error" title="As necessidades não carregaram">{needs.message}</StateNote>;
  if (needs.data.length === 0) return <StateNote kind="empty" title="Nenhuma necessidade registrada para esta atividade." />;
  return (
    <ul className="dgm-needs" aria-label="Necessidades da atividade">
      {needs.data.map((n) => {
        const tone = needTone(n, today);
        const q = qtyText(n.qty, n.unit);
        return (
          <li key={n.id} className="dgm-need" data-tone={tone} data-testid="dg-plan-need">
            <i aria-hidden>{NEED_ICON[n.type] ?? <ClipboardList size={18} strokeWidth={1.8} />}</i>
            {q ? <b className="num">{q}</b> : <b className="dgm-need-type">{n.typeLabel}</b>}
            <span title={n.title}>{n.title}</span>
            <em>
              {tone === 'warn' || tone === 'partial' || tone === 'late' ? <TriangleAlert size={14} strokeWidth={2.2} aria-hidden />
                : tone === 'ok' ? <CircleCheck size={14} strokeWidth={2.2} aria-hidden /> : <CircleDashed size={14} strokeWidth={2.2} aria-hidden />}
              {n.statusLabel}
            </em>
          </li>
        );
      })}
    </ul>
  );
}
