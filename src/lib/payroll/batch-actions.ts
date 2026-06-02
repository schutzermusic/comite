/**
 * Status-driven rules for editing/deleting/cancelling/reopening a payroll
 * closing batch. This is the SINGLE SOURCE OF TRUTH shared by the UI (to
 * show/disable controls) and the API routes (to authorize + re-validate the
 * transition server-side). Pure and dependency-free.
 *
 * Status lifecycle: imported → validated → reviewed → approved →
 * sent_to_finance → posted, plus the terminal `cancelled` (soft-delete).
 */

import type { PayrollClosingStatus } from '@/lib/types/payroll-closing';

export type BatchAction = 'edit' | 'delete' | 'cancel' | 'reopen' | 'replace_files' | 'reparse';

// Permission keys (also seeded in migration 023).
export const PERM_CLOSE = 'people.payroll_close';
export const PERM_DELETE = 'people.payroll_delete';
export const PERM_REOPEN = 'people.payroll_reopen';
export const PERM_ADMIN = 'people.payroll_admin';

export interface ActionRule {
  /** Structurally allowed for this status (independent of the user's role). */
  allowed: boolean;
  /** Permission the server enforces (admins always bypass via allowAdmin). */
  permission: string;
  /** UI should confirm before performing the action. */
  requiresConfirm: boolean;
  /** When not allowed, the reason to surface (tooltip / disabled hint). */
  reason?: string;
}

const editableStatuses: PayrollClosingStatus[] = ['imported', 'validated', 'reviewed'];

/**
 * Compute the rule set for a batch in `status`. `hasFinanceBatch` only affects
 * messaging (the strong warning on sent_to_finance) — the posted state is what
 * truly hard-blocks financial edits.
 */
export function batchActionRules(
  status: PayrollClosingStatus,
  hasFinanceBatch = false,
): Record<BatchAction, ActionRule> {
  const editable = editableStatuses.includes(status);
  const posted = status === 'posted';
  const sent = status === 'sent_to_finance';
  const approved = status === 'approved';
  const cancelled = status === 'cancelled';

  const editDisabledReason = posted
    ? 'Lançado no ledger — exige fluxo de estorno/ajuste.'
    : approved ? 'Reabra o fechamento para editar.'
    : sent ? 'Enviado ao Financeiro — reabra para editar.'
    : cancelled ? 'Fechamento cancelado — reabra para editar.'
    : 'Edição indisponível neste status.';

  return {
    edit: editable
      ? { allowed: true, permission: PERM_CLOSE, requiresConfirm: false }
      : { allowed: false, permission: PERM_CLOSE, requiresConfirm: false, reason: editDisabledReason },

    replace_files: editable
      ? { allowed: true, permission: PERM_CLOSE, requiresConfirm: false }
      : { allowed: false, permission: PERM_CLOSE, requiresConfirm: false, reason: editDisabledReason },

    reparse: editable
      ? { allowed: true, permission: PERM_CLOSE, requiresConfirm: false }
      : { allowed: false, permission: PERM_CLOSE, requiresConfirm: false, reason: editDisabledReason },

    // Cancel = soft delete (status → cancelled). Blocked once posted.
    cancel: posted
      ? { allowed: false, permission: PERM_DELETE, requiresConfirm: true, reason: 'Lançado no ledger — exige estorno, não cancelamento.' }
      : cancelled
        ? { allowed: false, permission: PERM_DELETE, requiresConfirm: true, reason: 'Fechamento já cancelado.' }
        : { allowed: true, permission: (approved || sent) ? PERM_DELETE : PERM_CLOSE, requiresConfirm: true },

    // Reopen brings approved/sent_to_finance/cancelled back to an editable state.
    reopen: (approved || sent || cancelled)
      ? { allowed: true, permission: PERM_REOPEN, requiresConfirm: true }
      : { allowed: false, permission: PERM_REOPEN, requiresConfirm: true, reason: posted ? 'Lançado no ledger.' : 'Fechamento já está editável.' },

    // Hard delete: drafts and approved (elevated) and cancelled cleanup. Never
    // for sent_to_finance (use cancel) or posted (ledger impact).
    delete: (editable || approved || cancelled)
      ? { allowed: true, permission: PERM_DELETE, requiresConfirm: true }
      : { allowed: false, permission: PERM_DELETE, requiresConfirm: true, reason: sent ? 'Enviado ao Financeiro — use Cancelar/Reabrir, não exclua.' : 'Lançado no ledger — exclusão bloqueada.' },
  };
}

/** Strong warning shown before cancel/reopen/delete touching a finance batch. */
export function financeImpactWarning(status: PayrollClosingStatus, hasFinanceBatch: boolean): string | null {
  if (status === 'sent_to_finance' || (hasFinanceBatch && status !== 'posted')) {
    return 'Este fechamento já foi enviado ao Financeiro. Cancelar/reabrir pode afetar Folha & Alocação.';
  }
  if (status === 'posted') {
    return 'Fechamento lançado no ledger. Valores financeiros não podem ser editados — use estorno/ajuste.';
  }
  return null;
}
