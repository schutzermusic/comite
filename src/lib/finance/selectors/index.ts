/**
 * Finance selectors barrel — page-scoped derivations from mocks/ledger data
 * into the standardized FinanceKpi shape and chart-ready series.
 *
 * To swap mocks for real data later, change the import inside the matching
 * selector module — components never call mocks directly.
 */

export * from './forecast';
export * from './budget-actual';
export * from './cost-centers';
export * from './contracts';
export * from './dre';
export * from './project-portfolio';
export * from './apar';
export * from './cash';
export * from './taxes';
export * from './payroll';
export * from './project-allocation';
export * from './project-finance';
export * from './data-quality';
export * from './category-analysis';
