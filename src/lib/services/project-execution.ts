'use client';

/**
 * Camada de JOIN entre o cronograma (032) e o apontamento (041).
 *
 * Arquivo próprio de propósito: `project-timeline.ts` é dono da 032 e
 * `timesheet.ts` é dono da 041 — nenhum dos dois deve importar o outro. Aqui é
 * o único ponto onde os dois domínios se encontram.
 *
 * ─── Por que existe um gate DURO de permissão ──────────────────────────────
 * As políticas de SELECT de time_entries e project_work_sessions (041:130-201)
 * liberam a linha quando `person_id = current_user_person_id()` OU quando o
 * usuário tem people.timesheet_view / people.timesheet_approve. Um gestor SEM
 * essas permissões não recebe erro: recebe SILENCIOSAMENTE apenas as próprias
 * linhas. Todo indicador "sem apontamento" seria então falso para as
 * atividades tocadas por outras pessoas.
 *
 * Por isso a checagem acontece ANTES de qualquer query, e a ausência de
 * permissão vira `unauthorized` — que a UI trata escondendo as colunas, não
 * mostrando zeros. Isso não é otimização; é correção.
 */

import { listOrgMembers } from '@/lib/services/agenda';
import { listPeople } from '@/lib/services/people';
import { listEntriesByProject, listSessionsByProject } from '@/lib/services/timesheet';
import {
  buildPersonUserLinks,
  type ExecutionAvailability,
  type PersonUserLink,
} from '@/lib/projects/timeline-execution';
import type { ProjectWorkSession, TimeEntry } from '@/lib/types/people';

export interface ProjectExecutionData {
  availability: ExecutionAvailability;
  entries: TimeEntry[];
  sessions: ProjectWorkSession[];
  links: PersonUserLink[];
}

const EMPTY = (availability: ExecutionAvailability): ProjectExecutionData => ({
  availability,
  entries: [],
  sessions: [],
  links: [],
});

/** Primeiro dia do mês de `date`, em ISO — janela de leitura das sessões. */
function startOfMonthIso(date: Date): string {
  return new Date(date.getFullYear(), date.getMonth(), 1).toISOString();
}

/** Competência yyyy-MM de `date`. */
export function monthKeyOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export interface LoadProjectExecutionInput {
  projectId: string;
  /** Competência yyyy-MM. Omitir carrega o histórico inteiro do projeto. */
  month?: string;
  /** hasPermission('people.timesheet_view') || hasPermission('people.timesheet_approve') */
  canReadTimesheet: boolean;
  now?: Date;
}

export async function loadProjectExecutionData(
  input: LoadProjectExecutionInput,
): Promise<ProjectExecutionData> {
  // Gate duro — ver o cabeçalho. Sem permissão, nenhuma query é emitida.
  if (!input.canReadTimesheet) return EMPTY('unauthorized');

  const now = input.now ?? new Date();

  try {
    const [entries, sessions, people, members] = await Promise.all([
      listEntriesByProject(input.projectId, input.month),
      listSessionsByProject(input.projectId, startOfMonthIso(now)),
      // people é legível por quem tem projects.view (038:289-392).
      listPeople({ status: 'all' }),
      // RPC SECURITY DEFINER: a única ponte people ↔ auth.users sem migration,
      // já que profiles_select_scoped (005:311) esconde os demais perfis.
      listOrgMembers(),
    ]);

    return {
      availability: 'available',
      entries,
      sessions,
      links: buildPersonUserLinks(people, members),
    };
  } catch (error) {
    // O Gantt precisa renderizar mesmo se o timesheet falhar. Nunca re-lança:
    // 'unavailable' faz a UI omitir os indicadores em vez de zerá-los.
    //
    // Mas engolir em silêncio deixaria a ausência indiagnosticável — quem
    // investiga "por que sumiram as horas?" precisa de um rastro.
    console.warn('[project-execution] execução indisponível:', error);
    return EMPTY('unavailable');
  }
}
