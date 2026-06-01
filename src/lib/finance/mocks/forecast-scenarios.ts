/**
 * Back-compat shim — FORECAST_SCENARIOS / FORECAST_COST_DRIVERS data is
 * now derived from the canonical ledger split by entry_type
 * (realized/budget/forecast) and scenario multipliers from
 * src/data/finance/reference.ts.
 */

export {
  FORECAST_SCENARIOS,
  FORECAST_ASSUMPTIONS,
  FORECAST_COST_DRIVERS,
  selectForecastScenarios,
  selectForecastCostDrivers,
} from '../selectors/forecast';

export type {
  ForecastScenario,
  ForecastScenarioType,
  ForecastAssumption,
} from '../selectors/forecast';
