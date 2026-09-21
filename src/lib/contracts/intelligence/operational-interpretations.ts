/**
 * A leitura OPERACIONAL do contrato — e por que ela não é a lista de cláusulas.
 *
 * ─── O defeito que este módulo existe para remover ─────────────────────────
 *
 * A aba "Inteligência Contratual" lia `contract_clauses` e chamava aquilo de
 * interpretação. Em JA10182283 isso produzia a frase mais cara da tela:
 *
 *     "21 itens requerem sua atenção"
 *
 * Nenhum dos 21 era uma fila de trabalho. Eram cláusulas extraídas do PDF, com
 * o selo de exceção da política de EXTRAÇÃO (migration 154) — um selo sobre o
 * texto do contrato, não sobre o que o Apex passou a operar.
 *
 * A fila de trabalho verdadeira vive em `contract_operational_interpretations`
 * (migration 161), e ela é pequena de propósito:
 *
 *     29 interpretações operacionais
 *       22 `automatic`          → materializadas; o Apex opera por elas
 *        7 `requires_attention` → retidas; nenhuma linha canônica foi escrita
 *
 * As duas contagens são verdadeiras, e são sobre coisas diferentes:
 *
 *     contract_clauses ................. o que o PAPEL diz  (38, rastreamento)
 *     contract_operational_interpretations  o que o APEX OPERA (29, trabalho)
 *
 * Misturá-las foi o que fez um contrato saudável parecer uma dívida de 38
 * conferências manuais. Este módulo mantém a separação explícita, e nenhuma
 * função aqui converte uma na outra.
 *
 * ─── O que este módulo NÃO faz ─────────────────────────────────────────────
 *
 * Este módulo só LÊ. Aceitar / descartar vive em `session.ts` + migration 188:
 * sem UPDATE direto para `authenticated`; a escrita passa pela RPC
 * `contract_operational_interpretation_resolve`. INSERT de fatos continua
 * `service_role`. Aqui só se lê e se formata.
 *
 * Lógica pura, sem JSX e sem I/O: roda no vitest em `node`.
 */

import { formatContractCurrency } from '@/lib/contracts/trust/format';

/** Espelha o CHECK de `family` na migration 161. */
export const OPERATIONAL_FAMILIES = [
  'obligations', 'billing_conditions', 'guarantees',
  'insurance_requirements', 'indexation_rules',
] as const;
export type OperationalFamily = (typeof OPERATIONAL_FAMILIES)[number];

/**
 * Espelha o CHECK de `trust_state` (migration 161 + 187).
 * `dismissed` = ato humano que encerra a retenção sem materializar.
 */
export type OperationalTrustState = 'automatic' | 'requires_attention' | 'dismissed';

/** Espelha `copi_trust_reasons`. A lista é fechada no banco. */
export type OperationalTrustReason = 'low_confidence' | 'material_financial_exposure';

export type OperationalHumanDecision = 'confirm' | 'dismiss';

export type ContractOperationalInterpretationRow = {
  id: string;
  organization_id: string;
  contract_id: string;
  analysis_id: string;
  source_document_id: string;
  family: OperationalFamily;
  fingerprint: string;
  normalized_payload: Record<string, unknown> | null;
  source_page: number;
  source_excerpt: string;
  confidence: number | string;
  provider: string;
  model: string;
  pipeline_version: string;
  requesting_user_id: string | null;
  trust_state: OperationalTrustState;
  trust_reasons: string[] | null;
  trust_policy_version: string;
  created_at: string;
  /** 187: ato humano que promove ou descarta a retenção. */
  human_decision?: OperationalHumanDecision | null;
  attention_resolved_by?: string | null;
  attention_resolved_at?: string | null;
  attention_resolution_note?: string | null;
};

/**
 * O nome de NEGÓCIO de cada família.
 *
 * O agrupamento da seção "Estruturado pelo Apex" é por família, e não pela
 * `category` livre que o modelo escreve dentro de uma obrigação. A família é
 * vocabulário governado (CHECK no banco, cinco valores); a `category` é texto
 * livre — em JA10182283 ela produziu nove valores para onze obrigações
 * ("mobilização", "fiscal/trabalhista", "aceitação"…), ou seja, um grupo por
 * item. Agrupar por texto livre não agrupa nada.
 */
export const OPERATIONAL_FAMILY_LABEL: Record<OperationalFamily, string> = {
  billing_conditions: 'Condições de pagamento',
  obligations: 'Obrigações contratuais',
  indexation_rules: 'Reajuste e indexação',
  guarantees: 'Garantias',
  insurance_requirements: 'Seguros',
};

/** Ordem de leitura executiva: dinheiro primeiro, depois execução, depois cobertura. */
export const OPERATIONAL_FAMILY_ORDER: readonly OperationalFamily[] = [
  'billing_conditions', 'obligations', 'indexation_rules', 'guarantees', 'insurance_requirements',
];

/**
 * O motivo da retenção, em linguagem de quem decide.
 *
 * Sem código técnico e sem nome de modelo: o leitor precisa saber o que
 * CONFERIR, não qual regra da política disparou.
 */
export const OPERATIONAL_ATTENTION_LABEL: Record<OperationalTrustReason, string> = {
  low_confidence: 'Baixa confiança documental',
  material_financial_exposure: 'Exposição financeira material',
};

/** O que a pessoa precisa fazer para destravar a interpretação. */
export const OPERATIONAL_ATTENTION_ASK: Record<OperationalTrustReason, string> = {
  low_confidence:
    'A leitura do trecho não ficou conclusiva. Confira a página de origem antes de o Apex operar por esta regra.',
  material_financial_exposure:
    'A regra carrega exposição financeira material. Avalie o valor antes de o Apex operar por ela.',
};

/**
 * Rótulo tolerante a um motivo que esta versão da interface não conhece.
 *
 * O banco pode ganhar um motivo novo antes desta tela. Mostrar o código cru
 * seria vazar jargão; inventar um rótulo seria pior. "Exceção de governança"
 * é verdadeiro para qualquer motivo que a política venha a ter.
 */
export function attentionReasonLabel(reason: string): string {
  return OPERATIONAL_ATTENTION_LABEL[reason as OperationalTrustReason] ?? 'Exceção de governança';
}

export function attentionReasonAsk(reason: string): string | null {
  return OPERATIONAL_ATTENTION_ASK[reason as OperationalTrustReason] ?? null;
}

// ─── vocabulários do payload ───────────────────────────────────────────────
// Espelham `src/lib/ai/contract-operationalization.ts`, que é server-only e
// LANÇA se importado no browser. Uma tela de cliente que importasse aquele
// módulo só pelo rótulo derrubaria o dossiê inteiro.

const CALENDAR_SUFFIX: Record<string, string> = {
  calendar_days: 'dias corridos',
  business_days: 'dias úteis',
  unspecified: 'dias',
};

const RECURRENCE_LABEL: Record<string, string> = {
  daily: 'Diária',
  weekly: 'Semanal',
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  yearly: 'Anual',
  fixed_interval: 'Intervalo fixo',
  custom: 'Recorrência específica',
};

const BILLING_CONDITION_LABEL: Record<string, string> = {
  milestone_reached: 'Marco atingido',
  measurement_accepted: 'Medição aprovada',
  service_report_required: 'Relatório de serviço',
  evidence_required: 'Evidência exigida',
  technical_acceptance_required: 'Aceite técnico',
  customer_approval_required: 'Aprovação do cliente',
  specific_document_required: 'Documento exigido',
  elapsed_contractual_period: 'Prazo contratual',
  contractual_event: 'Evento contratual',
};

const RESPONSIBLE_SIDE_LABEL: Record<string, string> = {
  contracting_organization: 'Nossa organização',
  counterparty: 'Contraparte',
  both: 'Ambas as partes',
  unspecified: 'Parte não definida no documento',
};

const ACTIVATION_LABEL: Record<string, string> = {
  contract_start: 'Início do contrato',
  days_after_contract_start: 'Dias após o início do contrato',
  days_before_contract_end: 'Dias antes do fim do contrato',
  fixed_date: 'Data fixa',
  manual: 'Acionamento manual',
  external_event: 'Evento externo',
  schedule_anchor: 'Âncora de cronograma',
  unspecified: 'Não definido no documento',
};

// ─── leitura defensiva do payload ──────────────────────────────────────────
// `normalized_payload` é `jsonb`. Nada aqui assume forma: um campo ausente é
// ausente, e NUNCA vira zero — zero significaria multa de 0% ou prazo de 0
// dias, que são afirmações que nenhum documento fez.

const str = (payload: Record<string, unknown> | null, key: string): string | null => {
  const value = payload?.[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

const num = (payload: Record<string, unknown> | null, key: string): number | null => {
  const value = payload?.[key];
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const bool = (payload: Record<string, unknown> | null, key: string): boolean | null => {
  const value = payload?.[key];
  return typeof value === 'boolean' ? value : null;
};

/** `confidence` chega como `numeric` — string no wire, número em memória. */
export function readConfidence(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * O EFEITO principal da interpretação, em uma expressão curta.
 *
 * É a única coluna numérica da linha compacta: "30 dias corridos", "R$
 * 300.000,00", "IPCA". `null` quando o contrato não quantificou — e aí a linha
 * mostra o traço, não um zero.
 */
export function interpretationEffect(row: ContractOperationalInterpretationRow): string | null {
  const p = row.normalized_payload;
  switch (row.family) {
    case 'obligations': {
      const dueKind = str(p, 'due_kind');
      if (dueKind === 'recurring') {
        const recurrence = str(p, 'recurrence_kind');
        return (recurrence && RECURRENCE_LABEL[recurrence]) ?? 'Recorrente';
      }
      const offset = num(p, 'due_offset_days');
      if (offset !== null) {
        const basis = str(p, 'calendar_basis') ?? 'unspecified';
        return `${offset} ${CALENDAR_SUFFIX[basis] ?? 'dias'}`;
      }
      if (dueKind === 'same_day_as_activation') return 'No mesmo dia';
      const fixed = str(p, 'due_fixed_date');
      if (fixed) return fixed;
      return null;
    }
    case 'billing_conditions': {
      const elapsed = num(p, 'elapsed_period_days');
      if (elapsed !== null) return `${elapsed} dias`;
      const kind = str(p, 'condition_type');
      return (kind && BILLING_CONDITION_LABEL[kind]) ?? null;
    }
    case 'guarantees': {
      const amount = num(p, 'required_amount');
      if (amount !== null) return formatContractCurrency(amount);
      const percentage = num(p, 'required_percentage');
      if (percentage !== null) return `${percentage}%`;
      return null;
    }
    case 'insurance_requirements': {
      const coverage = num(p, 'required_coverage');
      return coverage === null ? null : formatContractCurrency(coverage);
    }
    case 'indexation_rules':
      return str(p, 'indexer');
    default:
      return null;
  }
}

export type InterpretationFact = { readonly label: string; readonly value: string };

/**
 * O conteúdo da gaveta: campo a campo, só o que o documento afirmou.
 *
 * Um campo ausente NÃO produz linha. "Bloqueia faturamento: Não" seria uma
 * afirmação inventada quando `blocks_billing` é `null` — que é precisamente o
 * caso em 10 das 11 obrigações deste contrato.
 */
export function interpretationFacts(
  row: ContractOperationalInterpretationRow,
): InterpretationFact[] {
  const p = row.normalized_payload;
  const facts: InterpretationFact[] = [];
  const push = (label: string, value: string | null) => {
    if (value !== null && value !== '') facts.push({ label, value });
  };

  switch (row.family) {
    case 'obligations': {
      push('Quem responde', RESPONSIBLE_SIDE_LABEL[str(p, 'responsible_side') ?? ''] ?? null);
      push('O que o contrato exige', str(p, 'requirement_text'));
      push('Classificação no documento', str(p, 'category'));
      const activation = str(p, 'activation_kind');
      push('Quando passa a valer', activation ? ACTIVATION_LABEL[activation] ?? null : null);
      push('Evento de partida', str(p, 'activation_event_text'));
      push('Prazo', interpretationEffect(row));
      const recurrence = str(p, 'recurrence_kind');
      if (recurrence && recurrence !== 'one_time') {
        push('Repetição', RECURRENCE_LABEL[recurrence] ?? null);
      }
      // Só quando o contrato DISSE que bloqueia. `null` não vira "Não".
      if (bool(p, 'blocks_billing') === true) push('Efeito no faturamento', 'Bloqueia o faturamento');
      break;
    }
    case 'billing_conditions': {
      const kind = str(p, 'condition_type');
      push('Condição', kind ? BILLING_CONDITION_LABEL[kind] ?? null : null);
      push('O que o contrato exige', str(p, 'requirement_text'));
      push('Documento exigido', str(p, 'required_document_type'));
      const elapsed = num(p, 'elapsed_period_days');
      push('Prazo contratual', elapsed === null ? null : `${elapsed} dias`);
      break;
    }
    case 'guarantees': {
      push('Tipo de garantia', str(p, 'guarantee_type'));
      const amount = num(p, 'required_amount');
      push('Valor exigido', amount === null ? null : formatContractCurrency(amount));
      const percentage = num(p, 'required_percentage');
      push('Percentual exigido', percentage === null ? null : `${percentage}%`);
      push('Base do percentual', str(p, 'percentage_basis'));
      if (bool(p, 'renewal_required') === true) push('Renovação', 'Exigida pelo contrato');
      break;
    }
    case 'insurance_requirements': {
      push('Tipo de seguro', str(p, 'insurance_type'));
      const coverage = num(p, 'required_coverage');
      push('Cobertura mínima', coverage === null ? null : formatContractCurrency(coverage));
      if (bool(p, 'policy_required') === true) push('Apólice', 'Exigida pelo contrato');
      push('Exigência de vigência', str(p, 'validity_requirement'));
      break;
    }
    case 'indexation_rules': {
      push('Indexador', str(p, 'indexer'));
      const periodicity = num(p, 'periodicity_months');
      push('Periodicidade', periodicity === null ? null : `${periodicity} meses`);
      push('Data-base', str(p, 'base_date'));
      push('Regra de aniversário', str(p, 'anniversary_rule'));
      const lag = num(p, 'lag_months');
      push('Defasagem', lag === null ? null : `${lag} meses`);
      const floor = num(p, 'floor_percentage');
      push('Piso', floor === null ? null : `${floor}%`);
      const cap = num(p, 'cap_percentage');
      push('Teto', cap === null ? null : `${cap}%`);
      break;
    }
    default:
      break;
  }
  return facts;
}

/** O título que o Apex deu à interpretação, com degradação honesta. */
export function interpretationTitle(row: ContractOperationalInterpretationRow): string {
  return str(row.normalized_payload, 'title') ?? 'Interpretação sem título registrado';
}

// ─── modelo de leitura da aba ──────────────────────────────────────────────

export interface InterpretationView {
  readonly id: string;
  readonly family: OperationalFamily;
  readonly familyLabel: string;
  readonly title: string;
  /** `null` = o contrato não quantificou este efeito. */
  readonly effect: string | null;
  readonly page: number;
  readonly excerpt: string;
  readonly confidence: number | null;
  readonly trustState: OperationalTrustState;
  readonly attentionReasons: readonly string[];
  readonly documentId: string;
  readonly analysisId: string;
  readonly facts: readonly InterpretationFact[];
  readonly blocksBilling: boolean | null;
}

export interface InterpretationGroup {
  readonly family: OperationalFamily;
  readonly label: string;
  readonly items: readonly InterpretationView[];
}

/**
 * As exceções agrupadas pelo MOTIVO, e não pela família.
 *
 * Sete linhas com "Baixa confiança documental" repetido sete vezes são sete
 * leituras. Duas rubricas — "3 garantias com leitura inconclusiva", "4 seguros
 * com exposição material" — são DUAS decisões, e é assim que quem decide
 * pensa. A compressão não esconde item nenhum: os sete continuam listados,
 * cada um com o seu efeito e a sua página. O que deixa de se repetir é a
 * explicação, que passa a ser dita uma vez por grupo.
 */
export interface AttentionGroup {
  /** A combinação de motivos que define o grupo. Estável e ordenada. */
  readonly key: string;
  readonly reasons: readonly string[];
  readonly label: string;
  /** O que a pessoa precisa fazer. `null` quando o motivo é novo para esta tela. */
  readonly ask: string | null;
  readonly items: readonly InterpretationView[];
}

export function groupAttentionByReason(
  items: readonly InterpretationView[],
): AttentionGroup[] {
  const groups = new Map<string, InterpretationView[]>();
  for (const item of items) {
    const key = [...item.attentionReasons].sort().join('+') || 'sem-motivo';
    const bucket = groups.get(key) ?? [];
    bucket.push(item);
    groups.set(key, bucket);
  }
  return [...groups.entries()]
    .map(([key, bucket]) => {
      const reasons = [...bucket[0].attentionReasons].sort();
      return {
        key,
        reasons,
        label: reasons.map(attentionReasonLabel).join(' · ') || 'Exceção de governança',
        // O pedido de ação só é dito quando há UM motivo. Concatenar dois
        // pedidos produziria uma instrução que ninguém escreveu.
        ask: reasons.length === 1 ? attentionReasonAsk(reasons[0]) : null,
        items: bucket.sort((a, b) => a.page - b.page),
      };
    })
    // O grupo maior primeiro: é onde há mais decisão concentrada.
    .sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label, 'pt-BR'));
}

export interface ContractIntelligence {
  /** Toda interpretação da análise vigente. */
  readonly total: number;
  /** `automatic` — materializadas; o Apex opera por elas. */
  readonly structuredCount: number;
  /** `requires_attention` — a fila humana, e a única. */
  readonly attentionCount: number;
  readonly attention: readonly InterpretationView[];
  /** As mesmas exceções, agrupadas pelo motivo que as reteve. */
  readonly attentionGroups: readonly AttentionGroup[];
  readonly structured: readonly InterpretationGroup[];
  /** A análise que produziu esta leitura. `null` quando não houve nenhuma. */
  readonly analysisId: string | null;
  readonly documentId: string | null;
}

export function toView(row: ContractOperationalInterpretationRow): InterpretationView {
  return {
    id: row.id,
    family: row.family,
    familyLabel: OPERATIONAL_FAMILY_LABEL[row.family] ?? 'Outras exigências',
    title: interpretationTitle(row),
    effect: interpretationEffect(row),
    page: row.source_page,
    excerpt: row.source_excerpt,
    confidence: readConfidence(row.confidence),
    trustState: row.trust_state,
    attentionReasons: row.trust_reasons ?? [],
    documentId: row.source_document_id,
    analysisId: row.analysis_id,
    facts: interpretationFacts(row),
    blocksBilling: bool(row.normalized_payload, 'blocks_billing'),
  };
}

/**
 * A leitura vigente do contrato.
 *
 * Só a análise MAIS RECENTE conta. Uma releitura não soma à anterior: ela a
 * substitui, e somar as duas apresentaria o mesmo prazo de pagamento duas
 * vezes como se o contrato tivesse dois. A tabela guarda todas as gerações
 * para auditoria — a tela mostra a que vale hoje.
 */
export function buildContractIntelligence(
  rows: readonly ContractOperationalInterpretationRow[],
): ContractIntelligence {
  const latestByAnalysis = new Map<string, ContractOperationalInterpretationRow[]>();
  let latestId: string | null = null;
  let latestAt = '';
  for (const row of rows) {
    const bucket = latestByAnalysis.get(row.analysis_id) ?? [];
    bucket.push(row);
    latestByAnalysis.set(row.analysis_id, bucket);
    if (row.created_at > latestAt) {
      latestAt = row.created_at;
      latestId = row.analysis_id;
    }
  }

  const current = latestId ? latestByAnalysis.get(latestId) ?? [] : [];
  const views = current.map(toView);

  const attention = views
    .filter((v) => v.trustState === 'requires_attention')
    .sort((a, b) => a.familyLabel.localeCompare(b.familyLabel, 'pt-BR') || a.page - b.page);

  const structuredViews = views.filter((v) => v.trustState === 'automatic');
  const structured: InterpretationGroup[] = [];
  for (const family of OPERATIONAL_FAMILY_ORDER) {
    const items = structuredViews
      .filter((v) => v.family === family)
      .sort((a, b) => a.page - b.page);
    if (items.length > 0) {
      structured.push({ family, label: OPERATIONAL_FAMILY_LABEL[family], items });
    }
  }

  return {
    total: views.length,
    structuredCount: structuredViews.length,
    attentionCount: attention.length,
    attention,
    attentionGroups: groupAttentionByReason(attention),
    structured,
    analysisId: latestId,
    documentId: views[0]?.documentId ?? null,
  };
}
