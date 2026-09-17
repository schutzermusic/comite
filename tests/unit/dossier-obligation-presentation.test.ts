import { describe, expect, it } from 'vitest';
import { obligationGroup } from '@/components/contracts/shell/obligation-presentation';
import type { ObligationInstanceView } from '@/lib/contracts/obligations/types';

// The grouping only consumes persisted lifecycle and resolved urgency/date fields.
const instance = (overrides: Partial<ObligationInstanceView> = {}): ObligationInstanceView => ({
  id: 'occurrence', definitionId: 'definition', occurrenceKey: 'one_time', periodStart: null, periodEnd: null,
  activationState: 'activated', activatedAt: null, dueDate: '2026-10-01', dueConfidence: 'known', dueBasis: null,
  dateState: 'RESOLVED', scheduleAnchor: null, scheduleAnchorDate: null, state: 'OPEN', urgency: 'UPCOMING',
  satisfiedAt: null, satisfactionBasis: null, evidence: [], evidenceComplete: 'UNKNOWN', dependencies: [],
  exceptions: [], escalations: [], financialImpacts: [], blocksBilling: 'FALSE', ...overrides,
});
const obligation = (...instances: ObligationInstanceView[]) => ({ instances });

describe('Dossier obligation groups preserve contractual truth', () => {
  it('does not call definitions without occurrences active or completed', () => {
    expect(obligationGroup(obligation())).toBe('untracked');
  });
  it('does not classify an unknown due date as failure or completion', () => {
    expect(obligationGroup(obligation(instance({ dateState: 'UNKNOWN', urgency: 'UNKNOWN', dueDate: null })))).toBe('unknown');
  });
  it('separates known schedule dependencies from unknown dates', () => {
    expect(obligationGroup(obligation(instance({ dateState: 'AWAITING_SCHEDULE_ANCHOR', urgency: 'AWAITING_SCHEDULE_ANCHOR', dueDate: null })))).toBe('waiting');
  });
  it('puts actual overdue instances ahead of unknown instances in the same definition', () => {
    expect(obligationGroup(obligation(instance({ urgency: 'UNKNOWN' }), instance({ urgency: 'OVERDUE' })))).toBe('attention');
  });
  it('requires every instance to be satisfied before calling a definition completed', () => {
    expect(obligationGroup(obligation(instance({ state: 'SATISFIED' }), instance()))).toBe('active');
    expect(obligationGroup(obligation(instance({ state: 'SATISFIED' })))).toBe('completed');
  });
  it('never treats waived and cancelled instances as performed work', () => {
    expect(obligationGroup(obligation(instance({ state: 'WAIVED' }), instance({ state: 'CANCELLED' })))).toBe('closed');
  });
  it('distinguishes a proven billing block from an unknown block', () => {
    expect(obligationGroup(obligation(instance({ blocksBilling: 'TRUE' })))).toBe('attention');
    expect(obligationGroup(obligation(instance({ blocksBilling: 'UNKNOWN' })))).toBe('active');
  });
});
