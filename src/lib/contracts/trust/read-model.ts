/**
 * Read model confiável de Contratos.
 *
 * Constrói `TrustedContract` a partir EXCLUSIVAMENTE de linhas reais: a linha
 * de `contracts` e o batch de relações da migration 034. Nenhuma chamada ao
 * enricher, nenhum `hash(id + nome)`, nenhuma escada 10/40/50%.
 *
 * É o modelo único que tela e PDF oficial consomem — se os dois lerem daqui,
 * não há como divergirem.
 *
 * ─── Uma distinção que não é óbvia ─────────────────────────────────────────
 *
 * "Consulta voltou vazia" significa coisas diferentes conforme o indicador:
 *
 *  · Contagens operacionais (obrigações atrasadas, documentos pendentes):
 *    zero linhas É conhecimento. Se a consulta rodou e não há obrigação
 *    atrasada, "0 atrasadas" é uma afirmação apurada e verdadeira.
 *
 *  · Exposição financeira (faturado, saldo): zero linhas NÃO é conhecimento.
 *    Ausência de evento de faturamento registrado não significa que nada foi
 *    faturado — significa que nada foi registrado. Afirmar "R$ 0 faturado"
 *    seria inventar uma medição a partir de um silêncio. Aqui o resultado é
 *    `missing('no-rows')`.
 *
 * Essa assimetria é deliberada e é onde mora o cuidado do módulo: dinheiro
 * nunca é afirmado por ausência.
 *
 * Sem React, sem I/O. Roda em Node.
 */

import type { Project } from '@/lib/types';
import type { PartyRow } from '@/lib/parties/types';
import { partyDisplayName } from '@/lib/parties/types';
import { partyFor } from '@/lib/parties/counterparty';
import type {
  ContractRow,
  ContractDetail,
  ContractRelationsBatch,
  ContractObligationRow,
  ContractBillingEventRow,
  ContractDocumentRow,
  ContractApprovalRow,
  ContractProjectLinkRow,
  ContractRiskLinkRow,
  ContractAiAnalysisRow,
  ContractMilestoneRow,
  ContractClauseRow,
  ContractPenaltyRow,
  ContractRelationSectionKey,
} from '@/lib/contracts/contract-service';
import {
  live, derived, missing, failed, sumTrusted,
  hasOfficialValue, isError,
  type Official, type LiveSource, type ContractDataClass,
} from './trusted';

// ═══════════════════════════════════════════════════════════════════════════
// O modelo
// ═══════════════════════════════════════════════════════════════════════════

export type TrustedContract = {
  /**
   * Origem da linha. Determina a ELEGIBILIDADE a métrica oficial, e é
   * independente da qualidade dos valores: um contrato de demonstração pode ter
   * dados perfeitamente medidos — o que o exclui da carteira é a procedência.
   */
  readonly dataClass: ContractDataClass;

  /** Identidade — sempre apurada, vem das colunas de `contracts`. */
  readonly id: string;
  readonly code: string;
  readonly title: string;
  /**
   * Nome da contraparte.
   *
   * O ESTADO de confiança não muda com a existência de vínculo canônico: com
   * party é `live(..., 'parties')`, sem party e com texto é
   * `live(..., 'contracts')`, sem nenhum dos dois é `missing('null-in-source')`
   * — igual a antes. Ligar um contrato a uma `party` não promove nem rebaixa
   * confiança, e JAMAIS transforma um `missing` em valor: só diz de qual
   * tabela o nome veio.
   *
   * Não há campo `counterpartyIsCanonical`: seria redundante. O selo já está no
   * rótulo de origem — `counterparty.trust === 'live' && counterparty.source
   * === 'parties'`.
   */
  readonly counterparty: Official<string>;
  readonly contractType: Official<string>;
  readonly status: string;
  readonly riskLevel: 'low' | 'medium' | 'high';
  readonly ownerUserId: Official<string>;

  /** Vigência. */
  readonly startDate: Official<Date>;
  readonly endDate: Official<Date>;
  /**
   * Data da decisão de renovação, quando registrada.
   *
   * Separada de `endDate` de propósito: quando existe, é ela que governa a
   * janela de renovação — decidir renovar acontece antes de a vigência acabar,
   * e tratar as duas como a mesma coisa atrasa a decisão pelo tamanho do aviso
   * prévio.
   */
  readonly renewalDate: Official<Date>;
  readonly daysUntilExpiration: Official<number>;

  /** Exposição financeira — nunca afirmada por ausência. */
  readonly totalValue: Official<number>;
  readonly billedValue: Official<number>;
  readonly remainingValue: Official<number>;

  /** Relações, cada uma com sua própria proveniência. */
  readonly obligations: Official<readonly ContractObligationRow[]>;
  readonly billingEvents: Official<readonly ContractBillingEventRow[]>;
  readonly documents: Official<readonly ContractDocumentRow[]>;
  readonly approvals: Official<readonly ContractApprovalRow[]>;
  readonly projectLinks: Official<readonly ContractProjectLinkRow[]>;
  readonly riskLinks: Official<readonly ContractRiskLinkRow[]>;
  readonly aiAnalyses: Official<readonly ContractAiAnalysisRow[]>;
  /**
   * Marcos de medição e cláusulas — instrumentados em P2B (migration 092).
   *
   * Entraram no read model quando ganharam caminho de escrita: antes, ler
   * tabela que ninguém escreve era custo de rede para confirmar vazio.
   */
  readonly milestones: Official<readonly ContractMilestoneRow[]>;
  readonly clauses: Official<readonly ContractClauseRow[]>;
  readonly penalties: Official<readonly ContractPenaltyRow[]>;

  /** Projeto resolvido a partir de vínculo REAL — jamais por auto-match. */
  readonly project: Official<Project>;

  /** Contagens operacionais derivadas — aqui `0` é apurado. */
  readonly overdueObligations: Official<number>;
  readonly pendingDocuments: Official<number>;

  /**
   * Em revisão jurídica. Derivado da coluna `status` e do passo `juridico` de
   * `contract_approvals` — antes vinha de `legalStatus`, campo do enricher.
   */
  readonly inLegalReview: Official<boolean>;

  /** Tem análise de IA registrada. Antes era `aiStatus`, fabricado. */
  readonly hasAiAnalysis: Official<boolean>;
};

const BILLED_STATUSES = new Set(['pago', 'paid', 'billed', 'realizado', 'realized', 'faturado']);

function isBilled(row: ContractBillingEventRow): boolean {
  if (row.paid_at) return true;
  return BILLED_STATUSES.has((row.status ?? '').toLowerCase());
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Coluna `date` do Postgres → `Date`.
 *
 * Data-só ('2027-08-31') é interpretada como meia-noite LOCAL, não UTC.
 * `new Date('2027-08-31')` produz meia-noite UTC, e qualquer renderização em
 * fuso a oeste de Greenwich — o Brasil inteiro — exibe o DIA ANTERIOR. Um
 * contrato que vence em 31/08 aparecia vencendo em 30/08, e `daysUntilExpiration`
 * contava um dia a menos.
 *
 * `end_date`, `start_date` e `signed_date` são datas de calendário: não têm
 * hora nem fuso, e tratá-las como instantes UTC é o que produz o deslocamento.
 * Timestamps completos continuam sendo interpretados como sempre.
 */
function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const text = String(value);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.exec(text);
  const parsed = dateOnly ? new Date(`${text}T00:00:00`) : new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Coluna nullable → indicador. `null` na origem é ausência declarada, não zero. */
function fromColumn<T>(value: T | null | undefined, source: LiveSource): Official<T> {
  return value === null || value === undefined
    ? missing<T>('null-in-source')
    : live(value, source);
}

/**
 * Seção de relação → lista confiável.
 *
 * Erro de leitura vira `error`. Zero linhas vira `live([])`: a consulta rodou e
 * a resposta é "não há" — isso É conhecimento, e permite contagens apuradas
 * iguais a zero.
 */
function section<T>(
  rows: readonly T[] | undefined,
  error: string | null,
  source: LiveSource,
): Official<readonly T[]> {
  if (error) return failed<readonly T[]>(error, source);
  return live((rows ?? []) as readonly T[], source);
}

const SECTION_SOURCE: Record<ContractRelationSectionKey, LiveSource> = {
  obligations: 'contract_obligations',
  billing: 'contract_billing_events',
  documents: 'contract_documents',
  approvals: 'contract_approvals',
  projectLinks: 'contract_project_links',
  risks: 'contract_risks_links',
  ai: 'contract_ai_analyses',
  milestones: 'contract_milestones',
  clauses: 'contract_clauses',
  penalties: 'contract_penalties',
};

function contractCode(row: ContractRow): string {
  if (row.contract_number) return row.contract_number;
  const match = row.title?.match(/\b(?:OS|OP|CT|CTR)\s*[0-9.-]+/i);
  if (match) return match[0].replace(/\s+/g, ' ');
  return `CTR-${row.id.slice(-6).toUpperCase()}`;
}

/**
 * Contraparte: entidade canônica quando houver, texto do contrato quando não.
 *
 * A precedência é estrita e não tem terceiro caso: `parties` → texto →
 * ausência. Nenhuma comparação de nome participa da decisão — só o vínculo
 * explícito `counterparty_party_id`. `batch.parties` ausente (leitura que não
 * resolveu parties, ou que tentou e falhou) é indistinguível, aqui, de
 * contrato sem vínculo: nos dois casos o resultado é o texto livre, que é o
 * comportamento histórico e continua verdadeiro.
 */
function counterpartyOf(
  row: ContractRow,
  parties: ReadonlyMap<string, PartyRow> | undefined,
): Official<string> {
  const party = partyFor(row.counterparty_party_id, parties);
  if (party) return live(partyDisplayName(party), 'parties');
  return fromColumn(row.counterparty_name, 'contracts');
}

// ═══════════════════════════════════════════════════════════════════════════
// Construção
// ═══════════════════════════════════════════════════════════════════════════

export function buildTrustedContract(
  row: ContractRow,
  batch: ContractRelationsBatch,
  projects: readonly Project[],
  now: Date = new Date(),
): TrustedContract {
  const id = row.id;
  const err = batch.sectionErrors;

  const obligations = section<ContractObligationRow>(batch.obligations.get(id), err.obligations, SECTION_SOURCE.obligations);
  const billingEvents = section<ContractBillingEventRow>(batch.billingEvents.get(id), err.billing, SECTION_SOURCE.billing);
  const documents = section<ContractDocumentRow>(batch.documents.get(id), err.documents, SECTION_SOURCE.documents);
  const approvals = section<ContractApprovalRow>(batch.approvals.get(id), err.approvals, SECTION_SOURCE.approvals);
  const projectLinks = section<ContractProjectLinkRow>(batch.projectLinks.get(id), err.projectLinks, SECTION_SOURCE.projectLinks);
  const riskLinks = section<ContractRiskLinkRow>(batch.riskLinks.get(id), err.risks, SECTION_SOURCE.risks);
  const aiAnalyses = section<ContractAiAnalysisRow>(batch.aiAnalyses.get(id), err.ai, SECTION_SOURCE.ai);
  const milestones = section<ContractMilestoneRow>(batch.milestones.get(id), err.milestones, SECTION_SOURCE.milestones);
  const clauses = section<ContractClauseRow>(batch.clauses.get(id), err.clauses, SECTION_SOURCE.clauses);
  const penalties = section<ContractPenaltyRow>(batch.penalties.get(id), err.penalties, SECTION_SOURCE.penalties);

  // ── Exposição ────────────────────────────────────────────────────────────
  const totalValue = fromColumn(toNumber(row.total_value), 'contracts');

  /**
   * Faturado realizado. Três situações distintas, três respostas distintas:
   *
   *  · leitura falhou            → `error`
   *  · nenhum evento registrado  → `missing`: silêncio da fonte não é R$ 0
   *  · eventos existem, nenhum   → `derived(0)`: sabemos que nada foi pago.
   *    realizado                   Isto É uma medição, e um zero legítimo.
   *
   * A segunda e a terceira parecem iguais na tela hoje e são completamente
   * diferentes na realidade: uma é ignorância, a outra é conhecimento.
   */
  const billedValue: Official<number> = (() => {
    if (isError(billingEvents)) return billingEvents;
    if (!hasOfficialValue(billingEvents)) return missing<number>('no-rows');

    if (billingEvents.value.length === 0) {
      return missing<number>('no-rows', 'nenhum evento de faturamento registrado');
    }

    const realized = billingEvents.value.filter(isBilled);
    if (realized.length === 0) {
      return derived(0, {
        rule: 'nenhum dos eventos de faturamento registrados foi realizado',
        from: ['contract_billing_events'],
        coverage: { counted: billingEvents.value.length, total: billingEvents.value.length },
      });
    }

    return sumTrusted(
      realized.map((event) => fromColumn(toNumber(event.amount), 'contract_billing_events')),
      'soma dos eventos de faturamento realizados',
      ['contract_billing_events'],
    );
  })();

  const remainingValue: Official<number> =
    isError(totalValue) ? totalValue
    : isError(billedValue) ? billedValue
    : hasOfficialValue(totalValue) && hasOfficialValue(billedValue)
      ? derived(Math.max(totalValue.value - billedValue.value, 0), {
          rule: 'valor total menos faturado realizado',
          from: ['contracts', 'contract_billing_events'],
        })
      : missing<number>('not-comparable', 'exige valor total e faturado apurados');

  // ── Vigência ─────────────────────────────────────────────────────────────
  const endDate = fromColumn(toDate(row.end_date), 'contracts');
  const daysUntilExpiration: Official<number> = hasOfficialValue(endDate)
    ? derived(Math.floor((endDate.value.getTime() - now.getTime()) / 86_400_000), {
        rule: 'dias entre hoje e a data de término',
        from: ['contracts'],
      })
    : missing<number>('null-in-source', 'contrato sem data de término');

  // ── Projeto: SOMENTE vínculo real ────────────────────────────────────────
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const project: Official<Project> = isError(projectLinks)
    ? projectLinks
    : (() => {
        // `contracts.project_id` e `contract_project_links` coexistem; ambos são
        // vínculos REAIS. Nenhum auto-match por hash entra aqui.
        const direct = row.project_id ? projectMap.get(row.project_id) : undefined;
        if (direct) return live(direct, 'contracts');
        const linked = hasOfficialValue(projectLinks)
          ? projectLinks.value.map((l) => projectMap.get(l.project_id)).find(Boolean)
          : undefined;
        return linked
          ? live(linked, 'contract_project_links')
          : missing<Project>('no-rows', 'contrato sem vínculo de projeto');
      })();

  // ── Contagens operacionais: aqui zero É apurado ──────────────────────────
  const overdueObligations: Official<number> = isError(obligations)
    ? obligations
    : hasOfficialValue(obligations)
      ? derived(obligations.value.filter((o) => o.status === 'overdue').length, {
          rule: 'obrigações com status overdue',
          from: ['contract_obligations'],
        })
      : missing<number>('no-rows');

  const pendingDocuments: Official<number> = isError(documents)
    ? documents
    : hasOfficialValue(documents)
      ? derived(
          documents.value.filter((d) =>
            d.status === 'missing' || d.status === 'expired' || d.status === 'rejected' || d.status === 'pending_approval',
          ).length,
          { rule: 'documentos faltantes, vencidos, rejeitados ou em aprovação', from: ['contract_documents'] },
        )
      : missing<number>('no-rows');

  // ── Revisão jurídica: coluna real + passo de aprovação real ─────────────
  const inLegalReview: Official<boolean> = isError(approvals)
    ? approvals
    : (() => {
        if (row.status === 'legal_review') return live(true, 'contracts');
        if (!hasOfficialValue(approvals)) return missing<boolean>('no-rows');
        const juridico = approvals.value.find((step) => step.step_name === 'juridico');
        if (!juridico) return derived(false, { rule: 'sem etapa jurídica aberta', from: ['contracts', 'contract_approvals'] });
        return derived(juridico.status !== 'approved', {
          rule: 'etapa jurídica ainda não aprovada',
          from: ['contract_approvals'],
        });
      })();

  const hasAiAnalysis: Official<boolean> = isError(aiAnalyses)
    ? aiAnalyses
    : hasOfficialValue(aiAnalyses)
      ? derived(aiAnalyses.value.length > 0, {
          rule: 'existe ao menos uma análise registrada',
          from: ['contract_ai_analyses'],
        })
      : missing<boolean>('no-rows');

  return {
    /**
     * `unclassified` é o default seguro quando a coluna ainda não existe na
     * resposta (base sem a migration 091, ou select parcial): na dúvida, o
     * contrato não é oficial.
     */
    dataClass: row.data_class ?? 'unclassified',
    id,
    code: contractCode(row),
    title: row.title,
    counterparty: counterpartyOf(row, batch.parties),
    contractType: fromColumn(row.contract_type, 'contracts'),
    status: row.status,
    riskLevel: (row.risk_level === 'high' || row.risk_level === 'low' ? row.risk_level : 'medium'),
    ownerUserId: fromColumn(row.owner_user_id, 'contracts'),
    startDate: fromColumn(toDate(row.start_date), 'contracts'),
    endDate,
    renewalDate: fromColumn(toDate(row.renewal_date), 'contracts'),
    daysUntilExpiration,
    totalValue,
    billedValue,
    remainingValue,
    obligations,
    billingEvents,
    documents,
    approvals,
    projectLinks,
    riskLinks,
    milestones,
    clauses,
    penalties,
    aiAnalyses,
    project,
    overdueObligations,
    pendingDocuments,
    inLegalReview,
    hasAiAnalysis,
  };
}

/** Constrói o read model de uma carteira inteira. */
export function buildTrustedPortfolio(
  rows: readonly ContractRow[],
  batch: ContractRelationsBatch,
  projects: readonly Project[],
  now: Date = new Date(),
): TrustedContract[] {
  return rows.map((row) => buildTrustedContract(row, batch, projects, now));
}


// ═══════════════════════════════════════════════════════════════════════════
// Ponte a partir de `ContractDetail`
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Converte o retorno de `getContractById` no mesmo `ContractRelationsBatch`
 * que a listagem usa.
 *
 * Existe para que a página de detalhe e a listagem passem pelo MESMO
 * `buildTrustedContract` — era a divergência histórica do módulo: a lista
 * aplicava o merge live e o dossiê não, então as duas telas discordavam sobre
 * o mesmo contrato.
 *
 * `getContractById` dispara 12 consultas paralelas e lança em falha da consulta
 * principal, mas as relações são resilientes; `errors` permite ao chamador
 * marcar seções que falharam.
 */
export function relationsBatchFromDetail(
  detail: ContractDetail,
  errors: Partial<ContractRelationsBatch['sectionErrors']> = {},
): ContractRelationsBatch {
  const id = detail.contract.id;
  const one = <T>(rows: readonly T[]): Map<string, T[]> =>
    rows.length ? new Map([[id, [...rows]]]) : new Map();

  return {
    obligations: one(detail.obligations),
    billingEvents: one(detail.billingEvents),
    documents: one(detail.documents),
    approvals: one(detail.approvals),
    projectLinks: one(detail.projectLinks),
    riskLinks: one(detail.riskLinks),
    aiAnalyses: one(detail.aiAnalyses),
    milestones: one(detail.milestones),
    clauses: one(detail.clauses),
    penalties: one(detail.penalties),
    riskDetails: new Map(),
    // Repassa o que `getContractById` conseguiu resolver. Ausente segue
    // ausente: a ponte não inventa resolução que a leitura não fez.
    parties: detail.parties,
    sectionsWithData: {
      obligations: detail.obligations.length > 0,
      billing: detail.billingEvents.length > 0,
      documents: detail.documents.length > 0,
      approvals: detail.approvals.length > 0,
      projectLinks: detail.projectLinks.length > 0,
      risks: detail.riskLinks.length > 0,
      ai: detail.aiAnalyses.length > 0,
      milestones: detail.milestones.length > 0,
      clauses: detail.clauses.length > 0,
      penalties: detail.penalties.length > 0,
    },
    sectionErrors: {
      obligations: null, billing: null, documents: null,
      approvals: null, projectLinks: null, risks: null, ai: null,
      milestones: null, clauses: null, penalties: null,
      ...errors,
    },
  };
}

/** Contrato confiável a partir do detalhe carregado. */
export function trustedContractFromDetail(
  detail: ContractDetail,
  projects: readonly Project[],
  now: Date = new Date(),
): TrustedContract {
  return buildTrustedContract(detail.contract, relationsBatchFromDetail(detail), projects, now);
}
