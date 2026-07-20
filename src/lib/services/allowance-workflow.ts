/**
 * Diárias de Campo — máquina de estados do lote semanal (PURA, sem I/O).
 *
 * O fluxo do spec (§13) é linear com saídas para 'cancelled'. Fase 2
 * cobre generated → manager_review → hr_validation → finance_approved.
 * As fases seguintes destravam scheduled → … → closed. Sem motor de
 * workflow genérico: a transição é validada aqui e persistida no
 * serviço, junto de auditoria.
 *
 * Segregação de funções: cada ação exige uma permissão distinta, e o
 * serviço ainda impõe (a) RH validado antes do Financeiro aprovar e
 * (b) aprovador ≠ quem gerou a prévia.
 */
import type { AllowanceWeekStatus } from '@/lib/types/allowances';

/** Ações de transição disponíveis no fluxo. */
export type WeekAction =
  | 'send_to_manager_review'
  | 'complete_manager_review'
  | 'validate_hr'
  | 'approve_finance'
  | 'cancel';

export interface WeekActionSpec {
  from: AllowanceWeekStatus;
  to: AllowanceWeekStatus;
  /** permissão exigida para executar a ação */
  permission:
    | 'allowances.manage'
    | 'allowances.review_exception'
    | 'allowances.hr_validate'
    | 'allowances.finance_approve';
  label: string;
}

/**
 * validate_hr NÃO muda o estado (a semana continua em hr_validation);
 * apenas registra o carimbo de validação do RH, pré-requisito para a
 * aprovação financeira. As demais ações avançam o estado.
 */
export const WEEK_ACTIONS: Record<WeekAction, WeekActionSpec> = {
  send_to_manager_review: {
    from: 'generated',
    to: 'manager_review',
    permission: 'allowances.manage',
    label: 'Enviar para gestor',
  },
  complete_manager_review: {
    from: 'manager_review',
    to: 'hr_validation',
    permission: 'allowances.review_exception',
    label: 'Concluir revisão do gestor',
  },
  validate_hr: {
    from: 'hr_validation',
    to: 'hr_validation',
    permission: 'allowances.hr_validate',
    label: 'Validar vínculo e ausências (RH)',
  },
  approve_finance: {
    from: 'hr_validation',
    to: 'finance_approved',
    permission: 'allowances.finance_approve',
    label: 'Aprovar lote (Financeiro)',
  },
  cancel: {
    from: 'generated', // sobrescrito por canCancel (qualquer estado editável)
    to: 'cancelled',
    permission: 'allowances.manage',
    label: 'Cancelar semana',
  },
};

/** Estados a partir dos quais a semana ainda pode ser cancelada. */
const CANCELLABLE: AllowanceWeekStatus[] = [
  'draft',
  'generated',
  'manager_review',
  'hr_validation',
];

/** Estados a partir dos quais a prévia ainda pode ser regenerada/editada. */
export const EDITABLE_WEEK_STATUSES: AllowanceWeekStatus[] = [
  'draft',
  'generated',
  'manager_review',
];

export interface TransitionContext {
  /** carimbo de validação do RH presente (pré-requisito da aprovação) */
  hrValidated: boolean;
  /** aprovador é diferente de quem gerou a prévia (segregação) */
  approverDistinctFromGenerator: boolean;
  /** ainda há diárias pendentes de revisão (bloqueia aprovação) */
  hasUnresolvedReviews: boolean;
}

export interface TransitionCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Valida uma ação de transição a partir do estado atual e do contexto
 * de segregação. Função total: nunca lança.
 */
export function canPerform(
  action: WeekAction,
  current: AllowanceWeekStatus,
  ctx: Partial<TransitionContext> = {},
): TransitionCheck {
  const spec = WEEK_ACTIONS[action];

  if (action === 'cancel') {
    return CANCELLABLE.includes(current)
      ? { ok: true }
      : { ok: false, reason: `Não é possível cancelar uma semana em "${current}".` };
  }

  if (current !== spec.from) {
    return { ok: false, reason: `Ação indisponível no estado "${current}".` };
  }

  if (action === 'approve_finance') {
    if (!ctx.hrValidated) {
      return { ok: false, reason: 'O RH precisa validar a semana antes da aprovação financeira.' };
    }
    if (ctx.approverDistinctFromGenerator === false) {
      return {
        ok: false,
        reason: 'Segregação de funções: quem gerou a prévia não pode ser o único aprovador do lote.',
      };
    }
    if (ctx.hasUnresolvedReviews) {
      return { ok: false, reason: 'Existem diárias em revisão não resolvidas. Trate as exceções antes de aprovar.' };
    }
  }

  return { ok: true };
}

/** Próximo estado resultante da ação (o atual, no caso de validate_hr). */
export function nextStatus(
  action: WeekAction,
  current: AllowanceWeekStatus,
): AllowanceWeekStatus {
  if (action === 'cancel') return 'cancelled';
  return WEEK_ACTIONS[action].to === current ? current : WEEK_ACTIONS[action].to;
}
