/**
 * A FILA DE TRABALHO DO MARCO — lógica pura, sem banco e sem JSX.
 *
 * ─── A pergunta que este módulo responde ───────────────────────────────────
 *
 * "Que trabalho de medição este projeto tem em aberto, e o que trava cada um?"
 *
 * A resposta nasce de UMA fonte: `project_schedule_contract_events` (181/182),
 * já normalizada em `ProjectContractEvent`. É a mesma linha que o Gantt usa
 * para desenhar a sobreposição EVENTO DE MEDIÇÃO e a mesma identidade de marco
 * que Contratos usa na bancada. Não existe cópia, não existe segundo id, e não
 * existe registro criado aqui.
 *
 * ─── Por que um ITEM DE TRABALHO não é uma MEDIÇÃO ─────────────────────────
 *
 * Mapeamento ACEITO dá ao marco um lugar e uma data no cronograma. Isso o torna
 * TRABALHO PREVISTO — não medição realizada, não medição registrada, nem sequer
 * linha em `project_measurements`. A instância canônica de medição continua
 * nascendo só pela materialização governada (migration 134); enquanto ela não
 * existe, o item aparece com `measurement.pending = true` e diz exatamente
 * isso.
 *
 * Era esta distinção que faltava: a aba lia `project_measurements` e, sem linha
 * lá, escrevia "Nenhuma medição registrada" sobre um projeto com cinco pontes
 * aceitas. A ausência da INSTÂNCIA virava afirmação sobre o CONTRATO.
 *
 * ─── O que este módulo recusa fazer ────────────────────────────────────────
 *
 *   · Não deriva estágio próprio. Chama `deriveBillingPlanState`, que chama
 *     `deriveStage` — a máquina canônica de `milestone-stage.ts`.
 *   · Não converte evidência anexada em medição, nem medição em aceite, nem
 *     aceite em elegibilidade. Cada faceta abaixo lê o campo da SUA autoridade.
 *   · Não inventa quantia. Sem portão de valor a faceta diz "Restrito"; sem
 *     dado, "Não apurado". Nunca R$ 0,00.
 */

import {
  BILLING_PLAN_STATE_LABEL, deriveBillingPlanState,
  type BillingPlanState,
} from '@/lib/contracts/billing/planning/monthly-planning';
import {
  LINK_STATE_SHORT, LINK_STATE_TONE, eventNumberLabel, isGoverned,
  type ProjectContractEvent,
} from '@/lib/projects/contract-events';
import { MEASUREMENT_STATUS_LABEL } from '@/lib/projects/measurements/types';
import { extractMilestoneSequence } from '@/lib/contracts/billing/planning/milestone-timeline-matcher';

/** Os mesmos tons do sistema de tokens do dossiê. Nenhum vocabulário novo. */
export type FacetTone = 'neutral' | 'accent' | 'positive' | 'attention' | 'critical';

/**
 * Uma faceta do marco: o que UMA autoridade afirma sobre ele.
 *
 * `dashed` é o vocabulário reservado de NÃO APURADO, idêntico ao do dossiê: a
 * borda tracejada diz "ninguém apurou isto" sem gastar uma frase.
 */
export interface Facet {
  readonly label: string;
  readonly tone: FacetTone;
  readonly dashed: boolean;
  /** A explicação longa, para `title`. Opcional por desenho: nem tudo precisa. */
  readonly hint?: string;
}

/**
 * O agrupamento da fila — por O QUE BLOQUEIA, não por nome de status.
 *
 * Deriva de `BillingPlanState`, que deriva de `MilestoneStage`. Três nomes para
 * a mesma cadeia seria uma máquina nova; por isso o mapa abaixo é total e
 * explícito, e não um `switch` com ramo `default`.
 */
export type WorkBucket =
  | 'REMAP_REQUIRED'
  | 'PENDING_MAPPING'
  | 'BLOCKED'
  | 'AWAITING_TRIGGER'
  | 'AWAITING_EVIDENCE'
  | 'AWAITING_MEASUREMENT'
  | 'AWAITING_ACCEPTANCE'
  | 'ELIGIBLE'
  | 'SETTLED';

export const BUCKET_LABEL: Record<WorkBucket, string> = {
  REMAP_REQUIRED: 'Requer remapeamento',
  PENDING_MAPPING: 'Aguardando mapeamento no cronograma',
  BLOCKED: 'Bloqueado',
  AWAITING_TRIGGER: 'Previsto — gatilho não ocorrido',
  AWAITING_EVIDENCE: 'Aguardando evidência',
  AWAITING_MEASUREMENT: 'Aguardando medição',
  AWAITING_ACCEPTANCE: 'Aguardando aceite',
  ELIGIBLE: 'Elegível para faturar',
  SETTLED: 'Concluído',
};

/** Ordem de exibição: o que exige decisão primeiro; história por último. */
export const BUCKET_ORDER: readonly WorkBucket[] = [
  'REMAP_REQUIRED',
  'BLOCKED',
  'AWAITING_EVIDENCE',
  'AWAITING_MEASUREMENT',
  'AWAITING_ACCEPTANCE',
  'ELIGIBLE',
  'AWAITING_TRIGGER',
  'PENDING_MAPPING',
  'SETTLED',
];

const BUCKET_BY_PLAN_STATE: Record<BillingPlanState, WorkBucket> = {
  PLANNED: 'AWAITING_TRIGGER',
  AWAITING_PROJECT_MILESTONE: 'AWAITING_TRIGGER',
  NOT_ASSESSED: 'AWAITING_TRIGGER',
  AWAITING_EVIDENCE: 'AWAITING_EVIDENCE',
  AWAITING_MEASUREMENT: 'AWAITING_MEASUREMENT',
  AWAITING_APPROVAL: 'AWAITING_ACCEPTANCE',
  ELIGIBLE: 'ELIGIBLE',
  BILLED: 'SETTLED',
  RECEIVED: 'SETTLED',
  BLOCKED: 'BLOCKED',
};

/**
 * Um item da fila de Medições & Evidências.
 *
 * `event` viaja inteiro de propósito: é a linha canônica, e copiar campo a
 * campo para cá criaria a segunda verdade que este módulo existe para evitar.
 */
export interface MilestoneWorkItem {
  readonly milestoneId: string;
  readonly contractId: string;
  readonly contractNumber: string | null;
  /** "MARCO 02", ou "EVENTO CONTRATUAL" quando o título não numera. */
  readonly eventLabel: string;
  readonly title: string;

  /** Ponte ACEITA: o item é trabalho acionável, e não pendência de setup. */
  readonly actionable: boolean;
  readonly bucket: WorkBucket;
  readonly planState: BillingPlanState;

  readonly timelineItemId: string | null;
  readonly timelineTitle: string | null;
  readonly timelineWbsCode: string | null;
  readonly plannedDate: string | null;

  /** Evidência VINCULADA à medição canônica + documento canônico do marco. */
  readonly evidenceCount: number;
  /** Existe instância de medição em `project_measurements`? */
  readonly measurementId: string | null;

  readonly schedule: Facet;
  readonly execution: Facet;
  readonly evidence: Facet;
  readonly measurement: Facet;
  readonly acceptance: Facet;
  readonly billing: Facet;

  readonly event: ProjectContractEvent;
}

const NOT_ASSESSED: Facet = { label: 'Não apurado', tone: 'neutral', dashed: true };

// ═══════════════════════════════════════════════════════════════════════════
// AS FACETAS — uma por autoridade, nunca deduzidas umas das outras
// ═══════════════════════════════════════════════════════════════════════════

/** CRONOGRAMA — autoridade: Projetos (o estado da ponte governada). */
function scheduleFacet(event: ProjectContractEvent): Facet {
  const governed = isGoverned(event.linkState);
  return {
    label: LINK_STATE_SHORT[event.linkState],
    tone: LINK_STATE_TONE[event.linkState] === 'accent' ? 'accent'
      : LINK_STATE_TONE[event.linkState] === 'attention' ? 'attention' : 'neutral',
    dashed: !governed,
    hint: governed && event.plan.timelineWbsCode
      ? `${event.plan.timelineWbsCode} · ${event.plan.timelineTitle ?? ''}`.trim()
      : undefined,
  };
}

/**
 * EXECUÇÃO — autoridade: cronograma do projeto.
 *
 * `actualFinish` ou `completed`. Percentual fica de fora pela mesma razão de
 * `milestone-stage.ts`: 100% é estimativa de quem atualizou a linha, e
 * promovê-la a conclusão é como avanço de projeto viraria direito de faturar.
 */
function executionFacet(event: ProjectContractEvent): Facet {
  const plan = event.plan;
  if (!isGoverned(event.linkState)) return NOT_ASSESSED;
  if (plan.timelineActualFinish !== null || plan.timelineStatus === 'completed') {
    return { label: 'Concluída', tone: 'positive', dashed: false };
  }
  if (plan.timelineStatus === 'blocked') return { label: 'Bloqueada', tone: 'critical', dashed: false };
  if (plan.timelineStatus === 'delayed') return { label: 'Atrasada', tone: 'attention', dashed: false };
  if (plan.timelineStatus === 'in_progress') return { label: 'Em andamento', tone: 'accent', dashed: false };
  if (plan.timelineStatus === 'cancelled') return { label: 'Cancelada', tone: 'neutral', dashed: false };
  return { label: 'Não iniciada', tone: 'neutral', dashed: false };
}

/**
 * EVIDÊNCIA — autoridade: o acervo documental do projeto.
 *
 * Anexar evidência NÃO é medir e NÃO é aceitar. A faceta conta arquivos e para
 * por aí; qualquer promoção disso a outro estado seria a confusão que a §12
 * proíbe explicitamente.
 */
function evidenceFacet(event: ProjectContractEvent, count: number): Facet {
  if (count > 0) {
    return {
      label: count === 1 ? '1 anexo' : `${count} anexos`,
      tone: 'positive',
      dashed: false,
    };
  }
  if (event.plan.evidenceRequired === true) {
    return { label: 'Sem evidência', tone: 'attention', dashed: false, hint: 'O contrato exige evidência para este marco.' };
  }
  if (event.plan.evidenceRequired === false) {
    return { label: 'Não exigida', tone: 'neutral', dashed: false };
  }
  // `null` é exigência NÃO REGISTRADA — lacuna contratual, não trabalho.
  return { label: 'Sem evidência', tone: 'neutral', dashed: true, hint: 'O contrato não declara se este marco exige evidência.' };
}

/**
 * MEDIÇÃO — autoridade: `project_measurements` (Projetos).
 *
 * Sem instância materializada a faceta diz AGUARDANDO, tracejado: o trabalho
 * está previsto e ninguém o apurou. Dizer "nenhuma medição" aqui seria afirmar
 * sobre o contrato o que só se sabe sobre a tabela.
 */
function measurementFacet(event: ProjectContractEvent): Facet {
  const plan = event.plan;
  if (plan.measurementId === null) {
    if (!isGoverned(event.linkState)) return NOT_ASSESSED;
    return {
      label: 'Aguardando',
      tone: 'attention',
      dashed: true,
      hint: 'Trabalho previsto pela ponte aceita. A instância de medição ainda não foi materializada.',
    };
  }
  if (plan.measurementStatus === null) return NOT_ASSESSED;
  const settled = plan.measurementStatus === 'ACCEPTED';
  const live = plan.measurementStatus === 'SUBMITTED' || plan.measurementStatus === 'UNDER_REVIEW';
  return {
    label: MEASUREMENT_STATUS_LABEL[plan.measurementStatus],
    tone: settled ? 'positive' : live ? 'accent' : 'attention',
    dashed: false,
  };
}

/**
 * ACEITE — autoridade: quem tem poder de aceitar (Contratante ou aceite
 * registrado no marco). Nunca derivado de execução nem de apuração própria.
 */
function acceptanceFacet(event: ProjectContractEvent): Facet {
  const plan = event.plan;
  if (plan.measurementAcceptedAt !== null || plan.measurementStatus === 'ACCEPTED') {
    return { label: 'Aceito', tone: 'positive', dashed: false };
  }
  if (plan.customerAcceptanceRequired === true) {
    return { label: 'Pendente', tone: 'attention', dashed: false, hint: 'O contrato exige aceite da Contratante neste marco.' };
  }
  if (plan.customerAcceptanceRequired === false) {
    return { label: 'Não exigido', tone: 'neutral', dashed: false };
  }
  return { label: 'Pendente', tone: 'neutral', dashed: true, hint: 'O contrato não declara exigência de aceite neste marco.' };
}

/**
 * FATURAMENTO — autoridade: Contratos/Faturamento, a jusante.
 *
 * O rótulo é uma APRESENTAÇÃO do estado canônico, não um estado novo: o motivo
 * completo viaja no `hint`, e ele é exatamente `BILLING_PLAN_STATE_LABEL`.
 */
function billingFacet(state: BillingPlanState): Facet {
  const hint = BILLING_PLAN_STATE_LABEL[state];
  switch (state) {
    case 'RECEIVED': return { label: 'Recebido', tone: 'positive', dashed: false, hint };
    case 'BILLED': return { label: 'Faturado', tone: 'positive', dashed: false, hint };
    case 'ELIGIBLE': return { label: 'Elegível', tone: 'accent', dashed: false, hint };
    case 'BLOCKED': return { label: 'Bloqueado', tone: 'critical', dashed: false, hint };
    case 'NOT_ASSESSED': return { ...NOT_ASSESSED, hint };
    default: return { label: 'Não elegível', tone: 'neutral', dashed: false, hint };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// A FILA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evidências anexadas por marco, quando existem fora da medição canônica.
 *
 * O acervo do projeto pode guardar evidência de um marco cuja instância de
 * medição ainda não nasceu. Contar só `measurementEvidenceCount` faria o
 * anexo recém-enviado sumir da tela que acabou de enviá-lo.
 */
export type EvidenceCountByMilestone = ReadonlyMap<string, number>;

export function toWorkItem(
  event: ProjectContractEvent,
  documentCounts: EvidenceCountByMilestone = new Map(),
): MilestoneWorkItem {
  const plan = event.plan;
  const planState = deriveBillingPlanState(plan);
  const governed = isGoverned(event.linkState);

  /*
    A contagem é o MÁXIMO das duas fontes, e não a soma: o mesmo documento
    canônico aparece nas duas quando já foi vinculado à medição, e somar
    contaria o único arquivo duas vezes — que é precisamente a duplicação que
    esta refatoração existe para eliminar.
  */
  const evidenceCount = Math.max(
    plan.measurementEvidenceCount ?? 0,
    documentCounts.get(plan.milestoneId) ?? 0,
  );

  const bucket: WorkBucket = event.linkState === 'ANCHOR_LOST'
    ? 'REMAP_REQUIRED'
    : governed
      ? BUCKET_BY_PLAN_STATE[planState]
      : 'PENDING_MAPPING';

  return {
    milestoneId: plan.milestoneId,
    contractId: plan.contractId,
    contractNumber: plan.contractNumber,
    eventLabel: eventNumberLabel(event),
    title: plan.title,

    actionable: governed,
    bucket,
    planState,

    timelineItemId: plan.timelineItemId,
    timelineTitle: plan.timelineTitle,
    timelineWbsCode: plan.timelineWbsCode,
    plannedDate: plan.plannedBillingDate,

    evidenceCount,
    measurementId: plan.measurementId,

    schedule: scheduleFacet(event),
    execution: executionFacet(event),
    evidence: evidenceFacet(event, evidenceCount),
    measurement: measurementFacet(event),
    acceptance: acceptanceFacet(event),
    billing: billingFacet(planState),

    event,
  };
}

/** Ordem: o bucket manda; dentro dele, o número do evento; depois o título. */
export function sortWorkItems(
  items: readonly MilestoneWorkItem[],
): readonly MilestoneWorkItem[] {
  const rank = (b: WorkBucket) => BUCKET_ORDER.indexOf(b);
  return [...items].sort((a, b) => {
    const byBucket = rank(a.bucket) - rank(b.bucket);
    if (byBucket !== 0) return byBucket;
    const seqA = extractMilestoneSequence(a.title) ?? 99;
    const seqB = extractMilestoneSequence(b.title) ?? 99;
    if (seqA !== seqB) return seqA - seqB;
    return a.title.localeCompare(b.title, 'pt-BR');
  });
}

export function buildWorklist(
  events: readonly ProjectContractEvent[],
  documentCounts: EvidenceCountByMilestone = new Map(),
): readonly MilestoneWorkItem[] {
  return sortWorkItems(events.map((e) => toWorkItem(e, documentCounts)));
}

/** Os itens agrupados, na ordem de `BUCKET_ORDER`, sem buckets vazios. */
export function groupByBucket(
  items: readonly MilestoneWorkItem[],
): readonly { readonly bucket: WorkBucket; readonly items: readonly MilestoneWorkItem[] }[] {
  return BUCKET_ORDER
    .map((bucket) => ({ bucket, items: items.filter((i) => i.bucket === bucket) }))
    .filter((g) => g.items.length > 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// A AUSÊNCIA, DITA PELO NOME CERTO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Por que a fila está vazia — ou por que ela não está.
 *
 * Três ausências diferentes pedem três trabalhos diferentes, e um texto único
 * ("Nenhuma medição registrada") mandava todo mundo para o lugar errado.
 */
export type WorklistEmptiness =
  /** Há trabalho acionável. A tela mostra a fila. */
  | 'HAS_WORK'
  /** Nenhum contrato governadamente ligado a este projeto. */
  | 'NO_CONTRACT_LINK'
  /** Contrato ligado, mas sem regra/marco de medição cadastrado. */
  | 'NO_CONTRACTUAL_RULES'
  /** Marcos existem; nenhuma ponte aceita até uma etapa do cronograma. */
  | 'NO_ACCEPTED_MAPPING';

export const EMPTINESS_TITLE: Record<Exclude<WorklistEmptiness, 'HAS_WORK'>, string> = {
  NO_CONTRACT_LINK: 'Nenhum contrato vinculado a este projeto',
  NO_CONTRACTUAL_RULES: 'O contrato não tem marcos de medição cadastrados',
  NO_ACCEPTED_MAPPING: 'Nenhum marco vinculado ao cronograma',
};

export const EMPTINESS_DESCRIPTION: Record<Exclude<WorklistEmptiness, 'HAS_WORK'>, string> = {
  NO_CONTRACT_LINK:
    'Medições nascem do contrato. Vincule um contrato a este projeto no módulo Contratos '
    + 'para que os marcos apareçam aqui.',
  NO_CONTRACTUAL_RULES:
    'O contrato está vinculado, mas nenhum marco de medição foi cadastrado nele. '
    + 'O cadastro do marco é do módulo Contratos — este projeto não cria marcos.',
  NO_ACCEPTED_MAPPING:
    'Os marcos contratuais existem, mas nenhum foi aceito como etapa deste cronograma. '
    + 'Revise os vínculos na aba Timeline: só a ponte aceita por uma pessoa gera trabalho de medição.',
};

export function describeEmptiness(
  hasContractLink: boolean,
  items: readonly MilestoneWorkItem[],
): WorklistEmptiness {
  if (items.some((i) => i.actionable)) return 'HAS_WORK';
  if (!hasContractLink) return 'NO_CONTRACT_LINK';
  if (items.length === 0) return 'NO_CONTRACTUAL_RULES';
  return 'NO_ACCEPTED_MAPPING';
}

/** O resumo da fila, para o cabeçalho da aba. */
export interface WorklistSummary {
  readonly total: number;
  readonly actionable: number;
  readonly pendingMapping: number;
  readonly awaitingEvidence: number;
  readonly awaitingMeasurement: number;
  readonly awaitingAcceptance: number;
  readonly eligible: number;
  readonly settled: number;
}

export function summarizeWorklist(items: readonly MilestoneWorkItem[]): WorklistSummary {
  const inBucket = (b: WorkBucket) => items.filter((i) => i.bucket === b).length;
  return {
    total: items.length,
    actionable: items.filter((i) => i.actionable).length,
    pendingMapping: inBucket('PENDING_MAPPING') + inBucket('REMAP_REQUIRED'),
    awaitingEvidence: inBucket('AWAITING_EVIDENCE'),
    awaitingMeasurement: inBucket('AWAITING_MEASUREMENT'),
    awaitingAcceptance: inBucket('AWAITING_ACCEPTANCE'),
    eligible: inBucket('ELIGIBLE'),
    settled: inBucket('SETTLED'),
  };
}
