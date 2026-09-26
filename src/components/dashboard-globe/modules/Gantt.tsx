'use client';

import { useMemo, type CSSProperties } from 'react';
import { TriangleAlert } from 'lucide-react';
import { HudSignal } from '@/components/hud/HudSignal';
import type { SitePlanData } from '@/lib/dashboard/types';
import {
  dayMonth, dayNumber, flagSides, gapSpan, ganttLinkPaths, ganttRows, ganttScale, pillSide, type GanttRowView,
} from './model';
import { useElementSize } from './shared';

const pct = (x: number) => `${(Math.round(x * 100000) / 1000).toFixed(3)}%`;

/**
 * O CRONOGRAMA na gramática do protótipo (gantt.js): escala de meses e dias
 * sobre `plan.window`; trilho = tom a 18 %, borda a 50 %, preenchimento a
 * 88 % (o executado, ancorado à esquerda); barra em risco tracejada em âmbar;
 * crítica com a linha INTEIRA acesa em âmbar (anel + lavagem — sem trilho
 * lateral) e o sinal "CRÍTICA" (HudSignal inline); "Necessário até" (âmbar) e
 * "Hoje" (teal tracejado) como linhas verticais com bandeira; o intervalo
 * hoje → necessidade hachurado; marcos em losango; dependências com seta.
 * Linhas fora de foco caem para 73,6 %. Clicar numa linha a põe em foco.
 */
export function Gantt({ plan, today, focusId, onSelect, title }: {
  plan: SitePlanData; today: string; focusId: string | null; onSelect: (id: string) => void; title: string;
}) {
  const focus = plan.activities.find((a) => a.id === focusId) ?? null;
  const needBy = focus?.needBy ?? null;
  const scale = useMemo(
    () => ganttScale({ window: plan.window, activities: plan.activities, today, include: [needBy] }),
    [plan.window, plan.activities, today, needBy],
  );
  const rows = useMemo(() => ganttRows(plan.activities, scale), [plan.activities, scale]);
  const [plotRef, size] = useElementSize<HTMLDivElement>();
  const rowH = rows.length > 0 ? size.h / rows.length : 0;
  const paths = useMemo(() => ganttLinkPaths(plan.links, rows, { w: size.w, rowH }, focusId), [plan.links, rows, size.w, rowH, focusId]);

  const todayX = scale.at(dayNumber(today));
  const needX = needBy ? scale.at(dayNumber(needBy)) : null;
  const gap = focus?.atRisk ? gapSpan(scale, today, needBy) : null;
  const todayLabel = `Hoje · ${dayMonth(today)}`;
  const needLabel = `Necessário até ${dayMonth(needBy)}`;
  const sides = flagSides({ todayX, needX, w: size.w, todayLabel, needLabel });

  return (
    <div className="dgm-gantt-in">
      <header className="dgm-gantt-head">
        <div>
          <div className="dgm-gantt-eyebrow"><b>Projeto</b> · Cronograma</div>
          <div className="dgm-gantt-title"><em>{title}</em></div>
        </div>
        <div className="dgm-gantt-legend" aria-hidden>
          <span data-k="done"><i />Concluída</span>
          <span data-k="run"><i />Em andamento</span>
          <span data-k="plan"><i />Planejada</span>
          <span data-k="warn"><i />Em risco</span>
        </div>
      </header>

      <div className="dgm-gantt-cal" aria-hidden>
        <div className="dgm-gantt-axis">
          {scale.months.map((m) => <span key={m.key} className="dgm-gantt-month" style={{ left: pct(m.x) }}>{m.label}</span>)}
          {scale.ticks.map((t) => <span key={t.key} className="dgm-gantt-tick" style={{ left: pct(t.x) }}>{t.label}</span>)}
          {needX !== null && (
            <span className="dgm-gantt-need-top" style={{ left: pct(needX) }} data-side={sides.need}>
              <span className="dgm-gantt-need-flag" data-testid="dg-gantt-need">{needLabel}</span>
            </span>
          )}
          {todayX !== null && (
            <span className="dgm-gantt-today-top" style={{ left: pct(todayX) }} data-side={sides.today}>
              <span className="dgm-gantt-today-flag" data-testid="dg-gantt-today">{todayLabel}</span>
            </span>
          )}
        </div>
      </div>

      <div className="dgm-gantt-body">
        <div className="dgm-gantt-rows" role="group" aria-label="Atividades do cronograma">
          <div className="dgm-gantt-under" aria-hidden>
            {scale.months.map((m) => <i key={m.key} className="dgm-gantt-rule" style={{ left: pct(m.x) }} />)}
          </div>

          {rows.map((r) => (
            <Row key={r.id} r={r} focused={r.id === focusId} dim={focusId !== null && r.id !== focusId}
              gap={r.id === focusId ? gap : null} onSelect={onSelect} />
          ))}

          <div className="dgm-gantt-over" ref={plotRef} aria-hidden>
            {needX !== null && <i className="dgm-gantt-need" style={{ left: pct(needX) }} />}
            {todayX !== null && <i className="dgm-gantt-today" style={{ left: pct(todayX) }} />}
            {size.w > 0 && rowH > 0 && paths.length > 0 && (
              <svg className="dgm-gantt-links" width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`}>
                <defs>
                  <marker id="dgm-garrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M1,1 L9,5 L1,9 Z" />
                  </marker>
                </defs>
                {paths.map((p) => (
                  <path key={p.key} d={p.d} className="dgm-gantt-link" data-dim={focusId !== null && !p.toFocus ? 'true' : undefined}
                    markerEnd="url(#dgm-garrow)" />
                ))}
              </svg>
            )}
          </div>

          {/* As marcas das linhas (Crítica / Vencida / Bloqueada) numa camada ACIMA das linhas "Hoje" /
              "Necessário até" e das setas — dentro da linha elas ficariam por baixo (cada linha é um
              contexto de empilhamento). Uma faixa por linha, na mesma altura; o nome acessível da
              marca já está no botão da linha. */}
          {rows.some((r) => r.pill) && (
            <div className="dgm-gantt-flags" aria-hidden data-testid="dg-gantt-flags">
              {rows.map((r) => {
                const style = pillPlacement(r, size.w);
                return (
                  <div key={r.id} className="dgm-gantt-flag-row" data-dim={focusId !== null && r.id !== focusId ? 'true' : undefined}>
                    {r.pill && style && (
                      <span className="dgm-gantt-pill" data-kind={r.pill.kind} style={style}>
                        {/* o HudSignal não recebe `style`: o encaixe posicionado é quem vai para a trilha */}
                        <HudSignal variant="inline" size="sm" tone={r.pill.kind === 'overdue' ? 'danger' : 'warning'} label={r.pill.label}
                          icon={<TriangleAlert strokeWidth={2.4} aria-hidden />} />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Onde a marca da linha encosta na barra (depois, antes ou dentro do fim) — `null` sem barra nem marco. */
function pillPlacement(r: GanttRowView, trackW: number): CSSProperties | null {
  const end = r.bar?.x1 ?? r.diamond;
  const start = r.bar?.x0 ?? r.diamond;
  if (!r.pill || end === null || start === null) return null;
  const side = pillSide(start, end, trackW, r.pill.label);
  return side === 'after' ? { left: `calc(${pct(end)} + 14 * var(--g))` }
    : side === 'before' ? { right: `calc(${pct(1 - start)} + 14 * var(--g))` }
      : { right: `calc(${pct(1 - end)} + 8 * var(--g))` };
}

function Row({ r, focused, dim, gap, onSelect }: {
  r: GanttRowView; focused: boolean; dim: boolean; gap: { x0: number; x1: number } | null; onSelect: (id: string) => void;
}) {
  const label = [r.title, r.pctText === '—' ? 'avanço não informado' : `${r.pctText} concluído`, r.span, r.pill?.label, r.atRisk ? 'em risco' : null]
    .filter(Boolean).join(' · ');
  return (
    <div className="dgm-gantt-row" data-focus={focused ? 'true' : undefined} data-dim={dim ? 'true' : undefined}
      data-crit={r.critical ? 'true' : undefined} data-summary={r.summary ? 'true' : undefined} data-testid="dg-gantt-row">
      <div className="dgm-gantt-label" style={{ paddingLeft: `calc(52 * var(--g) + ${r.level} * 14 * var(--g))` }}>
        <span className="dgm-gantt-name">{r.title}</span>
        <span className="dgm-gantt-pct num" data-tone={r.tone}>{r.pctText}</span>
      </div>
      <div className="dgm-gantt-track">
        {gap && <i className="dgm-gantt-gap" style={{ left: pct(gap.x0), width: pct(gap.x1 - gap.x0) }} />}
        {r.bar && (
          <span className="dgm-gantt-bar" data-tone={r.tone} style={{ left: pct(r.bar.x0), width: pct(r.bar.x1 - r.bar.x0) }}>
            <i className="dgm-gantt-fill" style={{ width: `${r.pct ?? 0}%` }} />
          </span>
        )}
        {r.diamond !== null && <i className="dgm-gantt-ms" data-tone={r.tone} style={{ left: pct(r.diamond) }} />}
      </div>
      <button type="button" className="dgm-gantt-hit" aria-pressed={focused} aria-label={label} title={label} onClick={() => onSelect(r.id)} />
    </div>
  );
}
