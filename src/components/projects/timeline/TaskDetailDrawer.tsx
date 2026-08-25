'use client';

/**
 * Timeline item detail drawer — edit dates/status/%/responsável/equipe,
 * delay workflow trigger, comments, links and raw import audit values.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Activity, AlertTriangle, Clock, Gauge, History, Link2, MessageSquare, Send, Trash2, Users, Workflow } from 'lucide-react';
import { HudBadge, HudButton, HudDrawer, HudSignal, HudStatusPill, useHudToast } from '@/components/hud';
import { usePermissions } from '@/hooks/use-permissions';
import { useCurrentUser } from '@/hooks/use-current-user';
import { listOrgMembers } from '@/lib/services/agenda';
import type { OrgMember } from '@/lib/types/agenda';
import {
  addComment,
  assignResponsible,
  createDependency,
  deleteDependency,
  listComments,
  listDelayLogs,
  setExecutionTeam,
  submitDelayReport,
  updateTimelineItem,
} from '@/lib/services/project-timeline';
import { deriveDelayStatus, descendantIdsOf, wouldCreateCycle } from '@/lib/projects/timeline-analytics';
import { daysToLag, lagToDays } from '@/lib/projects/gantt-dependencies';
import {
  formatHours,
  formatVariance,
  STALE_ACTIVITY_DAYS,
  type ItemExecution,
} from '@/lib/projects/timeline-execution';
import { formatDays, formatPct, type ScheduleSignal } from '@/lib/projects/timeline-intelligence';
import { composeTimelineEvents, formatEventTime } from '@/lib/projects/timeline-events';
import type { ProjectWorkSession, TimeEntry } from '@/lib/types/people';
import {
  DELAY_REASON_LABELS,
  DELAY_STATUS_LABELS,
  DEPENDENCY_TYPE_LABELS,
  DEPENDENCY_TYPE_SHORT,
  TIMELINE_STATUS_LABELS,
  TIMELINE_TYPE_LABELS,
  type DelayLog,
  type DelayReportInput,
  type DependencyType,
  type TimelineComment,
  type TimelineDependency,
  type TimelineItem,
  type TimelineItemStatus,
} from '@/lib/types/project-timeline';
import { DelayReasonDialog } from './DelayReasonDialog';

/** Uma casa decimal, sem zeros à toa: 8 → "8", 7.5 → "7.5". */
function round1(n: number): string {
  return String(Math.round(n * 10) / 10);
}

const PRIORITY_LABELS: Record<TimelineItem['priority'], string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  critical: 'Crítica',
};

const inputCls =
  'w-full rounded-lg border border-ig-border bg-transparent px-2.5 py-1.5 text-sm text-ig-fg outline-none focus:border-ig-border-focus disabled:opacity-50';

/** Cor do marcador de cada evento na linha do tempo. */
const EVENT_DOT: Record<string, string> = {
  live: 'var(--ig-success)',
  success: 'var(--ig-success)',
  info: 'var(--ig-info)',
  accent: 'var(--ig-accent)',
  warning: 'var(--ig-warning)',
  danger: 'var(--ig-danger)',
  critical: 'var(--ig-danger)',
  neutral: 'var(--ig-fg-subtle)',
};

const STATUS_PILL: Record<TimelineItemStatus, 'active' | 'completed' | 'warning' | 'error' | 'neutral'> = {
  not_started: 'neutral',
  in_progress: 'active',
  blocked: 'error',
  delayed: 'error',
  completed: 'completed',
  cancelled: 'neutral',
};

export interface TaskDetailDrawerProps {
  item: TimelineItem | null;
  /** Cronograma completo — base do editor de predecessoras. */
  items: TimelineItem[];
  dependencies: TimelineDependency[];
  /** Execução da atividade selecionada. Ausente quando não há permissão. */
  execution?: ItemExecution;
  /** Sinal de prazo — independe de permissão de timesheet. */
  schedule?: ScheduleSignal;
  executionKnown: boolean;
  entries: TimeEntry[];
  sessions: ProjectWorkSession[];
  projectName: string;
  projectManagerUserId?: string | null;
  onClose: () => void;
  /** Called with the updated item after any persisted change. */
  onChanged: (item: TimelineItem) => void;
  onDepsChanged: () => void | Promise<void>;
}

export function TaskDetailDrawer({
  item,
  items,
  dependencies,
  execution,
  schedule,
  executionKnown,
  entries,
  sessions,
  projectName,
  projectManagerUserId,
  onClose,
  onChanged,
  onDepsChanged,
}: TaskDetailDrawerProps) {
  const { hasPermission } = usePermissions();
  const { user } = useCurrentUser();
  const { notify } = useHudToast();

  const [members, setMembers] = useState<OrgMember[]>([]);
  const [comments, setComments] = useState<TimelineComment[]>([]);
  const [delayLogs, setDelayLogs] = useState<DelayLog[]>([]);
  const [commentText, setCommentText] = useState('');
  const [saving, setSaving] = useState(false);
  const [pendingDelayStatus, setPendingDelayStatus] = useState<'delayed' | 'blocked' | null>(null);
  const [notifyOnAssign, setNotifyOnAssign] = useState(true);
  const [createAgendaTask, setCreateAgendaTask] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const [newDepId, setNewDepId] = useState('');
  const [newDepType, setNewDepType] = useState<DependencyType>('FS');
  const [newDepLag, setNewDepLag] = useState('');

  const isResponsible = Boolean(item && user && item.responsibleUserId === user.id);
  const canEdit = hasPermission('projects.timeline.edit') || isResponsible;
  const canAssign = hasPermission('projects.timeline.assign') || hasPermission('projects.timeline.edit');

  /* ─── Dependências desta atividade ─── */
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const predecessors = useMemo(
    () =>
      dependencies
        .filter((d) => d.successorId === item?.id)
        .map((dep) => ({ dep, other: itemById.get(dep.predecessorId) })),
    [dependencies, item?.id, itemById],
  );

  const successors = useMemo(
    () =>
      dependencies
        .filter((d) => d.predecessorId === item?.id)
        .map((dep) => ({ dep, other: itemById.get(dep.successorId) })),
    [dependencies, item?.id, itemById],
  );

  /**
   * Candidatas a predecessora: exclui a própria atividade, toda a sua
   * subárvore (uma fase não pode depender do que está dentro dela), o que já
   * está vinculado e o que foi desativado por importação.
   */
  const candidates = useMemo(() => {
    if (!item) return [];
    const blocked = descendantIdsOf(items, item.id);
    blocked.add(item.id);
    for (const { dep } of predecessors) blocked.add(dep.predecessorId);
    return items
      .filter((i) => i.isActive && !i.deletedAt && !blocked.has(i.id))
      .sort((a, b) => a.rowOrder - b.rowOrder);
  }, [item, items, predecessors]);

  const handleAddDependency = useCallback(async () => {
    if (!item || !newDepId) return;
    // O banco só barra auto-referência (032); o ciclo é responsabilidade do
    // cliente — sem esta guarda o roteador de setas entraria em laço.
    if (wouldCreateCycle(dependencies, newDepId, item.id)) {
      notify('Essa ligação criaria um ciclo no cronograma.', { variant: 'error' });
      return;
    }
    setSaving(true);
    try {
      const days = newDepLag.trim() ? Number(newDepLag.replace(',', '.')) : 0;
      await createDependency({
        projectId: item.projectId,
        predecessorId: newDepId,
        successorId: item.id,
        type: newDepType,
        lagMinutes: Number.isFinite(days) ? daysToLag(days) : 0,
      });
      setNewDepId('');
      setNewDepLag('');
      await onDepsChanged();
    } catch (e) {
      notify('Falha ao vincular dependência', {
        description: e instanceof Error ? e.message : undefined,
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  }, [item, newDepId, newDepType, newDepLag, dependencies, notify, onDepsChanged]);

  /**
   * Feed da atividade. Comentários e delay logs já estão carregados aqui, e
   * lançamentos/sessões vêm do pai — nenhuma query nova é disparada.
   */
  const now = useMemo(() => new Date(), []);
  const activityEvents = useMemo(() => {
    if (!item) return [];
    return composeTimelineEvents({
      items: [item],
      entries,
      sessions,
      delayLogs,
      comments,
      itemId: item.id,
      limit: 40,
    });
  }, [item, entries, sessions, delayLogs, comments]);

  const handleRemoveDependency = useCallback(async (id: string) => {
    setSaving(true);
    try {
      await deleteDependency(id);
      await onDepsChanged();
    } catch (e) {
      notify('Falha ao remover dependência', {
        description: e instanceof Error ? e.message : undefined,
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  }, [notify, onDepsChanged]);

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    Promise.all([
      listOrgMembers().catch(() => [] as OrgMember[]),
      listComments(item.id).catch(() => [] as TimelineComment[]),
      listDelayLogs(item.id).catch(() => [] as DelayLog[]),
    ]).then(([m, c, d]) => {
      if (cancelled) return;
      setMembers(m);
      setComments(c);
      setDelayLogs(d);
    });
    return () => {
      cancelled = true;
    };
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const team = useMemo(
    () => (item?.assignments ?? []).filter((a) => a.role === 'executor' && !a.removedAt),
    [item],
  );

  const patch = useCallback(
    async (changes: Parameters<typeof updateTimelineItem>[1]) => {
      if (!item) return;
      setSaving(true);
      try {
        const updated = await updateTimelineItem(item.id, changes);
        onChanged({ ...updated, assignments: item.assignments });
      } catch (e) {
        notify('Falha ao salvar', { description: e instanceof Error ? e.message : undefined, variant: 'error' });
      } finally {
        setSaving(false);
      }
    },
    [item, onChanged, notify],
  );

  const handleStatusChange = (status: TimelineItemStatus) => {
    if (!item) return;
    if (status === 'delayed' || status === 'blocked') {
      // Spec §6: delay/block requires the mandatory report first.
      setPendingDelayStatus(status);
      return;
    }
    void patch({ status });
  };

  const handleDelaySubmit = async (report: DelayReportInput) => {
    if (!item) return;
    const updated = await submitDelayReport(item, report, {
      projectName,
      projectManagerUserId,
    });
    onChanged({ ...updated, assignments: item.assignments });
    setPendingDelayStatus(null);
    setDelayLogs(await listDelayLogs(item.id).catch(() => delayLogs));
    notify('Atraso registrado', { description: 'Responsável e gestor notificados.', variant: 'warning' });
  };

  const handleResponsible = async (userId: string) => {
    if (!item) return;
    setSaving(true);
    try {
      const updated = await assignResponsible(item, userId || null, {
        notify: notifyOnAssign,
        createAgendaTask,
        projectName,
      });
      onChanged(updated);
      notify('Responsável atualizado', { variant: 'success' });
    } catch (e) {
      notify('Falha ao atribuir', { description: e instanceof Error ? e.message : undefined, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleTeamToggle = async (userId: string) => {
    if (!item) return;
    const currentIds = team.map((a) => a.userId);
    const next = currentIds.includes(userId) ? currentIds.filter((id) => id !== userId) : [...currentIds, userId];
    setSaving(true);
    try {
      await setExecutionTeam(item, next, { notify: notifyOnAssign, projectName });
      // Refresh assignments locally (optimistic-lite).
      const updatedAssignments = next.map(
        (uid) =>
          item.assignments?.find((a) => a.userId === uid && a.role === 'executor' && !a.removedAt) ?? {
            id: `tmp-${uid}`,
            organizationId: item.organizationId,
            projectId: item.projectId,
            timelineItemId: item.id,
            userId: uid,
            role: 'executor' as const,
            assignedBy: user?.id ?? null,
            assignedAt: new Date(),
            removedAt: null,
            userName: members.find((m) => m.userId === uid)?.fullName ?? null,
          },
      );
      const responsible = (item.assignments ?? []).filter((a) => a.role !== 'executor');
      onChanged({ ...item, assignments: [...responsible, ...updatedAssignments] });
    } catch (e) {
      notify('Falha ao atualizar equipe', { description: e instanceof Error ? e.message : undefined, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleComment = async () => {
    if (!item || !commentText.trim()) return;
    try {
      const created = await addComment(item, commentText);
      setComments((prev) => [...prev, created]);
      setCommentText('');
    } catch (e) {
      notify('Falha ao comentar', { description: e instanceof Error ? e.message : undefined, variant: 'error' });
    }
  };

  if (!item) return null;
  const derived = deriveDelayStatus(item, new Date());

  return (
    <HudDrawer
      isOpen={Boolean(item)}
      onClose={onClose}
      title={item.title}
      subtitle={`${item.wbsCode ? `EDT ${item.wbsCode} · ` : ''}${TIMELINE_TYPE_LABELS[item.type]}`}
      width="560px"
    >
      <div className="space-y-5 pb-6">
        {/* Status + derived delay banner */}
        <div className="flex flex-wrap items-center gap-2">
          <HudStatusPill variant={STATUS_PILL[item.status]} size="sm">
            {TIMELINE_STATUS_LABELS[item.status]}
          </HudStatusPill>
          {derived !== 'on_track' && item.status !== 'completed' && (
            <HudBadge variant={derived === 'at_risk' ? 'warning' : 'danger'} size="sm">
              {DELAY_STATUS_LABELS[derived]}
            </HudBadge>
          )}
          {item.isMilestone && <HudBadge variant="primary" size="sm">Marco</HudBadge>}
          {item.isSummary && <HudBadge variant="neutral" size="sm">Fase (resumo)</HudBadge>}
        </div>

        {canEdit && (
          <div className="space-y-3">
            {/* Título editável: o import do MS Project traz nomes truncados
                pelo layout do PDF, e até agora não havia como corrigi-los. */}
            <div>
              <label className="mb-1 block text-xs text-ig-fg-muted">Nome da atividade</label>
              <input
                className={inputCls}
                defaultValue={item.title}
                disabled={saving}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== item.title) void patch({ title: v });
                }}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-ig-fg-muted">Status</label>
                <select
                  className={inputCls}
                  value={item.status}
                  disabled={saving}
                  onChange={(e) => handleStatusChange(e.target.value as TimelineItemStatus)}
                >
                  {Object.entries(TIMELINE_STATUS_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-ig-fg-muted">Prioridade</label>
                <select
                  className={inputCls}
                  value={item.priority}
                  disabled={saving}
                  onChange={(e) => void patch({ priority: e.target.value as TimelineItem['priority'] })}
                >
                  {Object.entries(PRIORITY_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Dates */}
        <section>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ig-fg-muted">
            <Clock className="h-3.5 w-3.5" /> Datas
          </h4>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ['Início planejado', 'plannedStart', item.plannedStart],
                ['Término planejado', 'plannedFinish', item.plannedFinish],
                ['Início real', 'actualStart', item.actualStart],
                ['Término real', 'actualFinish', item.actualFinish],
                ['Término previsto', 'forecastFinish', item.forecastFinish],
              ] as const
            ).map(([label, field, value]) => (
              <div key={field}>
                <label className="mb-1 block text-xs text-ig-fg-muted">{label}</label>
                <input
                  type="date"
                  className={inputCls}
                  value={value ?? ''}
                  disabled={!canEdit || saving}
                  onChange={(e) => void patch({ [field]: e.target.value || null })}
                />
              </div>
            ))}
            <div>
              <label className="mb-1 block text-xs text-ig-fg-muted">% concluída</label>
              <input
                type="number"
                min={0}
                max={100}
                className={inputCls}
                defaultValue={Math.round(item.percentComplete)}
                disabled={!canEdit || saving}
                onBlur={(e) => {
                  const v = Math.min(100, Math.max(0, Number(e.target.value)));
                  if (v !== item.percentComplete) void patch({ percentComplete: v });
                }}
              />
            </div>

            {/* Horas planejadas — a ÚNICA fonte de `plannedHours`. Sem este campo
                editável, `duration_minutes` só chegava pelo import do MS Project
                e todo indicador de esforço ficava "—" para sempre. */}
            <div>
              <label htmlFor="timeline-planned-hours" className="mb-1 block text-xs text-ig-fg-muted">
                Horas planejadas
              </label>
              <input
                id="timeline-planned-hours"
                aria-label="Horas planejadas"
                type="number"
                min={0}
                step="0.5"
                className={inputCls}
                placeholder="—"
                defaultValue={item.durationMinutes == null ? '' : round1(item.durationMinutes / 60)}
                disabled={!canEdit || saving}
                onBlur={(e) => {
                  const raw = e.target.value.trim();
                  // Campo vazio volta a ser NULL (desconhecido), nunca 0.
                  const minutes = raw === '' ? null : Math.max(0, Math.round(Number(raw.replace(',', '.')) * 60));
                  if (minutes !== null && !Number.isFinite(minutes)) return;
                  if (minutes !== item.durationMinutes) void patch({ durationMinutes: minutes });
                }}
              />
            </div>
          </div>

          {item.isSummary && (
            <p className="mt-2 text-[11px] text-ig-fg-subtle">
              Em fases, as horas planejadas exibidas no cronograma são a soma das atividades filhas.
            </p>
          )}
        </section>

        {/* Prazo — não depende do timesheet, então aparece para todo mundo */}
        {schedule && (
          <section>
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ig-fg-muted">
              <Gauge className="h-3.5 w-3.5" /> Prazo
            </h4>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Esperado', value: schedule.expectedProgress == null ? '—' : `${schedule.expectedProgress}%` },
                { label: 'Realizado', value: `${Math.round(item.percentComplete)}%` },
                { label: 'Desvio', value: formatPct(schedule.progressVariancePct) },
              ].map((cell) => (
                <div key={cell.label} className="rounded-lg border border-ig-border p-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-ig-fg-subtle">{cell.label}</p>
                  <p className="tabular-nums text-sm text-ig-fg">{cell.value}</p>
                </div>
              ))}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-ig-fg-subtle">
              <span>
                Variação de prazo:{' '}
                <span
                  className={
                    (schedule.scheduleVarianceDays ?? 0) > 0 ? 'text-ig-danger' : 'text-ig-fg'
                  }
                >
                  {formatDays(schedule.scheduleVarianceDays)}
                </span>
              </span>
              {schedule.effectiveFinish && schedule.effectiveFinish !== item.plannedFinish && (
                <span>· Término projetado: {schedule.effectiveFinish.split('-').reverse().join('/')}</span>
              )}
            </div>

            {schedule.behindSchedule && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ig-warning">
                <AlertTriangle className="h-3.5 w-3.5" /> Progresso abaixo do esperado para a data de hoje.
              </p>
            )}
            {schedule.expectedProgress == null && (
              <p className="mt-2 text-[11px] text-ig-fg-subtle">
                Sem início e término planejados, o progresso esperado não é calculável.
              </p>
            )}
          </section>
        )}

        {/* Execução — planejado × apontado, vindo do timesheet do colaborador */}
        {executionKnown && (
          <section>
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ig-fg-muted">
              <Activity className="h-3.5 w-3.5" /> Execução
            </h4>

            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Planejado', value: formatHours(execution?.plannedHours ?? null) },
                { label: 'Apontado', value: formatHours(execution?.loggedHours ?? null) },
                { label: 'Variação', value: formatVariance(execution?.variance ?? null) },
              ].map((cell) => (
                <div key={cell.label} className="rounded-lg border border-ig-border p-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-ig-fg-subtle">{cell.label}</p>
                  <p className="tabular-nums text-sm text-ig-fg">{cell.value}</p>
                </div>
              ))}
            </div>

            {execution && (execution.pendingHours ?? 0) > 0 && (
              <p className="mt-2 text-[11px] text-ig-fg-subtle">
                Aprovadas {formatHours(execution.approvedHours)} · aguardando aprovação{' '}
                {formatHours(execution.pendingHours)}
              </p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {execution?.isActiveNow && <HudSignal size="sm" tone="live" label="Ativo agora" pulse />}
              {execution?.workedToday && !execution.isActiveNow && (
                <HudSignal size="sm" tone="info" label="Trabalhado hoje" />
              )}
              {execution?.lastActivityAt && (
                <span className="text-[11px] text-ig-fg-subtle">
                  Último apontamento: {new Date(execution.lastActivityAt).toLocaleDateString('pt-BR')}
                </span>
              )}
            </div>

            {/* Ausências relevantes — ditas, não escondidas atrás de um zero. */}
            {execution?.hasNoApontamento && item.status !== 'completed' && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ig-warning">
                <AlertTriangle className="h-3.5 w-3.5" /> Nenhum apontamento registrado nesta atividade.
              </p>
            )}
            {execution?.hoursWithoutProgress && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ig-warning">
                <AlertTriangle className="h-3.5 w-3.5" /> Há horas apontadas, mas o progresso segue em 0%.
              </p>
            )}
            {execution?.noRecentActivity && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ig-warning">
                <AlertTriangle className="h-3.5 w-3.5" /> Sem apontamento há mais de {STALE_ACTIVITY_DAYS} dias,
                com a atividade ainda aberta.
              </p>
            )}
            {execution?.overPlannedEffort && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ig-warning">
                <AlertTriangle className="h-3.5 w-3.5" /> Esforço acima do planejado
                ({formatVariance(execution.variance)}).
              </p>
            )}
            {execution?.projectedEffortHours != null && (
              <p className="mt-2 text-[11px] text-ig-fg-subtle">
                Projeção pelo ritmo atual: {formatHours(execution.projectedEffortHours)}
                {execution.projectedOverrunHours != null &&
                  ` · ${formatVariance(execution.projectedOverrunHours)} vs planejado`}
              </p>
            )}
            {execution?.plannedHours == null && (
              <p className="mt-2 text-[11px] text-ig-fg-subtle">
                Sem duração cadastrada: as horas planejadas ficam ausentes (não são estimadas).
              </p>
            )}

            {(execution?.collaborators.length ?? 0) > 0 && (
              <ul className="mt-3 space-y-1.5">
                {execution!.collaborators.map((c) => (
                  <li key={c.personId} className="flex items-center justify-between gap-2 rounded-lg border border-ig-border/70 px-2.5 py-1.5 text-xs">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-ig-fg">{c.name}</span>
                      {c.isActiveNow && <HudSignal size="sm" tone="live" label="agora" pulse />}
                      {!c.isAssigned && (
                        <span title="Apontou horas sem estar na equipe da atividade">
                          <HudBadge variant="warning" size="sm">fora da equipe</HudBadge>
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums text-ig-fg-muted">{formatHours(c.minutes / 60)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Dependências */}
        <section>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ig-fg-muted">
            <Workflow className="h-3.5 w-3.5" /> Dependências
          </h4>

          {predecessors.length === 0 && successors.length === 0 && (
            <p className="text-xs text-ig-fg-subtle">Nenhuma dependência vinculada.</p>
          )}

          {predecessors.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide text-ig-fg-subtle">Predecessoras</p>
              {predecessors.map(({ dep, other }) => (
                <div key={dep.id} className="flex items-center gap-2 rounded-lg border border-ig-border/70 px-2.5 py-1.5 text-xs">
                  <HudBadge variant="neutral" size="sm">{DEPENDENCY_TYPE_SHORT[dep.type]}</HudBadge>
                  <span className="min-w-0 flex-1 truncate text-ig-fg" title={other?.title}>
                    {other?.wbsCode ? `${other.wbsCode} · ` : ''}{other?.title ?? 'Atividade removida'}
                  </span>
                  {dep.lagMinutes !== 0 && (
                    <span className="shrink-0 tabular-nums text-ig-fg-muted">{lagToDays(dep.lagMinutes)}d</span>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => void handleRemoveDependency(dep.id)}
                      className="shrink-0 text-ig-fg-subtle hover:text-ig-danger"
                      aria-label="Remover dependência"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {successors.length > 0 && (
            <div className="mt-2 space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide text-ig-fg-subtle">Sucessoras</p>
              {successors.map(({ dep, other }) => (
                <div key={dep.id} className="flex items-center gap-2 rounded-lg border border-ig-border/70 px-2.5 py-1.5 text-xs">
                  <HudBadge variant="neutral" size="sm">{DEPENDENCY_TYPE_SHORT[dep.type]}</HudBadge>
                  <span className="min-w-0 flex-1 truncate text-ig-fg-muted" title={other?.title}>
                    {other?.wbsCode ? `${other.wbsCode} · ` : ''}{other?.title ?? 'Atividade removida'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {canEdit && (
            <div className="mt-3 space-y-2 rounded-lg border border-ig-border p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-ig-fg-subtle">Vincular predecessora</p>
              <select
                className={inputCls}
                value={newDepId}
                onChange={(e) => setNewDepId(e.target.value)}
                disabled={saving}
              >
                <option value="">Selecionar atividade…</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.wbsCode ? `${c.wbsCode} · ` : ''}{c.title}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <select
                  className={inputCls}
                  value={newDepType}
                  onChange={(e) => setNewDepType(e.target.value as DependencyType)}
                  disabled={saving}
                >
                  {(Object.keys(DEPENDENCY_TYPE_LABELS) as DependencyType[]).map((t) => (
                    <option key={t} value={t}>{DEPENDENCY_TYPE_LABELS[t]}</option>
                  ))}
                </select>
                <input
                  className={inputCls}
                  type="number"
                  step="0.5"
                  value={newDepLag}
                  onChange={(e) => setNewDepLag(e.target.value)}
                  placeholder="Lag (dias)"
                  aria-label="Lag em dias"
                  disabled={saving}
                />
              </div>
              <HudButton
                variant="secondary"
                size="sm"
                onClick={() => void handleAddDependency()}
                disabled={!newDepId || saving}
              >
                Vincular
              </HudButton>
            </div>
          )}
        </section>

        {/* Responsible + team */}
        <section>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ig-fg-muted">
            <Users className="h-3.5 w-3.5" /> Responsável e equipe
          </h4>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-ig-fg-muted">Responsável (usuário interno)</label>
              <select
                className={inputCls}
                value={item.responsibleUserId ?? ''}
                disabled={!canAssign || saving}
                onChange={(e) => void handleResponsible(e.target.value)}
              >
                <option value="">— Sem responsável —</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.fullName ?? m.email ?? m.userId}
                  </option>
                ))}
              </select>
            </div>
            {canAssign && (
              <div className="flex flex-wrap gap-4 text-xs text-ig-fg-muted">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={notifyOnAssign} onChange={(e) => setNotifyOnAssign(e.target.checked)} />
                  Notificar (in-app + e-mail)
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={createAgendaTask} onChange={(e) => setCreateAgendaTask(e.target.checked)} />
                  Criar tarefa na Agenda para o responsável
                </label>
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs text-ig-fg-muted">Equipe de execução</label>
              <div className="flex flex-wrap gap-1.5">
                {members.map((m) => {
                  const active = team.some((a) => a.userId === m.userId);
                  return (
                    <button
                      key={m.userId}
                      type="button"
                      disabled={!canAssign || saving}
                      onClick={() => void handleTeamToggle(m.userId)}
                      className={
                        active
                          ? 'rounded-full border border-ig-border-focus bg-ig-accent-weak px-2.5 py-1 text-xs text-ig-accent'
                          : 'rounded-full border border-ig-border px-2.5 py-1 text-xs text-ig-fg-muted hover:border-ig-border-strong disabled:opacity-50'
                      }
                    >
                      {m.fullName ?? m.email}
                    </button>
                  );
                })}
                {members.length === 0 && <p className="text-xs text-ig-fg-muted">Nenhum membro interno encontrado.</p>}
              </div>
            </div>
          </div>
        </section>

        {/* Delay */}
        <section>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ig-fg-muted">
            <AlertTriangle className="h-3.5 w-3.5" /> Atraso
          </h4>
          {item.delayReasonCategory && (
            <div className="mb-2 rounded-lg border border-ig-border p-3 text-xs space-y-1">
              <p className="text-ig-fg">
                <span className="text-ig-fg-muted">Motivo:</span> {DELAY_REASON_LABELS[item.delayReasonCategory]} — {item.delayReasonText}
              </p>
              {item.delayImpactText && (
                <p className="text-ig-fg"><span className="text-ig-fg-muted">Impacto:</span> {item.delayImpactText}</p>
              )}
              {item.recoveryPlanText && (
                <p className="text-ig-fg"><span className="text-ig-fg-muted">Recuperação:</span> {item.recoveryPlanText}</p>
              )}
            </div>
          )}
          {(canEdit || isResponsible) && item.status !== 'completed' && item.status !== 'cancelled' && (
            <HudButton variant="danger" size="sm" onClick={() => setPendingDelayStatus('delayed')}>
              Reportar atraso
            </HudButton>
          )}
        </section>

        {/* Linha do tempo — atrasos, comentários e apontamento numa só ordem
            cronológica. Substitui as duas listas separadas que existiam antes:
            o gestor lê a história da atividade, não três históricos paralelos. */}
        <section>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ig-fg-muted">
            <History className="h-3.5 w-3.5" /> Linha do tempo da atividade
          </h4>
          {activityEvents.length === 0 ? (
            <p className="text-xs text-ig-fg-subtle">Nenhum registro de execução até aqui.</p>
          ) : (
            <ul className="space-y-1.5">
              {activityEvents.map((event) => (
                <li key={event.id} className="flex items-start gap-2 rounded-lg border border-ig-border/70 px-2.5 py-1.5 text-xs">
                  <span
                    className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: EVENT_DOT[event.tone] ?? 'var(--ig-fg-subtle)' }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-ig-fg">{event.title}</span>
                    {event.detail && (
                      <span className="block whitespace-pre-wrap text-[11px] text-ig-fg-subtle">{event.detail}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-right text-[10px] tabular-nums text-ig-fg-subtle">
                    {event.actorName && <span className="block truncate">{event.actorName}</span>}
                    {formatEventTime(event, now)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Comments */}
        <section>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ig-fg-muted">
            <MessageSquare className="h-3.5 w-3.5" /> Novo comentário
          </h4>
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                className={inputCls}
                placeholder="Escreva um comentário…"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) void handleComment();
                }}
              />
              <HudButton variant="secondary" size="sm" onClick={() => void handleComment()} disabled={!commentText.trim()}>
                <Send className="h-3.5 w-3.5" />
              </HudButton>
            </div>
          </div>
        </section>

        {/* Links + raw import audit */}
        <section>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ig-fg-muted">
            <Link2 className="h-3.5 w-3.5" /> Vínculos
          </h4>
          <div className="space-y-1.5 text-xs">
            {item.relatedAgendaTaskId ? (
              <Link href="/reunioes?tab=tasks" className="text-ig-accent hover:underline">
                Tarefa vinculada na Agenda
              </Link>
            ) : (
              <p className="text-ig-fg-muted">Sem tarefa vinculada na Agenda.</p>
            )}
            {item.relatedRiskId && (
              <Link href="/riscos" className="block text-ig-accent hover:underline">
                Risco vinculado
              </Link>
            )}
          </div>
          {item.rawImport && (
            <div className="mt-3">
              <button
                type="button"
                className="text-xs text-ig-fg-muted underline decoration-dotted"
                onClick={() => setShowRaw((v) => !v)}
              >
                {showRaw ? 'Ocultar' : 'Ver'} valores originais do MS Project (auditoria)
              </button>
              {showRaw && (
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg border border-ig-border p-2.5 text-[11px]">
                  {Object.entries(item.rawImport).map(([k, v]) => (
                    <React.Fragment key={k}>
                      <dt className="text-ig-fg-muted">{k.replace('original_', '').replace(/_/g, ' ')}</dt>
                      <dd className="text-ig-fg font-mono">{String(v ?? '—')}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              )}
            </div>
          )}
        </section>
      </div>

      <DelayReasonDialog
        open={pendingDelayStatus !== null}
        newStatus={pendingDelayStatus ?? 'delayed'}
        defaultForecastFinish={item.forecastFinish ?? item.plannedFinish}
        onCancel={() => setPendingDelayStatus(null)}
        onSubmit={handleDelaySubmit}
      />
    </HudDrawer>
  );
}
