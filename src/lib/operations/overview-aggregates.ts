/**
 * Agregados PUROS da Visão Geral de Operações — os números SEM corte.
 *
 * A fila de Operações corta por tipo (25 atividades, 15 materiais, 15
 * dependências) e depois em 40; a tela de Operações mostra a fila. O
 * Dashboard precisa do total honesto: aqui as contagens saem de TODOS os
 * candidatos, antes de qualquer corte. Nenhuma função consulta nada.
 */
import type { HealthLevel } from './projects/health';

export type AttentionKind = 'service_order' | 'activity' | 'measurement' | 'risk' | 'material' | 'dependency';
export type AttentionTone = 'danger' | 'warning' | 'accent';

export const ATTENTION_KINDS: readonly AttentionKind[] = ['service_order', 'activity', 'measurement', 'risk', 'material', 'dependency'];

export type AttentionCounts = Record<AttentionKind, { total: number; danger: number; warning: number }>;

/** Teto de linhas por resposta do PostgREST (`max_rows`): a leitura que chega nele pode ter sido cortada. */
export const POSTGREST_MAX_ROWS = 1000;

/** A leitura voltou no teto do PostgREST ou no `.limit()` dela — pode haver mais linhas do que as lidas. */
export function readWasTruncated(rows: number, limit?: number): boolean {
  return rows >= Math.min(POSTGREST_MAX_ROWS, limit ?? Number.POSITIVE_INFINITY);
}

/** Tom da atividade vencida na fila: prioridade crítica ou bloqueada = perigo; o resto, aviso. */
export function overdueActivityTone(a: { priority: string; delay_status: string }): 'danger' | 'warning' {
  return a.priority === 'critical' || a.delay_status === 'blocked' ? 'danger' : 'warning';
}

/** Tom da falta de material na fila: necessidade (`required_by`) até `dangerUntil` = perigo; depois, aviso. */
export function materialShortageTone(requiredBy: string | null, dangerUntil: string): 'danger' | 'warning' {
  return requiredBy && requiredBy <= dangerUntil ? 'danger' : 'warning';
}

/** Contagem por tipo da fila (total, perigo, aviso) — sobre TODOS os candidatos. */
export function tallyAttention(entries: Iterable<{ kind: AttentionKind; tone: AttentionTone }>): AttentionCounts {
  const out = Object.fromEntries(ATTENTION_KINDS.map((k) => [k, { total: 0, danger: 0, warning: 0 }])) as AttentionCounts;
  for (const e of entries) {
    const c = out[e.kind];
    c.total += 1;
    if (e.tone === 'danger') c.danger += 1;
    else if (e.tone === 'warning') c.warning += 1;
  }
  return out;
}

export interface OverdueActivityLike {
  project_id: string;
  status: string;
  priority: string;
  delay_status: string;
  planned_finish: string | null;
  responsible_user_id: string | null;
}

export interface OverdueByProjectRow {
  projectId: string;
  project: string;
  client: string | null;
  /** Atividades-folha abertas com término planejado vencido. */
  count: number;
  /** Destas, bloqueadas (`delay_status` ou `status` = blocked — a mesma leitura da saúde do projeto). */
  blocked: number;
  /** Destas, de prioridade `critical`. */
  critical: number;
  /** O término planejado mais antigo entre as vencidas. */
  oldestDue: string | null;
  /** Responsáveis distintos, por nome resolvido, das mais antigas para as mais novas. */
  ownerNames: string[];
}

/**
 * Atividades vencidas agrupadas por projeto (ativo ou não) — uma linha por
 * projeto, ordenada por bloqueadas ↓, críticas ↓, vencimento mais antigo ↑.
 * Recebe JÁ filtradas por `isOverdueActivity`.
 */
export function groupOverdueByProject(
  overdue: readonly OverdueActivityLike[],
  projectOf: (id: string) => { name: string; client: string | null } | undefined,
  owners: Readonly<Record<string, string>>,
): OverdueByProjectRow[] {
  const sorted = [...overdue].sort((x, y) => (x.planned_finish ?? '').localeCompare(y.planned_finish ?? ''));
  const byProject = new Map<string, OverdueByProjectRow>();
  for (const a of sorted) {
    let row = byProject.get(a.project_id);
    if (!row) {
      const p = projectOf(a.project_id);
      row = { projectId: a.project_id, project: p?.name ?? a.project_id, client: p?.client ?? null,
        count: 0, blocked: 0, critical: 0, oldestDue: null, ownerNames: [] };
      byProject.set(a.project_id, row);
    }
    row.count += 1;
    if (a.delay_status === 'blocked' || a.status === 'blocked') row.blocked += 1;
    if (a.priority === 'critical') row.critical += 1;
    if (a.planned_finish && (!row.oldestDue || a.planned_finish < row.oldestDue)) row.oldestDue = a.planned_finish;
    const name = a.responsible_user_id ? owners[a.responsible_user_id] : undefined;
    if (name && !row.ownerNames.includes(name)) row.ownerNames.push(name);
  }
  return Array.from(byProject.values()).sort((a, b) =>
    b.blocked - a.blocked || b.critical - a.critical
    || (a.oldestDue ?? '9999').localeCompare(b.oldestDue ?? '9999')
    || a.project.localeCompare(b.project, 'pt-BR'));
}

/** Contagem por nível de saúde — sobre TODOS os projetos ativos. */
export function countHealthLevels(levels: Iterable<HealthLevel>): Record<HealthLevel, number> {
  const out: Record<HealthLevel, number> = { critical: 0, attention: 0, healthy: 0, unknown: 0 };
  for (const l of levels) out[l] += 1;
  return out;
}
