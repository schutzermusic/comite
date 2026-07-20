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
import { canPerform, nextStatus } from '../src/lib/services/allowance-workflow';
import {
  reconcileDaily,
  type ReconciliationInput,
} from '../src/lib/services/allowance-reconciliation';
import {
  computeAlerts,
  costByProject,
  type IntelligenceInput,
} from '../src/lib/services/allowance-intelligence';

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

console.log('\nallowance-workflow (máquina de estados + segregação)');

check('generated → manager_review permitido', () => {
  assert.equal(canPerform('send_to_manager_review', 'generated').ok, true);
  assert.equal(nextStatus('send_to_manager_review', 'generated'), 'manager_review');
});

check('ação fora de ordem é bloqueada', () => {
  assert.equal(canPerform('approve_finance', 'generated').ok, false);
});

check('aprovação sem RH validado é bloqueada', () => {
  const r = canPerform('approve_finance', 'hr_validation', {
    hrValidated: false,
    approverDistinctFromGenerator: true,
    hasUnresolvedReviews: false,
  });
  assert.equal(r.ok, false);
});

check('segregação: aprovador = gerador é bloqueado', () => {
  const r = canPerform('approve_finance', 'hr_validation', {
    hrValidated: true,
    approverDistinctFromGenerator: false,
    hasUnresolvedReviews: false,
  });
  assert.equal(r.ok, false);
});

check('aprovação com exceções pendentes é bloqueada', () => {
  const r = canPerform('approve_finance', 'hr_validation', {
    hrValidated: true,
    approverDistinctFromGenerator: true,
    hasUnresolvedReviews: true,
  });
  assert.equal(r.ok, false);
});

check('aprovação válida (RH ok, aprovador distinto, sem pendências)', () => {
  const r = canPerform('approve_finance', 'hr_validation', {
    hrValidated: true,
    approverDistinctFromGenerator: true,
    hasUnresolvedReviews: false,
  });
  assert.equal(r.ok, true);
  assert.equal(nextStatus('approve_finance', 'hr_validation'), 'finance_approved');
});

check('validate_hr não muda o estado (carimbo apenas)', () => {
  assert.equal(canPerform('validate_hr', 'hr_validation', {}).ok, true);
  assert.equal(nextStatus('validate_hr', 'hr_validation'), 'hr_validation');
});

check('cancel permitido em estados editáveis, bloqueado após aprovar', () => {
  assert.equal(canPerform('cancel', 'manager_review').ok, true);
  assert.equal(canPerform('cancel', 'finance_approved').ok, false);
});

console.log('\nallowance-reconciliation (previsto × realizado)');

function rbase(overrides: Partial<ReconciliationInput> = {}): ReconciliationInput {
  return {
    attendanceRequired: true,
    geofenceRequired: true,
    hasAcceptedClockIn: true,
    locationAvailable: true,
    hasLocationWithinGeofence: true,
    hasProjectTimeEntry: true,
    ...overrides,
  };
}

check('presença + geofence + apontamento → confirmed', () => {
  const r = reconcileDaily(rbase());
  assert.equal(r.outcome, 'confirmed');
  assert.deepEqual(r.reasons, []);
});

check('sem entrada → divergent (no_attendance)', () => {
  const r = reconcileDaily(rbase({ hasAcceptedClockIn: false }));
  assert.equal(r.outcome, 'divergent');
  assert.ok(r.reasons.includes('no_attendance'));
});

check('fora da geofence → divergent (outside_geofence)', () => {
  const r = reconcileDaily(rbase({ hasLocationWithinGeofence: false }));
  assert.equal(r.outcome, 'divergent');
  assert.ok(r.reasons.includes('outside_geofence'));
});

check('GPS indisponível → divergent (location_unavailable, requer análise)', () => {
  const r = reconcileDaily(rbase({ locationAvailable: false, hasLocationWithinGeofence: false }));
  assert.equal(r.outcome, 'divergent');
  assert.ok(r.reasons.includes('location_unavailable'));
});

check('sem apontamento é observação, não divergência', () => {
  const r = reconcileDaily(rbase({ hasProjectTimeEntry: false }));
  assert.equal(r.outcome, 'confirmed');
  assert.ok(r.reasons.includes('no_time_entry'));
});

check('política sem exigência de geofence ignora localização', () => {
  const r = reconcileDaily(
    rbase({ geofenceRequired: false, locationAvailable: false, hasLocationWithinGeofence: false }),
  );
  assert.equal(r.outcome, 'confirmed');
});

console.log('\nallowance-intelligence (alertas §19 + custo)');

function ibase(overrides: Partial<IntelligenceInput> = {}): IntelligenceInput {
  return {
    dailies: [],
    leaves: [],
    allocationState: [],
    allocatedPeopleByProject: {},
    closedProjectIds: [],
    ...overrides,
  };
}
const daily = (o: Partial<IntelligenceInput['dailies'][number]> = {}) => ({
  personId: 'p1',
  projectId: 'proj1',
  allowanceDate: '2026-07-27',
  status: 'confirmed',
  eligibilityReason: 'planned_eligible',
  amountCents: 4500,
  ...o,
});

check('semana consistente → nenhum alerta', () => {
  const a = computeAlerts(
    ibase({ dailies: [daily()], allocatedPeopleByProject: { proj1: 1 }, allocationState: [
      { personId: 'p1', projectId: 'proj1', hasLive: true, lastEndDate: null },
    ] }),
  );
  assert.equal(a.length, 0);
});

check('diária durante afastamento → leave_overlap crítico', () => {
  const a = computeAlerts(
    ibase({
      dailies: [daily()],
      leaves: [{ personId: 'p1', start: '2026-07-25', end: '2026-07-30' }],
      allocatedPeopleByProject: { proj1: 1 },
    }),
  );
  assert.ok(a.some((x) => x.code === 'leave_overlap' && x.severity === 'critical'));
});

check('diária após desmobilização → paid_after_demobilization', () => {
  const a = computeAlerts(
    ibase({
      dailies: [daily({ allowanceDate: '2026-07-29' })],
      allocationState: [
        { personId: 'p1', projectId: 'proj1', hasLive: false, lastEndDate: '2026-07-28' },
      ],
      allocatedPeopleByProject: {},
    }),
  );
  assert.ok(a.some((x) => x.code === 'paid_after_demobilization'));
});

check('mais diárias que alocados → worksite_count_mismatch', () => {
  const a = computeAlerts(
    ibase({
      dailies: [daily({ personId: 'p1' }), daily({ personId: 'p2' })],
      allocatedPeopleByProject: { proj1: 1 },
    }),
  );
  assert.ok(a.some((x) => x.code === 'worksite_count_mismatch' && x.count === 1));
});

check('projeto encerrado → closed_project', () => {
  const a = computeAlerts(
    ibase({ dailies: [daily()], closedProjectIds: ['proj1'], allocatedPeopleByProject: { proj1: 1 } }),
  );
  assert.ok(a.some((x) => x.code === 'closed_project'));
});

check('conciliação sem jornada → journey_missing', () => {
  const a = computeAlerts(
    ibase({
      dailies: [daily({ reconciliationReasons: ['no_attendance'] })],
      allocatedPeopleByProject: { proj1: 1 },
    }),
  );
  assert.ok(a.some((x) => x.code === 'journey_missing'));
});

check('gasto sobe sem aumento de pessoas → spend_spike', () => {
  const a = computeAlerts(
    ibase({
      dailies: [daily({ amountCents: 10000 })],
      allocatedPeopleByProject: { proj1: 1 },
      previous: { totalCents: 5000, people: 1 },
    }),
  );
  assert.ok(a.some((x) => x.code === 'spend_spike'));
});

check('custo por projeto ignora bloqueadas', () => {
  const c = costByProject([
    daily({ amountCents: 4500 }),
    daily({ personId: 'p2', status: 'blocked', amountCents: 4500 }),
  ]);
  assert.equal(c.proj1, 4500);
});

console.log(`\n${passed} verificações OK`);
