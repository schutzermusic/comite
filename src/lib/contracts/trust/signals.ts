/**
 * Sinais derivados do contrato confiável.
 *
 * Tudo aqui é DETERMINÍSTICO e sai de `TrustedContract` — nenhuma entrada vem
 * do enricher. Cada sinal carrega a regra que o produziu, de modo que a
 * pergunta "de onde saiu esse estado?" tenha resposta sem leitura de código.
 *
 * Sem React, sem I/O.
 */

import {
  derived, missing, hasOfficialValue, isError,
  type Official, type LiveSource,
} from './trusted';
import type { TrustedContract } from './read-model';
import type { ContractApprovalRow, ContractDocumentRow } from '@/lib/contracts/contract-service';

// ═══════════════════════════════════════════════════════════════════════════
// Renovação
// ═══════════════════════════════════════════════════════════════════════════

export type RenewalState = 'expired' | 'critical' | 'attention' | 'planned' | 'stable';

export const RENEWAL_LABEL: Record<RenewalState, string> = {
  expired: 'Vencido',
  critical: 'Crítico (≤30d)',
  attention: 'Atenção (≤90d)',
  planned: 'Planejado (≤180d)',
  stable: 'Estável',
};

/**
 * Estado de renovação a partir da data de término REAL.
 *
 * O enricher devolvia `'attention'` quando não havia data — um estado
 * operacional inventado para um contrato sobre o qual nada se sabe. Aqui, sem
 * data de término não há estado de renovação: é `missing`, e a interface diz
 * que a vigência não está cadastrada.
 */
export function renewalState(contract: TrustedContract): Official<RenewalState> {
  const days = contract.daysUntilExpiration;
  if (isError(days)) return days as Official<RenewalState>;
  if (!hasOfficialValue(days)) {
    return missing<RenewalState>('null-in-source', 'contrato sem data de término cadastrada');
  }
  const d = days.value;
  const state: RenewalState =
    d < 0 ? 'expired' : d <= 30 ? 'critical' : d <= 90 ? 'attention' : d <= 180 ? 'planned' : 'stable';
  return derived(state, {
    rule: 'faixa de dias até o término da vigência',
    from: ['contracts'],
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Situação jurídica e financeira — a partir de aprovações REAIS
// ═══════════════════════════════════════════════════════════════════════════

export type ApprovalOutcome = 'approved' | 'rejected' | 'in_review' | 'not_started';

export const APPROVAL_OUTCOME_LABEL: Record<ApprovalOutcome, string> = {
  approved: 'Aprovado',
  rejected: 'Rejeitado',
  in_review: 'Em análise',
  not_started: 'Não iniciado',
};

function outcomeOf(step: ContractApprovalRow | undefined): ApprovalOutcome {
  if (!step) return 'not_started';
  if (step.status === 'approved') return 'approved';
  if (step.status === 'rejected') return 'rejected';
  return 'in_review';
}

/**
 * Situação de uma etapa de aprovação.
 *
 * `legalStatus`/`financialStatus` do enricher saíam de `seed % 5` e do valor do
 * contrato. Aqui saem da linha de `contract_approvals` — e quando não há linha,
 * o estado é `not_started` APURADO (a consulta rodou e a etapa não existe),
 * não um palpite.
 */
export function approvalStepOutcome(
  contract: TrustedContract,
  step: ContractApprovalRow['step_name'],
): Official<ApprovalOutcome> {
  const approvals = contract.approvals;
  if (isError(approvals)) return approvals as Official<ApprovalOutcome>;
  if (!hasOfficialValue(approvals)) return missing<ApprovalOutcome>('no-rows');
  return derived(outcomeOf(approvals.value.find((a) => a.step_name === step)), {
    rule: `situação da etapa ${step} em contract_approvals`,
    from: ['contract_approvals'],
  });
}

/** Rota de aprovação real, na ordem canônica das etapas existentes. */
const STEP_ORDER = ['juridico', 'financeiro', 'comite', 'diretoria'] as const;
const STEP_LABEL: Record<string, string> = {
  juridico: 'Jurídico', financeiro: 'Financeiro', comite: 'Comitê', diretoria: 'Diretoria',
};

export function approvalRoute(contract: TrustedContract): Official<string> {
  const approvals = contract.approvals;
  if (isError(approvals)) return approvals as Official<string>;
  if (!hasOfficialValue(approvals)) return missing<string>('no-rows');
  if (approvals.value.length === 0) {
    return missing<string>('no-rows', 'nenhuma etapa de aprovação registrada');
  }
  const route = [...approvals.value]
    .sort((a, b) => STEP_ORDER.indexOf(a.step_name as never) - STEP_ORDER.indexOf(b.step_name as never))
    .map((s) => STEP_LABEL[s.step_name] ?? s.step_name)
    .join(' + ');
  return derived(route, { rule: 'etapas registradas em ordem canônica', from: ['contract_approvals'] });
}

// ═══════════════════════════════════════════════════════════════════════════
// SLA de aprovação — reusa a função já existente e testada do serviço
// ═══════════════════════════════════════════════════════════════════════════

export type ApprovalSlaSummary = {
  readonly avgHours: number | null;
  readonly overdueSteps: number;
  readonly rejectedSteps: number;
  readonly blocked: boolean;
};

/**
 * Resumo de SLA a partir das aprovações reais.
 *
 * `computeApprovalSla` (contract-service.ts) já faz este cálculo e é usada pelo
 * drawer desde a Fase 6 — não há motivo para uma segunda implementação. O que
 * muda aqui é o envelope: sem aprovação registrada o resultado é `missing`, em
 * vez do SLA heurístico que a band exibia.
 */
export function approvalSla(
  contract: TrustedContract,
  compute: (rows: ContractApprovalRow[]) => { avgHours: number | null; overdueSteps: number; rejectedSteps: number; blocked: boolean },
): Official<ApprovalSlaSummary> {
  const approvals = contract.approvals;
  if (isError(approvals)) return approvals as Official<ApprovalSlaSummary>;
  if (!hasOfficialValue(approvals)) return missing<ApprovalSlaSummary>('no-rows');
  if (approvals.value.length === 0) {
    return missing<ApprovalSlaSummary>('no-rows', 'nenhuma etapa de aprovação registrada');
  }
  const sla = compute([...approvals.value]);
  return derived(
    { avgHours: sla.avgHours, overdueSteps: sla.overdueSteps, rejectedSteps: sla.rejectedSteps, blocked: sla.blocked },
    { rule: 'duração por etapa em contract_approvals', from: ['contract_approvals'] },
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Documentos
// ═══════════════════════════════════════════════════════════════════════════

const BLOCKING_DOC_STATUSES = new Set(['missing', 'expired', 'rejected']);

/**
 * Documentos faltantes reais.
 *
 * O enricher inventava por `seed % 3` e `seed % 5` ("Comprovante fiscal",
 * "Matriz de obrigações"). Aqui só entram títulos que existem em
 * `contract_documents` com status bloqueante.
 */
export function missingDocuments(contract: TrustedContract): Official<readonly string[]> {
  const docs = contract.documents;
  if (isError(docs)) return docs as Official<readonly string[]>;
  if (!hasOfficialValue(docs)) return missing<readonly string[]>('no-rows');
  return derived(
    docs.value.filter((d: ContractDocumentRow) => BLOCKING_DOC_STATUSES.has(d.status)).map((d) => d.title),
    { rule: 'documentos com status missing, expired ou rejected', from: ['contract_documents'] },
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Obrigações
// ═══════════════════════════════════════════════════════════════════════════

export type ObligationBreakdown = {
  readonly open: number;
  readonly dueSoon: number;
  readonly overdue: number;
  readonly done: number;
  readonly total: number;
};

export function obligationBreakdown(contract: TrustedContract): Official<ObligationBreakdown> {
  const obligations = contract.obligations;
  if (isError(obligations)) return obligations as Official<ObligationBreakdown>;
  if (!hasOfficialValue(obligations)) return missing<ObligationBreakdown>('no-rows');
  const rows = obligations.value;
  return derived(
    {
      open: rows.filter((o) => o.status === 'open').length,
      dueSoon: rows.filter((o) => o.status === 'due_soon').length,
      overdue: rows.filter((o) => o.status === 'overdue').length,
      done: rows.filter((o) => o.status === 'done').length,
      total: rows.length,
    },
    { rule: 'contagem por status em contract_obligations', from: ['contract_obligations'] },
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Contract Health — INSUMOS, sem score
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Um insumo de saúde do contrato: um fato apurado que um futuro modelo de
 * pontuação poderia usar.
 */
export type HealthDriver = {
  readonly dimension: 'financeiro' | 'obrigacoes' | 'documentos' | 'aprovacoes' | 'vinculos' | 'vigencia';
  readonly label: string;
  /** `true` quando o fato pesa contra a saúde do contrato. */
  readonly adverse: boolean;
  readonly detail: string;
  readonly from: readonly LiveSource[];
};

export type ContractHealth = {
  /**
   * Deliberadamente AUSENTE.
   *
   * Não existe modelo de pontuação aprovado para contratos neste repositório.
   * `computeHealthScore` (src/lib/utils/project-utils.ts) é o único precedente
   * determinístico e é de PROJETOS: suas entradas — EAC/BAC, tarefas, riscos de
   * projeto — não têm equivalente contratual, e seus pesos foram calibrados
   * para outro domínio.
   *
   * Inventar pesos aqui só para preencher um número de 0 a 100 na interface
   * produziria exatamente o que P0.3 acabou de eliminar: uma medição que
   * ninguém mediu, com a agravante de virar base de decisão executiva. Os pesos
   * são chamada de negócio, não de engenharia.
   *
   * Até lá, a interface mostra os DRIVERS e a COBERTURA — que são apurados e
   * já respondem "o que está pesando contra este contrato?".
   */
  readonly score: Official<number>;
  readonly drivers: readonly HealthDriver[];
  /** Quantas das 6 dimensões puderam ser avaliadas. */
  readonly coverage: { readonly assessed: number; readonly total: number };
};

const HEALTH_DIMENSIONS = 6;

/**
 * Insumos de saúde a partir do contrato confiável.
 *
 * Devolve fatos, não julgamento. Cada driver é rastreável até a tabela que o
 * originou; dimensões sem fonte simplesmente não produzem driver e reduzem a
 * cobertura — em vez de contarem como "tudo bem".
 */
export function contractHealth(contract: TrustedContract): ContractHealth {
  const drivers: HealthDriver[] = [];
  let assessed = 0;

  // ── Financeiro ──
  if (hasOfficialValue(contract.billedValue) && hasOfficialValue(contract.totalValue)) {
    assessed += 1;
    const pct = contract.totalValue.value > 0
      ? Math.round((contract.billedValue.value / contract.totalValue.value) * 100)
      : null;
    drivers.push({
      dimension: 'financeiro',
      label: 'Execução financeira',
      adverse: pct !== null && pct < 20,
      detail: pct !== null ? `${pct}% do valor contratado faturado` : 'contrato sem valor para comparar',
      from: ['contracts', 'contract_billing_events'],
    });
  }

  // ── Obrigações ──
  const obligations = obligationBreakdown(contract);
  if (hasOfficialValue(obligations)) {
    assessed += 1;
    const b = obligations.value;
    drivers.push({
      dimension: 'obrigacoes',
      label: 'Obrigações contratuais',
      adverse: b.overdue > 0,
      detail: b.total === 0
        ? 'nenhuma obrigação mapeada'
        : `${b.overdue} atrasada(s), ${b.dueSoon} a vencer, ${b.open} aberta(s), ${b.done} concluída(s)`,
      from: ['contract_obligations'],
    });
  }

  // ── Documentos ──
  const docs = missingDocuments(contract);
  if (hasOfficialValue(docs)) {
    assessed += 1;
    drivers.push({
      dimension: 'documentos',
      label: 'Documentação',
      adverse: docs.value.length > 0,
      detail: docs.value.length === 0
        ? 'sem documento faltante, vencido ou rejeitado'
        : `${docs.value.length} documento(s) pendente(s): ${docs.value.slice(0, 3).join(', ')}`,
      from: ['contract_documents'],
    });
  }

  // ── Aprovações ──
  const route = approvalRoute(contract);
  if (hasOfficialValue(contract.approvals)) {
    assessed += 1;
    const rows = contract.approvals.value;
    const rejected = rows.filter((a) => a.status === 'rejected').length;
    const pending = rows.filter((a) => a.status !== 'approved').length;
    drivers.push({
      dimension: 'aprovacoes',
      label: 'Fluxo de aprovação',
      adverse: rejected > 0 || pending > 0,
      detail: rows.length === 0
        ? 'nenhuma etapa registrada'
        : `${hasOfficialValue(route) ? route.value : '—'} · ${pending} etapa(s) não aprovada(s)${rejected ? `, ${rejected} rejeitada(s)` : ''}`,
      from: ['contract_approvals'],
    });
  }

  // ── Vínculos ──
  if (!isError(contract.project) && !isError(contract.projectLinks)) {
    assessed += 1;
    const linked = hasOfficialValue(contract.project);
    drivers.push({
      dimension: 'vinculos',
      label: 'Vínculo de projeto',
      adverse: !linked,
      detail: linked
        ? `vinculado a ${contract.project.value.codigo}`
        : 'contrato sem projeto vinculado — fora da visão consolidada de portfólio',
      from: ['contracts', 'contract_project_links'],
    });
  }

  // ── Vigência ──
  const renewal = renewalState(contract);
  if (hasOfficialValue(renewal)) {
    assessed += 1;
    drivers.push({
      dimension: 'vigencia',
      label: 'Janela de renovação',
      adverse: renewal.value === 'expired' || renewal.value === 'critical',
      detail: RENEWAL_LABEL[renewal.value],
      from: ['contracts'],
    });
  }

  return {
    score: missing<number>(
      'not-integrated',
      'não há modelo de pontuação aprovado para contratos — pendente de decisão de negócio',
    ),
    drivers,
    coverage: { assessed, total: HEALTH_DIMENSIONS },
  };
}

/** Somente os drivers adversos, para superfícies de atenção. */
export function adverseDrivers(health: ContractHealth): readonly HealthDriver[] {
  return health.drivers.filter((d) => d.adverse);
}
