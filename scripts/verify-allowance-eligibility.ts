/**
 * Verificação do motor PURO de elegibilidade de diárias (Fase 1).
 * Não há runner de unit tests no projeto (só Playwright E2E), então
 * este script auto-contido exercita todas as ramificações da função
 * evaluateDailyEligibility e falha com exit code 1 em qualquer erro.
 *
 * Uso: npx tsx scripts/verify-allowance-eligibility.ts
 */
import assert from 'node:assert/strict';
import {
  evaluateDailyEligibility,
  statusFromReason,
  type EligibilityInput,
} from '../src/lib/services/allowance-eligibility';

/** Entrada "tudo elegível" — cada caso sobrescreve o que precisa. */
function base(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    activeEmployment: true,
    activeAllocation: true,
    eligibleWorksite: true,
    onLeave: false,
    demobilizedBeforeDate: false,
    alreadyHasAllowance: false,
    hasApplicablePolicy: true,
    scheduleMode: 'derived',
    hasExplicitSchedule: false,
    explicitlyIncluded: false,
    explicitlyExcluded: false,
    isCalendarWorkday: true,
    ...overrides,
  };
}

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('evaluateDailyEligibility');

check('caso feliz (derived, dia útil) → planned_eligible', () => {
  const r = evaluateDailyEligibility(base());
  assert.equal(r.reason, 'planned_eligible');
  assert.equal(r.scheduleEvidenceSource, 'active_allocation_and_calendar');
  assert.equal(r.classification, 'eligible');
  assert.equal(statusFromReason(r.reason), 'planned');
});

check('sem política → blocked_no_policy (precede tudo)', () => {
  const r = evaluateDailyEligibility(base({ hasApplicablePolicy: false, activeEmployment: false }));
  assert.equal(r.reason, 'blocked_no_policy');
});

check('vínculo inativo → blocked_inactive_employment', () => {
  const r = evaluateDailyEligibility(base({ activeEmployment: false }));
  assert.equal(r.reason, 'blocked_inactive_employment');
  assert.equal(statusFromReason(r.reason), 'blocked');
});

check('férias vence alocação → blocked_leave', () => {
  const r = evaluateDailyEligibility(base({ onLeave: true }));
  assert.equal(r.reason, 'blocked_leave');
});

check('desmobilizado antes da data → blocked_demobilized', () => {
  const r = evaluateDailyEligibility(base({ demobilizedBeforeDate: true, activeAllocation: false }));
  assert.equal(r.reason, 'blocked_demobilized');
});

check('sem alocação viva → blocked_no_allocation', () => {
  const r = evaluateDailyEligibility(base({ activeAllocation: false }));
  assert.equal(r.reason, 'blocked_no_allocation');
});

check('obra (geofence) inativa → blocked_ineligible_worksite', () => {
  const r = evaluateDailyEligibility(base({ eligibleWorksite: false }));
  assert.equal(r.reason, 'blocked_ineligible_worksite');
});

check('derived em fim de semana → blocked_not_scheduled', () => {
  const r = evaluateDailyEligibility(base({ isCalendarWorkday: false }));
  assert.equal(r.reason, 'blocked_not_scheduled');
  assert.equal(r.scheduleEvidenceSource, 'active_allocation_and_calendar');
});

check('explicit_required sem escala → under_review_missing_schedule', () => {
  const r = evaluateDailyEligibility(
    base({ scheduleMode: 'explicit_required', hasExplicitSchedule: false }),
  );
  assert.equal(r.reason, 'under_review_missing_schedule');
  assert.equal(r.classification, 'review');
  assert.equal(statusFromReason(r.reason), 'under_review_missing_schedule');
});

check('explicit_required com escala → planned_eligible (explicit_schedule)', () => {
  const r = evaluateDailyEligibility(
    base({ scheduleMode: 'explicit_required', hasExplicitSchedule: true }),
  );
  assert.equal(r.reason, 'planned_eligible');
  assert.equal(r.scheduleEvidenceSource, 'explicit_schedule');
});

check('not_required em fim de semana ainda é elegível', () => {
  const r = evaluateDailyEligibility(base({ scheduleMode: 'not_required', isCalendarWorkday: false }));
  assert.equal(r.reason, 'planned_eligible');
  assert.equal(r.scheduleEvidenceSource, 'not_required');
});

check('override de inclusão força elegível no fim de semana (derived)', () => {
  const r = evaluateDailyEligibility(base({ isCalendarWorkday: false, explicitlyIncluded: true }));
  assert.equal(r.reason, 'planned_eligible');
  assert.equal(r.scheduleEvidenceSource, 'manual_override');
});

check('override de exclusão bloqueia mesmo em dia útil', () => {
  const r = evaluateDailyEligibility(base({ explicitlyExcluded: true }));
  assert.equal(r.reason, 'blocked_not_scheduled');
  assert.equal(r.scheduleEvidenceSource, 'manual_override');
});

check('duplicidade após passar na escala → blocked_duplicate', () => {
  const r = evaluateDailyEligibility(base({ alreadyHasAllowance: true }));
  assert.equal(r.reason, 'blocked_duplicate');
  // preserva a origem da escala mesmo bloqueando por duplicidade
  assert.equal(r.scheduleEvidenceSource, 'active_allocation_and_calendar');
});

check('exclusão manual vence duplicidade (schedule antes de duplicidade)', () => {
  const r = evaluateDailyEligibility(base({ explicitlyExcluded: true, alreadyHasAllowance: true }));
  assert.equal(r.reason, 'blocked_not_scheduled');
});

console.log(`\n${passed} verificações OK`);
