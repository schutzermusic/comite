/**
 * Diárias de Campo — motor de elegibilidade (PURO, sem I/O).
 *
 * Espelha a função de decisão do spec (§5), estendida com a decisão de
 * arquitetura sobre escala (schedule_mode). É deliberadamente livre de
 * dependências (sem Supabase/DOM) para ser testável em node e reusável
 * tanto na geração da prévia quanto na revisão. Toda a coleta de dados
 * vive em allowances.ts; aqui só há regra.
 *
 * Precedência dos bloqueios (quando mais de um se aplica, vence o mais
 * informativo para a operação):
 *   1. vínculo inativo
 *   2. férias/afastamento (ausência conhecida)
 *   3. desmobilizado antes da data
 *   4. sem alocação ativa
 *   5. obra não elegível
 *   6. escala (derived / explicit_required / not_required + overrides)
 *   7. duplicidade
 *   8. sem política aplicável
 */
import type {
  DayClassification,
  EligibilityReason,
  ScheduleEvidenceSource,
  ScheduleMode,
  TravelEligibilityMode,
} from '@/lib/types/allowances';
import { classifyReason } from '@/lib/types/allowances';

export interface EligibilityInput {
  /** people.status = 'active' e não desligado até a data */
  activeEmployment: boolean;
  activeEmploymentRequired: boolean;
  /** alocação viva (pending_approval|active) cobrindo a data */
  activeAllocation: boolean;
  activeAllocationRequired: boolean;
  /**
   * obra elegível. Obra = geofence do projeto: quando a política fixa
   * uma geofence, ela deve estar ativa; caso contrário true.
   */
  eligibleWorksite: boolean;
  /** leave_period vivo cobrindo a data */
  onLeave: boolean;
  /** existe alocação encerrada (end_date < data) e nenhuma viva */
  demobilizedBeforeDate: boolean;
  /** já existe diária viva para pessoa+data+tipo+política */
  alreadyHasAllowance: boolean;
  /** há política aplicável resolvida (valor + regras) */
  hasApplicablePolicy: boolean;

  scheduleMode: ScheduleMode;
  /** work_schedule_days status='planned' na data (explicit_required) */
  hasExplicitSchedule: boolean;
  /** override manual de inclusão (source='override', status='planned') */
  explicitlyIncluded: boolean;
  /** override manual de exclusão (status='excluded') */
  explicitlyExcluded: boolean;
  /** dia útil pelo calendário operacional (schedule_mode='derived') */
  isCalendarWorkday: boolean;

  travelEligibilityMode: TravelEligibilityMode;
  residenceMunicipalityRequired: boolean;
  serviceMunicipalityRequired: boolean;
  residenceMunicipalityCode: string | null;
  residenceMunicipalityValidated: boolean;
  serviceMunicipalityCode: string | null;
  serviceMunicipalityValidated: boolean;
}

export interface EligibilityResult {
  reason: EligibilityReason;
  scheduleEvidenceSource: ScheduleEvidenceSource | null;
  classification: DayClassification;
}

function result(
  reason: EligibilityReason,
  scheduleEvidenceSource: ScheduleEvidenceSource | null,
): EligibilityResult {
  return { reason, scheduleEvidenceSource, classification: classifyReason(reason) };
}

/**
 * Resolve a evidência de escala para a data. Retorna:
 *  - { source } quando a pessoa está prevista (segue avaliação);
 *  - { blocked } quando fora da escala;
 *  - { review } quando a escala é exigida e não há registro.
 */
function evaluateSchedule(
  input: EligibilityInput,
): { source: ScheduleEvidenceSource } | { blocked: ScheduleEvidenceSource } | { review: true } {
  // overrides manuais valem em qualquer modo
  if (input.explicitlyExcluded) return { blocked: 'manual_override' };
  if (input.explicitlyIncluded) return { source: 'manual_override' };

  switch (input.scheduleMode) {
    case 'not_required':
      return { source: 'not_required' };
    case 'explicit_required':
      return input.hasExplicitSchedule
        ? { source: 'explicit_schedule' }
        : { review: true };
    case 'derived':
    default:
      return input.isCalendarWorkday
        ? { source: 'active_allocation_and_calendar' }
        : { blocked: 'active_allocation_and_calendar' };
  }
}

/**
 * Avalia a elegibilidade de UMA diária (pessoa × data × política).
 * Função total: sempre retorna um motivo e (quando aplicável) a origem
 * da evidência de escala a ser gravada no snapshot.
 */
export function evaluateDailyEligibility(input: EligibilityInput): EligibilityResult {
  if (input.activeEmploymentRequired && !input.activeEmployment) return result('blocked_inactive_employment', null);
  if (input.activeAllocationRequired && !input.activeAllocation) return result('blocked_no_allocation', null);
  if (!input.hasApplicablePolicy) return result('blocked_no_policy', null);
  if (!input.eligibleWorksite) return result('blocked_ineligible_worksite', null);

  const schedule = evaluateSchedule(input);
  if ('review' in schedule) {
    return result('under_review_missing_schedule', null);
  }
  if ('blocked' in schedule) {
    return result('blocked_not_scheduled', schedule.blocked);
  }

  if (input.onLeave) return result('blocked_leave', schedule.source);
  if (input.demobilizedBeforeDate) return result('blocked_demobilized', schedule.source);

  if (input.travelEligibilityMode === 'manual_review') {
    return result('manual_municipality_review_required', schedule.source);
  }

  if (input.travelEligibilityMode === 'different_municipality') {
    if (
      input.residenceMunicipalityRequired
      && (!input.residenceMunicipalityCode || !input.residenceMunicipalityValidated)
    ) {
      return result('missing_or_unvalidated_residence_municipality', schedule.source);
    }
    if (
      input.serviceMunicipalityRequired
      && (!input.serviceMunicipalityCode || !input.serviceMunicipalityValidated)
    ) {
      return result('missing_service_municipality', schedule.source);
    }
    if (
      input.residenceMunicipalityCode
      && input.serviceMunicipalityCode
      && input.residenceMunicipalityCode === input.serviceMunicipalityCode
    ) {
      return result('same_residence_and_service_municipality', schedule.source);
    }
  }

  if (input.alreadyHasAllowance) return result('blocked_duplicate', schedule.source);

  return result(
    input.travelEligibilityMode === 'different_municipality'
      && Boolean(input.residenceMunicipalityCode)
      && Boolean(input.serviceMunicipalityCode)
      ? 'service_outside_residence_municipality'
      : 'planned_eligible',
    schedule.source,
  );
}

/** Status inicial da diária a partir do motivo (mapeamento canônico). */
export function statusFromReason(
  reason: EligibilityReason,
): 'planned' | 'under_review' | 'under_review_missing_schedule' | 'blocked' {
  if (
    reason === 'planned_eligible'
    || reason === 'service_outside_residence_municipality'
    || reason === 'manual_include_override'
  ) return 'planned';
  if (reason === 'under_review_missing_schedule') return 'under_review_missing_schedule';
  if (
    reason === 'missing_or_unvalidated_residence_municipality'
    || reason === 'missing_service_municipality'
    || reason === 'manual_municipality_review_required'
  ) return 'under_review';
  return 'blocked';
}
