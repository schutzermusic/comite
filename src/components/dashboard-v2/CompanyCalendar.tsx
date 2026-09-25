'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { TriangleAlert } from 'lucide-react';
import { EmptyState, Plane, dateShort, daysBetween, relativeDue } from '@/components/ax';
import type { CalendarItem, CalendarModel, SectionState } from '@/lib/dashboard/types';

const TONE: Record<CalendarItem['tone'], string> = {
  danger: 'var(--ax-danger)', warning: 'var(--ax-warning)', accent: 'var(--ax-accent)',
  neutral: 'var(--ig-tone-neutral)', success: 'var(--ax-success)',
};
const MOBILE_ITEMS = 8;
const KIND_LABEL: Record<CalendarItem['kind'], string> = {
  milestone: 'Marco', activity: 'Atividade', need: 'Necessidade de material', delivery: 'Entrega prevista', due: 'Vencimento',
};

type Lane = CalendarModel['lanes'][number];

/** Posição de uma data na régua; `null` para data inválida (nunca NaN no SVG). */
function dayOffset(today: string, date: string, days: number): number | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
  const d = daysBetween(today, date);
  if (!Number.isFinite(d) || d < 0 || d > days) return null;
  return d;
}

/** A faixa não foi lida por inteiro: falhou (`unavailable`) ou carregou só em parte. */
const incompleteLane = (l: Lane) => l.state === 'unavailable' || (l.state === 'ok' && !!l.partial);
const gapText = (l: Lane) => (l.state === 'unavailable' ? 'não carregou' : 'carregou só em parte — o que aparece pode estar incompleto');

/**
 * PRÓXIMOS 30 DIAS — o calendário da empresa, uma faixa por área: marcos e
 * atividades críticas (Operação), necessidades e entregas (Supply), prazos do
 * cliente (Medição), vencimentos (Recebíveis). Faixa que o perfil não lê diz
 * "Restrito"; faixa cuja leitura falhou diz "não carregou" — e o calendário
 * só afirma "nada previsto" quando TODAS as faixas foram lidas por inteiro.
 */
export function CompanyCalendar({ section, today }: { section: SectionState<CalendarModel>; today: string }) {
  // Celular: 8 itens dos próximos 7 dias; "Ver mais" abre os 30 dias inteiros.
  const [expanded, setExpanded] = useState(false);
  const range = expanded ? 30 : 7;
  const model = section.state === 'ok' ? section.data : null;
  const upcoming = useMemo(() => (model?.items ?? [])
    .filter((i) => { const d = dayOffset(today, i.date, range); return d !== null; })
    .sort((a, b) => a.date.localeCompare(b.date)), [model, today, range]);

  if (section.state === 'restricted') return null;
  if (section.state === 'error' || !model) {
    return (
      <Plane title="Próximos 30 dias" testId="dashboard-calendar">
        <EmptyState compact title="Não carregou">{section.state === 'error' ? section.message : ''}</EmptyState>
      </Plane>
    );
  }
  const lanes = model.lanes;
  if (lanes.length === 0) return null;
  const gaps = lanes.filter(incompleteLane);
  const any = model.items.length > 0;
  const allReadEmpty = !any && lanes.every((l) => l.state === 'ok' && !l.partial);
  // O "nada" do celular só vale para o que foi lido.
  const scope = gaps.length > 0 ? ' nas faixas que carregaram' : lanes.some((l) => l.state === 'restricted') ? ' nas áreas que você lê' : '';
  return (
    <Plane title="Próximos 30 dias" subtitle="O calendário da empresa, por área — marcos, entregas, prazos do cliente e vencimentos"
      testId="dashboard-calendar" action={<span className="ax-desktop-only"><Legend /></span>}>
      {allReadEmpty ? (
        <EmptyState compact title="Nada previsto nos próximos 30 dias">
          O calendário se preenche com o cronograma canônico, as necessidades de material, as entregas dos pedidos, os prazos do
          cliente nas medições e os vencimentos dos recebíveis.
        </EmptyState>
      ) : (
        <>
          <div className="ax-desktop-only"><Timeline model={model} today={today} lanes={lanes} /></div>
          <div className="ax-mobile-only dv2-cal-list">
            {gaps.length > 0 && (
              <ul className="dv2-cal-gaps" role="status">
                {gaps.map((l) => (
                  <li key={l.id}><TriangleAlert size={13} aria-hidden /><span><strong>{l.label}:</strong> {gapText(l)}</span></li>
                ))}
              </ul>
            )}
            {upcoming.length === 0 ? (
              <p className="ax-subtle" style={{ margin: 0 }}>Nada nos próximos {range} dias{scope}.</p>
            ) : (
              <ol>
                {upcoming.slice(0, expanded ? 60 : MOBILE_ITEMS).map((i) => {
                  const due = relativeDue(i.date, today);
                  const body = (
                    <>
                      <i style={{ background: TONE[i.tone] }} aria-hidden />
                      <span className="dv2-cal-title">{i.title}</span>
                      <span className="dv2-cal-meta">{KIND_LABEL[i.kind]}{i.project ? ` · ${i.project}` : ''}</span>
                      <span className="dv2-cal-when">{due.text}</span>
                    </>
                  );
                  return <li key={i.id}>{i.href ? <Link href={i.href}>{body}</Link> : <div>{body}</div>}</li>;
                })}
              </ol>
            )}
            {!expanded && (upcoming.length > MOBILE_ITEMS || model.items.length > upcoming.length) && (
              <button type="button" className="ax-btn ghost sm" onClick={() => setExpanded(true)}>Ver os 30 dias</button>
            )}
          </div>
        </>
      )}
    </Plane>
  );
}

function Timeline({ model, today, lanes }: { model: CalendarModel; today: string; lanes: Lane[] }) {
  const W = 1000; const left = 132; const right = 16; const top = 26; const laneH = 42;
  const days = model.days > 0 ? model.days : 30;
  const H = top + Math.max(1, lanes.length) * laneH + 6;
  const x = (d: number) => left + (d / days) * (W - left - right);
  const ticks = [0, 7, 14, 21, 28].filter((t) => t <= days);
  const tickDate = (n: number) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  return (
    <div className="dv2-cal">
      {/* `group`, não `img`: os marcadores são links e precisam do nome e do papel expostos. */}
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`Próximos ${days} dias por área`}>
        <rect className="band" x={x(0)} y={top - 8} width={x(Math.min(7, days)) - x(0)} height={H - top + 4} rx="4" aria-hidden />
        {ticks.map((t) => (
          <g key={t} aria-hidden>
            <line className="axis" x1={x(t)} x2={x(t)} y1={top - 8} y2={H - 4} strokeDasharray={t === 0 ? undefined : '2 4'} />
            <text className="tick" x={x(t)} y={13} textAnchor={t === 0 ? 'start' : 'middle'}>{t === 0 ? 'hoje' : dateShort(tickDate(t))}</text>
          </g>
        ))}
        {lanes.map((lane, li) => {
          const y = top + li * laneH + laneH / 2;
          // Só o que cabe na régua (data válida, dentro dos N dias): é o que a faixa desenha e anuncia.
          const items = model.items.filter((i) => i.lane === lane.id && dayOffset(today, i.date, days) !== null);
          const seen = new Map<number, number>();
          const incomplete = incompleteLane(lane);
          // Faixa vazia diz por quê; faixa incompleta com itens leva "parcial" sob o nome.
          const emptyNote = lane.state === 'restricted' ? 'Restrito ao seu perfil'
            : lane.state === 'unavailable' ? 'não carregou — esta faixa não foi lida'
              : lane.partial ? 'parte não carregou — nada no que foi lido' : 'nada previsto';
          return (
            <g key={lane.id} role="group" aria-label={laneAria(lane, items.length)}>
              <text className="lane-label" x={0} y={y + 4} aria-hidden>{lane.label}</text>
              <line className={lane.state === 'unavailable' ? 'lane off' : 'lane'} x1={left} x2={W - right} y1={y} y2={y} aria-hidden />
              {items.length === 0 && (
                <text className={incomplete ? 'lane-note warn' : 'lane-note'} x={left + 12} y={y - 7} aria-hidden>{emptyNote}</text>
              )}
              {items.length > 0 && incomplete && <text className="lane-note warn" x={0} y={y + 17} aria-hidden>parcial</text>}
              {items.map((it) => {
                const d = dayOffset(today, it.date, days);
                if (d === null) return null;
                // Marcadores da mesma data na mesma faixa se afastam um do outro verticalmente.
                const n = seen.get(d) ?? 0; seen.set(d, n + 1);
                const cx = x(d); const cy = y + (n === 0 ? 0 : n % 2 === 1 ? -9 : 9);
                const fill = TONE[it.tone];
                const shape = it.kind === 'milestone'
                  ? <rect x={cx - 6} y={cy - 6} width={12} height={12} transform={`rotate(45 ${cx} ${cy})`} fill={fill} rx="1.5" />
                  : it.kind === 'need' ? <path d={`M${cx} ${cy - 7} L${cx + 6.5} ${cy + 5} L${cx - 6.5} ${cy + 5} Z`} fill={fill} />
                    : it.kind === 'delivery' ? <rect x={cx - 5} y={cy - 5} width={10} height={10} fill={fill} rx="2" />
                      : it.kind === 'due' ? <circle cx={cx} cy={cy} r={5.5} fill="none" stroke={fill} strokeWidth={2.4} />
                        : <circle cx={cx} cy={cy} r={5.5} fill={fill} />;
                const label = `${dateShort(it.date)} — ${KIND_LABEL[it.kind]}: ${it.title}${it.project ? ` · ${it.project}` : ''}`;
                const node = <g className="mark"><title>{label}</title>{shape}</g>;
                return it.href
                  ? <a key={it.id} href={it.href} aria-label={label}>{node}</a>
                  : <Fragment key={it.id}>{node}</Fragment>;
              })}
            </g>
          );
        })}
        <line className="today" x1={x(0)} x2={x(0)} y1={top - 8} y2={H - 4} aria-hidden />
      </svg>
    </div>
  );
}

function laneAria(lane: Lane, n: number): string {
  if (lane.state === 'restricted') return `${lane.label}: restrito ao seu perfil`;
  const count = n === 1 ? '1 item' : `${n} itens`;
  if (lane.state === 'unavailable') return n === 0 ? `${lane.label}: não carregou` : `${lane.label}: ${count} — parte da faixa não carregou`;
  if (lane.partial) return `${lane.label}: ${count} — parte da faixa não carregou`;
  return `${lane.label}: ${n === 0 ? 'nada previsto' : count}`;
}

function Legend() {
  return (
    <div className="ax-legend" aria-hidden>
      <span><svg width="12" height="12"><rect x="2" y="2" width="8" height="8" transform="rotate(45 6 6)" fill="var(--ax-accent)" /></svg>Marco</span>
      <span><svg width="12" height="12"><circle cx="6" cy="6" r="4.5" fill="var(--ax-accent)" /></svg>Atividade</span>
      <span><svg width="12" height="12"><path d="M6 1 L11 10 L1 10 Z" fill="var(--ax-accent)" /></svg>Necessidade</span>
      <span><svg width="12" height="12"><rect x="2" y="2" width="8" height="8" rx="1.5" fill="var(--ax-info)" /></svg>Entrega</span>
      <span><svg width="12" height="12"><circle cx="6" cy="6" r="4" fill="none" stroke="var(--ax-accent)" strokeWidth="2" /></svg>Vencimento</span>
      <span><svg width="12" height="12"><circle cx="6" cy="6" r="4.5" fill="var(--ax-danger)" /></svg>Crítico</span>
    </div>
  );
}
