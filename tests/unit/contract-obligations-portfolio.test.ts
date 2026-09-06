import { describe, expect, it } from 'vitest';
import { buildObligationPortfolio } from '@/lib/contracts/obligations/portfolio';
import type { ContractObligationsAsOf, ResolvedObligation } from '@/lib/contracts/obligations/types';

const obligation = (over: Partial<ResolvedObligation> = {}): ResolvedObligation => ({
  definition: {
    id: 'def-1', organizationId: 'org', contractId: 'ct-1', title: 'Relatório mensal',
    requirementText: null, category: null, responsibleSide: 'contracting_organization',
    provenance: { clauseId: 'cl-1', amendmentId: null, documentId: null, page: 12, excerpt: null },
    effectiveFrom: '2026-01-01', effectiveTo: null, predecessorId: null, changeEffect: null,
    activationKind: 'contract_start', activationOffsetDays: null, activationFixedDate: null,
    activationEventText: null, dueKind: 'days_after_activation', dueOffsetDays: 5, dueFixedDate: null,
    calendarBasis: 'calendar_days', recurrenceKind: 'monthly', recurrenceInterval: null,
    recurrenceUntil: null, blocksBilling: true, status: 'active',
    parties: [{ id: 'p1', role: 'obligor', partyId: null, partyText: 'Insight', partyLegalName: null }],
  },
  evidenceRequirements: [],
  instances: [{
    id: 'i1', definitionId: 'def-1', occurrenceKey: '2026-03', periodStart: '2026-03-01',
    periodEnd: '2026-03-31', activationState: 'activated', activatedAt: '2026-03-01',
    dueDate: '2026-03-06', dueConfidence: 'known', dueBasis: 'days_after_activation',
    state: 'OPEN', urgency: 'OVERDUE', satisfiedAt: null, satisfactionBasis: null,
    evidence: [], evidenceComplete: 'UNKNOWN', dependencies: [], exceptions: [],
    escalations: [], financialImpacts: [], blocksBilling: 'TRUE',
  }],
  effective: 'TRUE', blocksBilling: 'TRUE', ...over,
});

const contract = (over: Partial<ContractObligationsAsOf & { contractTitle: string }> = {}) => ({
  contractId: 'ct-1', asOf: '2026-03-08', contractTitle: 'Contrato A',
  obligations: [obligation()],
  billingBlock: { state: 'TRUE' as const, blockingInstanceIds: ['i1'], unknownDefinitionIds: [] },
  counts: { definitions: 1, instances: 1, overdue: 1, due: 0, upcoming: 0, unknown: 0 },
  ...over,
});

describe('carteira de obrigações', () => {
  it('ordena por urgência: atrasada, vence hoje, desconhecida, no prazo', () => {
    const make = (id: string, urgency: 'OVERDUE' | 'DUE' | 'UNKNOWN' | 'UPCOMING', dueDate: string | null) =>
      obligation({
        definition: { ...obligation().definition, id: `def-${id}` },
        instances: [{ ...obligation().instances[0], id, urgency, dueDate,
          dueConfidence: dueDate ? 'known' : 'unknown' }],
      });
    const result = buildObligationPortfolio(
      [contract({ obligations: [make('a', 'UPCOMING', '2026-04-01'), make('b', 'OVERDUE', '2026-02-01'),
        make('c', 'UNKNOWN', null), make('d', 'DUE', '2026-03-08')] })], '2026-03-08');
    expect(result.rows.map((r) => r.instanceId)).toEqual(['b', 'd', 'c', 'a']);
  });

  it('deixa de fora a definição que não vigora, mas mantém a de vigência desconhecida', () => {
    const result = buildObligationPortfolio([contract({
      obligations: [
        obligation({ effective: 'FALSE' }),
        obligation({ effective: 'UNKNOWN',
          definition: { ...obligation().definition, id: 'def-2' },
          instances: [{ ...obligation().instances[0], id: 'i2', blocksBilling: 'UNKNOWN' }] }),
      ],
    })], '2026-03-08');
    expect(result.rows.map((r) => r.instanceId)).toEqual(['i2']);
  });

  it('separa contratos bloqueados dos indeterminados', () => {
    const result = buildObligationPortfolio([
      contract({ contractId: 'a', contractTitle: 'Bloqueado' }),
      contract({ contractId: 'b', contractTitle: 'Indeterminado',
        billingBlock: { state: 'UNKNOWN', blockingInstanceIds: [], unknownDefinitionIds: ['def-1'] } }),
      contract({ contractId: 'c', contractTitle: 'Livre',
        billingBlock: { state: 'FALSE', blockingInstanceIds: [], unknownDefinitionIds: [] } }),
    ], '2026-03-08');
    expect(result.billingBlockedContracts).toEqual(['Bloqueado']);
    expect(result.billingUnknownContracts).toEqual(['Indeterminado']);
  });

  it('contrato sem obrigação é lacuna de controle, não saúde', () => {
    const result = buildObligationPortfolio([contract({
      contractTitle: 'Sem obrigação', obligations: [],
      billingBlock: { state: 'FALSE', blockingInstanceIds: [], unknownDefinitionIds: [] },
    })], '2026-03-08');
    expect(result.contractsWithoutObligations).toEqual(['Sem obrigação']);
    expect(result.rows).toHaveLength(0);
    // ...e não inventa um contrato "saudável".
    expect(result.billingBlockedContracts).toHaveLength(0);
  });

  it('não fabrica contagem quando a carteira está vazia', () => {
    const result = buildObligationPortfolio([], '2026-03-08');
    expect(result.counts).toEqual({ OVERDUE: 0, DUE: 0, UPCOMING: 0, UNKNOWN: 0, NOT_APPLICABLE: 0 });
    expect(result.asOf).toBe('2026-03-08');
  });

  it('leva a proveniência e o motivo do prazo desconhecido para a linha', () => {
    const result = buildObligationPortfolio([contract({
      obligations: [obligation({
        instances: [{ ...obligation().instances[0], urgency: 'UNKNOWN', dueDate: null,
          dueConfidence: 'unknown', dueBasis: 'regra em dias úteis sem calendário oficial' }],
      })],
    })], '2026-03-08');
    expect(result.rows[0].dueBasis).toContain('dias úteis');
    expect(result.rows[0].provenance).toEqual({ clauseId: 'cl-1', documentId: null, page: 12 });
    expect(result.rows[0].obligor).toBe('Insight');
  });
});
