/**
 * EVENTOS DE MEDIÇÃO no cronograma do projeto — lógica pura, sem banco e sem JSX.
 *
 * ─── O que um evento de medição É, e o que ele não é ───────────────────────
 *
 * É uma SOBREPOSIÇÃO derivada: o marco contratual de faturamento, mostrado ao
 * lado da etapa de cronograma que um revisor humano aceitou como sendo ele.
 *
 * Não é uma atividade de projeto. Não é editável em Projetos. Não tem data
 * própria — a data é a da etapa, e é o cronograma que a define. O contrato diz
 * O QUE precisa acontecer; o cronograma diz QUANDO está planejado acontecer.
 * Esta camada só coloca os dois lado a lado.
 *
 * ─── O que este arquivo deliberadamente NÃO faz ────────────────────────────
 *
 *   · Não deriva estágio de marco. Chama `deriveBillingPlanState`, que chama
 *     `deriveStage` — a máquina canônica de `milestone-stage.ts`. Uma segunda
 *     máquina aqui divergiria da primeira no dia em que alguém corrigisse uma
 *     e esquecesse a outra, e a divergência apareceria como "Elegível para
 *     faturar" em Projetos e "Em aceite" em Contratos, sobre o mesmo marco.
 *   · Não soma quantias de naturezas diferentes. Previsto, elegível e recebido
 *     continuam separados, e a soma para quando as moedas divergem.
 *   · Não inventa valor. Ausência é `null`, e a tela escreve "Não apurado".
 */

import type { BillingMonthPlanRow } from '@/lib/contracts/billing/planning/month-plan-types';
import { deriveBillingPlanState } from '@/lib/contracts/billing/planning/monthly-planning';
import { extractMilestoneSequence } from '@/lib/contracts/billing/planning/milestone-timeline-matcher';

/**
 * O ESTADO DO VÍNCULO entre o marco contratual e o cronograma.
 *
 * Mesmo vocabulário em quatro lugares — a coluna `link_state` da visão (181),
 * o relatório de reconciliação da importação, o cabeçalho do projeto e a
 * linha derivada do Gantt. Um vocabulário por camada foi como "sugerido" e
 * "pendente" passaram a significar coisas diferentes na mesma tela.
 */
export type EventLinkState =
  | 'ACCEPTED'
  /**
   * Ponte aceita cuja etapa SAIU do cronograma (desativada numa reimportação).
   *
   * A decisão humana continua registrada — o mapeamento segue `accepted` na
   * tabela, com revisor e data intactos. O que mudou é o mundo: a atividade
   * que sustentava o marco não está mais lá. O sistema NÃO escolhe uma
   * substituta por semelhança; ele avisa e devolve a escolha a quem planeja.
   */
  | 'ANCHOR_LOST'
  | 'PROPOSED'
  | 'AMBIGUOUS'
  | 'UNMATCHED';

export const LINK_STATE_LABEL: Record<EventLinkState, string> = {
  ACCEPTED: 'Sincronizado com cronograma',
  ANCHOR_LOST: 'Atividade removida do cronograma — requer remapeamento',
  PROPOSED: 'Mapeamento sugerido',
  AMBIGUOUS: 'Ambíguo',
  UNMATCHED: 'Sem vínculo no cronograma',
};

/** Rótulo curto, para chips e contadores. */
export const LINK_STATE_SHORT: Record<EventLinkState, string> = {
  ACCEPTED: 'Vinculado',
  ANCHOR_LOST: 'Requer remapeamento',
  PROPOSED: 'Sugerido',
  AMBIGUOUS: 'Ambíguo',
  UNMATCHED: 'Sem vínculo',
};

/**
 * Tom visual. Sugerido e ambíguo são TRACEJADOS na tela pelo mesmo motivo que
 * o dossiê usa tracejado: não apurado ainda, e a borda diz isso sem texto.
 */
export const LINK_STATE_TONE: Record<EventLinkState, 'accent' | 'attention' | 'neutral'> = {
  ACCEPTED: 'accent',
  ANCHOR_LOST: 'attention',
  PROPOSED: 'attention',
  AMBIGUOUS: 'attention',
  UNMATCHED: 'neutral',
};

/** Só o vínculo ACEITO é autoridade. Proposta é proposta (§17). */
export function isGoverned(state: EventLinkState): boolean {
  return state === 'ACCEPTED';
}

/**
 * O estado do vínculo de UM marco, como a reconciliação de importação o viu.
 *
 * Vive no módulo PURO — e não junto da rotina de servidor que o produz —
 * porque o wizard de importação, que roda no navegador, precisa do tipo. Um
 * `import type` apontando para o módulo do service role é uma seta na direção
 * errada: ela some na compilação, mas convida o próximo import a não sumir.
 */
export interface ReconciledMilestone {
  readonly milestoneId: string;
  readonly ruleId: string;
  readonly contractId: string;
  readonly title: string;
  readonly linkState: EventLinkState;
  /** A etapa aceita (ACCEPTED) ou a candidata (PROPOSED/AMBIGUOUS). */
  readonly timelineItemId: string | null;
  readonly confidence: number | null;
  readonly reasons: readonly string[];
  readonly ambiguousWith: readonly string[];
}

/** O relatório da reconciliação, devolvido pela importação e pela rota de proposta. */
export interface ProposalRunResult {
  readonly evaluatedMilestones: number;
  readonly proposed: number;
  readonly quickReview: number;
  readonly requiresAttention: number;
  readonly skippedAlreadyGoverned: number;
  readonly timelineItems: number;

  /** Marcos contratuais dos contratos ligados ao projeto. O denominador. */
  readonly contractEvents: number;
  /** Ponte já aceita: sincroniza sozinha, sem pedir nada a ninguém. */
  readonly synchronized: number;
  /** Proposta nova aguardando revisão. */
  readonly suggested: number;
  /** Empate: exige ESCOLHA humana, não aceite. */
  readonly ambiguous: number;
  /** Sem etapa que sustente o marco. Uma resposta, não uma falha. */
  readonly unmatched: number;
  /** Vínculos aceitos cuja etapa sumiu do cronograma. Exigem remapeamento. */
  readonly anchorLost: number;
  readonly milestones: readonly ReconciledMilestone[];
}

export interface AmbiguousAlternative {
  readonly id: string;
  readonly title: string;
  readonly wbsCode: string | null;
  readonly plannedFinish: string | null;
}

/**
 * Um evento de medição do projeto.
 *
 * `plan` é a linha do planejamento mensal INTEIRA, sem reinterpretação: é ela
 * que carrega valor, data prevista, base da data, medição, aceite, evidência,
 * faturamento e caixa. Copiar campo por campo para cá criaria uma segunda
 * verdade com o mesmo nome — que é exatamente o que este módulo existe para
 * evitar.
 */
export interface ProjectContractEvent {
  readonly linkState: EventLinkState;
  readonly ruleId: string;
  readonly mappingId: string | null;
  readonly mappingSource: string | null;
  readonly reviewState: 'proposed' | 'accepted' | 'rejected' | null;
  readonly confidence: number | null;
  readonly note: string | null;
  readonly mappedAt: string | null;
  readonly reviewedAt: string | null;

  /** A etapa CANDIDATA — só existe enquanto a proposta não foi decidida. */
  readonly proposedTimelineItemId: string | null;
  readonly proposedTimelineTitle: string | null;
  readonly proposedTimelineWbsCode: string | null;
  readonly proposedTimelineFinish: string | null;
  readonly ambiguousAlternatives: readonly AmbiguousAlternative[];

  /**
   * O PORTÃO DE VALOR desta linha (migration 182).
   *
   * `false` significa RESTRITO, e nunca "não apurado". A diferença não é
   * cosmética: "o sistema não sabe o valor" manda o gestor procurar quem
   * cadastre; "você não pode ver o valor" manda procurar quem autorize. Com
   * um `null` sozinho, as duas frases ficam idênticas na tela.
   */
  readonly canViewValues: boolean;
  /**
   * O marco destrava uma parcela contratual?
   *
   * Vem do banco, calculado ANTES da máscara de valor — por isso continua
   * verdadeiro para quem não pode ver quantia. É a relevância de faturamento
   * como pergunta de EXECUÇÃO: o gestor precisa saber que a atividade libera
   * um pagamento, e não precisa saber de quanto ele é.
   */
  readonly generatesBilling: boolean;

  /** A etapa que o mapeamento aponta — viva ou não. Sustenta o aviso de âncora perdida. */
  readonly mappedTimelineItemId: string | null;
  readonly mappedTimelineTitle: string | null;
  readonly mappedTimelineWbsCode: string | null;
  readonly mappedTimelineIsActive: boolean;

  readonly contractTotalValue: number | null;
  /** Participação do marco no valor total do contrato. `null` = não apurado. */
  readonly contractPercent: number | null;

  readonly plan: BillingMonthPlanRow;
}

/**
 * "MARCO 02" — o número do evento, lido do título do marco.
 *
 * Sem número no título não há número: o rótulo cai para o título do marco, e
 * não para uma posição na lista. Numerar por ordem de exibição produziria um
 * "MARCO 03" que muda de marco quando alguém reordena a tela.
 */
export function eventNumberLabel(event: ProjectContractEvent): string {
  const seq = extractMilestoneSequence(event.plan.title);
  return seq === null ? 'EVENTO CONTRATUAL' : `MARCO ${String(seq).padStart(2, '0')}`;
}

/**
 * A DATA VIGENTE do evento, e de onde ela vem.
 *
 * Para vínculo aceito é a data do cronograma, repassada pela visão do
 * planejamento — a MESMA que Contratos mostra, derivada da mesma expressão em
 * SQL. É isto que garante que os dois módulos nunca discordem da data
 * governada vigente: não existem duas contas, existe uma coluna.
 */
export function currentDate(event: ProjectContractEvent): string | null {
  return event.plan.plannedBillingDate;
}

/** A data ANTERIOR, quando a etapa foi reprogramada. Preservada pela 179. */
export function previousDate(event: ProjectContractEvent): string | null {
  return event.plan.reprogrammingCount > 0
    ? event.plan.lastPreviousPlannedFinish
    : null;
}

export function wasReprogrammed(event: ProjectContractEvent): boolean {
  return event.plan.reprogrammingCount > 0
    && event.plan.lastPreviousPlannedFinish !== null
    && event.plan.lastPreviousPlannedFinish !== event.plan.lastNewPlannedFinish;
}

/**
 * Este evento GERA FATURAMENTO?
 *
 * Lê a coluna `generates_billing` da visão 182, e não `plannedAmount`: para
 * quem não passa no portão de valor a quantia chega nula, e derivar daí diria
 * "não gera faturamento" sobre um marco que gera. A relevância atravessa o
 * portão; o número, não.
 *
 * A resposta honesta é "o contrato prevê que sim" — nunca "vai faturar". Um
 * marco contratual de faturamento é um DIREITO previsto; o evento de
 * faturamento só existe quando o fluxo governado de Contratos o cria, e nada
 * em Projetos cria um. O rótulo da tela diz "Gera faturamento" porque é uma
 * característica do MARCO, e a linha de estado ao lado diz em que ponto da
 * cadeia ele está.
 */
export function generatesBilling(event: ProjectContractEvent): boolean {
  return event.generatesBilling;
}

/**
 * Os eventos ACEITOS, indexados pela etapa de cronograma.
 *
 * É o índice que o Gantt consome para decidir, em O(1) por linha, se uma
 * atividade recebe linha derivada — sem uma requisição por linha e sem varrer
 * a lista de eventos a cada render.
 *
 * Uma etapa pode sustentar mais de um marco (contratos que dividem a mesma
 * entrega em duas parcelas), então o valor é uma lista, não um item.
 */
export function governedEventsByTimelineItem(
  events: readonly ProjectContractEvent[],
): ReadonlyMap<string, readonly ProjectContractEvent[]> {
  const out = new Map<string, ProjectContractEvent[]>();
  for (const event of events) {
    if (!isGoverned(event.linkState)) continue;
    const itemId = event.plan.timelineItemId;
    if (!itemId) continue;
    const list = out.get(itemId);
    if (list) list.push(event);
    else out.set(itemId, [event]);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// O RESUMO DO CABEÇALHO
// ═══════════════════════════════════════════════════════════════════════════

export interface ContractEventsSummary {
  readonly total: number;
  readonly linked: number;
  readonly suggested: number;
  readonly ambiguous: number;
  readonly unmatched: number;
  /** Aceitos cuja etapa sumiu do cronograma — exigem remapeamento humano. */
  readonly anchorLost: number;

  /**
   * Moeda única da carteira do projeto, ou `null` quando os contratos ligados
   * usam moedas diferentes. Quando é `null`, TODAS as quantias abaixo também
   * são: somar BRL com USD para caber num número é o tipo de precisão falsa
   * que esta base recusa.
   */
  readonly currency: string | null;
  /**
   * Alguma linha veio com valor RESTRITO. Quando `true`, as quantias abaixo
   * são nulas por PERMISSÃO — e a tela escreve "Restrito", não "Não apurado".
   */
  readonly valuesRestricted: boolean;
  /** Valor contratual com ponte ACEITA. `null` = não apurado. */
  readonly linkedAmount: number | null;
  /** Valor que o fluxo de faturamento já APUROU como elegível. */
  readonly eligibleAmount: number | null;
  readonly eligibleCount: number;
  /** Previsto para os próximos 30 dias, só sobre vínculo aceito. */
  readonly next30Amount: number | null;
  readonly next30Count: number;
}

const DAY_MS = 86_400_000;
const startOfDay = (iso: string): number => new Date(`${iso}T00:00:00`).getTime();

/**
 * O resumo "CONTRATO & FATURAMENTO" do cabeçalho do cronograma.
 *
 * ─── Por que tantos `null` ────────────────────────────────────────────────
 *
 * Porque "0" e "não apurado" são respostas diferentes, e a tela precisa poder
 * dizer a segunda. Zero elegível significa "nada está elegível agora"; não
 * apurado significa "o fluxo de faturamento ainda não apurou valor nenhum".
 * Um gerente que lê R$ 0,00 onde deveria ler "não apurado" conclui que não há
 * nada a faturar — e essa conclusão custa um mês.
 */
export function summarizeContractEvents(
  events: readonly ProjectContractEvent[],
  asOf: Date = new Date(),
): ContractEventsSummary {
  const count = (state: EventLinkState) => events.filter((e) => e.linkState === state).length;

  const currencies = new Set(
    events.map((e) => e.plan.currency).filter((c): c is string => c !== null),
  );
  const currency = currencies.size === 1 ? [...currencies][0] : null;

  const governed = events.filter((e) => isGoverned(e.linkState));

  /*
    Basta UMA linha restrita para que o total deixe de ser somável.

    Somar só as visíveis produziria um "valor vinculado" que parece completo e
    não é — e um gestor que lê R$ 2 mi onde há R$ 8 mi toma decisão sobre um
    número que o próprio sistema sabe estar truncado.
  */
  const valuesRestricted = events.some((e) => !e.canViewValues);

  // Soma que preserva "não apurado": uma lista sem nenhuma parcela conhecida
  // devolve `null`, e não 0.
  const sum = (values: readonly (number | null)[]): number | null => {
    const known = values.filter((v): v is number => v !== null);
    return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
  };

  // Moeda misturada e valor restrito bloqueiam a soma pela mesma razão: o
  // número resultante não significaria o que a etiqueta diz.
  const mixed = (currency === null && currencies.size > 1) || valuesRestricted;

  const eligible = events.filter(
    (e) => deriveBillingPlanState(e.plan) === 'ELIGIBLE',
  );

  const today = startOfDay(asOf.toISOString().slice(0, 10));
  const within30 = governed.filter((e) => {
    const date = e.plan.plannedBillingDate;
    if (!date) return false;
    const delta = startOfDay(date) - today;
    return delta >= 0 && delta <= 30 * DAY_MS;
  });

  return {
    total: events.length,
    linked: count('ACCEPTED'),
    suggested: count('PROPOSED'),
    ambiguous: count('AMBIGUOUS'),
    unmatched: count('UNMATCHED'),
    anchorLost: count('ANCHOR_LOST'),

    currency,
    valuesRestricted,
    linkedAmount: mixed ? null : sum(governed.map((e) => e.plan.plannedAmount)),
    // APURADO a jusante: só existe com evento de faturamento vivo. Cair para
    // o previsto aqui faria a tela afirmar apuração que ninguém fez.
    eligibleAmount: mixed ? null : sum(eligible.map((e) => e.plan.billingEligibleAmount)),
    eligibleCount: eligible.length,
    next30Amount: mixed ? null : sum(within30.map((e) => e.plan.plannedAmount)),
    next30Count: within30.length,
  };
}

/** Ordem de exibição: o que exige decisão primeiro, o resolvido por último. */
const LINK_STATE_ORDER: Record<EventLinkState, number> = {
  // Âncora perdida vem primeiro: é o único estado em que algo que FUNCIONAVA
  // parou de funcionar, e a previsão de faturamento já mudou por causa disso.
  ANCHOR_LOST: 0, AMBIGUOUS: 1, PROPOSED: 2, UNMATCHED: 3, ACCEPTED: 4,
};

export function sortForReview(
  events: readonly ProjectContractEvent[],
): readonly ProjectContractEvent[] {
  return [...events].sort((a, b) => {
    const byState = LINK_STATE_ORDER[a.linkState] - LINK_STATE_ORDER[b.linkState];
    if (byState !== 0) return byState;
    const seqA = extractMilestoneSequence(a.plan.title) ?? 99;
    const seqB = extractMilestoneSequence(b.plan.title) ?? 99;
    if (seqA !== seqB) return seqA - seqB;
    return a.plan.title.localeCompare(b.plan.title, 'pt-BR');
  });
}
