'use client';

/**
 * Timeline item detail drawer — edit dates/status/%/responsável/equipe,
 * delay workflow trigger, comments, links and raw import audit values.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Clock, Link2, MessageSquare, Send, Users } from 'lucide-react';
import { HudBadge, HudButton, HudDrawer, HudStatusPill, useHudToast } from '@/components/hud';
import { usePermissions } from '@/hooks/use-permissions';
import { useCurrentUser } from '@/hooks/use-current-user';
import { listOrgMembers } from '@/lib/services/agenda';
import type { OrgMember } from '@/lib/types/agenda';
import {
  addComment,
  assignResponsible,
  listComments,
  listDelayLogs,
  setExecutionTeam,
  submitDelayReport,
  updateTimelineItem,
} from '@/lib/services/project-timeline';
import { deriveDelayStatus } from '@/lib/projects/timeline-analytics';
import {
  DELAY_REASON_LABELS,
  DELAY_STATUS_LABELS,
  TIMELINE_STATUS_LABELS,
  TIMELINE_TYPE_LABELS,
  type DelayLog,
  type DelayReportInput,
  type TimelineComment,
  type TimelineItem,
  type TimelineItemStatus,
} from '@/lib/types/project-timeline';
import { DelayReasonDialog } from './DelayReasonDialog';

const inputCls =
  'w-full rounded-lg border border-ig-border bg-transparent px-2.5 py-1.5 text-sm text-ig-fg outline-none focus:border-ig-border-focus disabled:opacity-50';

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
  projectName: string;
  projectManagerUserId?: string | null;
  onClose: () => void;
  /** Called with the updated item after any persisted change. */
  onChanged: (item: TimelineItem) => void;
}

export function TaskDetailDrawer({ item, projectName, projectManagerUserId, onClose, onChanged }: TaskDetailDrawerProps) {
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

  const isResponsible = Boolean(item && user && item.responsibleUserId === user.id);
  const canEdit = hasPermission('projects.timeline.edit') || isResponsible;
  const canAssign = hasPermission('projects.timeline.assign') || hasPermission('projects.timeline.edit');

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
          </div>
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
          {delayLogs.length > 0 && (
            <div className="mt-3 space-y-2">
              {delayLogs.map((log) => (
                <div key={log.id} className="rounded-lg border border-ig-border/70 p-2.5 text-xs">
                  <p className="text-ig-fg-muted">
                    {log.createdAt.toLocaleDateString('pt-BR')} · {log.reporterName ?? '—'} ·{' '}
                    {log.reasonCategory ? DELAY_REASON_LABELS[log.reasonCategory] : '—'}
                  </p>
                  <p className="text-ig-fg">{log.reasonText}</p>
                  {log.newForecastFinish && (
                    <p className="text-ig-fg-muted">Novo término: {log.newForecastFinish.split('-').reverse().join('/')}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Comments */}
        <section>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ig-fg-muted">
            <MessageSquare className="h-3.5 w-3.5" /> Comentários
          </h4>
          <div className="space-y-2">
            {comments.map((c) => (
              <div key={c.id} className="rounded-lg border border-ig-border/70 p-2.5 text-xs">
                <p className="text-ig-fg-muted">
                  {c.authorName ?? '—'} · {c.createdAt.toLocaleString('pt-BR')}
                </p>
                <p className="text-ig-fg whitespace-pre-wrap">{c.body}</p>
              </div>
            ))}
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
