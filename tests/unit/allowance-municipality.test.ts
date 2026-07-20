import { describe, expect, it } from 'vitest';
import { evaluateDailyEligibility, statusFromReason, type EligibilityInput } from '@/lib/services/allowance-eligibility';

function eligible(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    activeEmployment: true, activeEmploymentRequired: true,
    activeAllocation: true, activeAllocationRequired: true,
    eligibleWorksite: true, onLeave: false, demobilizedBeforeDate: false,
    alreadyHasAllowance: false, hasApplicablePolicy: true,
    scheduleMode: 'derived', hasExplicitSchedule: false,
    explicitlyIncluded: false, explicitlyExcluded: false, isCalendarWorkday: true,
    travelEligibilityMode: 'different_municipality',
    residenceMunicipalityRequired: true, serviceMunicipalityRequired: true,
    residenceMunicipalityCode: '4113700', residenceMunicipalityValidated: true,
    serviceMunicipalityCode: '3304557', serviceMunicipalityValidated: true,
    ...overrides,
  };
}

describe('municipality eligibility', () => {
  it('blocks equal official codes', () => {
    const result = evaluateDailyEligibility(eligible({ serviceMunicipalityCode: '4113700' }));
    expect(result.reason).toBe('same_residence_and_service_municipality');
    expect(statusFromReason(result.reason)).toBe('blocked');
  });

  it('continues when official codes differ', () => {
    const result = evaluateDailyEligibility(eligible());
    expect(result.reason).toBe('service_outside_residence_municipality');
    expect(statusFromReason(result.reason)).toBe('planned');
  });

  it('reviews missing and unvalidated residence', () => {
    expect(evaluateDailyEligibility(eligible({ residenceMunicipalityCode: null })).reason)
      .toBe('missing_or_unvalidated_residence_municipality');
    expect(evaluateDailyEligibility(eligible({ residenceMunicipalityValidated: false })).reason)
      .toBe('missing_or_unvalidated_residence_municipality');
  });

  it('reviews missing service municipality', () => {
    expect(evaluateDailyEligibility(eligible({ serviceMunicipalityCode: null })).reason)
      .toBe('missing_service_municipality');
  });

  it('supports policies that do not require municipality comparison', () => {
    expect(evaluateDailyEligibility(eligible({
      travelEligibilityMode: 'not_required', residenceMunicipalityCode: null,
      serviceMunicipalityCode: null, residenceMunicipalityValidated: false,
      serviceMunicipalityValidated: false,
    })).reason).toBe('planned_eligible');
  });

  it('keeps duplicate prevention after municipality checks', () => {
    expect(evaluateDailyEligibility(eligible({ alreadyHasAllowance: true })).reason).toBe('blocked_duplicate');
  });
});
