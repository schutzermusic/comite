/**
 * Back-compat shim — COST_CENTERS data is now derived from the canonical
 * ledger grouped by cost_center_id, merged with the costCenterRefs
 * reference (director / headcount) in src/data/finance/reference.ts.
 */

export {
  COST_CENTERS,
  COST_CENTERS_MONTHS_REF,
  selectCostCenters,
} from '../selectors/cost-centers';

export type {
  CostCenterMock,
  CostCenterMockCategory,
} from '../selectors/cost-centers';
