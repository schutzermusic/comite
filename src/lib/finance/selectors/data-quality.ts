/**
 * Finance integrity / data-quality selector.
 *
 * Pure scan over the finance entities (ledger, AP/AR, taxes, payroll
 * allocations) that surfaces missing-dimension and broken-link issues BEFORE
 * the data is persisted to Supabase. Each check returns a count plus a small
 * sample of offending ids so the future repository migration can be validated
 * against a clean dataset.
 *
 * This is additive — it does not touch the legacy computeDataQuality()
 * dashboard indicator in finance-store, so existing dashboards are unaffected.
 */

import type {
  LedgerEntry, APARTitle, TaxObligation, PayrollAllocation, ManagementCategory,
} from '@/lib/types/finance';
import { projects as financeProjects } from '@/data/finance/reference';

export type DataQualitySeverity = 'error' | 'warning';

export interface DataQualityIssue {
  key: string;
  label: string;
  severity: DataQualitySeverity;
  count: number;
  /** Up to 10 offending entity ids for triage. */
  sampleIds: string[];
  /** Which entity table the issue lives in. */
  entity: 'ledger_entry' | 'apar_title' | 'tax_obligation' | 'payroll_allocation' | 'project';
}

export interface FinanceDataQualityReport {
  issues: DataQualityIssue[];
  totalIssues: number;
  errorCount: number;
  warningCount: number;
  /** True when no error-severity issues remain (warnings allowed). */
  clean: boolean;
  generatedAt: string;
}

export interface FinanceDataQualityInput {
  ledger: LedgerEntry[];
  apar: APARTitle[];
  taxes: TaxObligation[];
  payroll: PayrollAllocation[];
  categories: ManagementCategory[];
  /** Treats clearing categories as out-of-P&L (group_key === 'clearing'). */
  isClearingGroup: (groupKey: string) => boolean;
  /** Reference "today" (YYYY-MM-DD) for ageing pending allocations. Defaults to now. */
  today?: string;
  /** Project ids that could not be mapped to a finance ledger project. */
  unmappedProjectIds?: string[];
}

const SAMPLE = 10;
/** A pending-project cost older than this is flagged for stale allocation. */
const STALE_PENDING_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function ageInDays(dateIso: string | undefined, today: string): number {
  if (!dateIso) return 0;
  const a = new Date(`${dateIso.slice(0, 10)}T00:00:00Z`).getTime();
  const b = new Date(`${today.slice(0, 10)}T00:00:00Z`).getTime();
  return Math.floor((b - a) / MS_PER_DAY);
}

function issue(
  entity: DataQualityIssue['entity'],
  key: string,
  label: string,
  severity: DataQualitySeverity,
  ids: string[],
): DataQualityIssue {
  return { entity, key, label, severity, count: ids.length, sampleIds: ids.slice(0, SAMPLE) };
}

export function selectFinanceDataQuality(input: FinanceDataQualityInput): FinanceDataQualityReport {
  const { ledger, apar, taxes, payroll, categories, isClearingGroup } = input;
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const catById = new Map(categories.map(c => [c.id, c]));
  const contractsWithProject = new Set(financeProjects.map(p => p.contract_id).filter(Boolean) as string[]);
  const issues: DataQualityIssue[] = [];
  const isSettledActual = (e: LedgerEntry) =>
    e.entry_type === 'actual' && (e.status === 'posted' || e.status === 'reconciled');

  // ── Ledger entries ───────────────────────────────────────────────
  issues.push(issue('ledger_entry', 'ledger_no_category',
    'Lançamentos sem categoria', 'error',
    ledger.filter(e => !e.category_id && !e.dre_line).map(e => e.id)));

  issues.push(issue('ledger_entry', 'ledger_no_competence',
    'Lançamentos sem competência', 'error',
    ledger.filter(e => !e.competence_month && !e.period_key).map(e => e.id)));

  // Cost center is mandatory for non-revenue P&L groups (mirrors validateLedgerEntryInput).
  issues.push(issue('ledger_entry', 'ledger_no_cost_center',
    'Lançamentos de despesa sem centro de custo', 'error',
    ledger.filter(e => {
      const cat = catById.get(e.category_id);
      if (!cat) return false;
      const needsCC = cat.group_key !== 'revenue' && cat.group_key !== 'clearing';
      return needsCC && !e.cost_center_id;
    }).map(e => e.id)));

  // Clearing/cash legs should always carry provenance (source_ref or metadata).
  issues.push(issue('ledger_entry', 'clearing_no_provenance',
    'Entradas de clearing sem source_ref/metadata', 'warning',
    ledger.filter(e => {
      const cat = catById.get(e.category_id);
      if (!cat || !isClearingGroup(cat.group_key)) return false;
      const hasMeta = e.metadata && Object.keys(e.metadata).length > 0;
      return !e.source_ref && !hasMeta;
    }).map(e => e.id)));

  // ── Project allocation integrity (pre-project costs) ─────────────
  // Posted P&L expense whose category requires a project but has none.
  issues.push(issue('ledger_entry', 'posted_expense_no_project',
    'Despesas postadas sem projeto (categoria exige projeto)', 'error',
    ledger.filter(e => {
      if (!isSettledActual(e)) return false;
      const cat = catById.get(e.category_id);
      if (!cat || cat.group_key === 'revenue' || isClearingGroup(cat.group_key)) return false;
      return cat.requires_project && !e.project_id;
    }).map(e => e.id)));

  // Pending costs (contract but no project) ageing past the stale threshold.
  issues.push(issue('ledger_entry', 'pending_project_stale',
    `Custos pendentes de projeto há mais de ${STALE_PENDING_DAYS} dias`, 'warning',
    ledger.filter(e => {
      if (e.status === 'void' || e.project_id || !e.contract_id) return false;
      const cat = catById.get(e.category_id);
      if (!cat || isClearingGroup(cat.group_key)) return false;
      return ageInDays(e.entry_date, today) > STALE_PENDING_DAYS;
    }).map(e => e.id)));

  // Inconsistency: marked 'allocated' but project_id is missing.
  issues.push(issue('ledger_entry', 'allocated_no_project',
    "Lançamentos marcados como 'allocated' sem project_id", 'error',
    ledger.filter(e => e.allocation_status === 'allocated' && !e.project_id).map(e => e.id)));

  // Project revenue booked but not posted/reconciled — it would be excluded
  // from official realized revenue, so flag the inconsistency for review.
  issues.push(issue('ledger_entry', 'project_revenue_unsettled',
    'Receita de projeto (actual) sem status postado/reconciliado', 'warning',
    ledger.filter(e => {
      if (!e.project_id || e.status === 'void' || e.entry_type !== 'actual') return false;
      const cat = catById.get(e.category_id);
      if (cat?.group_key !== 'revenue') return false;
      return e.status !== 'posted' && e.status !== 'reconciled';
    }).map(e => e.id)));

  // Clearing entries must never be classified as project cost/revenue. They are
  // excluded by the selectors; this flags any clearing entry mis-tagged with a
  // P&L dre_line that a future importer could miscount.
  issues.push(issue('ledger_entry', 'project_clearing_pnl_line',
    'Entradas de clearing com dre_line de P&L (risco de dupla contagem)', 'warning',
    ledger.filter(e => {
      const cat = catById.get(e.category_id);
      if (!cat || !isClearingGroup(cat.group_key)) return false;
      const lineCat = e.dre_line ? categories.find(c => c.code === e.dre_line) : undefined;
      return !!lineCat && !isClearingGroup(lineCat.group_key);
    }).map(e => e.id)));

  // ── AP/AR titles ─────────────────────────────────────────────────
  issues.push(issue('apar_title', 'apar_no_due_date',
    'Títulos AP/AR sem vencimento', 'error',
    apar.filter(t => !t.due_date).map(t => t.id)));

  // Title carries a contract that already has a finance project, but no
  // project_id — its settlements won't feed the project received/cash curve.
  issues.push(issue('apar_title', 'apar_contract_no_project',
    'Títulos AP/AR com contrato de projeto existente mas sem project_id', 'warning',
    apar.filter(t =>
      t.status !== 'cancelled' && !t.project_id && !!t.contract_id && contractsWithProject.has(t.contract_id),
    ).map(t => t.id)));

  // ── Tax obligations ──────────────────────────────────────────────
  issues.push(issue('tax_obligation', 'tax_no_due_date',
    'Obrigações tributárias sem vencimento', 'error',
    taxes.filter(t => !t.due_date).map(t => t.id)));

  issues.push(issue('tax_obligation', 'tax_no_accrual_link',
    'Tributos sem lançamento de competência (accrual)', 'warning',
    taxes.filter(t => t.status !== 'cancelled' && !t.accrual_entry_id).map(t => t.id)));

  // ── Payroll allocations ──────────────────────────────────────────
  issues.push(issue('payroll_allocation', 'payroll_no_batch',
    'Alocações de folha sem lote', 'warning',
    payroll.filter(a => a.status !== 'cancelled' && !a.payroll_batch_id).map(a => a.id)));

  issues.push(issue('payroll_allocation', 'payroll_no_cost_center',
    'Alocações de folha sem centro de custo', 'error',
    payroll.filter(a => a.status !== 'cancelled' && !a.cost_center_id).map(a => a.id)));

  // A line with an allocated amount must name the project it is charged to.
  issues.push(issue('payroll_allocation', 'payroll_alloc_no_project',
    'Alocações com valor mas sem projeto', 'error',
    payroll.filter(a => a.status !== 'cancelled' && a.allocated_amount_cents > 0 && !a.project_id).map(a => a.id)));

  // ── Project ↔ finance mapping ────────────────────────────────────
  // Projects with no resolvable finance ledger link show no official numbers.
  issues.push(issue('project', 'project_no_finance_mapping',
    'Projetos sem vínculo com projeto financeiro', 'warning',
    input.unmappedProjectIds ?? []));

  const active = issues.filter(i => i.count > 0);
  const errorCount = active.filter(i => i.severity === 'error').reduce((s, i) => s + i.count, 0);
  const warningCount = active.filter(i => i.severity === 'warning').reduce((s, i) => s + i.count, 0);

  return {
    issues: active.sort((a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === 'error' ? -1 : 1)),
    totalIssues: errorCount + warningCount,
    errorCount,
    warningCount,
    clean: errorCount === 0,
    generatedAt: new Date().toISOString(),
  };
}
