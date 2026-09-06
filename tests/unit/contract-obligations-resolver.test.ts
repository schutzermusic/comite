import { describe, expect, it } from 'vitest';
import {
  definitionEffectiveAsOf, escalationApplicable, evidenceCompleteness,
  exceptionEffectiveAsOf, instanceBlocksBilling, resolveContractObligationsAsOf, urgencyOf,
} from '@/lib/contracts/obligations/resolve';
import type {
  ObligationDefinition, ObligationEvidence, ObligationEvidenceRequirement,
  ObligationException, ObligationInstanceView,
} from '@/lib/contracts/obligations/types';

const definition = (over: Partial<ObligationDefinition> = {}): ObligationDefinition => ({
  id: 'def-1', organizationId: 'org-1', contractId: 'ct-1',
  title: 'Relatório mensal de segurança', requirementText: null, category: null,
  responsibleSide: 'contracting_organization',
  provenance: { clauseId: 'cl-1', amendmentId: null, documentId: null, page: 12, excerpt: null },
  effectiveFrom: '2026-01-01', effectiveTo: null, predecessorId: null, changeEffect: null,
  activationKind: 'contract_start', activationOffsetDays: null, activationFixedDate: null,
  activationEventText: null, dueKind: 'days_after_activation', dueOffsetDays: 5,
  dueFixedDate: null, calendarBasis: 'calendar_days', recurrenceKind: 'monthly',
  recurrenceInterval: null, recurrenceUntil: null, blocksBilling: true, status: 'active',
  parties: [], ...over,
});

type RawInstance = Parameters<typeof resolveContractObligationsAsOf>[0]['obligations'][number]['instances'][number];
const instance = (over: Partial<RawInstance> = {}): RawInstance => ({
  id: 'inst-1', definitionId: 'def-1', occurrenceKey: '2026-03',
  periodStart: '2026-03-01', periodEnd: '2026-03-31',
  activationState: 'activated', activatedAt: '2026-03-01',
  dueDate: '2026-03-06', dueConfidence: 'known', dueBasis: 'days_after_activation',
  state: 'OPEN', satisfiedAt: null, satisfactionBasis: null,
  evidence: [], dependencies: [], exceptions: [], escalations: [], financialImpacts: [], ...over,
});

const exception = (over: Partial<Omit<ObligationException, 'effective'>> = {}): Omit<ObligationException, 'effective'> => ({
  id: 'exc-1', kind: 'waiver', reason: 'Acordo comercial', scope: 'instance',
  effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31',
  authorityReference: 'Ata 12/2026', sourceDocumentId: null, sourceAmendmentId: null,
  approvalState: 'not_required', ...over,
});

// ═══════════════════════════════ VIGÊNCIA ═══════════════════════════════
describe('vigência da definição', () => {
  it('antes da data de vigência não vigora', () => {
    expect(definitionEffectiveAsOf(definition({ effectiveFrom: '2026-06-01' }), '2026-05-31')).toBe('FALSE');
  });
  it('NA data de vigência já vigora', () => {
    expect(definitionEffectiveAsOf(definition({ effectiveFrom: '2026-06-01' }), '2026-06-01')).toBe('TRUE');
  });
  it('depois do fim da vigência não vigora', () => {
    expect(definitionEffectiveAsOf(definition({ effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' }), '2026-07-01')).toBe('FALSE');
  });
  it('data de vigência DESCONHECIDA não vira "desde sempre"', () => {
    expect(definitionEffectiveAsOf(definition({ effectiveFrom: null }), '2026-06-01')).toBe('UNKNOWN');
  });
  it('removida com data conhecida deixa de vigorar; sem data fica desconhecida', () => {
    expect(definitionEffectiveAsOf(definition({ status: 'removed', effectiveFrom: '2026-10-01' }), '2026-11-01')).toBe('FALSE');
    expect(definitionEffectiveAsOf(definition({ status: 'removed', effectiveFrom: null }), '2026-11-01')).toBe('UNKNOWN');
  });
  it('após alteração, a sucessora vigora e a anterior não', () => {
    const anterior = definition({ id: 'v1', effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30', status: 'superseded' });
    const nova = definition({ id: 'v2', effectiveFrom: '2026-07-01', predecessorId: 'v1', changeEffect: 'altered' });
    expect(definitionEffectiveAsOf(anterior, '2026-08-01')).toBe('FALSE');
    expect(definitionEffectiveAsOf(nova, '2026-08-01')).toBe('TRUE');
    // ...e antes da alteração, o contrário.
    expect(definitionEffectiveAsOf(anterior, '2026-03-01')).toBe('TRUE');
    expect(definitionEffectiveAsOf(nova, '2026-03-01')).toBe('FALSE');
  });
});

// ═══════════════════════════════ URGÊNCIA ═══════════════════════════════
describe('urgência derivada', () => {
  it('antes do vencimento, no vencimento e depois', () => {
    expect(urgencyOf(instance({ dueDate: '2026-03-10' }), '2026-03-01')).toBe('UPCOMING');
    expect(urgencyOf(instance({ dueDate: '2026-03-10' }), '2026-03-10')).toBe('DUE');
    expect(urgencyOf(instance({ dueDate: '2026-03-10' }), '2026-03-11')).toBe('OVERDUE');
  });
  it('prazo desconhecido é DESCONHECIDO, nunca "no prazo"', () => {
    expect(urgencyOf(instance({ dueDate: null, dueConfidence: 'unknown' }), '2026-03-11')).toBe('UNKNOWN');
  });
  it('vencimento passado NÃO marca como cumprida', () => {
    const late = instance({ dueDate: '2026-01-01' });
    expect(urgencyOf(late, '2026-06-01')).toBe('OVERDUE');
    expect(late.state).toBe('OPEN');
  });
  it('cumprida com atraso sai da fila de atrasadas', () => {
    expect(urgencyOf(instance({ state: 'SATISFIED', dueDate: '2026-01-01' }), '2026-06-01')).toBe('NOT_APPLICABLE');
  });
  it('não ativada não é "não aplicável" — é desconhecida', () => {
    expect(urgencyOf(instance({ state: 'NOT_ACTIVATED', activationState: 'unknown' }), '2026-06-01')).toBe('UNKNOWN');
  });
  it('dispensada e cancelada não pedem mais nada', () => {
    expect(urgencyOf(instance({ state: 'WAIVED' }), '2026-06-01')).toBe('NOT_APPLICABLE');
    expect(urgencyOf(instance({ state: 'CANCELLED' }), '2026-06-01')).toBe('NOT_APPLICABLE');
  });
});

// ═══════════════════════════════ DISPENSA ═══════════════════════════════
describe('dispensa e exceção', () => {
  it('vale dentro da vigência, com autoridade registrada', () => {
    expect(exceptionEffectiveAsOf(exception(), '2026-06-01')).toBe(true);
  });
  it('sem autoridade provada não produz efeito', () => {
    expect(exceptionEffectiveAsOf(exception({ authorityReference: '  ' }), '2026-06-01')).toBe(false);
  });
  it('documento ou aditivo de origem também provam autoridade', () => {
    expect(exceptionEffectiveAsOf(exception({ authorityReference: null, sourceDocumentId: 'doc-1' }), '2026-06-01')).toBe(true);
    expect(exceptionEffectiveAsOf(exception({ authorityReference: null, sourceAmendmentId: 'am-1' }), '2026-06-01')).toBe(true);
  });
  it('VENCIDA deixa de suprimir', () => {
    expect(exceptionEffectiveAsOf(exception({ effectiveTo: '2026-05-31' }), '2026-06-01')).toBe(false);
  });
  it('ainda não iniciada não suprime', () => {
    expect(exceptionEffectiveAsOf(exception({ effectiveFrom: '2026-07-01' }), '2026-06-01')).toBe(false);
  });
  it('aprovação pendente ou recusada não dispensa', () => {
    expect(exceptionEffectiveAsOf(exception({ approvalState: 'pending' }), '2026-06-01')).toBe(false);
    expect(exceptionEffectiveAsOf(exception({ approvalState: 'rejected' }), '2026-06-01')).toBe(false);
    expect(exceptionEffectiveAsOf(exception({ approvalState: 'approved' }), '2026-06-01')).toBe(true);
  });
});

// ═══════════════════════════════ EVIDÊNCIA ═══════════════════════════════
describe('completude de evidência', () => {
  const requirement = (over: Partial<ObligationEvidenceRequirement> = {}): ObligationEvidenceRequirement => ({
    id: 'req-1', requirementText: 'Boletim assinado', evidenceType: 'document',
    requiredCount: null, mandatory: true, requiresFormalAcceptance: false, ...over,
  });
  const provided = (over: Partial<ObligationEvidence> = {}): ObligationEvidence => ({
    id: 'ev-1', requirementId: 'req-1', documentId: 'doc-1', referenceText: null,
    acceptanceState: 'not_required', providedAt: '2026-03-02T00:00:00Z', ...over,
  });

  it('sem exigência apurada, a completude é desconhecida — não "completa"', () => {
    expect(evidenceCompleteness([], [])).toBe('UNKNOWN');
  });
  it('exigência obrigatória sem evidência é FALSO', () => {
    expect(evidenceCompleteness([requirement()], [])).toBe('FALSE');
  });
  it('evidência presente onde a presença basta é COMPLETO', () => {
    expect(evidenceCompleteness([requirement()], [provided()])).toBe('TRUE');
  });
  it('obrigatoriedade não apurada mantém a resposta em DESCONHECIDO', () => {
    expect(evidenceCompleteness([requirement({ mandatory: null })], [])).toBe('UNKNOWN');
  });
  it('contagem insuficiente não completa', () => {
    expect(evidenceCompleteness([requirement({ requiredCount: 3 })], [provided(), provided({ id: 'ev-2' })])).toBe('FALSE');
  });
  it('PRESENÇA NÃO É APROVAÇÃO quando o contrato exige aceite formal', () => {
    const req = requirement({ requiresFormalAcceptance: true });
    expect(evidenceCompleteness([req], [provided({ acceptanceState: 'pending' })])).toBe('UNKNOWN');
    expect(evidenceCompleteness([req], [provided({ acceptanceState: 'accepted' })])).toBe('TRUE');
    expect(evidenceCompleteness([req], [provided({ acceptanceState: 'rejected' })])).toBe('FALSE');
  });
});

// ═══════════════════════════ ESCALONAMENTO ═══════════════════════════
describe('escalonamento', () => {
  const rule = { id: 'esc-1', triggerKind: 'days_before_due' as const, offsetDays: 5,
    severity: 'medium' as const, targetRole: null, targetSide: null };

  it('N dias antes do vencimento', () => {
    expect(escalationApplicable(rule, instance({ dueDate: '2026-03-10' }), '2026-03-06')).toBe(true);
    expect(escalationApplicable(rule, instance({ dueDate: '2026-03-10' }), '2026-03-04')).toBe(false);
  });
  it('no dia do vencimento', () => {
    const onDue = { ...rule, triggerKind: 'on_due_date' as const, offsetDays: null };
    expect(escalationApplicable(onDue, instance({ dueDate: '2026-03-10' }), '2026-03-10')).toBe(true);
    expect(escalationApplicable(onDue, instance({ dueDate: '2026-03-10' }), '2026-03-11')).toBe(false);
  });
  it('N dias após o vencimento', () => {
    const after = { ...rule, triggerKind: 'days_after_due' as const, offsetDays: 3 };
    expect(escalationApplicable(after, instance({ dueDate: '2026-03-10' }), '2026-03-13')).toBe(true);
    expect(escalationApplicable(after, instance({ dueDate: '2026-03-10' }), '2026-03-12')).toBe(false);
  });
  it('sem prazo conhecido não há escalonamento por prazo', () => {
    expect(escalationApplicable(rule, instance({ dueDate: null, dueConfidence: 'unknown' }), '2026-03-06')).toBe(false);
  });
  it('obrigação encerrada não escala', () => {
    expect(escalationApplicable(rule, instance({ state: 'SATISFIED', dueDate: '2026-03-10' }), '2026-03-06')).toBe(false);
  });
});

// ═══════════════════════ BLOQUEIO DE FATURAMENTO ═══════════════════════
describe('blocks_billing', () => {
  it('definição não-bloqueadora → FALSE', () => {
    expect(instanceBlocksBilling(false, instance(), [], '2026-03-01')).toBe('FALSE');
  });
  it('definição NÃO APURADA → UNKNOWN, nunca FALSE', () => {
    expect(instanceBlocksBilling(null, instance(), [], '2026-03-01')).toBe('UNKNOWN');
  });
  it('pendente e aplicável → TRUE', () => {
    expect(instanceBlocksBilling(true, instance(), [], '2026-03-01')).toBe('TRUE');
  });
  it('cumprida deixa de bloquear', () => {
    expect(instanceBlocksBilling(true, instance({ state: 'SATISFIED' }), [], '2026-03-01')).toBe('FALSE');
  });
  it('dispensa EFETIVA remove o bloqueio; dispensa vencida não', () => {
    const live = { ...exception(), effective: true };
    const expired = { ...exception({ effectiveTo: '2026-01-31' }), effective: false };
    expect(instanceBlocksBilling(true, instance(), [live], '2026-03-01')).toBe('FALSE');
    expect(instanceBlocksBilling(true, instance(), [expired], '2026-03-01')).toBe('TRUE');
  });
  it('aplicabilidade indeterminada → UNKNOWN, nunca FALSE', () => {
    expect(instanceBlocksBilling(true, instance({ state: 'NOT_ACTIVATED', activationState: 'unknown' }), [], '2026-03-01')).toBe('UNKNOWN');
  });
});

// ═══════════════════════════ RESOLVEDOR INTEIRO ═══════════════════════════
describe('resolveContractObligationsAsOf', () => {
  const resolve = (obligations: Parameters<typeof resolveContractObligationsAsOf>[0]['obligations'], asOf = '2026-03-08') =>
    resolveContractObligationsAsOf({ contractId: 'ct-1', asOf, obligations });

  it('uma obrigação pontual, pendente e vencida, bloqueia o contrato', () => {
    const result = resolve([{
      definition: definition({ recurrenceKind: 'one_time' }),
      evidenceRequirements: [],
      instances: [instance({ dueDate: '2026-03-01' })],
    }]);
    expect(result.obligations[0].instances[0].urgency).toBe('OVERDUE');
    expect(result.billingBlock.state).toBe('TRUE');
    expect(result.billingBlock.blockingInstanceIds).toEqual(['inst-1']);
    expect(result.counts).toMatchObject({ definitions: 1, instances: 1, overdue: 1 });
  });

  it('uma série recorrente resolve cada ocorrência por si', () => {
    const result = resolve([{
      definition: definition(),
      evidenceRequirements: [],
      instances: [
        instance({ id: 'i1', occurrenceKey: '2026-01', dueDate: '2026-01-06' }),
        instance({ id: 'i2', occurrenceKey: '2026-02', dueDate: '2026-02-06', state: 'SATISFIED', satisfiedAt: '2026-02-05T00:00:00Z', satisfactionBasis: 'explicit_completion' }),
        instance({ id: 'i3', occurrenceKey: '2026-03', dueDate: '2026-03-06' }),
        instance({ id: 'i4', occurrenceKey: '2026-04', dueDate: '2026-04-06' }),
      ],
    }]);
    const [i1, i2, i3, i4] = result.obligations[0].instances;
    expect([i1.urgency, i2.urgency, i3.urgency, i4.urgency]).toEqual(['OVERDUE', 'NOT_APPLICABLE', 'OVERDUE', 'UPCOMING']);
    // Cumprir fevereiro não apaga a exigência de março.
    expect(i3.blocksBilling).toBe('TRUE');
    expect(result.billingBlock.blockingInstanceIds).toEqual(['i1', 'i3', 'i4']);
  });

  it('definição ainda não vigente não bloqueia nada', () => {
    const result = resolve([{
      definition: definition({ effectiveFrom: '2026-09-01' }),
      evidenceRequirements: [],
      instances: [instance({ dueDate: '2026-03-01' })],
    }]);
    expect(result.obligations[0].effective).toBe('FALSE');
    expect(result.billingBlock.state).toBe('FALSE');
  });

  it('vigência desconhecida contamina o bloqueio com UNKNOWN', () => {
    const result = resolve([{
      definition: definition({ effectiveFrom: null }),
      evidenceRequirements: [],
      instances: [instance()],
    }]);
    expect(result.obligations[0].effective).toBe('UNKNOWN');
    expect(result.billingBlock.state).toBe('UNKNOWN');
    expect(result.billingBlock.unknownDefinitionIds).toEqual(['def-1']);
  });

  it('dependência não resolvida deixa o bloqueio em UNKNOWN em vez de FALSE', () => {
    const result = resolve([{
      definition: definition(),
      evidenceRequirements: [],
      instances: [instance({
        state: 'SATISFIED', satisfiedAt: '2026-03-05T00:00:00Z', satisfactionBasis: 'explicit_completion',
        dependencies: [{ dependsOnDefinitionId: 'def-9', dependsOnTitle: 'Medição', mappingMode: 'unresolved', satisfied: 'UNKNOWN' }],
      })],
    }]);
    expect(result.billingBlock.state).toBe('UNKNOWN');
  });

  it('dependência satisfeita não contamina', () => {
    const result = resolve([{
      definition: definition(),
      evidenceRequirements: [],
      instances: [instance({
        state: 'SATISFIED', satisfiedAt: '2026-03-05T00:00:00Z', satisfactionBasis: 'explicit_completion',
        dependencies: [{ dependsOnDefinitionId: 'def-9', dependsOnTitle: 'Medição', mappingMode: 'same_occurrence_key', satisfied: 'TRUE' }],
      })],
    }]);
    expect(result.billingBlock.state).toBe('FALSE');
  });

  it('conta prazos desconhecidos separadamente dos prazos no futuro', () => {
    const result = resolve([{
      definition: definition({ calendarBasis: 'business_days' }),
      evidenceRequirements: [],
      instances: [
        instance({ id: 'x1', dueDate: null, dueConfidence: 'unknown', dueBasis: 'regra em dias úteis sem calendário oficial' }),
        instance({ id: 'x2', dueDate: '2026-04-01' }),
      ],
    }]);
    expect(result.counts.unknown).toBe(1);
    expect(result.counts.upcoming).toBe(1);
    expect(result.obligations[0].instances[0].dueBasis).toContain('dias úteis');
  });

  it('evidência exigindo aceite formal mantém a completude fora de TRUE', () => {
    const result = resolve([{
      definition: definition(),
      evidenceRequirements: [{ id: 'req-1', requirementText: 'Aceite', evidenceType: 'document',
        requiredCount: null, mandatory: true, requiresFormalAcceptance: true }],
      instances: [instance({ evidence: [{ id: 'ev-1', requirementId: 'req-1', documentId: 'doc-1',
        referenceText: null, acceptanceState: 'pending', providedAt: '2026-03-02T00:00:00Z' }] })],
    }]);
    expect(result.obligations[0].instances[0].evidenceComplete).toBe('UNKNOWN');
    // ...e a obrigação continua bloqueando, porque nada foi aceito.
    expect(result.billingBlock.state).toBe('TRUE');
  });

  it('um contrato sem obrigação nenhuma não bloqueia e não inventa contagem', () => {
    const result = resolve([]);
    expect(result.billingBlock.state).toBe('FALSE');
    expect(result.counts).toEqual({ definitions: 0, instances: 0, overdue: 0, due: 0, upcoming: 0, unknown: 0 });
  });
});
