/**
 * SST — Saúde e Segurança do Trabalho a partir dos eventos do eSocial.
 *
 * Três eventos alimentam esta camada: S-2210 (CAT), S-2220 (ASO/monitoramento
 * da saúde) e S-2240 (condições ambientais, agentes nocivos). Até aqui eles
 * eram guardados como XML bruto e contados como `eventsStoredOnly` — existiam
 * no acervo e não existiam em lugar nenhum da interface.
 *
 * O PONTO DELICADO: VALIDADE DO ASO
 *
 * O leiaute do S-2220 **não declara data de vencimento**. Ele diz quando o
 * exame foi feito, de que tipo era e qual foi o resultado — e só. Um "ASO
 * vencido" na tela é, portanto, sempre uma conta que alguém fez.
 *
 * Fazer essa conta para todo exame seria confortável e errado: a periodicidade
 * legal varia por risco ocupacional, faixa etária e acordo coletivo, e um ASO
 * admissional não estabelece por si o calendário do periódico seguinte. Então a
 * regra aqui é estreita de propósito — só o exame **periódico** gera vencimento,
 * pela periodicidade anual da NR-7. Todo o resto sai com `null`, e o
 * trabalhador aparece em "ASO sem vencimento apurável" em vez de aparecer,
 * falsamente, em "em dia" ou em "vencido".
 *
 * A premissa fica visível aqui, exportada e comentada, em vez de escondida
 * dentro de um cálculo.
 */

import type { ParsedEsocialEvent } from './parser';

/** Periodicidade anual da NR-7 para o exame periódico. */
export const ASO_DEFAULT_PERIOD_MONTHS = 12;

/**
 * Periodicidade assumida por tipo de exame, em meses.
 *
 * `null` significa "não é possível apurar vencimento a partir deste exame" —
 * não significa "sem vencimento". A diferença é a razão de este mapa existir.
 */
const ASO_PERIOD_BY_EXAM_KIND: Record<string, number | null> = {
  '0': null, // admissional — inaugura o vínculo, não o calendário do periódico
  '1': ASO_DEFAULT_PERIOD_MONTHS, // periódico
  '2': null, // retorno ao trabalho
  '3': null, // mudança de risco ocupacional
  '4': null, // monitoração pontual
  '9': null, // demissional — encerra o vínculo
};

export const ASO_EXAM_KIND_LABELS: Record<string, string> = {
  '0': 'Admissional',
  '1': 'Periódico',
  '2': 'Retorno ao trabalho',
  '3': 'Mudança de risco',
  '4': 'Monitoração pontual',
  '9': 'Demissional',
};

export const ASO_RESULT_LABELS: Record<string, string> = {
  '1': 'Apto',
  '2': 'Inapto',
};

export const CAT_TYPE_LABELS: Record<string, string> = {
  '1': 'Inicial',
  '2': 'Reabertura',
  '3': 'Comunicação de óbito',
};

export const CAT_LOCAL_LABELS: Record<string, string> = {
  '1': 'Estabelecimento do empregador',
  '2': 'Estabelecimento de terceiros',
  '3': 'Via pública',
  '4': 'Área rural',
  '5': 'Embarcação',
  '9': 'Outros',
};

export const CAT_INITIATOR_LABELS: Record<string, string> = {
  '1': 'Iniciativa do empregador',
  '2': 'Ordem judicial',
  '3': 'Determinação de órgão fiscalizador',
};

export const RISK_ASSESSMENT_LABELS: Record<string, string> = {
  '1': 'Quantitativo',
  '2': 'Qualitativo',
};

/** Meses de validade assumidos para o exame, ou `null` quando não apurável. */
export function asoPeriodMonths(examKind?: string): number | null {
  if (!examKind) return null;
  return ASO_PERIOD_BY_EXAM_KIND[examKind.trim()] ?? null;
}

/**
 * Vencimento do ASO, ou `null` quando a periodicidade não é apurável.
 *
 * Nunca devolve uma data "por garantia": sem tipo de exame que estabeleça
 * periodicidade, não há vencimento a afirmar.
 */
export function asoValidUntil(asoDate?: string, examKind?: string): string | null {
  const months = asoPeriodMonths(examKind);
  if (months === null || !asoDate || !/^\d{4}-\d{2}-\d{2}/.test(asoDate)) return null;

  const [year, month, day] = asoDate.slice(0, 10).split('-').map(Number);
  // Dia 31 + 1 mês não existe em todo mês; o UTC normaliza para o mês seguinte,
  // o que antecipa o vencimento em vez de postergá-lo. Antecipar é o lado
  // seguro de um indicador de conformidade.
  const due = new Date(Date.UTC(year, month - 1 + months, day));
  return due.toISOString().slice(0, 10);
}

/** Linha de `esocial_sst_events` — espelha as colunas da migration 084. */
export interface SstEventRow {
  organization_id: string;
  esocial_event_id: string;
  event_type: 'S-2210' | 'S-2220' | 'S-2240';
  competence: string | null;
  event_date: string | null;
  worker_cpf_hash: string | null;
  worker_cpf_mask: string | null;
  worker_name: string | null;
  matricula: string | null;
  area_code: string | null;
  area_label: string | null;
  // CAT
  cat_type: string | null;
  accident_kind: string | null;
  local_kind: string | null;
  situation_code: string | null;
  /** iniciatCAT — CAT espontânea do empregador ou imposta por ordem judicial. */
  initiator: string | null;
  caused_leave: boolean | null;
  death_date: string | null;
  body_part_code: string | null;
  causing_agent_code: string | null;
  // ASO
  exam_kind: string | null;
  exam_result: string | null;
  aso_valid_until: string | null;
  aso_period_months: number | null;
  exams: { code?: string; date?: string; result?: string }[];
  // Exposição a risco
  exposure_start: string | null;
  exposure_end: string | null;
  environment_code: string | null;
  /** EPC/EPI vivem POR AGENTE — ver `RiskExposurePayload` no parser. */
  agents: {
    code?: string;
    description?: string;
    assessment?: string;
    intensity?: string;
    toleranceLimit?: string;
    unit?: string;
    epcEfficient?: boolean;
    epiEfficient?: boolean;
  }[];
}

/** Como o normalizador informa onde o trabalhador estava lotado. */
export type AreaResolver = (
  workerKey: string | undefined,
  competence: string | undefined,
) => { code: string; label: string } | undefined;

function emptyRow(
  organizationId: string,
  eventId: string,
  eventType: SstEventRow['event_type'],
): SstEventRow {
  return {
    organization_id: organizationId,
    esocial_event_id: eventId,
    event_type: eventType,
    competence: null,
    event_date: null,
    worker_cpf_hash: null,
    worker_cpf_mask: null,
    worker_name: null,
    matricula: null,
    area_code: null,
    area_label: null,
    cat_type: null,
    accident_kind: null,
    local_kind: null,
    situation_code: null,
    initiator: null,
    caused_leave: null,
    death_date: null,
    body_part_code: null,
    causing_agent_code: null,
    exam_kind: null,
    exam_result: null,
    aso_valid_until: null,
    aso_period_months: null,
    exams: [],
    exposure_start: null,
    exposure_end: null,
    environment_code: null,
    agents: [],
  };
}

/**
 * Linhas de SST a partir dos eventos já interpretados.
 *
 * A LOTAÇÃO vem do trabalhador, não do evento — exatamente como nos
 * afastamentos. Um S-2210 identifica quem se acidentou e não declara
 * `codLotacao`; sem herdar a lotação aprendida no S-1200, todo acidente cairia
 * em "sem lotação informada" e o recorte por área ficaria zerado justamente
 * onde ele mais importa.
 */
export function buildSstEvents(
  organizationId: string,
  events: ParsedEsocialEvent[],
  resolveArea: AreaResolver,
  workerKeyOf: (ev: ParsedEsocialEvent) => string | undefined,
  maskOf: (ev: ParsedEsocialEvent) => string | undefined,
  competenceOf: (ev: ParsedEsocialEvent) => string | undefined,
): SstEventRow[] {
  const rows = new Map<string, SstEventRow>();

  for (const ev of events) {
    const kind = ev.payload.kind;
    if (kind !== 'cat' && kind !== 'aso' && kind !== 'risk-exposure') continue;

    // Sem identidade de evento não há como deduplicar nem repor na reapuração;
    // uma linha órfã só polui a contagem.
    const eventId = ev.eventId;
    if (!eventId) continue;

    const eventType =
      kind === 'cat' ? 'S-2210' : kind === 'aso' ? 'S-2220' : ('S-2240' as const);
    const row = emptyRow(organizationId, eventId, eventType as SstEventRow['event_type']);

    const workerKey = workerKeyOf(ev);
    const competence = competenceOf(ev) ?? null;
    const where = resolveArea(workerKey, competence ?? undefined);

    row.competence = competence;
    row.event_date = ev.eventDate ?? null;
    row.worker_cpf_hash = workerKey ?? null;
    row.worker_cpf_mask = maskOf(ev) ?? null;
    row.worker_name = ev.workerName ?? null;
    row.matricula = ev.matricula ?? null;
    row.area_code = where?.code ?? ev.areaCode ?? null;
    row.area_label = where?.label ?? ev.areaLabel ?? null;

    if (ev.payload.kind === 'cat') {
      const p = ev.payload;
      row.event_date = p.accidentDate ?? row.event_date;
      row.cat_type = p.catType ?? null;
      row.accident_kind = p.accidentKind ?? null;
      row.local_kind = p.localKind ?? null;
      row.situation_code = p.situationCode ?? null;
      row.initiator = p.initiator ?? null;
      row.caused_leave = p.causedLeave ?? null;
      row.death_date = p.deathDate ?? null;
      row.body_part_code = p.bodyPartCode ?? null;
      row.causing_agent_code = p.causingAgentCode ?? null;
    } else if (ev.payload.kind === 'aso') {
      const p = ev.payload;
      row.event_date = p.asoDate ?? row.event_date;
      row.exam_kind = p.examKind ?? null;
      row.exam_result = p.result ?? null;
      row.aso_period_months = asoPeriodMonths(p.examKind);
      row.aso_valid_until = asoValidUntil(p.asoDate, p.examKind);
      row.exams = p.exams;
    } else {
      const p = ev.payload;
      row.event_date = p.startDate ?? row.event_date;
      row.exposure_start = p.startDate ?? null;
      row.exposure_end = p.endDate ?? null;
      row.environment_code = p.environmentCode ?? null;
      row.agents = p.agents;
    }

    // Retificação reenvia o mesmo Id; a última leitura vence.
    rows.set(eventId, row);
  }

  return [...rows.values()];
}
