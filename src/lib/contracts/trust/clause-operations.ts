/**
 * Operação da inteligência de cláusulas — ciclo de vida, fila de revisão,
 * cobertura e métricas.
 *
 * Lógica pura, sem JSX (o vitest deste repositório roda em `node`).
 *
 * O que este módulo NÃO faz, e não fará antes de haver corpus validado:
 * padrão de carteira, desvio em relação a esse padrão, ou qualquer pontuação
 * preditiva. Comparar cláusulas contra um "normal" que ainda não existe
 * produziria desvio calculado sobre nada — a modalidade de erro mais cara
 * deste domínio, porque parece análise.
 */

import type {
  AiAnalysisStatus, ClauseReviewStatus,
  ContractAiAnalysisRow, ContractClauseRow, ContractDocumentRow,
} from '../contract-service';
import { CLAUSE_CATEGORIES, type ClauseCategory } from '../clause-categories';
import { hasOfficialValue, isError, isOfficialOrigin } from './trusted';
import { safeAnalysisFailureMessage } from './analysis-errors';
import type { TrustedContract } from './read-model';

// ═══════════════════════════════════════════════════════════════════════════
// 1 · Ciclo de vida da análise, por documento
// ═══════════════════════════════════════════════════════════════════════════

export type AnalysisLifecycle =
  /** Documento existe, nunca foi analisado. */
  | 'not-analyzed'
  /** Análise em curso. */
  | 'analyzing'
  /** Concluída, com propostas aguardando decisão. */
  | 'proposals-available'
  /** Alguém começou a decidir, ainda há pendência. */
  | 'in-review'
  /** Toda proposta desta análise recebeu decisão humana. */
  | 'reviewed'
  /** A análise falhou. */
  | 'failed';

/**
 * Que ETAPA da leitura está em curso, quando alguma está.
 *
 * Deriva de `contract_ai_analyses.extracted_data.kind`, que a própria execução
 * grava. Não é uma barra de progresso: são as duas etapas que o backend sabe
 * distinguir, e nada além delas. Inventar uma terceira — ou uma porcentagem —
 * seria descrever um processo que ninguém está medindo.
 */
export type AnalysisStage = 'clause-extraction' | 'operationalization';

/**
 * O que a tela diz que o Apex está fazendo, por etapa.
 *
 * Vocabulário do domínio, e não do transporte: quem lê um contrato não precisa
 * saber qual provedor, qual modelo ou qual fila está envolvida — precisa saber
 * o que vai existir no dossiê quando isto terminar.
 */
export const STAGE_DESCRIPTION: Record<AnalysisStage, string> = {
  'clause-extraction': 'Lendo o documento e identificando cláusulas...',
  operationalization: 'Identificando obrigações, condições e garantias...',
};

/**
 * As duas etapas que a tela consegue LASTREAR, com os rótulos de cada uma.
 *
 * `done` é uma etapa cuja conclusão está persistida; `active` é a que está
 * viva. Não há uma terceira — "consolidando", "revisando", "quase lá" seriam
 * decoração, porque não existe estado no banco que as sustente.
 */
export const STAGE_STEPS: Record<AnalysisStage, { readonly done: string; readonly active: string }> = {
  'clause-extraction': {
    done: 'Documento recebido',
    active: 'Leitura do documento em andamento',
  },
  operationalization: {
    done: 'Documento preparado',
    active: 'Inteligência contratual em processamento',
  },
};

/**
 * A partir de quando a espera deixa de ser a esperada, por etapa.
 *
 * Não é limite nem prazo: passar daqui não é falha, e o texto muda justamente
 * para dizer isso. O que ele evita é o silêncio — uma espera que excede a
 * expectativa sem que a tela reconheça que excedeu parece abandono.
 */
export const LONGER_THAN_USUAL_MS: Record<AnalysisStage, number> = {
  'clause-extraction': 240_000,
  operationalization: 300_000,
};

/** Duração como MM:SS. Cresce sem teto de hora: é decorrido, não relógio. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Milissegundos decorridos desde o início PERSISTIDO.
 *
 * `null` quando não há início confiável — e, nesse caso, a tela não mostra
 * relógio nenhum. Um "00:00" fabricado seria pior que a ausência: afirmaria
 * que a análise acabou de começar.
 *
 * Relógios de cliente e servidor divergem, e um decorrido negativo é ruído de
 * relógio, não informação: ele é achatado em zero.
 */
export function elapsedSince(startedAt: string | null, now: number): number | null {
  if (!startedAt) return null;
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return null;
  return Math.max(0, now - started);
}

function stageOf(analysis: ContractAiAnalysisRow | null): AnalysisStage | null {
  const kind = analysis?.extracted_data?.kind;
  if (kind === 'contract_operationalization') return 'operationalization';
  if (kind === 'clause_extraction') return 'clause-extraction';
  return null;
}

export const LIFECYCLE_LABEL: Record<AnalysisLifecycle, string> = {
  'not-analyzed': 'Não analisado',
  analyzing: 'Analisando',
  'proposals-available': 'Propostas disponíveis',
  'in-review': 'Em revisão',
  reviewed: 'Revisado',
  failed: 'Falhou',
};

/** Ordem de urgência operacional — o que precisa de gente primeiro. */
const LIFECYCLE_RANK: Record<AnalysisLifecycle, number> = {
  failed: 0,
  'proposals-available': 1,
  'in-review': 2,
  'not-analyzed': 3,
  analyzing: 4,
  reviewed: 5,
};

export type DocumentAnalysisState = {
  readonly documentId: string;
  readonly documentTitle: string;
  readonly version: number;
  /** Documento substituído por outra versão — não é mais o vigente. */
  readonly superseded: boolean;
  readonly lifecycle: AnalysisLifecycle;
  /** Análise mais recente NÃO substituída deste documento. */
  readonly analysisId: string | null;
  readonly analysisAt: string | null;
  /**
   * Início PERSISTIDO da análise viva — `started_at`, com `created_at` como
   * segunda opção quando a linha nasceu antes de a execução começar.
   *
   * É daqui, e de nenhum relógio de componente, que o tempo decorrido em tela
   * é calculado. Um cronômetro que começasse na montagem do React voltaria a
   * zero a cada refresh e mentiria sobre uma execução que nunca parou.
   */
  readonly startedAt: string | null;
  /** A etapa em curso, quando `lifecycle === 'analyzing'`. */
  readonly stage: AnalysisStage | null;
  /**
   * Mensagem de NEGÓCIO da falha — o que a tela pode mostrar.
   *
   * Nunca é o texto do provedor. Ver `analysis-errors.ts`.
   */
  readonly errorMessage: string | null;
  /**
   * O erro técnico cru, preservado para log, auditoria e diagnóstico.
   *
   * Existe justamente para que sanitizar a tela NÃO custe informação: quem
   * investiga continua tendo o texto inteiro. Nenhuma superfície de negócio
   * deve renderizá-lo.
   */
  readonly errorDiagnostic: string | null;
  readonly proposalsPending: number;
  readonly proposalsValidated: number;
  readonly proposalsRejected: number;
  readonly rank: number;
};

const PENDING: readonly ClauseReviewStatus[] = ['draft', 'in_review'];

/**
 * O estado de cada documento do contrato.
 *
 * Documentos substituídos continuam na lista, marcados — sumir com eles
 * apagaria a linhagem que a auditoria precisa.
 */
export function documentAnalysisStates(
  documents: readonly ContractDocumentRow[],
  analyses: readonly ContractAiAnalysisRow[],
  clauses: readonly ContractClauseRow[],
): DocumentAnalysisState[] {
  return documents.map((document) => {
    // Só análises vivas definem o estado; as substituídas são história.
    const own = analyses
      .filter((a) => a.document_id === document.id && a.status !== 'superseded')
      .sort((a, b) => b.created_at.localeCompare(a.created_at));

    /*
      ─── UMA TENTATIVA BEM-SUCEDIDA ENCERRA A FALHA ANTERIOR ──────────────

      Uma leitura que falhou e foi REFEITA com sucesso é história, não estado.
      Deixá-la governar a apresentação faz o dossiê anunciar como situação
      atual um incidente já resolvido — e foi exatamente o que produção
      mostrou: o erro da primeira tentativa continuava em tela depois de a
      releitura ter concluído.

      O critério é o relógio: se existe conclusão posterior à última falha, é
      ela que descreve o documento. A falha continua na persistência e no
      histórico de auditoria; o que ela perde é o direito de falar em nome do
      presente.
    */
    const at = (a: ContractAiAnalysisRow) => a.completed_at ?? a.created_at;
    const newestCompleted = own.find((a) => a.status === 'completed') ?? null;
    const newestFailed = own.find((a) => a.status === 'failed') ?? null;
    const successSupersedesFailure = Boolean(
      newestCompleted && newestFailed && at(newestCompleted) >= at(newestFailed),
    );
    const latest = successSupersedesFailure ? newestCompleted : (own[0] ?? null);

    const fromDoc = clauses.filter((c) => c.source_document_id === document.id && c.ai_flagged);
    const pending = fromDoc.filter((c) => PENDING.includes(c.review_status)).length;
    const validated = fromDoc.filter((c) => c.review_status === 'validated').length;
    const rejected = fromDoc.filter((c) => c.review_status === 'rejected').length;

    const lifecycle = deriveLifecycle(latest?.status ?? null, {
      pending, decided: validated + rejected, total: fromDoc.length,
    });

    return {
      documentId: document.id,
      documentTitle: document.title,
      version: document.version,
      superseded: document.superseded_by_document_id !== null,
      lifecycle,
      analysisId: latest?.id ?? null,
      analysisAt: latest?.completed_at ?? latest?.created_at ?? null,
      startedAt: latest?.started_at ?? latest?.created_at ?? null,
      stage: lifecycle === 'analyzing' ? stageOf(latest) : null,
      errorMessage: safeAnalysisFailureMessage(latest?.error_message, { withRetry: true }),
      errorDiagnostic: latest?.error_message ?? null,
      proposalsPending: pending,
      proposalsValidated: validated,
      proposalsRejected: rejected,
      rank: LIFECYCLE_RANK[lifecycle],
    };
  }).sort((a, b) => a.rank - b.rank || a.documentTitle.localeCompare(b.documentTitle));
}

/**
 * A transição de estado. Pura e exportada porque é a regra do ciclo, e a regra
 * precisa ser verificável sem montar banco.
 *
 * Uma sutileza que vale explicitar: análise `completed` que não propôs NADA é
 * `reviewed`, não `proposals-available`. Não há o que revisar — e deixá-la
 * como pendente encheria a fila de trabalho inexistente.
 */
export function deriveLifecycle(
  status: AiAnalysisStatus | null,
  counts: { pending: number; decided: number; total: number },
): AnalysisLifecycle {
  if (status === null || status === 'pending') {
    // Sem análise viva: se há proposta pendente, ela veio de outro caminho e
    // continua sendo trabalho; senão, o documento nunca foi lido.
    return counts.pending > 0 ? 'proposals-available' : 'not-analyzed';
  }
  if (status === 'running') return 'analyzing';
  if (status === 'failed') return 'failed';
  // completed
  if (counts.pending === 0) return 'reviewed';
  return counts.decided > 0 ? 'in-review' : 'proposals-available';
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · Fila de revisão
// ═══════════════════════════════════════════════════════════════════════════

export type InboxItem = {
  readonly clauseId: string;
  readonly contractId: string;
  readonly contractCode: string;
  readonly contractTitle: string;
  readonly documentId: string | null;
  readonly documentTitle: string | null;
  /** A proposta veio de um documento que já foi substituído. */
  readonly fromSupersededDocument: boolean;
  readonly category: ClauseCategory | null;
  readonly title: string;
  readonly excerpt: string | null;
  readonly page: number | null;
  readonly confidence: number | null;
  readonly reviewStatus: ClauseReviewStatus;
  readonly riskLevel: 'low' | 'medium' | 'high';
  /** Dias desde a proposta. */
  readonly ageDays: number | null;
  readonly priority: number;
};

export type InboxFilters = {
  readonly category?: ClauseCategory | 'all';
  readonly contractId?: string | 'all';
  readonly status?: ClauseReviewStatus | 'all';
  /** Confiança máxima — para isolar as leituras duvidosas. */
  readonly maxConfidence?: number;
  /** Idade mínima em dias — para achar o que está parado. */
  readonly minAgeDays?: number;
};

const DAY = 86_400_000;

/**
 * Prioridade da fila. Menor = mais urgente.
 *
 * A regra: **confiança baixa sobe**, porque leitura duvidosa é onde o humano
 * agrega mais — uma leitura clara provavelmente será validada sem discussão.
 * Risco alto sobe junto, e a idade desempata. Nada aqui é preditivo: são três
 * fatos da própria linha.
 */
export function inboxPriority(item: {
  confidence: number | null;
  riskLevel: 'low' | 'medium' | 'high';
  ageDays: number | null;
  fromSupersededDocument: boolean;
}): number {
  // Proposta de documento substituído vai para o fim: revisar leitura de um
  // papel que não vale mais é trabalho jogado fora.
  if (item.fromSupersededDocument) return 1000;

  const confidencePenalty = item.confidence === null ? 40 : Math.round(item.confidence * 100);
  const riskBonus = item.riskLevel === 'high' ? -30 : item.riskLevel === 'medium' ? -10 : 0;
  const agePressure = item.ageDays === null ? 0 : -Math.min(item.ageDays, 30);
  return confidencePenalty + riskBonus + agePressure;
}

export function buildReviewInbox(
  contracts: readonly TrustedContract[],
  documents: ReadonlyMap<string, ContractDocumentRow>,
  now: Date = new Date(),
  filters: InboxFilters = {},
  options: { officialOnly?: boolean } = {},
): InboxItem[] {
  const scope = options.officialOnly === false
    ? contracts
    : contracts.filter((c) => isOfficialOrigin(c.dataClass));

  const items: InboxItem[] = [];

  for (const contract of scope) {
    if (isError(contract.clauses) || !hasOfficialValue(contract.clauses)) continue;

    for (const clause of contract.clauses.value) {
      if (!clause.ai_flagged) continue;
      if (!PENDING.includes(clause.review_status)) continue;

      const document = clause.source_document_id ? documents.get(clause.source_document_id) : undefined;
      const fromSuperseded = Boolean(document?.superseded_by_document_id);
      const confidence = clause.ai_confidence === null ? null : Number(clause.ai_confidence);
      const proposedAt = clause.ai_proposed_at ? new Date(clause.ai_proposed_at).getTime() : null;
      const ageDays = proposedAt === null ? null : Math.floor((now.getTime() - proposedAt) / DAY);
      const category = (CLAUSE_CATEGORIES as readonly string[]).includes(clause.clause_type ?? '')
        ? (clause.clause_type as ClauseCategory)
        : null;
      const riskLevel = clause.risk_level === 'high' || clause.risk_level === 'low'
        ? clause.risk_level : 'medium';

      const item: InboxItem = {
        clauseId: clause.id,
        contractId: contract.id,
        contractCode: contract.code,
        contractTitle: contract.title,
        documentId: clause.source_document_id,
        documentTitle: document?.title ?? null,
        fromSupersededDocument: fromSuperseded,
        category,
        title: clause.title,
        excerpt: clause.source_excerpt,
        page: clause.source_page,
        confidence: confidence !== null && Number.isFinite(confidence) ? confidence : null,
        reviewStatus: clause.review_status,
        riskLevel,
        ageDays,
        priority: 0,
      };
      items.push({ ...item, priority: inboxPriority(item) });
    }
  }

  return applyInboxFilters(items, filters).sort(
    (a, b) => a.priority - b.priority || a.contractCode.localeCompare(b.contractCode),
  );
}

export function applyInboxFilters(items: readonly InboxItem[], filters: InboxFilters): InboxItem[] {
  return items.filter((item) => {
    if (filters.category && filters.category !== 'all' && item.category !== filters.category) return false;
    if (filters.contractId && filters.contractId !== 'all' && item.contractId !== filters.contractId) return false;
    if (filters.status && filters.status !== 'all' && item.reviewStatus !== filters.status) return false;
    if (filters.maxConfidence !== undefined) {
      // Proposta SEM confiança entra no recorte de baixa confiança: não saber
      // o quanto a leitura é firme é, no mínimo, tão incerto quanto saber que
      // é fraca.
      if (item.confidence !== null && item.confidence > filters.maxConfidence) return false;
    }
    if (filters.minAgeDays !== undefined) {
      if (item.ageDays === null || item.ageDays < filters.minAgeDays) return false;
    }
    return true;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · Cobertura por contrato
// ═══════════════════════════════════════════════════════════════════════════

export type CategoryCoverage = {
  readonly category: ClauseCategory;
  readonly validated: number;
  readonly pending: number;
  readonly rejected: number;
  /** Nenhuma cláusula desta categoria foi validada. */
  readonly missing: boolean;
};

export type ContractCoverage = {
  readonly contractId: string;
  readonly code: string;
  readonly title: string;
  readonly categories: readonly CategoryCoverage[];
  readonly validatedCategories: number;
  readonly expectedCategories: number;
  readonly pendingProposals: number;
  /** Documentos vigentes que nunca foram analisados. */
  readonly documentsNotAnalyzed: number;
  readonly analysesFailed: number;
  /** `null` quando não há documento algum: cobertura não é apurável. */
  readonly coverageRatio: number | null;
};

/**
 * Cobertura de categorias por contrato.
 *
 * "Esperado" é o vocabulário inteiro — dez categorias — e isso é deliberado:
 * nenhuma inferência decide quais categorias um contrato "deveria" ter. Essa
 * inferência exigiria padrão de carteira, que é justamente o que ainda não
 * pode existir. Categoria ausente é informação neutra: pode ser lacuna de
 * revisão ou o contrato simplesmente não a tem.
 */
export function contractCoverage(
  contract: TrustedContract,
  documents: readonly ContractDocumentRow[],
  analyses: readonly ContractAiAnalysisRow[],
): ContractCoverage {
  const clauses = hasOfficialValue(contract.clauses) ? contract.clauses.value : [];

  const categories: CategoryCoverage[] = CLAUSE_CATEGORIES.map((category) => {
    const own = clauses.filter((c) => c.clause_type === category);
    const validated = own.filter((c) => c.review_status === 'validated').length;
    return {
      category,
      validated,
      pending: own.filter((c) => PENDING.includes(c.review_status)).length,
      rejected: own.filter((c) => c.review_status === 'rejected').length,
      missing: validated === 0,
    };
  });

  const current = documents.filter((d) => d.superseded_by_document_id === null);
  const analyzed = new Set(
    analyses.filter((a) => a.status === 'completed' && a.document_id).map((a) => a.document_id as string),
  );

  const validatedCategories = categories.filter((c) => c.validated > 0).length;

  return {
    contractId: contract.id,
    code: contract.code,
    title: contract.title,
    categories,
    validatedCategories,
    expectedCategories: CLAUSE_CATEGORIES.length,
    pendingProposals: clauses.filter((c) => c.ai_flagged && PENDING.includes(c.review_status)).length,
    documentsNotAnalyzed: current.filter((d) => !analyzed.has(d.id)).length,
    analysesFailed: analyses.filter((a) => a.status === 'failed').length,
    // Sem documento não há o que analisar, e cobertura vira uma fração sem
    // denominador honesto.
    coverageRatio: current.length === 0 ? null : validatedCategories / CLAUSE_CATEGORIES.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · Métricas operacionais
// ═══════════════════════════════════════════════════════════════════════════

export type ClauseOpsMetrics = {
  readonly documentsAwaitingAnalysis: number;
  readonly proposalsAwaitingReview: number;
  readonly contractsWithIncompleteReview: number;
  readonly analysesFailed: number;
  readonly validatedClauses: number;
  /** Contratos com ao menos uma categoria validada, sobre o total do recorte. */
  readonly contractsWithValidatedCoverage: number;
  readonly contractsInScope: number;
  /** Propostas de documento já substituído — trabalho que não vale a pena. */
  readonly staleProposals: number;
};

export function clauseOpsMetrics(
  coverages: readonly ContractCoverage[],
  inbox: readonly InboxItem[],
): ClauseOpsMetrics {
  return {
    documentsAwaitingAnalysis: coverages.reduce((s, c) => s + c.documentsNotAnalyzed, 0),
    proposalsAwaitingReview: inbox.filter((i) => !i.fromSupersededDocument).length,
    contractsWithIncompleteReview: coverages.filter((c) => c.pendingProposals > 0).length,
    analysesFailed: coverages.reduce((s, c) => s + c.analysesFailed, 0),
    validatedClauses: coverages.reduce(
      (s, c) => s + c.categories.reduce((n, cat) => n + cat.validated, 0), 0),
    contractsWithValidatedCoverage: coverages.filter((c) => c.validatedCategories > 0).length,
    contractsInScope: coverages.length,
    staleProposals: inbox.filter((i) => i.fromSupersededDocument).length,
  };
}

/**
 * Há corpus validado suficiente para comparar cláusulas entre contratos?
 *
 * Existe para ser respondida por DADO e não por opinião — e para que a
 * resposta negativa seja visível na própria tela, em vez de virar uma
 * decisão silenciosa de arquitetura.
 *
 * O limiar é deliberadamente conservador: comparar exige mais de uma
 * observação por categoria, em mais de um contrato. Com menos que isso, o
 * "padrão" seria a própria amostra.
 */
export function benchmarkReadiness(
  coverages: readonly ContractCoverage[],
  options: { minContracts?: number; minPerCategory?: number } = {},
): {
  readonly ready: boolean;
  readonly reason: string;
  readonly categoriesReady: readonly ClauseCategory[];
  readonly contractsWithData: number;
} {
  const minContracts = options.minContracts ?? 5;
  const minPerCategory = options.minPerCategory ?? 3;

  const contractsWithData = coverages.filter((c) => c.validatedCategories > 0).length;
  const perCategory = new Map<ClauseCategory, number>();
  for (const coverage of coverages) {
    for (const cat of coverage.categories) {
      if (cat.validated > 0) perCategory.set(cat.category, (perCategory.get(cat.category) ?? 0) + 1);
    }
  }
  const categoriesReady = [...perCategory.entries()]
    .filter(([, n]) => n >= minPerCategory)
    .map(([category]) => category);

  if (contractsWithData < minContracts) {
    return {
      ready: false,
      reason: `Comparação entre contratos exige ao menos ${minContracts} contratos com cláusula validada; há ${contractsWithData}.`,
      categoriesReady,
      contractsWithData,
    };
  }
  if (categoriesReady.length === 0) {
    return {
      ready: false,
      reason: `Nenhuma categoria alcançou ${minPerCategory} contratos com cláusula validada — não há padrão contra o qual comparar.`,
      categoriesReady,
      contractsWithData,
    };
  }
  return {
    ready: true,
    reason: `${categoriesReady.length} categoria(s) com massa suficiente em ${contractsWithData} contratos.`,
    categoriesReady,
    contractsWithData,
  };
}
