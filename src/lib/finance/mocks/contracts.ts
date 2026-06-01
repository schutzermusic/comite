/**
 * Back-compat shim — CONTRACTS data is now derived from the canonical
 * ledger + AR titles + contract reference (src/data/finance/reference.ts).
 *
 * The original hard-coded array has been removed; types + data are re-
 * exported from the selector so existing imports keep working.
 */

export {
  CONTRACTS,
  CONTRACT_TYPE_LABEL,
  selectContracts,
} from '../selectors/contracts';

export type {
  ContractMock,
  ContractTimelineEvent,
  ContractType,
} from '../selectors/contracts';
