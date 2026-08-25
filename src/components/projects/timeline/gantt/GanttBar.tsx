'use client';

/**
 * Barras do Gantt — fase, tarefa, marco — mais os trilhos de execução real e
 * de escorregamento de previsão.
 *
 * ─── Por que o modelo de cor mudou ─────────────────────────────────────────
 * A versão anterior pintava o progresso com `bg-white/30` sobre um tom opaco.
 * No dark mode isso clareia e lê; no LIGHT mode branco-sobre-claro é
 * praticamente invisível — a barra parecia sempre vazia. O modelo agora é
 * track/fill derivado do MESMO tom via color-mix, então o contraste é
 * simétrico nos dois temas:
 *
 *   track  = tom a 18%   (o planejado)
 *   borda  = tom a 45%
 *   fill   = tom a 88%   (o executado, ancorado à esquerda)
 *
 * Nenhum hex literal: tudo sai de --ig-accent/success/warning/danger, que já
 * trocam de valor por tema.
 */

import React from 'react';
import { Ban, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ganttBar, ganttX, type GanttScale } from '@/lib/projects/timeline-analytics';
import type { DelayStatus, TimelineItem } from '@/lib/types/project-timeline';
import { ROW_H } from './gantt-constants';

export type BarTone = DelayStatus | 'completed';

const TONE_VAR: Record<BarTone, string> = {
  on_track: 'var(--ig-accent)',
  at_risk: 'var(--ig-warning)',
  delayed: 'var(--ig-danger)',
  blocked: 'var(--ig-danger)',
  completed: 'var(--ig-success)',
};

/** Estilo base da barra: o tom entra como variável local e o CSS deriva o resto. */
function toneStyle(tone: BarTone): React.CSSProperties {
  return { ['--bar' as string]: TONE_VAR[tone] };
}

const TRACK = 'color-mix(in oklab, var(--bar) 18%, transparent)';
const EDGE = 'color-mix(in oklab, var(--bar) 45%, transparent)';
const FILL = 'color-mix(in oklab, var(--bar) 88%, transparent)';

export interface GanttBarProps {
  item: TimelineItem;
  tone: BarTone;
  scale: GanttScale;
  /** Sessão de apontamento rodando agora nesta atividade. */
  isActiveNow?: boolean;
  showBaseline?: boolean;
  selected?: boolean;
  onSelect: (id: string) => void;
}

export const GanttBar = React.memo(function GanttBar({
  item,
  tone,
  scale,
  isActiveNow = false,
  showBaseline = true,
  selected = false,
  onSelect,
}: GanttBarProps) {
  const geom = ganttBar(scale, item);
  if (!geom) return null;

  const title = `${item.title}${item.plannedStart ? ` · ${item.plannedStart}` : ''}`;

  /* ─── Marco: losango na data de término ─── */
  if (item.isMilestone) {
    const x = ganttX(scale, item.plannedFinish ?? item.plannedStart);
    if (x === null) return null;
    const done = item.status === 'completed';
    return (
      <button
        type="button"
        onClick={() => onSelect(item.id)}
        className="group/bar absolute z-10 flex items-center gap-1.5"
        style={{ left: x - 6, top: ROW_H / 2 - 6 }}
        title={title}
        aria-label={`Marco: ${item.title}`}
      >
        <span
          className={cn(
            'block h-3 w-3 rotate-45 border transition-transform group-hover/bar:scale-125',
            selected && 'ring-2 ring-offset-1 ring-ig-accent ring-offset-transparent',
          )}
          style={{
            ...toneStyle(done ? 'completed' : tone),
            background: FILL,
            borderColor: EDGE,
          }}
        />
      </button>
    );
  }

  /* ─── Fase: bracket no estilo MS Project ─── */
  if (item.isSummary) {
    return (
      <button
        type="button"
        onClick={() => onSelect(item.id)}
        className="absolute z-10"
        style={{ left: geom.left, width: geom.width, top: ROW_H / 2 - 4, height: 10 }}
        title={title}
        aria-label={`Fase: ${item.title}`}
      >
        <span className="absolute inset-x-0 top-0 h-[5px] rounded-sm" style={{ background: 'var(--ig-fg-muted)' }} />
        {/* Pontas para baixo: é o que distingue uma fase de uma tarefa num relance. */}
        <span className="absolute left-0 top-0 h-[10px] w-[2px]" style={{ background: 'var(--ig-fg-muted)' }} />
        <span className="absolute right-0 top-0 h-[10px] w-[2px]" style={{ background: 'var(--ig-fg-muted)' }} />
      </button>
    );
  }

  /* ─── Tarefa ─── */
  const progress = Math.min(100, Math.max(0, item.percentComplete));
  const blocked = tone === 'blocked';
  const atRisk = tone === 'at_risk';
  const completed = tone === 'completed';

  // Escorregamento: só desenha quando a previsão realmente passou do planejado.
  const slip =
    showBaseline && item.forecastFinish && item.plannedFinish && item.forecastFinish > item.plannedFinish
      ? (() => {
          const from = ganttX(scale, item.plannedFinish);
          const to = ganttX(scale, item.forecastFinish);
          return from !== null && to !== null && to > from ? { left: from, width: to - from } : null;
        })()
      : null;

  // Execução real: trilho fino sob a barra planejada, só quando há data real.
  const actual =
    showBaseline && item.actualStart
      ? (() => {
          const from = ganttX(scale, item.actualStart);
          const to = ganttX(scale, item.actualFinish ?? item.actualStart);
          if (from === null || to === null) return null;
          // Término inclusivo (+1 dia), igual a ganttBar.
          const dayPx = 24 * 60 * 60 * 1000 * scale.pxPerMs;
          return { left: from, width: Math.max(to - from + dayPx, 6) };
        })()
      : null;

  return (
    <>
      {slip && (
        <span
          className="absolute z-[9] rounded-r-md"
          style={{
            ...toneStyle('delayed'),
            left: slip.left,
            width: slip.width,
            top: ROW_H / 2 - 6,
            height: 12,
            backgroundImage:
              'repeating-linear-gradient(45deg, color-mix(in oklab, var(--bar) 40%, transparent) 0 4px, transparent 4px 8px)',
            borderRight: `1px solid ${EDGE}`,
          }}
          title={`Previsão: ${item.forecastFinish}`}
        />
      )}

      <button
        type="button"
        onClick={() => onSelect(item.id)}
        className={cn(
          'group/bar absolute z-10 overflow-hidden rounded-md transition-shadow',
          selected && 'ring-2 ring-ig-accent',
          isActiveNow && 'motion-safe:animate-pulse',
        )}
        style={{
          ...toneStyle(tone),
          left: geom.left,
          width: geom.width,
          top: ROW_H / 2 - 8,
          height: 16,
          background: TRACK,
          border: `1px solid ${EDGE}`,
          borderStyle: atRisk ? 'dashed' : 'solid',
          boxShadow: isActiveNow ? '0 0 0 2px color-mix(in oklab, var(--ig-success) 45%, transparent)' : undefined,
        }}
        title={`${title} — ${Math.round(progress)}%`}
        aria-label={`${item.title}, ${Math.round(progress)}% concluído`}
      >
        {/* Progresso: preenchimento à esquerda, mesmo tom, alto contraste. */}
        <span
          className="absolute inset-y-0 left-0 transition-[width] duration-300"
          style={{
            width: `${progress}%`,
            background: blocked
              ? 'repeating-linear-gradient(45deg, color-mix(in oklab, var(--bar) 70%, transparent) 0 3px, transparent 3px 6px)'
              : FILL,
            opacity: completed ? 0.75 : 1,
          }}
        />
        {blocked && (
          <Ban
            className="absolute left-0.5 top-1/2 h-3 w-3 -translate-y-1/2"
            style={{ color: 'var(--ig-danger)' }}
            aria-hidden
          />
        )}
        {completed && geom.width > 28 && (
          <Check
            className="absolute right-0.5 top-1/2 h-3 w-3 -translate-y-1/2"
            style={{ color: 'var(--ig-success)' }}
            aria-hidden
          />
        )}
      </button>

      {actual && (
        <span
          className="absolute z-[11] rounded-full"
          style={{
            ...toneStyle(completed ? 'completed' : tone),
            left: actual.left,
            width: actual.width,
            top: ROW_H / 2 + 9,
            height: 3,
            background: FILL,
          }}
          title={`Execução real: ${item.actualStart}${item.actualFinish ? ` → ${item.actualFinish}` : ' (em curso)'}`}
        />
      )}
    </>
  );
});
