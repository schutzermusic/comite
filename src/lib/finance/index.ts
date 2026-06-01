/**
 * Finance module — public entry point for typed data, selectors and mocks.
 *
 * Architecture:
 *   mocks/        raw fixtures (drop-in replacement for Supabase queries)
 *   selectors/    pure functions: mocks → FinanceKpi[] | chart series
 *   kpi.ts        FinanceKpi type, math helpers, drawer rules
 *   finance-store.ts  legacy ledger-backed store (unchanged)
 *
 * Pages should import from this barrel only.
 */

export * from './kpi';
export * from './mocks';
export * from './selectors';
