/**
 * Camada de EVIDÊNCIA DE EXECUÇÃO — normaliza registros operacionais.
 *
 * A premissa do P2: antes de pedir digitação, verificar se o valor já existe
 * em algum registro operacional. Este módulo não inventa integração nenhuma —
 * ele lê o que os módulos vizinhos já gravam e traduz para uma forma única:
 *
 *   time_entries          apontamento consolidado           (041)
 *   project_work_sessions cronômetro do app de Ponto        (041)
 *   attendance_punches    batida de ponto (+ localização)   (045)
 *   daily_allowances      diária de campo já reconciliada   (allowances)
 *   project_files         documento entregue na etapa       (032)
 *
 * ─── Fatos × derivação ─────────────────────────────────────────────────────
 * Aqui só entram FATOS OBSERVADOS: o que aconteceu, quando, por quem, com que
 * registro de origem. Nenhuma interpretação. Casar evidência com etapa é
 * responsabilidade de `execution-matching.ts`; concluir estado de execução é de
 * `execution-derivation.ts`. Manter as três camadas separadas é o que permite
 * auditar de onde cada número veio.
 *
 * Puro: sem Supabase, sem React.
 */

import type { ProjectWorkSession, TimeEntry } from '@/lib/types/people';

/** De qual tabela o registro veio. */
export type EvidenceSource =
  | 'time_entry'
  | 'work_session'
  | 'attendance_punch'
  | 'daily_allowance'
  | 'project_document';

/** O que o registro evidencia, independente da tabela. */
export type EvidenceKind =
  | 'work_logged'      // esforço declarado e consolidado
  | 'work_session'     // sessão de trabalho cronometrada
  | 'presence'         // presença registrada (batida de ponto)
  | 'field_presence'   // presença em campo com diária reconhecida
  | 'deliverable';     // artefato entregue

/**
 * Como um campo foi obtido. A trilha acompanha a evidência inteira para que
 * qualquer número exibido possa ser rastreado até o registro de origem.
 */
export interface ProvenanceStep {
  field: 'projectId' | 'timelineItemId' | 'personId' | 'occurredAt' | 'durationMinutes' | 'location';
  /** 'source' = veio explícito do registro; 'derived' = calculado aqui. */
  origin: 'source' | 'derived';
  detail: string;
}

export interface EvidenceLocation {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  /** Geofence já resolvido no registro de origem (hoje sempre nulo no dado real). */
  geofenceId: string | null;
}

export interface ExecutionEvidence {
  /** Chave sintética estável: `${source}:${sourceRecordId}`. */
  id: string;
  source: EvidenceSource;
  sourceRecordId: string;
  kind: EvidenceKind;

  /** Vínculos EXPLÍCITOS do registro. null = o registro não afirma. */
  projectId: string | null;
  timelineItemId: string | null;
  personId: string | null;

  occurredAt: string;
  /** Duração observada. null quando o registro não mede tempo (ex.: batida). */
  durationMinutes: number | null;
  location: EvidenceLocation | null;

  /** Registro descartado/rejeitado na origem não é evidência de execução. */
  isValid: boolean;
  /**
   * Discriminador da própria fonte (ex.: `clock_in` numa batida). Genérico de
   * propósito: quem consome decide se entende — a reconstrução de sessão
   * precisa distinguir entrada de intervalo sem que o modelo comum vire um
   * catálogo de campos específicos de cada tabela.
   */
  subtype: string | null;
  /** Rótulo curto para a UI. */
  label: string;
  provenance: ProvenanceStep[];
}

const p = (field: ProvenanceStep['field'], origin: ProvenanceStep['origin'], detail: string): ProvenanceStep =>
  ({ field, origin, detail });

/* ───────────────────────── Adaptadores por fonte ───────────────────────── */

export function fromTimeEntry(entry: TimeEntry): ExecutionEvidence {
  return {
    id: `time_entry:${entry.id}`,
    source: 'time_entry',
    sourceRecordId: entry.id,
    kind: 'work_logged',
    projectId: entry.projectId,
    timelineItemId: entry.timelineItemId,
    personId: entry.personId,
    occurredAt: `${entry.workDate}T12:00:00`,
    durationMinutes: entry.minutes,
    location: null,
    // Lançamento rejeitado não evidencia execução aceita.
    isValid: entry.status !== 'rejected',
    subtype: entry.status,
    label: `${(entry.minutes / 60).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h apontadas`,
    provenance: [
      p('projectId', 'source', 'time_entries.project_id'),
      p('timelineItemId', 'source', 'time_entries.timeline_item_id'),
      p('personId', 'source', 'time_entries.person_id'),
      p('occurredAt', 'derived', 'work_date ancorado ao meio-dia (precisão de dia)'),
      p('durationMinutes', 'source', 'time_entries.minutes'),
    ],
  };
}

export function fromWorkSession(session: ProjectWorkSession): ExecutionEvidence {
  return {
    id: `work_session:${session.id}`,
    source: 'work_session',
    sourceRecordId: session.id,
    kind: 'work_session',
    projectId: session.projectId,
    timelineItemId: session.timelineItemId,
    personId: session.personId,
    occurredAt: session.startedAt,
    durationMinutes: session.durationMinutes,
    location: null,
    isValid: session.status !== 'discarded',
    subtype: session.status,
    label: session.status === 'running' ? 'Sessão em andamento' : 'Sessão de trabalho',
    provenance: [
      p('projectId', 'source', 'project_work_sessions.project_id'),
      p('timelineItemId', 'source', 'project_work_sessions.timeline_item_id'),
      p('personId', 'source', 'project_work_sessions.person_id'),
      p('occurredAt', 'source', 'project_work_sessions.started_at'),
      p('durationMinutes', 'source', 'project_work_sessions.duration_minutes'),
    ],
  };
}

/** Linha crua de attendance_punches + location_evidence (join no serviço). */
export interface AttendancePunchRow {
  id: string;
  personId: string;
  type: string;
  occurredAt: string;
  status: string;
  location: EvidenceLocation | null;
}

const PUNCH_LABELS: Record<string, string> = {
  clock_in: 'Entrada registrada',
  clock_out: 'Saída registrada',
  break_start: 'Início de intervalo',
  break_end: 'Fim de intervalo',
};

export function fromAttendancePunch(row: AttendancePunchRow): ExecutionEvidence {
  const provenance = [
    // A batida NÃO carrega projeto: attendance_punches não tem project_id.
    // Qualquer projeto virá de inferência no matching, nunca daqui.
    p('personId', 'source', 'attendance_punches.person_id'),
    p('occurredAt', 'source', 'attendance_punches.occurred_at'),
  ];
  if (row.location) provenance.push(p('location', 'source', 'location_evidence (lat/lng)'));

  return {
    id: `attendance_punch:${row.id}`,
    source: 'attendance_punch',
    sourceRecordId: row.id,
    kind: 'presence',
    projectId: null,
    timelineItemId: null,
    personId: row.personId,
    occurredAt: row.occurredAt,
    // Batida marca um INSTANTE. Transformar par entrada/saída em duração é
    // trabalho do módulo de jornada, não desta camada.
    durationMinutes: null,
    location: row.location,
    isValid: row.status !== 'cancelled' && row.status !== 'rejected',
    // A reconstrução de sessão depende disto para distinguir entrada,
    // intervalo e saída — o label em pt-BR é para gente, não para máquina.
    subtype: row.type,
    label: PUNCH_LABELS[row.type] ?? 'Batida de ponto',
    provenance,
  };
}

/** Linha crua de daily_allowances. */
export interface DailyAllowanceRow {
  id: string;
  personId: string;
  projectId: string | null;
  allowanceDate: string;
  status: string;
}

export function fromDailyAllowance(row: DailyAllowanceRow): ExecutionEvidence {
  return {
    id: `daily_allowance:${row.id}`,
    source: 'daily_allowance',
    sourceRecordId: row.id,
    kind: 'field_presence',
    // A diária JÁ foi reconciliada contra ponto e geofence na origem: o
    // project_id dela é afirmação do módulo de diárias, não inferência nossa.
    projectId: row.projectId,
    timelineItemId: null,
    personId: row.personId,
    occurredAt: `${row.allowanceDate}T12:00:00`,
    durationMinutes: null,
    location: null,
    isValid: row.status !== 'cancelled' && row.status !== 'rejected' && row.status !== 'blocked',
    subtype: row.status,
    label: 'Diária de campo',
    provenance: [
      p('projectId', 'source', 'daily_allowances.project_id (reconciliado na origem)'),
      p('personId', 'source', 'daily_allowances.person_id'),
      p('occurredAt', 'derived', 'allowance_date ancorado ao meio-dia'),
    ],
  };
}

/** Linha crua de project_files. */
export interface ProjectDocumentRow {
  id: string;
  projectId: string;
  timelineItemId: string | null;
  fileName: string;
  createdAt: string;
}

export function fromProjectDocument(row: ProjectDocumentRow): ExecutionEvidence {
  return {
    id: `project_document:${row.id}`,
    source: 'project_document',
    sourceRecordId: row.id,
    kind: 'deliverable',
    projectId: row.projectId,
    timelineItemId: row.timelineItemId,
    // project_files.created_by é auth.users, não people — sem pessoa confiável.
    personId: null,
    occurredAt: row.createdAt,
    durationMinutes: null,
    location: null,
    isValid: true,
    subtype: null,
    label: `Documento: ${row.fileName}`,
    provenance: [
      p('projectId', 'source', 'project_files.project_id'),
      p('timelineItemId', 'source', 'project_files.timeline_item_id'),
      p('occurredAt', 'source', 'project_files.created_at'),
    ],
  };
}

/* ───────────────────────── Disponibilidade por fonte ───────────────────────── */

/**
 * Cada fonte tem a SUA permissão e degrada sozinha.
 *
 * Isso importa porque as RLS de `time_entries` (041) e `attendance_punches`
 * (045) devolvem SILENCIOSAMENTE apenas as linhas do próprio usuário quando
 * falta a permissão de leitura ampla. Tratar isso como "não há evidência"
 * produziria taxas de autonomia falsas. Sem permissão, a fonte é declarada
 * `unauthorized` e fica FORA de qualquer denominador.
 */
export type SourceAvailability = 'available' | 'unauthorized' | 'unavailable';

export type EvidenceSourceStatus = Record<EvidenceSource, SourceAvailability>;

export const EMPTY_SOURCE_STATUS: EvidenceSourceStatus = {
  time_entry: 'unavailable',
  work_session: 'unavailable',
  attendance_punch: 'unavailable',
  daily_allowance: 'unavailable',
  project_document: 'unavailable',
};

export const EVIDENCE_SOURCE_LABELS: Record<EvidenceSource, string> = {
  time_entry: 'Apontamento',
  work_session: 'Sessão de trabalho',
  attendance_punch: 'Ponto',
  daily_allowance: 'Diária de campo',
  project_document: 'Documento',
};

/** Ordena por instante, mais recente primeiro; desempate estável pelo id. */
export function sortEvidence(evidence: ExecutionEvidence[]): ExecutionEvidence[] {
  return [...evidence].sort((a, b) => {
    if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
