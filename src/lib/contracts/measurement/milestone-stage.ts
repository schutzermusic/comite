/**
 * ESTÁGIO E SOBREPOSIÇÕES DO MARCO — lógica pura, sem JSX e sem banco.
 *
 * ─── Por que ESTÁGIO e SOBREPOSIÇÃO são coisas diferentes ──────────────────
 *
 * O desenho original listava "Em atraso" e "Aguardando responsável" ao lado de
 * "Mapeado" e "Concluído", como se fossem alternativas do mesmo campo. Não são.
 * Um marco pode estar PRONTO PARA MEDIR **e** atrasado **e** sem responsável ao
 * mesmo tempo — e um status único obrigaria a tela a esconder dois dos três
 * fatos. Então:
 *
 *   · ESTÁGIO       — onde o marco está na cadeia. Mutuamente exclusivo.
 *   · SOBREPOSIÇÃO  — o que está faltando nele. Acumulável.
 *
 * ─── A regra que governa a ordem do `switch` ───────────────────────────────
 *
 * A precedência desce a cadeia de trás para frente: o fato mais A JUSANTE que
 * já é verdade define o estágio. Existir evento de faturamento é mais forte que
 * existir medição aceita, que é mais forte que a etapa ter terminado. Ler ao
 * contrário faria um marco já faturado voltar a aparecer como "pronto para
 * medir" só porque a etapa continua aberta no cronograma.
 *
 * ─── O que esta derivação NUNCA faz ────────────────────────────────────────
 *
 *   · Não olha o relógio para decidir que um gatilho ocorreu. `asOf` entra
 *     SOMENTE em `OVERDUE`, que é sobreposição de prazo — não de execução.
 *   · Não lê `timelinePercentComplete` como conclusão. 100% de avanço é
 *     opinião do cronograma; `actualFinish`/`completed` é o fato registrado.
 *   · Não transforma mapeamento PROPOSTO em mapeado. A visão já filtrou, e
 *     `governedMappingCount` só conta aceitos — mas a checagem de
 *     `timelineItemId` mantém a garantia mesmo se alguém trocar a fonte.
 *   · Não deriva faturado, aceito ou recebido de progresso de projeto.
 *
 *   · Não lê `status = 'measured'` como aceite. Medir é ato de quem executa;
 *     aceitar é ato da Contratante. Onde o contrato exige aprovação de Boletim
 *     de Medição, medir sozinho para em `AWAITING_ACCEPTANCE` — nunca em
 *     `READY_TO_BILL`.
 */

import type { MilestoneWorkbenchRow } from './milestone-workbench-types';

/**
 * Onde o marco está na cadeia. Mutuamente exclusivo.
 *
 * `UNKNOWN` não é "erro": é a afirmação honesta de que os fatos disponíveis não
 * sustentam nenhum dos outros estágios.
 */
export type MilestoneStage =
  | 'CANCELLED'
  | 'BILLED'
  | 'READY_TO_BILL'
  /**
   * Em ANÁLISE CONTRATUAL — o pacote está com a Gestão de Contratos.
   *
   * Distinto de `AWAITING_ACCEPTANCE` desde a migration 192, e a distinção é o
   * ponto: "esperando a gente" e "esperando o cliente" tinham o mesmo rótulo, e
   * era entre os dois que morava o prazo que ninguém conseguia cobrar.
   */
  | 'AWAITING_CONTRACT_REVIEW'
  | 'AWAITING_ACCEPTANCE'
  | 'AWAITING_EVIDENCE'
  | 'BLOCKED'
  | 'READY_TO_MEASURE'
  | 'TRIGGER_PENDING'
  | 'UNMAPPED'
  | 'UNINSTRUMENTED'
  | 'UNKNOWN';

/** O que falta no marco. Acumulável, e independente do estágio. */
export type MilestoneOverlay =
  | 'OVERDUE'
  | 'NO_OWNER'
  | 'NO_EVIDENCE'
  | 'VALUE_UNVERIFIED'
  | 'ENTITLEMENT_MISSING';

/** Tom visual — os mesmos quatro do sistema de tokens do dossiê. */
export type StageTone = 'neutral' | 'accent' | 'positive' | 'attention' | 'critical';

/** Agrupamento do quadro, por o que BLOQUEIA e não por nome de status. */
export type MilestoneGroup =
  | 'REQUIRES_SETUP'
  | 'AWAITING_TRIGGER'
  | 'AWAITING_EVIDENCE_OR_ACCEPTANCE'
  | 'READY_TO_BILL'
  | 'SETTLED';

export interface StageDescriptor {
  readonly stage: MilestoneStage;
  readonly label: string;
  readonly tone: StageTone;
  /** Tracejado = NÃO APURADO. É o vocabulário visual reservado da tela. */
  readonly dashed: boolean;
  readonly group: MilestoneGroup;
  /**
   * O gatilho contratual foi APURADO contra dado real de projeto?
   *
   * `false` em tudo que antecede `READY_TO_MEASURE`. É esta propriedade — e não
   * o nome do estágio — que os testes usam para provar que nenhum marco é dado
   * por ocorrido sem cronograma governado.
   */
  readonly triggerAssessed: boolean;
}

export const STAGE: Record<MilestoneStage, StageDescriptor> = {
  CANCELLED: {
    stage: 'CANCELLED', label: 'Cancelado', tone: 'neutral',
    dashed: false, group: 'SETTLED', triggerAssessed: false,
  },
  BILLED: {
    stage: 'BILLED', label: 'Faturamento gerado', tone: 'positive',
    dashed: false, group: 'SETTLED', triggerAssessed: true,
  },
  READY_TO_BILL: {
    stage: 'READY_TO_BILL', label: 'Elegível para faturar', tone: 'positive',
    dashed: false, group: 'READY_TO_BILL', triggerAssessed: true,
  },
  AWAITING_CONTRACT_REVIEW: {
    stage: 'AWAITING_CONTRACT_REVIEW', label: 'Em análise contratual', tone: 'accent',
    dashed: false, group: 'AWAITING_EVIDENCE_OR_ACCEPTANCE', triggerAssessed: true,
  },
  AWAITING_ACCEPTANCE: {
    stage: 'AWAITING_ACCEPTANCE', label: 'Em aceite', tone: 'attention',
    dashed: false, group: 'AWAITING_EVIDENCE_OR_ACCEPTANCE', triggerAssessed: true,
  },
  AWAITING_EVIDENCE: {
    stage: 'AWAITING_EVIDENCE', label: 'Aguardando evidência', tone: 'attention',
    dashed: false, group: 'AWAITING_EVIDENCE_OR_ACCEPTANCE', triggerAssessed: true,
  },
  BLOCKED: {
    stage: 'BLOCKED', label: 'Bloqueado', tone: 'critical',
    dashed: false, group: 'AWAITING_EVIDENCE_OR_ACCEPTANCE', triggerAssessed: true,
  },
  READY_TO_MEASURE: {
    stage: 'READY_TO_MEASURE', label: 'Pronto para medir', tone: 'accent',
    dashed: false, group: 'AWAITING_EVIDENCE_OR_ACCEPTANCE', triggerAssessed: true,
  },
  TRIGGER_PENDING: {
    stage: 'TRIGGER_PENDING', label: 'Gatilho não ocorrido', tone: 'neutral',
    dashed: true, group: 'AWAITING_TRIGGER', triggerAssessed: false,
  },
  UNMAPPED: {
    stage: 'UNMAPPED', label: 'Requer mapeamento', tone: 'attention',
    dashed: true, group: 'REQUIRES_SETUP', triggerAssessed: false,
  },
  UNINSTRUMENTED: {
    stage: 'UNINSTRUMENTED', label: 'Requer configuração', tone: 'attention',
    dashed: true, group: 'REQUIRES_SETUP', triggerAssessed: false,
  },
  UNKNOWN: {
    stage: 'UNKNOWN', label: 'Não apurado', tone: 'neutral',
    dashed: true, group: 'AWAITING_TRIGGER', triggerAssessed: false,
  },
};

export const GROUP_LABEL: Record<MilestoneGroup, string> = {
  REQUIRES_SETUP: 'Requer configuração',
  AWAITING_TRIGGER: 'Aguardando gatilho',
  AWAITING_EVIDENCE_OR_ACCEPTANCE: 'Aguardando evidência / aceite',
  READY_TO_BILL: 'Pronto para faturar',
  SETTLED: 'Concluído',
};

/**
 * Vocabulário da carteira global de Faturamentos.
 *
 * Distinto dos rótulos de estágio do dossiê de propósito: a carteira precisa
 * separar "marco contratual previsto" de "evento de faturamento", e o dossiê
 * já responde à pergunta operacional ("o que me impede de faturar?"). Recebido
 * só aparece quando Finanças afirma pagamento — nunca por ausência de evento.
 */
export type PortfolioBillingStageLabel =
  | 'Previsto contratualmente'
  | 'Aguardando gatilho'
  | 'Em medição'
  | 'Aguardando aceite'
  | 'Elegível para faturar'
  | 'Faturado'
  | 'Recebido'
  | 'Não apurado';

export function portfolioBillingStageLabel(
  row: MilestoneWorkbenchRow,
  _asOf: Date = new Date(),
): PortfolioBillingStageLabel {
  if (row.billingReceivableStatus === 'PAID') return 'Recebido';
  const stage = deriveStage(row).stage;
  switch (stage) {
    case 'BILLED':
      return 'Faturado';
    case 'CANCELLED':
      return 'Não apurado';
    case 'READY_TO_BILL':
      return 'Elegível para faturar';
    case 'AWAITING_CONTRACT_REVIEW':
      return 'Em medição';
    case 'AWAITING_ACCEPTANCE':
      return 'Aguardando aceite';
    case 'AWAITING_EVIDENCE':
    case 'READY_TO_MEASURE':
    case 'BLOCKED':
      return 'Em medição';
    case 'TRIGGER_PENDING':
      return 'Aguardando gatilho';
    case 'UNMAPPED':
    case 'UNINSTRUMENTED':
      return 'Previsto contratualmente';
    case 'UNKNOWN':
    default:
      return 'Não apurado';
  }
}

/** Ordem de exibição: o que exige trabalho primeiro; história por último. */
export const GROUP_ORDER: readonly MilestoneGroup[] = [
  'REQUIRES_SETUP',
  'AWAITING_TRIGGER',
  'AWAITING_EVIDENCE_OR_ACCEPTANCE',
  'READY_TO_BILL',
  'SETTLED',
];

export const OVERLAY_LABEL: Record<MilestoneOverlay, string> = {
  OVERDUE: 'Atrasado',
  NO_OWNER: 'Sem responsável',
  NO_EVIDENCE: 'Sem evidência',
  VALUE_UNVERIFIED: 'Valor não apurado',
  ENTITLEMENT_MISSING: 'Direito sem registro',
};

export const OVERLAY_TONE: Record<MilestoneOverlay, StageTone> = {
  OVERDUE: 'critical',
  NO_OWNER: 'attention',
  NO_EVIDENCE: 'attention',
  VALUE_UNVERIFIED: 'neutral',
  ENTITLEMENT_MISSING: 'attention',
};

/**
 * Marco que a própria linha afirma MEDIDO — e nada além disso.
 *
 * `measured` é afirmação de QUEM EXECUTOU: apurei a quantidade. Não é o aceite
 * da Contratante. Manter os dois no mesmo array, como estava antes, fazia a
 * medição da própria Contratada liberar faturamento em contrato que exige
 * aprovação de Boletim de Medição — que é o caso de JA10182283/2025.
 */
const MEASURED_ONLY = ['measured'] as const;

/**
 * Marco que a própria linha afirma APROVADO por quem tem autoridade de aceite.
 *
 * Vocabulário da migration 092: `approved` é o ato de aceitação registrado no
 * marco, distinto de `measured`.
 */
const ACCEPTED_STATUS = ['approved'] as const;

/** A linha afirma que a operação apurou o marco (sem dizer nada sobre aceite). */
function claimsMeasured(row: MilestoneWorkbenchRow): boolean {
  return MEASURED_ONLY.includes(row.status as (typeof MEASURED_ONLY)[number]);
}

/**
 * O CONTRATO exige aceite da Contratante para este marco?
 *
 * Só `true` explícito exige. `null` é exigência NÃO REGISTRADA, e tratá-la como
 * exigente travaria todo marco sem instrumentação; tratá-la como dispensa é o
 * que o estágio já diz por outro caminho (`UNINSTRUMENTED`/`UNMAPPED`).
 */
function acceptanceRequired(row: MilestoneWorkbenchRow): boolean {
  return row.customerAcceptanceRequired === true;
}

/**
 * ALGUÉM COM AUTORIDADE DE ACEITE disse sim?
 *
 * Três fatos, todos vindos de fonte de aceite — nunca de execução e nunca de
 * apuração própria:
 *
 *   · `status = 'approved'` — aceite registrado no próprio marco;
 *   · `measurementStatus = 'ACCEPTED'` — medição aceita em Projetos;
 *   · `measurementAcceptedAt` — o carimbo do ato de aceite.
 */
function acceptanceSatisfied(row: MilestoneWorkbenchRow): boolean {
  return ACCEPTED_STATUS.includes(row.status as (typeof ACCEPTED_STATUS)[number])
    || row.measurementStatus === 'ACCEPTED'
    || row.measurementAcceptedAt !== null;
}

/** A exigência documental do marco está satisfeita por algum registro real? */
function evidenceSatisfied(row: MilestoneWorkbenchRow): boolean {
  return row.evidenceDocumentId !== null
    || (row.evidence !== null && row.evidence.trim() !== '')
    || (row.measurementEvidenceCount ?? 0) > 0;
}

/**
 * As CONDIÇÕES RESTANTES do marco — o que ainda falta depois do aceite.
 *
 * Hoje é a evidência exigida. Fica isolado numa função porque a lista cresce
 * com o contrato, e crescer dentro do `switch` é como a regra de aceite se
 * perdeu da primeira vez.
 */
function remainingConditionsSatisfied(row: MilestoneWorkbenchRow): boolean {
  return row.evidenceRequired !== true || evidenceSatisfied(row);
}

/**
 * A etapa de cronograma TERMINOU?
 *
 * Só `actualFinish` registrado ou `status = 'completed'` contam. Percentual de
 * avanço fica deliberadamente de fora: 100% num cronograma é estimativa de
 * quem atualizou a linha, e promover estimativa a fato é exatamente o que
 * transformaria progresso de projeto em direito de faturar.
 */
function timelineFinished(row: MilestoneWorkbenchRow): boolean {
  return row.timelineActualFinish !== null || row.timelineStatus === 'completed';
}

/** Há ponte GOVERNADA até uma etapa real de cronograma? */
function hasGovernedMapping(row: MilestoneWorkbenchRow): boolean {
  return row.governedMappingCount > 0 && row.timelineItemId !== null;
}

/**
 * O estágio do marco.
 *
 * Primeira correspondência vence, e a ordem desce a cadeia de trás para frente.
 */
export function deriveStage(row: MilestoneWorkbenchRow): StageDescriptor {
  // ── Fim de linha declarado pela própria linha ──────────────────────────
  if (row.status === 'cancelled') return STAGE.CANCELLED;

  // ── A jusante: o evento de faturamento já existe ───────────────────────
  // Não afirma pago nem recebido — só que o evento foi criado por alguém.
  if (row.billingEventId !== null) return STAGE.BILLED;

  // ── Bloqueio operacional vence qualquer sinal a jusante ────────────────
  // Prontidão BLOCKED junto de aceite é contradição de dado. Diante dela a
  // derivação fecha, não abre: o bloqueio é o fato que alguém precisa resolver.
  if (row.measurementReadiness === 'BLOCKED') return STAGE.BLOCKED;

  // ── ACEITE REGISTRADO: a autoridade do aceite já se pronunciou ─────────
  // Só aqui o marco pode virar elegível — e ainda assim as condições
  // restantes precisam estar satisfeitas.
  if (acceptanceSatisfied(row)) {
    return remainingConditionsSatisfied(row) ? STAGE.READY_TO_BILL : STAGE.AWAITING_EVIDENCE;
  }

  // ── MEDIDO PELA PRÓPRIA LINHA, SEM ACEITE ──────────────────────────────
  //
  // Este é o ponto que o desenho anterior errava. `measured` é a afirmação de
  // quem executou — "apurei" — e não o "aceito" da Contratante. Quando o
  // contrato exige aceite (JA10182283/2025 exige aprovação de Boletim de
  // Medição nos seis eventos), medir sozinho NÃO libera faturamento: libera,
  // no máximo, o direito de submeter o BM.
  if (claimsMeasured(row)) {
    if (acceptanceRequired(row)) return STAGE.AWAITING_ACCEPTANCE;
    return remainingConditionsSatisfied(row) ? STAGE.READY_TO_BILL : STAGE.AWAITING_EVIDENCE;
  }

  // ── Medição operacional em curso ───────────────────────────────────────
  if (row.measurementId !== null) {
    /*
      A cadeia interna e a externa são estágios DIFERENTES.

      `SUBMITTED`, `UNDER_REVIEW` e `APPROVED_FOR_CUSTOMER` são trabalho de
      casa: o pacote está com a Gestão de Contratos, e aprovar para envio é ato
      interno. Só `AWAITING_CUSTOMER_ACCEPTANCE` é espera do cliente.

      Colapsar os quatro em "Em aceite" — como era antes da 192 — fazia um
      pacote que nem saiu da empresa aparecer como se estivesse na mesa do
      cliente, e é exatamente essa confusão que impedia cobrar o prazo certo de
      quem de fato o detinha.
    */
    if (row.measurementStatus === 'SUBMITTED'
        || row.measurementStatus === 'UNDER_REVIEW'
        || row.measurementStatus === 'APPROVED_FOR_CUSTOMER') {
      return STAGE.AWAITING_CONTRACT_REVIEW;
    }
    if (row.measurementStatus === 'AWAITING_CUSTOMER_ACCEPTANCE') {
      return STAGE.AWAITING_ACCEPTANCE;
    }
    // Correção pedida — por Contratos ou pela Contratante — é trabalho de
    // evidência do projeto, e é assim que a fila do marco o apresenta.
    if (row.measurementStatus === 'RETURNED_FOR_CORRECTION'
        || row.measurementStatus === 'CUSTOMER_CORRECTION_REQUESTED') {
      return STAGE.AWAITING_EVIDENCE;
    }
    if (row.measurementReadiness === 'INCOMPLETE') return STAGE.AWAITING_EVIDENCE;
    if (row.measurementReadiness === 'READY') return STAGE.READY_TO_MEASURE;
    // Medição existe, prontidão desconhecida: dizer isso é mais verdadeiro que
    // escolher um dos dois lados.
    return STAGE.UNKNOWN;
  }

  // ── Sem medição: o que o cronograma governado permite afirmar ──────────
  if (hasGovernedMapping(row)) {
    return timelineFinished(row) ? STAGE.READY_TO_MEASURE : STAGE.TRIGGER_PENDING;
  }

  // ── A ponte não existe. Distinguir "sem ponte" de "sem exigência". ─────
  if (row.requirementId !== null) return STAGE.UNMAPPED;
  return STAGE.UNINSTRUMENTED;
}

/**
 * As sobreposições do marco. Independentes do estágio e entre si.
 *
 * `asOf` é injetado pelo chamador — nunca `new Date()` aqui dentro, senão o
 * teste de atraso passa a depender do dia em que roda.
 */
export function deriveOverlays(
  row: MilestoneWorkbenchRow,
  asOf: Date = new Date(),
): readonly MilestoneOverlay[] {
  const out: MilestoneOverlay[] = [];

  // ATRASO é sobre PRAZO, e só existe quando há prazo registrado. Sem
  // `due_date` não há atraso — há ausência de prazo, que é outra coisa e não
  // se inventa a partir da data de hoje.
  if (row.dueDate !== null && row.completedAt === null && row.status !== 'cancelled') {
    const due = new Date(`${row.dueDate}T23:59:59`);
    if (asOf.getTime() > due.getTime()) out.push('OVERDUE');
  }

  if (row.ownerUserId === null && row.status !== 'cancelled') out.push('NO_OWNER');

  // Só cobra evidência de quem a exige. Um marco sem exigência registrada não
  // está "sem evidência": está sem exigência, e isso já aparece no estágio.
  const needsEvidence = row.evidenceRequired === true || row.requirementId !== null;
  if (needsEvidence && !evidenceSatisfied(row) && row.status !== 'cancelled') out.push('NO_EVIDENCE');

  // Marco que alguém AFIRMA apurado ou aceito, mas cujo valor ninguém apurou.
  //
  // A condição se ancora na AFIRMAÇÃO, não no estágio: um marco medido que
  // esbarra no aceite pendente continua sendo um marco sem valor apurado, e
  // amarrar a sobreposição a `READY_TO_BILL` a fazia sumir exatamente quando o
  // aceite passou a ser exigido. O previsto do contrato NÃO preenche a lacuna.
  const claimsApuration = claimsMeasured(row) || acceptanceSatisfied(row)
    || row.measurementStatus === 'SUBMITTED' || row.measurementStatus === 'UNDER_REVIEW'
    || row.measurementStatus === 'APPROVED_FOR_CUSTOMER'
    || row.measurementStatus === 'AWAITING_CUSTOMER_ACCEPTANCE';
  if (claimsApuration && row.measuredAmount === null && row.acceptedValue === null
      && row.status !== 'cancelled') {
    out.push('VALUE_UNVERIFIED');
  }

  if (row.entitlementRuleCount === 0 && row.status !== 'cancelled') out.push('ENTITLEMENT_MISSING');

  return out;
}

/** Estágio + sobreposições, resolvidos juntos para a tela. */
export interface MilestoneAssessment {
  readonly row: MilestoneWorkbenchRow;
  readonly stage: StageDescriptor;
  readonly overlays: readonly MilestoneOverlay[];
}

export function assessMilestone(
  row: MilestoneWorkbenchRow,
  asOf: Date = new Date(),
): MilestoneAssessment {
  return { row, stage: deriveStage(row), overlays: deriveOverlays(row, asOf) };
}

// ═══════════════════════════════════════════════════════════════════════════
// A CADEIA, POR MARCO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Os quatro elos que a linha do marco desenha.
 *
 * É aqui que a fronteira do domínio vira gramática visual: CONTRATUAL é o que o
 * contrato promete, EXECUÇÃO é o que Projetos registrou, ACEITE é o que alguém
 * com autoridade disse sim, FATURAMENTO é o que Contratos liberou. Quatro
 * autoridades, quatro nós — e um nó só acende com fato da SUA fonte.
 */
export type ChainLinkKey = 'contractual' | 'execution' | 'acceptance' | 'billing';

export interface ChainLink {
  readonly key: ChainLinkKey;
  readonly label: string;
  /** Fato estabelecido pela fonte deste elo. */
  readonly fact: boolean;
  readonly blocked: boolean;
  /** A fonte, nomeada. `null` quando o elo ainda não tem fato. */
  readonly source: string | null;
}

export function deriveChain(row: MilestoneWorkbenchRow): readonly ChainLink[] {
  const contractual = row.entitlementRuleCount > 0;
  const execution = hasGovernedMapping(row) && timelineFinished(row);
  // O elo de ACEITE só acende com ato da autoridade de aceite. `measured` é a
  // apuração de quem executou e acendia este nó por engano.
  const acceptance = acceptanceSatisfied(row);
  const billing = row.billingEventId !== null;

  const contractualSource = row.entitlementSourcePage !== null
    ? `Contrato p.${row.entitlementSourcePage}`
    : contractual ? 'Direito registrado' : null;

  const executionSource = execution
    ? (row.timelineWbsCode ? `WBS ${row.timelineWbsCode}` : row.timelineTitle ?? 'Etapa concluída')
    : hasGovernedMapping(row)
      ? (row.timelineTitle ?? 'Etapa mapeada')
      : null;

  return [
    { key: 'contractual', label: 'Contratual', fact: contractual, blocked: false, source: contractualSource },
    {
      key: 'execution', label: 'Execução', fact: execution,
      blocked: row.measurementReadiness === 'BLOCKED',
      source: executionSource,
    },
    {
      key: 'acceptance', label: 'Aceite', fact: acceptance, blocked: false,
      source: acceptance
        ? (row.measurementAcceptedAt ? 'Medição aceita' : 'Marco aprovado')
        : null,
    },
    {
      key: 'billing', label: 'Faturamento', fact: billing, blocked: false,
      source: billing ? (row.billingReleaseState ?? 'Evento criado') : null,
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// AGRUPAMENTO
// ═══════════════════════════════════════════════════════════════════════════

export interface MilestoneGroupBucket {
  readonly group: MilestoneGroup;
  readonly label: string;
  readonly items: readonly MilestoneAssessment[];
  /**
   * Soma do DIREITO CONTRATUAL do grupo. `null` quando nenhum marco do grupo
   * tem direito registrado — somar `billing_amount` no lugar apresentaria
   * previsão como direito.
   */
  readonly entitlementTotal: number | null;
}

/** Todos os grupos, sempre — inclusive vazios: ver o funil é o diagnóstico. */
export function groupMilestones(
  assessments: readonly MilestoneAssessment[],
): readonly MilestoneGroupBucket[] {
  return GROUP_ORDER.map((group) => {
    const items = assessments.filter((a) => a.stage.group === group);
    const withEntitlement = items.filter((a) => a.row.entitlementAmount !== null);
    return {
      group,
      label: GROUP_LABEL[group],
      items,
      entitlementTotal: withEntitlement.length > 0
        ? withEntitlement.reduce((s, a) => s + (a.row.entitlementAmount ?? 0), 0)
        : null,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// AÇÃO RECOMENDADA
// ═══════════════════════════════════════════════════════════════════════════

export type MilestoneActionKind =
  | 'configure_requirement' | 'map_timeline' | 'view_timeline'
  | 'open_measurement' | 'attach_evidence' | 'generate_billing'
  | 'view_billing' | 'none';

export interface MilestoneAction {
  readonly kind: MilestoneActionKind;
  readonly label: string;
  /** Só UMA ação por linha é primária — a que move dinheiro. */
  readonly primary: boolean;
  /** Destino em Projetos, quando a resolução mora lá. */
  readonly projectId: string | null;
}

/**
 * A ação que RESOLVE o gargalo daquele marco.
 *
 * Uma só por linha. Um menu de cinco botões iguais devolve ao usuário o
 * trabalho de descobrir qual importa — que é justamente o que a tela deveria
 * ter feito por ele.
 */
export function deriveAction(assessment: MilestoneAssessment): MilestoneAction {
  const { row, stage } = assessment;
  const projectId = row.timelineProjectId ?? row.projectId;

  switch (stage.stage) {
    case 'UNINSTRUMENTED':
      return { kind: 'configure_requirement', label: 'Definir exigência de medição', primary: false, projectId: null };
    case 'UNMAPPED':
      return { kind: 'map_timeline', label: 'Mapear ao cronograma', primary: false, projectId };
    case 'TRIGGER_PENDING':
      return { kind: 'view_timeline', label: 'Ver etapa no projeto', primary: false, projectId };
    case 'READY_TO_MEASURE':
      return { kind: 'open_measurement', label: 'Abrir medição em Projetos', primary: false, projectId };
    case 'AWAITING_EVIDENCE':
      return { kind: 'attach_evidence', label: 'Vincular evidência', primary: false, projectId };
    case 'AWAITING_CONTRACT_REVIEW':
      return { kind: 'open_measurement', label: 'Ver análise contratual', primary: false, projectId };
    case 'AWAITING_ACCEPTANCE':
      return { kind: 'open_measurement', label: 'Acompanhar aceite', primary: false, projectId };
    case 'BLOCKED':
      return { kind: 'open_measurement', label: 'Ver bloqueio em Projetos', primary: false, projectId };
    case 'READY_TO_BILL':
      // A ÚNICA ação primária do quadro, e continua sendo um ato humano.
      return { kind: 'generate_billing', label: 'Gerar faturamento', primary: true, projectId: null };
    case 'BILLED':
      return { kind: 'view_billing', label: 'Ver evento', primary: false, projectId: null };
    default:
      return { kind: 'none', label: '', primary: false, projectId: null };
  }
}
