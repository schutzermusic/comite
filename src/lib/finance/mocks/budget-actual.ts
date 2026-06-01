/**
 * Back-compat shim — the legacy hard-coded BUDGET_ACTUAL_ROWS dataset has
 * been collapsed into the canonical ledger. Types + data are now derived
 * by the selector and re-exported from here so existing imports keep
 * working without code changes.
 *
 * One number, one source of truth: see src/data/finance/mock-ledger.ts.
 */

export {
  BUDGET_ACTUAL_ROWS,
  BUDGET_ACTUAL_AREAS,
  selectBudgetActualRows,
} from '../selectors/budget-actual';

export type {
  BudgetActualArea,
  BudgetActualRow,
  BudgetActualTransaction,
} from '../selectors/budget-actual';
