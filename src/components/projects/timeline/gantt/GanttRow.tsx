'use client';

/**
 * Uma linha do Gantt: células fixas do painel esquerdo + a faixa do gráfico.
 *
 * Painel e gráfico vivem na MESMA linha do DOM — é o que faz o hover e a
 * seleção ficarem sincronizados entre os dois lados sem uma linha de JS. As
 * células da esquerda usam `sticky left-0`, resolvendo contra o scroller único
 * do GanttView.
 *
 * Memoizada: em cronogramas grandes o scroll horizontal re-renderiza o pai a
 * cada frame e as linhas não precisam acompanhar.
 */

import React from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Diamond, Flag } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GanttScale } from '@/lib/projects/timeline-analytics';
import type { TimelineNode } from '@/lib/projects/timeline-analytics';
import { formatHours, type ItemExecution } from '@/lib/projects/timeline-execution';
import type { ScheduleSignal } from '@/lib/projects/timeline-intelligence';
import { TIMELINE_STATUS_LABELS, type TimelineItem } from '@/lib/types/project-timeline';
import { SignalChip, type SignalChipTone } from '@/components/ui/signal-chip';
import { GanttBar, type BarTone } from './GanttBar';
import { COL_W, ROW_H, TITLE_MIN_W } from './gantt-constants';
import type { TimelineColumn } from '../timeline-store';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

const STATUS_TONE: Record<string, SignalChipTone> = {
  not_started: 'neutral',
  in_progress: 'info',
  blocked: 'critical',
  delayed: 'critical',
  completed: 'success',
  cancelled: 'neutral',
};

const DOT_COLOR: Record<BarTone, string> = {
  on_track: 'var(--ig-success)',
  at_risk: 'var(--ig-warning)',
  delayed: 'var(--ig-danger)',
  blocked: 'var(--ig-danger)',
  completed: 'var(--ig-success)',
};

/** Iniciais para o avatar: primeira letra do primeiro e do último nome. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function Avatar({ name, url, dashed }: { name: string; url: string | null; dashed?: boolean }) {
  return (
    <span
      className={cn(
        'flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full',
        'bg-ig-panel-hover text-[8px] font-semibold text-ig-fg-muted ring-1',
        // Anel tracejado = apontou horas sem estar na equipe da atividade.
        dashed ? 'ring-dashed ring-ig-warning' : 'ring-ig-border',
      )}
      title={name}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={name} className="h-full w-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}

export interface GanttRowProps {
  node: TimelineNode;
  index: number;
  tone: BarTone;
  scale: GanttScale;
  panelWidth: number;
  columns: Record<TimelineColumn, boolean>;
  execution?: ItemExecution;
  schedule?: ScheduleSignal;
  executionKnown: boolean;
  collapsed: boolean;
  hasChildren: boolean;
  selected: boolean;
  hovered: boolean;
  /** Mantido só para dar contexto hierárquico ao filtro — sem match próprio. */
  dimmed: boolean;
  showBaseline: boolean;
  onSelect: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onHover: (id: string | null) => void;
}

function Cell({ width, className, children }: { width: number; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn('shrink-0 truncate px-1', className)} style={{ width }}>
      {children}
    </span>
  );
}

export const GanttRow = React.memo(function GanttRow({
  node,
  index,
  tone,
  scale,
  panelWidth,
  columns,
  execution,
  schedule,
  executionKnown,
  collapsed,
  hasChildren,
  selected,
  hovered,
  dimmed,
  showBaseline,
  onSelect,
  onToggleCollapse,
  onHover,
}: GanttRowProps) {
  const item: TimelineItem = node.item;
  const responsible = item.assignments?.find((a) => a.role === 'responsible' && !a.removedAt);
  const collaborators = execution?.collaborators ?? [];
  const shown = collaborators.slice(0, 3);
  const extra = collaborators.length - shown.length;

  return (
    <div
      data-timeline-row={item.id}
      role="row"
      onClick={() => onSelect(item.id)}
      onMouseEnter={() => onHover(item.id)}
      onMouseLeave={() => onHover(null)}
      className={cn(
        'absolute left-0 flex cursor-pointer items-stretch border-b border-ig-border-subtle',
        selected ? 'bg-ig-accent-weak' : hovered ? 'bg-ig-panel-hover' : 'bg-transparent',
      )}
      style={{ top: index * ROW_H, height: ROW_H, width: panelWidth + scale.totalWidth }}
    >
      {/* ─── Painel esquerdo, congelado horizontalmente ─── */}
      <div
        className={cn(
          // overflow-hidden é rede de segurança: o painel jamais pode vazar
          // sobre a faixa das barras, mesmo se uma célula crescer.
          'sticky left-0 z-20 flex shrink-0 items-center overflow-hidden border-r border-ig-border text-[11px]',
          selected ? 'bg-ig-accent-weak' : hovered ? 'bg-ig-panel-hover' : 'bg-ig-panel',
          dimmed && 'opacity-55',
        )}
        style={{ width: panelWidth }}
      >
        <Cell width={COL_W.wbs} className="font-mono text-[10px] text-ig-fg-subtle">
          {item.wbsCode ?? ''}
        </Cell>

        <span
          className="flex min-w-0 flex-1 items-center gap-1 px-1"
          style={{ paddingLeft: 4 + node.depth * 14, minWidth: TITLE_MIN_W }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse(item.id);
              }}
              className="shrink-0 rounded text-ig-fg-subtle hover:bg-ig-panel-hover hover:text-ig-fg"
              aria-label={collapsed ? `Expandir ${item.title}` : `Recolher ${item.title}`}
              aria-expanded={!collapsed}
            >
              {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <span className="w-3.5 shrink-0" />
          )}

          {item.isMilestone ? (
            <Diamond className="h-3 w-3 shrink-0 text-ig-accent" aria-hidden />
          ) : item.isSummary ? (
            <Flag className="h-3 w-3 shrink-0 text-ig-fg-muted" aria-hidden />
          ) : null}

          <span
            className={cn(
              'truncate',
              item.isSummary ? 'font-semibold text-ig-fg-strong' : 'text-ig-fg',
              item.status === 'completed' && 'text-ig-fg-muted',
            )}
            title={`${item.title} — ${TIMELINE_STATUS_LABELS[item.status]}`}
          >
            {item.title}
          </span>
        </span>

        {/* % com micro-barra: o número sozinho não dá leitura periférica. */}
        <Cell
          width={COL_W.progress}
          className={cn(
            'text-right tabular-nums',
            execution?.hoursWithoutProgress || schedule?.behindSchedule
              ? 'text-ig-warning'
              : 'text-ig-fg-muted',
          )}
        >
          <span
            title={
              execution?.hoursWithoutProgress
                ? 'Horas apontadas sem progresso registrado'
                : schedule?.expectedProgress != null
                  ? `Esperado hoje: ${schedule.expectedProgress}%`
                  : undefined
            }
          >
            {Math.round(item.percentComplete)}%
          </span>
          <span className="mt-0.5 block h-[2px] w-full overflow-hidden rounded-full bg-ig-border">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${Math.min(100, Math.max(0, item.percentComplete))}%`,
                background: DOT_COLOR[tone],
              }}
            />
          </span>
        </Cell>

        <Cell width={COL_W.start} className="tabular-nums text-ig-fg-muted">{fmtDate(item.plannedStart)}</Cell>
        <Cell width={COL_W.finish} className="tabular-nums text-ig-fg-muted">{fmtDate(item.plannedFinish)}</Cell>

        {columns.responsible && (
          <Cell width={COL_W.responsible}>
            <span className="flex items-center -space-x-1.5">
              {shown.length > 0 ? (
                shown.map((c) => (
                  <Avatar key={c.personId} name={c.name} url={c.avatarUrl} dashed={!c.isAssigned} />
                ))
              ) : responsible ? (
                <Avatar name={responsible.userName ?? '?'} url={responsible.avatarUrl ?? null} />
              ) : (
                <span className="text-ig-fg-disabled">—</span>
              )}
              {extra > 0 && <span className="pl-2 text-[9px] text-ig-fg-muted">+{extra}</span>}
            </span>
          </Cell>
        )}

        {columns.status && (
          <Cell width={COL_W.status}>
            <SignalChip size="xs" tone={STATUS_TONE[item.status] ?? 'neutral'} label={TIMELINE_STATUS_LABELS[item.status]} />
          </Cell>
        )}

        {/* Colunas de execução só existem quando o apontamento é legível. */}
        {executionKnown && columns.plannedHours && (
          <Cell width={COL_W.plannedHours} className="text-right tabular-nums text-ig-fg-muted">
            {formatHours(execution?.plannedHours ?? null)}
          </Cell>
        )}

        {executionKnown && columns.loggedHours && (
          <Cell
            width={COL_W.loggedHours}
            className={cn(
              'text-right tabular-nums',
              execution && execution.variance != null && execution.variance > 0
                ? 'text-ig-warning'
                : 'text-ig-fg',
            )}
          >
            <span
              title={
                execution
                  ? `Aprovadas ${formatHours(execution.approvedHours)} · pendentes ${formatHours(execution.pendingHours)}`
                  : undefined
              }
            >
              {formatHours(execution?.loggedHours ?? null)}
            </span>
          </Cell>
        )}

        {executionKnown && columns.lastActivity && (
          <Cell width={COL_W.lastActivity} className="tabular-nums text-[10px] text-ig-fg-subtle">
            {execution?.lastActivityAt ? fmtDate(execution.lastActivityAt.slice(0, 10)) : '—'}
          </Cell>
        )}

        {/*
          Um sinal por linha, por PRECEDÊNCIA — não uma fileira de bolinhas.
          O que está acontecendo agora vence o que está errado, que vence o
          estado nominal. Empilhar todos os avisos deixaria a coluna ilegível
          e nenhum deles seria notado.
        */}
        <Cell width={COL_W.signal} className="flex items-center justify-center">
          {execution?.isActiveNow ? (
            <span
              className="h-2 w-2 rounded-full motion-safe:animate-pulse"
              style={{ background: 'var(--ig-success)', boxShadow: '0 0 0 3px color-mix(in oklab, var(--ig-success) 25%, transparent)' }}
              title="Apontamento ativo agora"
            />
          ) : execution?.overPlannedEffort ? (
            <AlertTriangle className="h-3 w-3 text-ig-danger" aria-hidden>
              <title>Esforço acima do planejado</title>
            </AlertTriangle>
          ) : execution?.noRecentActivity ? (
            <AlertTriangle
              className="h-3 w-3 text-ig-warning"
              aria-hidden
              // Trabalhou e parou: diferente de nunca ter começado.
            >
              <title>Sem apontamento recente</title>
            </AlertTriangle>
          ) : schedule?.behindSchedule ? (
            <span
              className="h-2 w-2 rotate-45"
              style={{ background: 'var(--ig-warning)' }}
              title="Progresso abaixo do esperado para hoje"
            />
          ) : execution?.workedToday ? (
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: 'var(--ig-info)' }}
              title="Trabalhado hoje"
            />
          ) : executionKnown && execution?.hasNoApontamento && item.status !== 'completed' ? (
            // Dot VAZADO: ausência de apontamento, distinta de um estado ruim.
            <span
              className="h-2 w-2 rounded-full border border-ig-fg-disabled"
              title="Sem apontamento registrado"
            />
          ) : (
            <span className="h-2 w-2 rounded-full" style={{ background: DOT_COLOR[tone] }} title={item.status} />
          )}
        </Cell>
      </div>

      {/* ─── Faixa do gráfico ─── */}
      <div className="relative shrink-0" style={{ width: scale.totalWidth }}>
        <GanttBar
          item={item}
          tone={tone}
          scale={scale}
          isActiveNow={execution?.isActiveNow}
          showBaseline={showBaseline}
          selected={selected}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
});
