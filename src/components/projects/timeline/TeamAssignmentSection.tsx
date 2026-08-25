'use client';

/**
 * Atribuição de EQUIPE a uma etapa — a intenção operacional do P3A.
 *
 * O ponto desta tela é não obrigar o gestor a nomear pessoa por linha do
 * Gantt. Numa fase, o botão "aplicar a todas as atividades da fase" atribui a
 * turma à subárvore inteira de uma vez — que é como obra realmente aloca:
 * "Equipe Elétrica A cuida da Montagem", não "João na 5.2.3, Carlos na 5.2.4".
 */

import React, { useMemo, useState } from 'react';
import { Trash2, Users2 } from 'lucide-react';
import { HudBadge, HudButton, useHudToast } from '@/components/hud';
import {
  assignTeamToItems,
  createProjectTeam,
  unassignTeamFromItem,
} from '@/lib/services/project-teams';
import { descendantIdsOf } from '@/lib/projects/timeline-analytics';
import type { ProjectTeam, TimelineItem, TimelineTeamAssignment } from '@/lib/types/project-timeline';

const inputCls =
  'w-full rounded-lg border border-ig-border bg-transparent px-2.5 py-1.5 text-sm text-ig-fg outline-none focus:border-ig-border-focus disabled:opacity-50';

export interface TeamAssignmentSectionProps {
  item: TimelineItem;
  items: TimelineItem[];
  teams: ProjectTeam[];
  teamAssignments: TimelineTeamAssignment[];
  canAssign: boolean;
  onChanged: () => void | Promise<void>;
}

export function TeamAssignmentSection({
  item,
  items,
  teams,
  teamAssignments,
  canAssign,
  onChanged,
}: TeamAssignmentSectionProps) {
  const { notify } = useHudToast();
  const [selectedTeam, setSelectedTeam] = useState('');
  const [applyToSubtree, setApplyToSubtree] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const assignedHere = useMemo(
    () => teamAssignments.filter((t) => t.timelineItemId === item.id),
    [teamAssignments, item.id],
  );

  const assignedTeamIds = useMemo(
    () => new Set(assignedHere.map((t) => t.teamId)),
    [assignedHere],
  );

  /** Folhas da subárvore — o alvo real do "aplicar à fase". */
  const subtreeLeafIds = useMemo(() => {
    if (!item.isSummary) return [item.id];
    const ids = descendantIdsOf(items, item.id);
    return items
      .filter((i) => ids.has(i.id) && i.isActive && !i.deletedAt && !i.isSummary)
      .map((i) => i.id);
  }, [item, items]);

  const handleAssign = async () => {
    if (!selectedTeam) return;
    const targets = applyToSubtree && item.isSummary ? subtreeLeafIds : [item.id];
    if (targets.length === 0) {
      notify('Esta fase não tem atividades para atribuir.', { variant: 'error' });
      return;
    }
    setSaving(true);
    try {
      const n = await assignTeamToItems({
        projectId: item.projectId,
        teamId: selectedTeam,
        timelineItemIds: targets,
      });
      setSelectedTeam('');
      setApplyToSubtree(false);
      await onChanged();
      notify(
        n === 1 ? 'Equipe atribuída à atividade.' : `Equipe atribuída a ${n} atividades.`,
        { variant: 'success' },
      );
    } catch (e) {
      notify('Falha ao atribuir equipe', {
        description: e instanceof Error ? e.message : undefined,
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleUnassign = async (teamId: string) => {
    setSaving(true);
    try {
      await unassignTeamFromItem({ teamId, timelineItemId: item.id });
      await onChanged();
    } catch (e) {
      notify('Falha ao remover equipe', {
        description: e instanceof Error ? e.message : undefined,
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCreateTeam = async () => {
    if (!newTeamName.trim()) return;
    setSaving(true);
    try {
      const team = await createProjectTeam({ projectId: item.projectId, name: newTeamName.trim() });
      setNewTeamName('');
      setCreating(false);
      await onChanged();
      setSelectedTeam(team.id);
    } catch (e) {
      notify('Falha ao criar equipe', {
        description: e instanceof Error ? e.message : undefined,
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ig-fg-muted">
        <Users2 className="h-3.5 w-3.5" /> Equipe
      </h4>

      {assignedHere.length === 0 ? (
        <p className="text-xs text-ig-fg-subtle">Nenhuma equipe atribuída a esta atividade.</p>
      ) : (
        <div className="space-y-1.5">
          {assignedHere.map((ta) => {
            const team = teams.find((t) => t.id === ta.teamId);
            const members = team?.members ?? [];
            return (
              <div key={ta.id} className="rounded-lg border border-ig-border/70 px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-ig-fg">
                    {ta.teamName ?? team?.name ?? 'Equipe'}
                  </span>
                  <HudBadge variant="neutral" size="sm">{members.length} membro(s)</HudBadge>
                  {canAssign && (
                    <button
                      type="button"
                      onClick={() => void handleUnassign(ta.teamId)}
                      disabled={saving}
                      className="shrink-0 text-ig-fg-subtle hover:text-ig-danger"
                      aria-label="Remover equipe da atividade"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {members.length > 0 && (
                  <p className="mt-1 truncate text-[11px] text-ig-fg-subtle">
                    {members.map((m) => m.personName ?? '—').join(', ')}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {canAssign && (
        <div className="mt-3 space-y-2 rounded-lg border border-ig-border p-2.5">
          {creating ? (
            <div className="flex gap-2">
              <input
                className={inputCls}
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                placeholder="Nome da equipe (ex.: Equipe Elétrica A)"
                aria-label="Nome da nova equipe"
                autoFocus
              />
              <HudButton variant="primary" size="sm" onClick={() => void handleCreateTeam()} disabled={saving}>
                Criar
              </HudButton>
              <HudButton variant="ghost" size="sm" onClick={() => setCreating(false)} disabled={saving}>
                Cancelar
              </HudButton>
            </div>
          ) : (
            <>
              <select
                className={inputCls}
                value={selectedTeam}
                onChange={(e) => setSelectedTeam(e.target.value)}
                disabled={saving}
                aria-label="Equipe a atribuir"
              >
                <option value="">Selecionar equipe…</option>
                {teams
                  .filter((t) => !assignedTeamIds.has(t.id))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({(t.members ?? []).length})
                    </option>
                  ))}
              </select>

              {/* O ganho do P3A: uma turma para a fase inteira, num clique. */}
              {item.isSummary && subtreeLeafIds.length > 0 && (
                <label className="flex items-center gap-2 text-[11px] text-ig-fg-muted">
                  <input
                    type="checkbox"
                    checked={applyToSubtree}
                    onChange={(e) => setApplyToSubtree(e.target.checked)}
                    disabled={saving}
                  />
                  Aplicar às {subtreeLeafIds.length} atividades desta fase
                </label>
              )}

              <div className="flex items-center gap-2">
                <HudButton
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleAssign()}
                  disabled={!selectedTeam || saving}
                >
                  Atribuir equipe
                </HudButton>
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  disabled={saving}
                  className="text-[11px] text-ig-fg-muted underline-offset-2 hover:text-ig-fg hover:underline"
                >
                  Nova equipe
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
