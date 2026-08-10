/**
 * Diárias de Campo — resolução da faixa de valor por função (migration 078).
 *
 * Módulo PURO (sem I/O), no mesmo espírito de allowance-eligibility.ts:
 * dada a função cadastrada da pessoa (people.job_title) e as faixas da
 * política, decide quanto vale a diária daquele dia.
 *
 * Regra: normaliza a função (minúsculo, sem acento, sem pontuação) e
 * procura a faixa de menor `priority` cuja lista de palavras-chave
 * apareça na função. Nenhuma faixa casou → valor-base da política.
 */
import type { AllowancePolicy, AllowancePolicyTier } from '@/lib/types/allowances';

/** Rótulo padrão da faixa de liderança sugerida na criação de política. */
export const LEADERSHIP_TIER_NAME = 'Liderança';

/**
 * Palavras-chave que caracterizam liderança de campo no cadastro de
 * pessoas. Sugestão inicial editável pelo usuário — o que vale em
 * produção é o que está gravado em allowance_policy_tiers.
 */
export const DEFAULT_LEADERSHIP_JOB_TITLES = [
  'lider',
  'encarregado',
  'supervisor',
  'coordenador',
  'gerente',
  'chefe',
  'mestre de obras',
  'capataz',
] as const;

/** minúsculo, sem acento, pontuação → espaço, espaços colapsados. */
export function normalizeJobTitle(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface ResolvedAllowanceTier {
  tier: AllowancePolicyTier | null;
  amountCents: number;
  /** rótulo para exibição/auditoria ("Base" quando nenhuma faixa casou) */
  label: string;
  /** palavra-chave que produziu o match (evidência) */
  matchedKeyword: string | null;
}

/** Faixas em ordem de avaliação: priority asc, depois nome. */
export function sortTiers(tiers: AllowancePolicyTier[]): AllowancePolicyTier[] {
  return [...tiers].sort(
    (a, b) => a.priority - b.priority || a.name.localeCompare(b.name, 'pt-BR'),
  );
}

/**
 * Resolve a faixa aplicável. `jobTitle` vem de people.job_title —
 * pessoa sem função cadastrada cai no valor-base (nunca no maior).
 */
export function resolveAllowanceTier(
  policy: Pick<AllowancePolicy, 'amountCents' | 'tiers'>,
  jobTitle: string | null | undefined,
): ResolvedAllowanceTier {
  const base: ResolvedAllowanceTier = {
    tier: null,
    amountCents: policy.amountCents,
    label: 'Base',
    matchedKeyword: null,
  };

  const normalized = normalizeJobTitle(jobTitle);
  if (!normalized || policy.tiers.length === 0) return base;

  for (const tier of sortTiers(policy.tiers)) {
    const matched = tier.matchJobTitles
      .map((k) => normalizeJobTitle(k))
      .filter(Boolean)
      .find((k) => normalized.includes(k));
    if (matched) {
      return {
        tier,
        amountCents: tier.amountCents,
        label: tier.name,
        matchedKeyword: matched,
      };
    }
  }
  return base;
}

/** Resumo textual das faixas para tabelas/relatórios. */
export function describeTiers(
  policy: Pick<AllowancePolicy, 'amountCents' | 'tiers'>,
  formatCents: (cents: number) => string,
): string {
  if (policy.tiers.length === 0) return 'Valor único';
  return [
    ...sortTiers(policy.tiers).map((t) => `${t.name} ${formatCents(t.amountCents)}`),
    `Demais ${formatCents(policy.amountCents)}`,
  ].join(' · ');
}
