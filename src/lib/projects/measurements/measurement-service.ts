'use client';

/**
 * MEDIÇÃO DE PROJETO — acesso do lado do cliente.
 *
 * ─── O que este módulo pode e o que não pode ───────────────────────────────
 *
 * Pode LER (o modelo de leitura canônico e as tabelas do pacote) e pode CHAMAR
 * as RPCs de transição. NÃO pode escrever medição, evidência, exigência nem
 * história: `authenticated` só tem SELECT nessas tabelas (migrations 130–133),
 * e isso é deliberado. Houvesse caminho de escrita direto, a validação de
 * estado, ator, proveniência e prontidão viraria opcional — bastaria não usar
 * a RPC. É a mesma decisão do Motor de Aprovação da Fase 5.
 *
 * ─── O ator ────────────────────────────────────────────────────────────────
 *
 * Nenhuma função abaixo envia "quem aceitou". A RPC lê `auth.uid()` por conta
 * própria. Se alguém acrescentar esse parâmetro aqui, ele não existirá do
 * outro lado — e é assim que se quer.
 */

import { createClient } from '@/utils/supabase/client';
import {
  parseReadiness,
  type AcceptanceSource, type EvidenceClass, type EvidenceLinkSource,
  type EvidenceSourceType, type MeasurementEvidenceRow, type MeasurementHistoryRow,
  type MeasurementPackage, type MeasurementReadiness, type MeasurementRequirementRow,
  type MeasurementStatus, type ProjectMeasurementRow, type RequirementKind,
} from './types';

/** Erro do domínio com o CÓDIGO preservado, para a tela explicar o bloqueio. */
export class MeasurementError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'MeasurementError';
  }
}

/*
  O banco levanta `CODE: mensagem`. Preservar o código é o que permite à tela
  dizer "esta medição ainda não está pronta, falta o relatório" em vez de
  despejar o texto cru do Postgres.
*/
const KNOWN_CODES = new Set([
  'MEASUREMENT_NOT_FOUND', 'MEASUREMENT_FINALIZED', 'INVALID_TRANSITION',
  'PERMISSION_DENIED', 'NOT_READY', 'REASON_REQUIRED',
  'ACCEPTANCE_NEVER_AUTOMATED', 'ACCEPTANCE_SOURCE_REQUIRED', 'ACCEPTANCE_PROVENANCE_REQUIRED',
  'CROSS_TENANT_EVIDENCE', 'WRONG_PROJECT', 'NOT_DETERMINISTIC',
  'SOURCE_INVALID', 'SOURCE_NOT_FOUND', 'SOURCE_TYPE_UNSUPPORTED',
  'EVIDENCE_NOT_FOUND', 'ORG_REQUIRED', 'HORIZON_OUT_OF_RANGE', 'LIMIT_OUT_OF_RANGE',
  'MAPPING_NOT_GOVERNED', 'ORIGIN_INVALID',
]);

export const MEASUREMENT_ERROR_MESSAGE: Record<string, string> = {
  ACCEPTANCE_NEVER_AUTOMATED:
    'O aceite de medição nunca é automático. É preciso uma pessoa autorizada ou a proveniência do aceite externo.',
  ACCEPTANCE_SOURCE_REQUIRED: 'Informe de onde vem o aceite antes de registrá-lo.',
  ACCEPTANCE_PROVENANCE_REQUIRED:
    'Aceite externo precisa da parte, do documento ou da referência que o comprova.',
  PERMISSION_DENIED: 'Você não tem permissão para esta ação sobre medições.',
  NOT_READY: 'A medição ainda não está pronta para submissão. Veja o que falta no pacote.',
  MEASUREMENT_FINALIZED: 'Esta medição já foi finalizada e o pacote dela não muda mais.',
  INVALID_TRANSITION: 'Esta transição não é permitida a partir do estado atual.',
  REASON_REQUIRED: 'Informe o motivo.',
  CROSS_TENANT_EVIDENCE: 'Este registro pertence a outra organização.',
  WRONG_PROJECT: 'Este registro pertence a outro projeto.',
  NOT_DETERMINISTIC:
    'Esta origem não declara o projeto. Ela pode entrar como evidência inferida, não como vínculo determinístico.',
  SOURCE_INVALID: 'Este registro foi descartado ou não concluído, e por isso não é evidência de execução.',
  MAPPING_NOT_GOVERNED:
    'Este marco ainda não tem etapa de cronograma aceita. Vincule-o na aba Timeline — '
    + 'sem a ponte aceita não há data nem etapa contra a qual medir.',
};

function toMeasurementError(message: string): MeasurementError {
  // `[\s\S]` em vez da flag `s`, pelo alvo de compilação do projeto.
  const m = /^([A-Z_]+):\s*([\s\S]*)$/.exec(message.replace(/^ERROR:\s*/, ''));
  if (m && KNOWN_CODES.has(m[1])) return new MeasurementError(m[1], m[2].trim());
  return new MeasurementError('UNKNOWN', message);
}

const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await createClient().rpc(fn, args);
  if (error) throw toMeasurementError(error.message);
  return data as T;
};

// ════════════════════════════════════════════════════════════════════
// LEITURA
// ════════════════════════════════════════════════════════════════════

const READ_MODEL = 'project_measurement_read_model';

/**
 * As instâncias de medição JÁ MATERIALIZADAS de um projeto.
 *
 * Deliberadamente NÃO é a fila de trabalho da aba Medições & Evidências. A
 * fila nasce da ponte aceita ao cronograma (`project_schedule_contract_events`)
 * porque a instância canônica só existe depois da materialização governada
 * (migration 134) — e ler esta lista como se fosse o trabalho do projeto é
 * exatamente o que produzia "Nenhuma medição registrada" sobre cinco
 * mapeamentos aceitos. Ver `src/lib/projects/milestone-worklist.ts`.
 */
export async function listProjectMeasurements(projectId: string): Promise<ProjectMeasurementRow[]> {
  const { data, error } = await createClient()
    .from(READ_MODEL)
    .select('*')
    .eq('project_id', projectId)
    // Vivas primeiro, e dentro delas a mais próxima do prazo. Substituída e
    // cancelada ficam no fim porque são história, não trabalho.
    .order('expected_at', { ascending: true, nullsFirst: false });
  if (error) throw toMeasurementError(error.message);
  return (data ?? []) as ProjectMeasurementRow[];
}

export async function listContractMeasurements(contractId: string): Promise<ProjectMeasurementRow[]> {
  const { data, error } = await createClient()
    .from(READ_MODEL)
    .select('*')
    .eq('contract_id', contractId)
    .order('expected_at', { ascending: true, nullsFirst: false });
  if (error) throw toMeasurementError(error.message);
  return (data ?? []) as ProjectMeasurementRow[];
}

export async function getProjectMeasurement(id: string): Promise<ProjectMeasurementRow | null> {
  const { data, error } = await createClient()
    .from(READ_MODEL).select('*').eq('id', id).maybeSingle();
  if (error) throw toMeasurementError(error.message);
  return (data ?? null) as ProjectMeasurementRow | null;
}

/**
 * Prontidão AO VIVO, direto do resolvedor canônico.
 *
 * O modelo de leitura traz o cache, que é suficiente para uma lista. Antes de
 * agir sobre uma medição a tela chama isto: um cache de ontem diria "pronta"
 * sobre um pacote que perdeu evidência hoje.
 */
export async function resolveReadiness(id: string, asOf?: string): Promise<MeasurementReadiness> {
  const raw = await rpc<unknown>('project_measurement_readiness', {
    p_measurement_id: id, p_as_of: asOf ?? null,
  });
  return parseReadiness(raw);
}

export async function getMeasurementPackage(id: string): Promise<MeasurementPackage | null> {
  const supabase = createClient();
  const measurement = await getProjectMeasurement(id);
  if (!measurement) return null;

  const [requirements, evidence, history] = await Promise.all([
    supabase.from('project_measurement_requirements').select('*')
      .eq('measurement_id', id).order('requirement_kind'),
    supabase.from('project_measurement_evidence').select('*')
      .eq('measurement_id', id).order('linked_at'),
    supabase.from('project_measurement_history').select('*')
      .eq('measurement_id', id).order('recorded_at'),
  ]);

  for (const r of [requirements, evidence, history]) {
    if (r.error) throw toMeasurementError(r.error.message);
  }

  return {
    measurement,
    requirements: (requirements.data ?? []) as MeasurementRequirementRow[],
    evidence: (evidence.data ?? []) as MeasurementEvidenceRow[],
    history: (history.data ?? []) as MeasurementHistoryRow[],
    readiness: parseReadiness(
      await rpc<unknown>('project_measurement_readiness', { p_measurement_id: id, p_as_of: null }),
      measurement.readiness_computed_at,
    ),
  };
}

// ════════════════════════════════════════════════════════════════════
// TRANSIÇÕES GOVERNADAS
// ════════════════════════════════════════════════════════════════════

export interface TransitionResult {
  readonly measurement_id: string;
  readonly status: MeasurementStatus;
  readonly event_id?: string;
  readonly revision: number;
  readonly idempotent?: boolean;
}

export const prepareMeasurement = (id: string) =>
  rpc<TransitionResult>('project_measurement_prepare', { p_measurement_id: id });

export const markMeasurementReady = (id: string) =>
  rpc<TransitionResult>('project_measurement_mark_ready', { p_measurement_id: id });

export const submitMeasurement = (id: string, note?: string) =>
  rpc<TransitionResult>('project_measurement_submit', { p_measurement_id: id, p_note: note ?? null });

/**
 * ACEITE.
 *
 * Repare no que a assinatura NÃO tem: quem aceitou. Para fonte interna, o ator
 * é a pessoa autenticada e o banco a lê sozinho; para fonte externa, o que
 * viaja é a PROVENIÊNCIA — a parte, o documento ou a referência do aceite —,
 * nunca um usuário interno fazendo as vezes do cliente.
 */
export interface AcceptInput {
  readonly measurementId: string;
  readonly source: AcceptanceSource;
  readonly acceptedQuantity?: number | null;
  readonly acceptedValue?: number | null;
  readonly acceptedCurrency?: string | null;
  readonly acceptedByPartyId?: string | null;
  readonly externalReference?: string | null;
  readonly acceptanceDocumentId?: string | null;
  readonly note?: string | null;
}

export const acceptMeasurement = (input: AcceptInput) =>
  rpc<TransitionResult>('project_measurement_accept', {
    p_measurement_id: input.measurementId,
    p_acceptance_source: input.source,
    p_accepted_quantity: input.acceptedQuantity ?? null,
    p_accepted_value: input.acceptedValue ?? null,
    p_accepted_currency: input.acceptedCurrency ?? null,
    p_accepted_by_party_id: input.acceptedByPartyId ?? null,
    p_external_reference: input.externalReference ?? null,
    p_acceptance_document_id: input.acceptanceDocumentId ?? null,
    p_note: input.note ?? null,
  });

/** Decisão negativa. NÃO é o mesmo que devolver para correção. */
export const rejectMeasurement = (id: string, reason: string) =>
  rpc<TransitionResult>('project_measurement_reject', { p_measurement_id: id, p_reason: reason });

/** Devolver: o pacote volta para preparação e pode ser reenviado. */
export const returnMeasurement = (id: string, reason: string) =>
  rpc<TransitionResult>('project_measurement_return', { p_measurement_id: id, p_reason: reason });

export const cancelMeasurement = (id: string, reason?: string) =>
  rpc<TransitionResult>('project_measurement_cancel', { p_measurement_id: id, p_reason: reason ?? null });

/** O ÚNICO caminho para mudar verdade aceita. Cria revisão, não desfaz aceite. */
export const supersedeMeasurement = (id: string, reason: string) =>
  rpc<{ superseded_id: string; new_measurement_id: string; event_id: string }>(
    'project_measurement_supersede', { p_measurement_id: id, p_reason: reason });

// ════════════════════════════════════════════════════════════════════
// EVIDÊNCIA
// ════════════════════════════════════════════════════════════════════

export interface LinkEvidenceInput {
  readonly measurementId: string;
  readonly sourceType: EvidenceSourceType;
  readonly sourceId: string;
  readonly evidenceClass?: EvidenceClass;
  readonly linkSource?: EvidenceLinkSource;
  readonly confidence?: number | null;
  readonly requirementKind?: RequirementKind | null;
  readonly provenance?: Record<string, unknown>;
  readonly note?: string | null;
}

/**
 * Vincula evidência — CAMINHO DE SERVIDOR.
 *
 * ⚠ `project_measurement_link_evidence` está REVOKEd de `authenticated` desde
 * a 131, e o comentário dela diz o motivo: ela valida inquilino, projeto e
 * validade da origem, mas NÃO verifica permissão — porque foi desenhada para
 * ser chamada por rota que já autorizou o pedido. Chamá-la do navegador
 * devolve `permission denied`.
 *
 * Para anexar documento a partir da tela, use `attachDocumentToMeasurement`:
 * ela passa pela porta estreita da 191, que tem portão de permissão próprio.
 */
export const linkMeasurementEvidence = (input: LinkEvidenceInput) =>
  rpc<string>('project_measurement_link_evidence', {
    p_measurement_id: input.measurementId,
    p_source_type: input.sourceType,
    p_source_id: input.sourceId,
    p_evidence_class: input.evidenceClass ?? 'RAW_EVIDENCE',
    p_link_source: input.linkSource ?? 'deterministic',
    p_confidence: input.confidence ?? null,
    p_requirement_kind: input.requirementKind ?? null,
    p_provenance: input.provenance ?? {},
    p_note: input.note ?? null,
    p_linked_by: null,
  });

/**
 * ANEXAR DOCUMENTO À MEDIÇÃO — a porta do navegador (migration 191).
 *
 * Estreita por desenho: só origem `project_file`, só evidência BRUTA, só
 * vínculo manual, e só para quem tem `projects.measurements.edit`. O tipo, a
 * classe e a procedência não são parâmetros — nem aqui nem no banco.
 *
 * Idempotente: anexar o mesmo documento duas vezes devolve o mesmo vínculo.
 */
export const attachDocumentToMeasurement = (
  measurementId: string,
  documentId: string,
  requirementKind?: RequirementKind | null,
) =>
  rpc<string>('project_measurement_attach_document', {
    p_measurement_id: measurementId,
    p_document_id: documentId,
    p_requirement_kind: requirementKind ?? null,
  });

/** Revogar não apaga: preserva que o vínculo existiu e por que saiu. */
export const revokeMeasurementEvidence = (evidenceId: string, reason: string) =>
  rpc<void>('project_measurement_revoke_evidence', { p_evidence_id: evidenceId, p_reason: reason });

// ════════════════════════════════════════════════════════════════════
// MATERIALIZAÇÃO (migration 190)
// ════════════════════════════════════════════════════════════════════

/**
 * ABRIR A MEDIÇÃO do marco quando o gatilho ocorreu no mundo antes de o
 * cronograma registrá-lo.
 *
 * ─── Por que isto existe, e por que é um BOTÃO ────────────────────────────
 *
 * O caminho normal não passa por aqui: quando a etapa governada é concluída,
 * o gatilho da 190 materializa a medição na mesma transação, sem ninguém
 * pedir. Esta chamada é a válvula para o descompasso — o equipamento saiu na
 * sexta, a etapa só fecha na segunda, e a operação precisa começar a reunir
 * evidência antes disso.
 *
 * É botão, e não efeito de carregamento de tela, de propósito: criar registro
 * de medição porque alguém ABRIU uma aba faria o sistema inventar trabalho a
 * partir de curiosidade. A RPC exige `auth.uid()` e
 * `projects.measurements.edit`; sem os dois, ela recusa.
 *
 * O que ela NÃO faz: não conclui a etapa, não mede, não aceita e não fatura.
 * A instância nasce PLANNED — e a chave de ocorrência é a mesma do gatilho,
 * então concluir a etapa depois reencontra esta linha em vez de criar outra.
 */
export const ensureMeasurementForMilestone = (milestoneId: string) =>
  rpc<string | null>('project_measurement_ensure_for_milestone', {
    p_milestone_id: milestoneId,
  });
