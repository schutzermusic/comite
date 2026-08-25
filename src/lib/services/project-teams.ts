'use client';

/**
 * Equipes de projeto (migration 096) — a intenção de atribuição do gestor.
 *
 * Serviço separado de `project-timeline.ts` porque este é o único lugar que
 * cruza cronograma com `people`. Leituras nunca lançam: equipe é enriquecimento
 * do casamento, e uma falha de RLS aqui não pode apagar o Gantt.
 */

import { createClient } from '@/utils/supabase/client';
import { logAuditEvent } from '@/lib/audit/log-audit-event';
import type {
  ProjectTeam,
  ProjectTeamMember,
  TimelineTeamAssignment,
} from '@/lib/types/project-timeline';

const TEAMS = 'project_teams';
const MEMBERS = 'project_team_members';
const ITEM_TEAMS = 'project_timeline_team_assignments';

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function currentOrg(supabase: ReturnType<typeof createClient>): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) throw new Error('Não autenticado');
  const { data, error } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('user_id', user.id)
    .single();
  if (error || !data?.organization_id) throw new Error('Usuário sem organização ativa');
  return data.organization_id as string;
}

/** Equipes do projeto com os membros vivos já hidratados. */
export async function listProjectTeams(projectId: string): Promise<ProjectTeam[]> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from(TEAMS)
      .select('*')
      .eq('project_id', projectId)
      .eq('active', true)
      .order('name');
    if (error) return [];

    const teams: ProjectTeam[] = (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      organizationId: row.organization_id as string,
      projectId: row.project_id as string,
      name: row.name as string,
      description: (row.description as string | null) ?? null,
      active: Boolean(row.active),
      createdAt: toDate(row.created_at as string) ?? new Date(),
      members: [],
    }));
    if (teams.length === 0) return teams;

    const { data: memberRows } = await supabase
      .from(MEMBERS)
      .select('*, people:person_id ( full_name )')
      .in('team_id', teams.map((t) => t.id))
      .is('removed_at', null);

    const byTeam = new Map(teams.map((t) => [t.id, t]));
    for (const row of (memberRows ?? []) as Record<string, unknown>[]) {
      const team = byTeam.get(row.team_id as string);
      if (!team) continue;
      team.members!.push({
        id: row.id as string,
        organizationId: row.organization_id as string,
        teamId: row.team_id as string,
        personId: row.person_id as string,
        roleTitle: (row.role_title as string | null) ?? null,
        addedAt: toDate(row.added_at as string) ?? new Date(),
        removedAt: toDate(row.removed_at as string),
        personName: (row.people as { full_name?: string } | null)?.full_name ?? null,
      });
    }
    for (const team of teams) {
      team.members!.sort((a, b) => (a.personName ?? '').localeCompare(b.personName ?? '', 'pt-BR'));
    }
    return teams;
  } catch {
    return [];
  }
}

/** Vínculos etapa → equipe vivos do projeto. */
export async function listTimelineTeamAssignments(projectId: string): Promise<TimelineTeamAssignment[]> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from(ITEM_TEAMS)
      .select('*, project_teams:team_id ( name )')
      .eq('project_id', projectId)
      .is('removed_at', null);
    if (error) return [];
    return (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      organizationId: row.organization_id as string,
      projectId: row.project_id as string,
      timelineItemId: row.timeline_item_id as string,
      teamId: row.team_id as string,
      assignedAt: toDate(row.assigned_at as string) ?? new Date(),
      removedAt: toDate(row.removed_at as string),
      teamName: (row.project_teams as { name?: string } | null)?.name ?? null,
    }));
  } catch {
    return [];
  }
}

export async function createProjectTeam(input: {
  projectId: string;
  name: string;
  description?: string | null;
}): Promise<ProjectTeam> {
  const supabase = createClient();
  const organizationId = await currentOrg(supabase);
  const { data, error } = await supabase
    .from(TEAMS)
    .insert({
      organization_id: organizationId,
      project_id: input.projectId,
      name: input.name.trim(),
      description: input.description ?? null,
    })
    .select('*')
    .single();
  if (error?.code === '23505') throw new Error('Já existe uma equipe com esse nome no projeto.');
  if (error || !data) throw new Error(error?.message ?? 'Falha ao criar equipe');

  await logAuditEvent({
    organizationId,
    action: 'project_team.created',
    entityType: 'project_team',
    entityId: data.id as string,
    metadata: { projectId: input.projectId, name: input.name },
  });

  return {
    id: data.id as string,
    organizationId,
    projectId: data.project_id as string,
    name: data.name as string,
    description: (data.description as string | null) ?? null,
    active: Boolean(data.active),
    createdAt: toDate(data.created_at as string) ?? new Date(),
    members: [],
  };
}

export async function addTeamMember(input: {
  teamId: string;
  personId: string;
  roleTitle?: string | null;
}): Promise<ProjectTeamMember> {
  const supabase = createClient();
  const organizationId = await currentOrg(supabase);
  const { data, error } = await supabase
    .from(MEMBERS)
    .insert({
      organization_id: organizationId,
      team_id: input.teamId,
      person_id: input.personId,
      role_title: input.roleTitle ?? null,
    })
    .select('*')
    .single();
  if (error?.code === '23505') throw new Error('Essa pessoa já está na equipe.');
  if (error || !data) throw new Error(error?.message ?? 'Falha ao adicionar membro');
  return {
    id: data.id as string,
    organizationId,
    teamId: data.team_id as string,
    personId: data.person_id as string,
    roleTitle: (data.role_title as string | null) ?? null,
    addedAt: toDate(data.added_at as string) ?? new Date(),
    removedAt: null,
  };
}

/** Remoção lógica: o histórico de quem estava na turma precisa sobreviver. */
export async function removeTeamMember(memberId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from(MEMBERS)
    .update({ removed_at: new Date().toISOString() })
    .eq('id', memberId);
  if (error) throw new Error(error.message);
}

/**
 * Atribui uma equipe a VÁRIAS etapas de uma vez — é o ponto do P3A: o gestor
 * atribui a turma à fase, não pessoa por linha.
 */
export async function assignTeamToItems(input: {
  projectId: string;
  teamId: string;
  timelineItemIds: string[];
}): Promise<number> {
  if (input.timelineItemIds.length === 0) return 0;
  const supabase = createClient();
  const organizationId = await currentOrg(supabase);

  // Reativa vínculo removido em vez de duplicar linha.
  const { data: existing } = await supabase
    .from(ITEM_TEAMS)
    .select('id, timeline_item_id, removed_at')
    .eq('team_id', input.teamId)
    .in('timeline_item_id', input.timelineItemIds);

  const existingByItem = new Map(
    ((existing ?? []) as { id: string; timeline_item_id: string; removed_at: string | null }[]).map(
      (r) => [r.timeline_item_id, r],
    ),
  );

  const toInsert = input.timelineItemIds.filter((id) => !existingByItem.has(id));
  const toRevive = [...existingByItem.values()].filter((r) => r.removed_at !== null).map((r) => r.id);

  if (toInsert.length > 0) {
    const { error } = await supabase.from(ITEM_TEAMS).insert(
      toInsert.map((timelineItemId) => ({
        organization_id: organizationId,
        project_id: input.projectId,
        timeline_item_id: timelineItemId,
        team_id: input.teamId,
      })),
    );
    if (error) throw new Error(error.message);
  }
  if (toRevive.length > 0) {
    const { error } = await supabase.from(ITEM_TEAMS).update({ removed_at: null }).in('id', toRevive);
    if (error) throw new Error(error.message);
  }

  await logAuditEvent({
    organizationId,
    action: 'project_team.assigned_to_items',
    entityType: 'project_team',
    entityId: input.teamId,
    metadata: { projectId: input.projectId, itemCount: input.timelineItemIds.length },
  });

  return toInsert.length + toRevive.length;
}

export async function unassignTeamFromItem(input: {
  teamId: string;
  timelineItemId: string;
}): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from(ITEM_TEAMS)
    .update({ removed_at: new Date().toISOString() })
    .eq('team_id', input.teamId)
    .eq('timeline_item_id', input.timelineItemId)
    .is('removed_at', null);
  if (error) throw new Error(error.message);
}
