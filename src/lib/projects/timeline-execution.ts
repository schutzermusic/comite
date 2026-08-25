/**
 * Read-model de EXECUÇÃO do cronograma — planejado × apontado por atividade.
 *
 * Junta itens do cronograma (032) com o apontamento do colaborador (041) pela
 * FK `time_entries.timeline_item_id`, que o app de Ponto já preenche. Puro:
 * sem Supabase, sem React. Espelha o padrão de selectors de timeline-analytics.
 *
 * ─── Disciplina de ausência ────────────────────────────────────────────────
 * Regra do módulo Pessoas & Custos: indicador sem fonte fica AUSENTE, nunca
 * zero e nunca derivado. Aqui isso tem três consequências não-negociáveis:
 *
 *   1. `plannedHours` é null quando `durationMinutes` é null. Sem fallback.
 *      (timelineKpis usa `|| 60`, mas ali é PESO de ponderação, não indicador
 *      exibido — não reaproveitar aquela heurística nesta camada.)
 *   2. `availability !== 'available'` ⇒ o modelo inteiro é vazio/null. Sem
 *      permissão de leitura do timesheet a RLS devolve só as linhas do próprio
 *      usuário (041:130-201), então qualquer contagem seria uma MENTIRA — não
 *      um dado parcial.
 *   3. `available` + item genuinamente sem lançamento ⇒ `loggedHours = 0` e
 *      `hasNoApontamento = true`. Ausente (desconhecido) ≠ zero (observado).
 *
 * ─── Custo ─────────────────────────────────────────────────────────────────
 * Este módulo NUNCA calcula custo. Horas são livremente legíveis com
 * `people.timesheet_view`; custo é RLS-gated em `people.cost_view` (043/054) e
 * `cost.ts` deliberadamente nunca carimba custo em time_entries. Nada de
 * horas × taxa aqui.
 */

import type { OrgMember } from '@/lib/types/agenda';
import type { Person, ProjectWorkSession, TimeEntry } from '@/lib/types/people';
import type { TimelineItem } from '@/lib/types/project-timeline';
import type { TimelineNode } from '@/lib/projects/timeline-analytics';

export type ExecutionAvailability = 'available' | 'unauthorized' | 'unavailable';

/** Ponte people ↔ auth.users. `userId` null quando a pessoa não tem login. */
export interface PersonUserLink {
  personId: string;
  userId: string | null;
  fullName: string;
  avatarUrl: string | null;
}

export interface ItemCollaborator {
  personId: string;
  userId: string | null;
  name: string;
  avatarUrl: string | null;
  minutes: number;
  lastWorkDate: string | null;
  isActiveNow: boolean;
  /** false ⇒ apontou horas sem estar na equipe da atividade. */
  isAssigned: boolean;
}

export interface ItemExecution {
  itemId: string;
  plannedHours: number | null;
  loggedHours: number | null;
  approvedHours: number | null;
  pendingHours: number | null;
  draftHours: number | null;
  variance: number | null;
  variancePct: number | null;
  lastActivityAt: string | null;
  collaborators: ItemCollaborator[];
  isActiveNow: boolean;
  workedToday: boolean;
  hasNoApontamento: boolean;
  hoursWithoutProgress: boolean;
  entriesCount: number;

  /* ─── Inteligência de esforço (P3) ─── */
  /** Já apontou horas, mas nada nos últimos STALE_ACTIVITY_DAYS. */
  noRecentActivity: boolean;
  /** Apontou mais horas do que o planejado. false quando não há planejado. */
  overPlannedEffort: boolean;
  /** Esforço total projetado pelo ritmo atual: horas ÷ (progresso/100). */
  projectedEffortHours: number | null;
  /** projectedEffortHours − plannedHours. Positivo = estouro projetado. */
  projectedOverrunHours: number | null;
}

/** Dias sem apontamento a partir dos quais uma atividade em curso vira alerta. */
export const STALE_ACTIVITY_DAYS = 7;

/**
 * Quanto do cronograma tem cada fonte preenchida.
 *
 * Existe para que a UI diga "não sei" com números em vez de mostrar um zero
 * que parece apurado: um KPI de horas planejadas em 0 quando NENHUMA atividade
 * tem duração cadastrada é uma mentira silenciosa.
 */
export interface ExecutionCoverage {
  /** Folhas ativas — o denominador de tudo. */
  leaves: number;
  withPlannedHours: number;
  withResponsible: number;
  withLoggedHours: number;
}

export interface ProjectExecutionModel {
  availability: ExecutionAvailability;
  byItem: Map<string, ItemExecution>;
  /** Horas apontadas no projeto sem etapa do cronograma escolhida. */
  unlinkedHours: number | null;
  coverage: ExecutionCoverage;
  totals: {
    /** Soma das horas planejadas das folhas. null quando NENHUMA tem duração. */
    plannedHours: number | null;
    loggedHours: number | null;
    /** loggedHours − plannedHours. null sem base de planejado. */
    effortVariance: number | null;
    activeNowCount: number | null;
    /** Pessoas distintas com apontamento hoje. */
    activeWorkersToday: number | null;
    noApontamentoCount: number | null;
    noRecentActivityCount: number | null;
    overPlannedEffortCount: number | null;
    hoursWithoutProgressCount: number | null;
  };
}

export const EMPTY_EXECUTION: ProjectExecutionModel = {
  availability: 'unavailable',
  byItem: new Map(),
  unlinkedHours: null,
  coverage: { leaves: 0, withPlannedHours: 0, withResponsible: 0, withLoggedHours: 0 },
  totals: {
    plannedHours: null,
    loggedHours: null,
    effortVariance: null,
    activeNowCount: null,
    activeWorkersToday: null,
    noApontamentoCount: null,
    noRecentActivityCount: null,
    overPlannedEffortCount: null,
    hoursWithoutProgressCount: null,
  },
};

/* ───────────────────────── Ponte people ↔ auth.users ───────────────────────── */

const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

function normalizeName(name: string | null | undefined): string | null {
  if (!name) return null;
  const out = name
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    // remove diacríticos combinantes (U+0300–U+036F), igual a normalize_person_name() da 038
    .replace(COMBINING_MARKS, '');
  return out || null;
}

/** Indexa por chave, marcando como ambígua (null) qualquer chave repetida. */
function uniqueIndex<T>(rows: T[], keyOf: (row: T) => string | null): Map<string, T | null> {
  const index = new Map<string, T | null>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    index.set(key, index.has(key) ? null : row);
  }
  return index;
}

/**
 * Liga `people` a `auth.users` por e-mail (chave primária) com fallback de nome
 * normalizado. `profiles` NÃO serve: profiles_select_scoped (005:311-323) só
 * expõe o próprio perfil a quem não é admin, então o embed viria null. O RPC
 * SECURITY DEFINER list_organization_members() é a única ponte segura sem
 * migration.
 *
 * Ambiguidade de qualquer lado ⇒ userId null. Nunca adivinhar de quem é a hora.
 */
export function buildPersonUserLinks(people: Person[], members: OrgMember[]): PersonUserLink[] {
  const byEmail = uniqueIndex(members, (m) => m.email?.trim().toLowerCase() ?? null);
  const byName = uniqueIndex(members, (m) => normalizeName(m.fullName));
  const peopleByEmail = uniqueIndex(people, (p) => p.email?.trim().toLowerCase() ?? null);
  const peopleByName = uniqueIndex(people, (p) => normalizeName(p.fullName));

  return people.map((person) => {
    const email = person.email?.trim().toLowerCase() ?? null;
    const name = normalizeName(person.fullName);

    // Só aceita o match quando ele é único NOS DOIS SENTIDOS.
    let member: OrgMember | null = null;
    if (email && peopleByEmail.get(email) !== null) member = byEmail.get(email) ?? null;
    if (!member && name && peopleByName.get(name) !== null) member = byName.get(name) ?? null;

    return {
      personId: person.id,
      userId: member?.userId ?? null,
      fullName: person.fullName,
      avatarUrl: member?.avatarUrl ?? null,
    };
  });
}

/* ───────────────────────── Modelo de execução ───────────────────────── */

const MINUTES_PER_HOUR = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN_STATUSES = new Set(['not_started', 'in_progress', 'blocked', 'delayed']);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Data local em yyyy-MM-dd — coerente com o que o timesheet grava em work_date. */
function localDateIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function emptyItemExecution(item: TimelineItem): ItemExecution {
  const plannedHours = item.durationMinutes == null ? null : round2(item.durationMinutes / MINUTES_PER_HOUR);
  return {
    itemId: item.id,
    plannedHours,
    loggedHours: 0,
    approvedHours: 0,
    pendingHours: 0,
    draftHours: 0,
    variance: plannedHours == null ? null : round2(0 - plannedHours),
    variancePct: plannedHours == null || plannedHours === 0 ? null : round2((0 - plannedHours) / plannedHours),
    lastActivityAt: null,
    collaborators: [],
    isActiveNow: false,
    workedToday: false,
    hasNoApontamento: true,
    hoursWithoutProgress: false,
    entriesCount: 0,
    noRecentActivity: false,
    overPlannedEffort: false,
    projectedEffortHours: null,
    projectedOverrunHours: null,
  };
}

export interface BuildProjectExecutionInput {
  items: TimelineItem[];
  entries: TimeEntry[];
  sessions: ProjectWorkSession[];
  links: PersonUserLink[];
  now: Date;
  availability: ExecutionAvailability;
}

export function buildProjectExecution(input: BuildProjectExecutionInput): ProjectExecutionModel {
  const { items, entries, sessions, links, now, availability } = input;
  if (availability !== 'available') return { ...EMPTY_EXECUTION, availability };

  const todayIso = localDateIso(now);
  const linkByPerson = new Map(links.map((l) => [l.personId, l]));
  const itemById = new Map(items.map((i) => [i.id, i]));

  const byItem = new Map<string, ItemExecution>();
  for (const item of items) byItem.set(item.id, emptyItemExecution(item));

  // Acumuladores de colaborador, por item.
  const collabByItem = new Map<string, Map<string, ItemCollaborator>>();
  const collaboratorOf = (itemId: string, personId: string, fallbackName: string): ItemCollaborator => {
    let bucket = collabByItem.get(itemId);
    if (!bucket) {
      bucket = new Map();
      collabByItem.set(itemId, bucket);
    }
    let collab = bucket.get(personId);
    if (!collab) {
      const link = linkByPerson.get(personId);
      const item = itemById.get(itemId);
      const userId = link?.userId ?? null;
      const isAssigned = Boolean(
        userId &&
          item &&
          (item.responsibleUserId === userId ||
            (item.assignments ?? []).some((a) => a.userId === userId && !a.removedAt)),
      );
      collab = {
        personId,
        userId,
        name: link?.fullName ?? fallbackName,
        avatarUrl: link?.avatarUrl ?? null,
        minutes: 0,
        lastWorkDate: null,
        isActiveNow: false,
        isAssigned,
      };
      bucket.set(personId, collab);
    }
    return collab;
  };

  let unlinkedMinutes = 0;

  /* ─── Lançamentos consolidados ─── */
  for (const entry of entries) {
    if (entry.status === 'rejected') continue;

    if (!entry.timelineItemId) {
      unlinkedMinutes += entry.minutes;
      continue;
    }
    const exec = byItem.get(entry.timelineItemId);
    // Lançamento apontando para item desativado/removido: não inventa linha.
    if (!exec) continue;

    exec.loggedHours = (exec.loggedHours ?? 0) + entry.minutes / MINUTES_PER_HOUR;
    if (entry.status === 'approved' || entry.status === 'locked') {
      exec.approvedHours = (exec.approvedHours ?? 0) + entry.minutes / MINUTES_PER_HOUR;
    } else if (entry.status === 'submitted') {
      exec.pendingHours = (exec.pendingHours ?? 0) + entry.minutes / MINUTES_PER_HOUR;
    } else if (entry.status === 'draft') {
      exec.draftHours = (exec.draftHours ?? 0) + entry.minutes / MINUTES_PER_HOUR;
    }
    exec.entriesCount += 1;
    if (entry.workDate === todayIso) exec.workedToday = true;

    // Entradas têm precisão de DIA — ancoradas ao meio-dia para não competirem
    // indevidamente com timestamps reais de sessão.
    const at = `${entry.workDate}T12:00:00`;
    if (!exec.lastActivityAt || at > exec.lastActivityAt) exec.lastActivityAt = at;

    const collab = collaboratorOf(entry.timelineItemId, entry.personId, entry.person?.fullName ?? '—');
    collab.minutes += entry.minutes;
    if (!collab.lastWorkDate || entry.workDate > collab.lastWorkDate) collab.lastWorkDate = entry.workDate;
  }

  /* ─── Sessões (timer) — dão o sinal de "ativo agora" ─── */
  for (const session of sessions) {
    if (session.status === 'discarded') continue;
    if (!session.timelineItemId) continue;
    const exec = byItem.get(session.timelineItemId);
    if (!exec) continue;

    const running = session.status === 'running';
    if (running) exec.isActiveNow = true;

    const at = session.endedAt ?? session.startedAt;
    if (at && (!exec.lastActivityAt || at > exec.lastActivityAt)) exec.lastActivityAt = at;
    if (localDateIso(new Date(session.startedAt)) === todayIso) exec.workedToday = true;

    const collab = collaboratorOf(session.timelineItemId, session.personId, '—');
    if (running) collab.isActiveNow = true;
  }

  /* ─── Fechamento por item ─── */
  for (const [itemId, exec] of byItem) {
    const item = itemById.get(itemId)!;
    exec.loggedHours = round2(exec.loggedHours ?? 0);
    exec.approvedHours = round2(exec.approvedHours ?? 0);
    exec.pendingHours = round2(exec.pendingHours ?? 0);
    exec.draftHours = round2(exec.draftHours ?? 0);

    exec.collaborators = [...(collabByItem.get(itemId)?.values() ?? [])].sort((a, b) => b.minutes - a.minutes);

    exec.hasNoApontamento = exec.entriesCount === 0 && !exec.isActiveNow;
    exec.hoursWithoutProgress = exec.loggedHours > 0 && item.percentComplete === 0;

    if (exec.plannedHours != null) {
      exec.variance = round2(exec.loggedHours - exec.plannedHours);
      exec.variancePct = exec.plannedHours === 0 ? null : round2(exec.variance / exec.plannedHours);
      exec.overPlannedEffort = exec.plannedHours > 0 && exec.loggedHours > exec.plannedHours;
    }

    // Já trabalhou, mas parou: só faz sentido para item aberto que TEM histórico.
    // Item que nunca recebeu hora é `hasNoApontamento`, não "parado".
    if (exec.lastActivityAt && !exec.isActiveNow && OPEN_STATUSES.has(item.status)) {
      const last = new Date(exec.lastActivityAt).getTime();
      exec.noRecentActivity = now.getTime() - last > STALE_ACTIVITY_DAYS * DAY_MS;
    }

    // Projeção pelo ritmo atual. Exige progresso > 0 e horas > 0 — sem os dois
    // não há ritmo a extrapolar, e null é a resposta honesta.
    if (exec.loggedHours > 0 && item.percentComplete > 0 && item.status !== 'completed') {
      exec.projectedEffortHours = round2(exec.loggedHours / (item.percentComplete / 100));
      if (exec.plannedHours != null) {
        exec.projectedOverrunHours = round2(exec.projectedEffortHours - exec.plannedHours);
      }
    }
  }

  return {
    availability: 'available',
    byItem,
    unlinkedHours: round2(unlinkedMinutes / MINUTES_PER_HOUR),
    coverage: computeCoverage(items, byItem),
    totals: computeTotals(items, byItem, entries, sessions, todayIso),
  };
}

function computeCoverage(items: TimelineItem[], byItem: Map<string, ItemExecution>): ExecutionCoverage {
  let leaves = 0;
  let withPlannedHours = 0;
  let withResponsible = 0;
  let withLoggedHours = 0;

  for (const item of items) {
    if (item.isSummary || !item.isActive || item.deletedAt) continue;
    leaves += 1;
    const exec = byItem.get(item.id);
    if (exec?.plannedHours != null) withPlannedHours += 1;
    if ((exec?.loggedHours ?? 0) > 0) withLoggedHours += 1;
    if (item.responsibleUserId || (item.assignments ?? []).some((a) => !a.removedAt)) {
      withResponsible += 1;
    }
  }
  return { leaves, withPlannedHours, withResponsible, withLoggedHours };
}

function computeTotals(
  items: TimelineItem[],
  byItem: Map<string, ItemExecution>,
  entries: TimeEntry[],
  sessions: ProjectWorkSession[],
  todayIso: string,
) {
  let loggedHours = 0;
  let plannedHours = 0;
  let anyPlanned = false;
  let activeNowCount = 0;
  let noApontamentoCount = 0;
  let noRecentActivityCount = 0;
  let overPlannedEffortCount = 0;
  let hoursWithoutProgressCount = 0;

  for (const item of items) {
    // Fases somariam a subárvore em duplicidade — os totais contam só folhas.
    if (item.isSummary) continue;
    const exec = byItem.get(item.id);
    if (!exec) continue;
    loggedHours += exec.loggedHours ?? 0;
    if (exec.plannedHours != null) {
      anyPlanned = true;
      plannedHours += exec.plannedHours;
    }
    if (exec.isActiveNow) activeNowCount += 1;
    if (exec.hasNoApontamento && item.status !== 'completed' && item.status !== 'cancelled') {
      noApontamentoCount += 1;
    }
    if (exec.noRecentActivity) noRecentActivityCount += 1;
    if (exec.overPlannedEffort) overPlannedEffortCount += 1;
    if (exec.hoursWithoutProgress) hoursWithoutProgressCount += 1;
  }

  // Pessoas distintas com evidência de trabalho hoje — conta o PROJETO inteiro,
  // inclusive horas sem etapa escolhida: a pessoa trabalhou de qualquer forma.
  const workersToday = new Set<string>();
  for (const entry of entries) {
    if (entry.status !== 'rejected' && entry.workDate === todayIso) workersToday.add(entry.personId);
  }
  for (const session of sessions) {
    if (session.status === 'discarded') continue;
    if (localDateIso(new Date(session.startedAt)) === todayIso) workersToday.add(session.personId);
  }

  const totalPlanned = anyPlanned ? round2(plannedHours) : null;
  return {
    plannedHours: totalPlanned,
    loggedHours: round2(loggedHours),
    effortVariance: totalPlanned == null ? null : round2(round2(loggedHours) - totalPlanned),
    activeNowCount,
    activeWorkersToday: workersToday.size,
    noApontamentoCount,
    noRecentActivityCount,
    overPlannedEffortCount,
    hoursWithoutProgressCount,
  };
}

/**
 * Faz as FASES agregarem a subárvore, para que uma fase recolhida continue
 * mostrando as horas do que está embaixo dela. Muta `byItem` in-place.
 *
 * `plannedHours` da fase soma os descendentes não-nulos e só permanece null
 * quando TODOS são null — do contrário uma fase com uma etapa sem duração
 * apagaria o planejado das demais.
 */
export function rollupExecution(roots: TimelineNode[], byItem: Map<string, ItemExecution>): void {
  const visit = (node: TimelineNode): ItemExecution | undefined => {
    const own = byItem.get(node.item.id);
    if (node.children.length === 0) return own;

    const childExecs = node.children.map(visit).filter((e): e is ItemExecution => Boolean(e));
    if (!own) return undefined;

    const collabs = new Map<string, ItemCollaborator>();
    for (const collab of own.collaborators) collabs.set(collab.personId, { ...collab });

    // A fase NÃO soma a própria duração: no MS Project a duração de um resumo
    // é o SPAN de calendário da fase, não esforço. Somar as duas contaria a
    // mesma fase duas vezes. O planejado de uma fase é o dos seus filhos.
    let plannedSum: number | null = null;
    for (const child of childExecs) {
      own.loggedHours = round2((own.loggedHours ?? 0) + (child.loggedHours ?? 0));
      own.approvedHours = round2((own.approvedHours ?? 0) + (child.approvedHours ?? 0));
      own.pendingHours = round2((own.pendingHours ?? 0) + (child.pendingHours ?? 0));
      own.draftHours = round2((own.draftHours ?? 0) + (child.draftHours ?? 0));
      own.entriesCount += child.entriesCount;
      own.isActiveNow = own.isActiveNow || child.isActiveNow;
      own.workedToday = own.workedToday || child.workedToday;
      own.hoursWithoutProgress = own.hoursWithoutProgress || child.hoursWithoutProgress;
      own.noRecentActivity = own.noRecentActivity || child.noRecentActivity;
      own.overPlannedEffort = own.overPlannedEffort || child.overPlannedEffort;
      if (child.plannedHours != null) plannedSum = round2((plannedSum ?? 0) + child.plannedHours);
      if (child.lastActivityAt && (!own.lastActivityAt || child.lastActivityAt > own.lastActivityAt)) {
        own.lastActivityAt = child.lastActivityAt;
      }
      for (const collab of child.collaborators) {
        const existing = collabs.get(collab.personId);
        if (existing) {
          existing.minutes += collab.minutes;
          existing.isActiveNow = existing.isActiveNow || collab.isActiveNow;
          existing.isAssigned = existing.isAssigned || collab.isAssigned;
          if (collab.lastWorkDate && (!existing.lastWorkDate || collab.lastWorkDate > existing.lastWorkDate)) {
            existing.lastWorkDate = collab.lastWorkDate;
          }
        } else {
          collabs.set(collab.personId, { ...collab });
        }
      }
    }

    own.plannedHours = plannedSum;
    own.collaborators = [...collabs.values()].sort((a, b) => b.minutes - a.minutes);
    own.hasNoApontamento = own.entriesCount === 0 && !own.isActiveNow;
    if (own.plannedHours != null) {
      own.variance = round2((own.loggedHours ?? 0) - own.plannedHours);
      own.variancePct = own.plannedHours === 0 ? null : round2(own.variance / own.plannedHours);
    } else {
      own.variance = null;
      own.variancePct = null;
    }
    return own;
  };

  roots.forEach(visit);
}

/* ───────────────────────── Formatação ───────────────────────── */

/** Horas em pt-BR. `null` ⇒ travessão. NUNCA devolve "0" para dado ausente. */
export function formatHours(hours: number | null): string {
  if (hours == null) return '—';
  return `${hours.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })} h`;
}

/** Variância com sinal explícito. `null` ⇒ travessão. */
export function formatVariance(variance: number | null): string {
  if (variance == null) return '—';
  const sign = variance > 0 ? '+' : '';
  return `${sign}${variance.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;
}
