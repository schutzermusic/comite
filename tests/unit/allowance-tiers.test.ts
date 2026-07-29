import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEADERSHIP_JOB_TITLES,
  describeTiers,
  normalizeJobTitle,
  resolveAllowanceTier,
} from '@/lib/services/allowance-tiers';
import type { AllowancePolicyTier } from '@/lib/types/allowances';

function tier(overrides: Partial<AllowancePolicyTier> = {}): AllowancePolicyTier {
  return {
    id: 'tier-1',
    organizationId: 'org-1',
    policyId: 'pol-1',
    name: 'Liderança',
    amountCents: 12000,
    matchJobTitles: [...DEFAULT_LEADERSHIP_JOB_TITLES],
    priority: 10,
    createdAt: '2026-07-29T00:00:00Z',
    updatedAt: '2026-07-29T00:00:00Z',
    ...overrides,
  };
}

/** Política padrão do caso real: liderança R$120, demais R$90. */
const policy = { amountCents: 9000, tiers: [tier()] };

describe('resolveAllowanceTier', () => {
  it('aplica R$120 para função de liderança', () => {
    const r = resolveAllowanceTier(policy, 'Encarregado de Turma');
    expect(r.amountCents).toBe(12000);
    expect(r.label).toBe('Liderança');
    expect(r.matchedKeyword).toBe('encarregado');
  });

  it('ignora acento e caixa', () => {
    expect(resolveAllowanceTier(policy, 'LÍDER DE EQUIPE').amountCents).toBe(12000);
    expect(resolveAllowanceTier(policy, 'Supervisor(a) de Campo').amountCents).toBe(12000);
  });

  it('aplica o valor-base para as demais funções', () => {
    const r = resolveAllowanceTier(policy, 'Eletricista');
    expect(r.amountCents).toBe(9000);
    expect(r.tier).toBeNull();
    expect(r.label).toBe('Base');
  });

  it('pessoa sem função cadastrada cai no valor-base, nunca no maior', () => {
    expect(resolveAllowanceTier(policy, null).amountCents).toBe(9000);
    expect(resolveAllowanceTier(policy, '   ').amountCents).toBe(9000);
  });

  it('respeita a prioridade quando mais de uma faixa casa', () => {
    const multi = {
      amountCents: 9000,
      tiers: [
        tier({ id: 'a', name: 'Coordenação', amountCents: 15000, matchJobTitles: ['coordenador'], priority: 5 }),
        tier({ id: 'b', name: 'Liderança', amountCents: 12000, matchJobTitles: ['coordenador', 'encarregado'], priority: 10 }),
      ],
    };
    expect(resolveAllowanceTier(multi, 'Coordenador de Obra').amountCents).toBe(15000);
    expect(resolveAllowanceTier(multi, 'Encarregado').amountCents).toBe(12000);
  });

  it('política sem faixas mantém valor único', () => {
    const r = resolveAllowanceTier({ amountCents: 4500, tiers: [] }, 'Encarregado');
    expect(r.amountCents).toBe(4500);
  });
});

describe('normalizeJobTitle', () => {
  it('remove acentos e pontuação', () => {
    expect(normalizeJobTitle('Líder de Equipe / Campo')).toBe('lider de equipe campo');
  });
});

describe('describeTiers', () => {
  const fmt = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;

  it('lista faixas e o valor das demais funções', () => {
    expect(describeTiers(policy, fmt)).toBe('Liderança R$ 120,00 · Demais R$ 90,00');
  });

  it('sinaliza política sem faixas', () => {
    expect(describeTiers({ amountCents: 9000, tiers: [] }, fmt)).toBe('Valor único');
  });
});
