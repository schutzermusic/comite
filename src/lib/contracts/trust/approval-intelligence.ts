/**
 * Approval Intelligence — onde a alçada está, há quanto tempo, e com quem.
 *
 * Lógica pura, sem JSX. Reusa `computeApprovalSla` (que já existia e já estava
 * correta) em vez de recalcular SLA por conta própria: duas contas para a mesma
 * pergunta acabam divergindo, e a divergência aparece primeiro no PDF.
 *
 * "Gargalo" aqui é uma constatação, não uma previsão: é a etapa aberta há mais
 * tempo, ou a que passou do próprio prazo registrado. Nada é extrapolado de
 * média histórica — a base não tem série para isso.
 */

import { derived, hasOfficialValue, isError, missing, isOfficialOrigin, type Official } from './trusted';
import type { TrustedContract } from './read-model';
import type { ContractApprovalRow } from '../contract-service';

export type ApprovalStepKey = 'juridico' | 'financeiro' | 'comite' | 'diretoria';

export const APPROVAL_STEP_LABEL: Record<string, string> = {
  juridico: 'Jurídico',
  financeiro: 'Financeiro',
  comite: 'Comitê',
  diretoria: 'Diretoria',
};

/** A ordem canônica da rota, conforme o CHECK da migration 034. */
export const APPROVAL_STEP_ORDER: readonly ApprovalStepKey[] = [
  'juridico', 'financeiro', 'comite', 'diretoria',
];

export type ApprovalStepState = {
  readonly step: string;
  readonly label: string;
  readonly status: ContractApprovalRow['status'];
  /** Quem responde pela etapa. `null` quando ninguém foi designado. */
  readonly reviewerUserId: string | null;
  readonly deadline: Date | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  /** Horas decorridas — até a conclusão, ou até agora se ainda aberta. */
  readonly elapsedHours: number | null;
  /** Dias além do prazo registrado. `null` sem prazo ou dentro dele. */
  readonly overdueDays: number | null;
  readonly isOpen: boolean;
};

export type ApprovalIntelligence = {
  /** A etapa em que o contrato está parado agora. */
  readonly currentStage: ApprovalStepState | null;
  readonly steps: readonly ApprovalStepState[];
  /** Média de horas por etapa concluída. Não apurada sem etapa concluída. */
  readonly avgHoursPerStep: Official<number>;
  /** A etapa aberta há mais tempo — o gargalo observado. */
  readonly bottleneck: ApprovalStepState | null;
  readonly overdueSteps: readonly ApprovalStepState[];
  readonly rejectedSteps: readonly ApprovalStepState[];
  /** Progresso da rota, quando ela existe. */
  readonly route: Official<{ approved: number; total: number }>;
  /**
   * Por que não há inteligência, quando é o caso. Rota inexistente é lacuna de
   * controle de alçada, não contrato aprovado.
   */
  readonly unavailable: 'no-route' | 'error' | null;
};

const HOUR = 3_600_000;
const DAY = 86_400_000;

const toDate = (v: string | null): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function buildApprovalIntelligence(
  contract: TrustedContract,
  now: Date = new Date(),
): ApprovalIntelligence {
  const empty = {
    currentStage: null,
    steps: [] as ApprovalStepState[],
    avgHoursPerStep: missing<number>('no-rows'),
    bottleneck: null,
    overdueSteps: [] as ApprovalStepState[],
    rejectedSteps: [] as ApprovalStepState[],
    route: missing<{ approved: number; total: number }>('no-rows'),
  };

  if (isError(contract.approvals)) return { ...empty, unavailable: 'error' };
  if (!hasOfficialValue(contract.approvals) || contract.approvals.value.length === 0) {
    return { ...empty, unavailable: 'no-route' };
  }

  const rows = [...contract.approvals.value].sort((a, b) => {
    const ia = APPROVAL_STEP_ORDER.indexOf(a.step_name as ApprovalStepKey);
    const ib = APPROVAL_STEP_ORDER.indexOf(b.step_name as ApprovalStepKey);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  const steps: ApprovalStepState[] = rows.map((row) => {
    const startedAt = toDate(row.started_at) ?? toDate(row.created_at);
    const completedAt = toDate(row.completed_at);
    const deadline = toDate(row.deadline_date);
    const isOpen = row.status !== 'approved' && row.status !== 'rejected';
    const end = completedAt ?? (isOpen ? now : null);

    const elapsedHours = startedAt && end
      ? Math.max(Math.round((end.getTime() - startedAt.getTime()) / HOUR), 0)
      : null;

    // Só uma etapa AINDA ABERTA pode estar atrasada: uma etapa concluída fora
    // do prazo é histórico, e mantê-la como pendência entope o painel.
    const overdueDays = isOpen && deadline && deadline.getTime() < now.getTime()
      ? Math.floor((now.getTime() - deadline.getTime()) / DAY)
      : null;

    return {
      step: row.step_name,
      label: APPROVAL_STEP_LABEL[row.step_name] ?? row.step_name,
      status: row.status,
      reviewerUserId: row.reviewer_user_id,
      deadline,
      startedAt,
      completedAt,
      elapsedHours,
      overdueDays,
      isOpen,
    };
  });

  const open = steps.filter((s) => s.isOpen);
  const approved = steps.filter((s) => s.status === 'approved');
  const rejected = steps.filter((s) => s.status === 'rejected');

  // A etapa corrente é a primeira aberta na ordem canônica da rota.
  const currentStage = open[0] ?? null;

  const completedHours = approved
    .map((s) => s.elapsedHours)
    .filter((h): h is number => h !== null);
  const avgHoursPerStep: Official<number> = completedHours.length > 0
    ? derived(Math.round(completedHours.reduce((a, b) => a + b, 0) / completedHours.length), {
        rule: 'média de horas das etapas concluídas',
        from: ['contract_approvals'],
        coverage: { counted: completedHours.length, total: steps.length },
      })
    : missing<number>('no-rows');

  // Gargalo: a aberta há mais tempo. Sem etapa aberta, não há gargalo — e
  // eleger a mais demorada do passado apresentaria história como problema.
  const bottleneck = open
    .filter((s) => s.elapsedHours !== null)
    .sort((a, b) => (b.elapsedHours ?? 0) - (a.elapsedHours ?? 0))[0] ?? null;

  return {
    currentStage,
    steps,
    avgHoursPerStep,
    bottleneck,
    overdueSteps: open.filter((s) => s.overdueDays !== null),
    rejectedSteps: rejected,
    route: derived({ approved: approved.length, total: steps.length }, {
      rule: 'etapas aprovadas sobre o total da rota',
      from: ['contract_approvals'],
    }),
    unavailable: null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Carteira
// ═══════════════════════════════════════════════════════════════════════════

export type PortfolioApprovalRow = {
  readonly contractId: string;
  readonly code: string;
  readonly title: string;
  readonly intelligence: ApprovalIntelligence;
};

export type PortfolioApprovals = {
  readonly rows: readonly PortfolioApprovalRow[];
  /** Contratos SEM rota de alçada — lacuna de controle. */
  readonly withoutRoute: readonly { code: string; title: string }[];
  readonly erroredContracts: readonly string[];
  /** Etapas abertas além do prazo, na carteira inteira. */
  readonly overdueCount: number;
  readonly rejectedCount: number;
  /** Média de horas por etapa concluída, na carteira. */
  readonly avgHours: Official<number>;
  readonly coverage: { readonly counted: number; readonly total: number };
};

export function buildPortfolioApprovals(
  contracts: readonly TrustedContract[],
  now: Date = new Date(),
  options: { officialOnly?: boolean } = {},
): PortfolioApprovals {
  const scope = options.officialOnly === false
    ? contracts
    : contracts.filter((c) => isOfficialOrigin(c.dataClass));

  const rows: PortfolioApprovalRow[] = [];
  const withoutRoute: { code: string; title: string }[] = [];
  const errored: string[] = [];
  const allAvg: number[] = [];
  let overdueCount = 0;
  let rejectedCount = 0;
  let counted = 0;

  for (const contract of scope) {
    const intelligence = buildApprovalIntelligence(contract, now);
    if (intelligence.unavailable === 'error') { errored.push(contract.code); continue; }
    counted += 1;
    if (intelligence.unavailable === 'no-route') {
      withoutRoute.push({ code: contract.code, title: contract.title });
      continue;
    }
    rows.push({ contractId: contract.id, code: contract.code, title: contract.title, intelligence });
    overdueCount += intelligence.overdueSteps.length;
    rejectedCount += intelligence.rejectedSteps.length;
    if (hasOfficialValue(intelligence.avgHoursPerStep)) allAvg.push(intelligence.avgHoursPerStep.value);
  }

  // Mais grave primeiro: rejeitada, depois atrasada, depois a mais antiga.
  rows.sort((a, b) =>
    b.intelligence.rejectedSteps.length - a.intelligence.rejectedSteps.length
    || b.intelligence.overdueSteps.length - a.intelligence.overdueSteps.length
    || (b.intelligence.bottleneck?.elapsedHours ?? 0) - (a.intelligence.bottleneck?.elapsedHours ?? 0));

  return {
    rows,
    withoutRoute,
    erroredContracts: errored,
    overdueCount,
    rejectedCount,
    avgHours: allAvg.length > 0
      ? derived(Math.round(allAvg.reduce((a, b) => a + b, 0) / allAvg.length), {
          rule: 'média das médias por contrato com etapa concluída',
          from: ['contract_approvals'],
          coverage: { counted: allAvg.length, total: rows.length },
        })
      : missing<number>('no-rows'),
    coverage: { counted, total: scope.length },
  };
}
