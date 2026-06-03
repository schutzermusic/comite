import { findCategoryById, managementCategories } from '@/data/finance/seed-categories';
import type { ManagementCategory } from '@/lib/types/finance';

// ─────────────────────────────────────────────────────────────────
// Category dashboard registry.
//
// The Análise de Custos page is driven by the SELECTED CATEGORY, not by a
// top-level tab. When no category is selected the page shows the global cost
// overview; when a category is selected this registry decides which
// category-specific dashboard configuration renders (logistics, materials,
// fleet, services, admin, taxes, payroll or a generic category view).
//
// The config is the single source of truth for: which categoria subtree the
// dashboard aggregates (scopeRootCodes), which dimensions/filters apply, the
// header identity, and which demo-fixture scope to fall back to when the real
// ledger has no entries for the subtree.
// ─────────────────────────────────────────────────────────────────

export type CategoryDashboardType =
  | 'logistics'
  | 'materials'
  | 'fleet'
  | 'services'
  | 'admin'
  | 'taxes'
  | 'payroll'
  | 'generic';

export interface CategoryDashboardConfig {
  /** Stable key (semantic slug). */
  key: string;
  /** Header title suffix — rendered as "Análise de Custos — {title}". */
  title: string;
  /** Header subtitle. */
  description: string;
  dashboardType: CategoryDashboardType;
  /**
   * Categoria code roots whose subtree this dashboard aggregates. Usually the
   * selected categoria's own code; logistics also folds in historical Viagens.
   */
  scopeRootCodes: string[];
  /** Accent color for charts/headers (hex). */
  accent: string;
  /** Supported analysis dimensions (drive which panels render). */
  supportsProject: boolean;
  supportsContract: boolean;
  supportsCostCenter: boolean;
  supportsSupplier: boolean;
  /** Whether per-collaborator analytics (filter + ranking) make sense here. */
  supportsCollaborator: boolean;
  /** Label used for the supplier dimension ("Agência/Fornecedor" vs "Fornecedor"). */
  supplierLabel: string;
  /** For payroll dashboards: direct (COGS) vs indirect (OPEX). */
  payrollKind?: 'direct' | 'indirect';
  /** Copy shown when the subtree has no data at all (even in demo mode). */
  emptyState: string;
}

type ConfigDefaults = Partial<CategoryDashboardConfig>;

const BASE: ConfigDefaults = {
  accent: '#14B8A6',
  supportsProject: true,
  supportsContract: true,
  supportsCostCenter: true,
  supportsSupplier: true,
  supportsCollaborator: false,
  supplierLabel: 'Fornecedor',
  emptyState: 'Sem custos nesta categoria no recorte selecionado.',
};

/**
 * Explicit configs keyed by the selected categoria CODE. Categories not listed
 * here fall back to a generic category dashboard (see resolveCategoryDashboard).
 * Logistics intentionally scopes to B.2 + C.6 so legacy "Viagens" entries are
 * included for backward compatibility — they are never deleted, just folded in.
 */
export const categoryDashboardConfigs: Record<string, CategoryDashboardConfig> = {
  'B.2': {
    ...BASE,
    key: 'mobilizacao_logistica',
    title: 'Mobilização e Logística',
    description: 'Hospedagem, aéreo, locação, combustível, pedágio, alimentação, diárias, frete e fornecedores',
    dashboardType: 'logistics',
    scopeRootCodes: ['B.2', 'C.6'],
    accent: '#F43F5E',
    supportsCollaborator: true,
    supplierLabel: 'Agência/Fornecedor',
    emptyState: 'Sem custos de mobilização/logística no recorte.',
  } as CategoryDashboardConfig,
  'B.3': {
    ...BASE,
    key: 'materiais',
    title: 'Materiais',
    description: 'EPIs, cabos, ferramentas, equipamentos, peças e consumíveis',
    dashboardType: 'materials',
    scopeRootCodes: ['B.3'],
    accent: '#F59E0B',
  } as CategoryDashboardConfig,
  'B.6': {
    ...BASE,
    key: 'frota',
    title: 'Frota',
    description: 'Locação, combustível, manutenção, seguro, pedágio e multas da frota',
    dashboardType: 'fleet',
    scopeRootCodes: ['B.6'],
    accent: '#3B82F6',
  } as CategoryDashboardConfig,
  'B.4': {
    ...BASE,
    key: 'servicos',
    title: 'Serviços',
    description: 'Subcontratados, consultoria, engenharia e serviços técnicos',
    dashboardType: 'services',
    scopeRootCodes: ['B.4'],
    accent: '#06B6D4',
  } as CategoryDashboardConfig,
  'C.7': {
    ...BASE,
    key: 'administrativo',
    title: 'Administrativo',
    description: 'Software, escritório, telefonia, internet, contabilidade, jurídico e assinaturas',
    dashboardType: 'admin',
    scopeRootCodes: ['C.7'],
    accent: '#8B5CF6',
    supportsProject: false,
  } as CategoryDashboardConfig,
  E: {
    ...BASE,
    key: 'tributos',
    title: 'Tributos',
    description: 'Impostos e contribuições por tipo, competência e vencimento (reconhecimento P&L)',
    dashboardType: 'taxes',
    scopeRootCodes: ['E'],
    accent: '#EAB308',
    supportsProject: false,
    supportsSupplier: false,
    emptyState: 'Sem tributos reconhecidos no recorte. Liquidações (clearing) ficam fora da análise de custo.',
  } as CategoryDashboardConfig,
  'B.1': {
    ...BASE,
    key: 'folha_direta',
    title: 'Folha Direta',
    description: 'Folha alocada a projetos e equipes de campo (Custo Direto / COGS)',
    dashboardType: 'payroll',
    scopeRootCodes: ['B.1'],
    accent: '#22C55E',
    payrollKind: 'direct',
    supportsSupplier: false,
    emptyState: 'Sem folha direta no recorte.',
  } as CategoryDashboardConfig,
  'C.1': {
    ...BASE,
    key: 'folha_indireta',
    title: 'Folha Indireta',
    description: 'Folha administrativa e estrutural por departamento e centro de custo (OPEX)',
    dashboardType: 'payroll',
    scopeRootCodes: ['C.1'],
    accent: '#10B981',
    payrollKind: 'indirect',
    supportsProject: false,
    supportsSupplier: false,
    emptyState: 'Sem folha indireta no recorte.',
  } as CategoryDashboardConfig,
};

/**
 * Categories whose quick-chip should appear at the top of the page. Travel
 * ("Viagens", C.6) is intentionally omitted — it is folded into Mobilização e
 * Logística (B.2). Each entry resolves to a categoria by code; the chip is
 * dropped silently if the categoria does not exist. Order matches the brief's
 * 8 main categories.
 */
export const QUICK_CATEGORY_CODES = ['B.2', 'B.3', 'B.6', 'B.4', 'C.7', 'E', 'B.1', 'C.1'] as const;

export interface QuickCategory {
  id: string;
  code: string;
  label: string;
}

export function quickCategories(): QuickCategory[] {
  return QUICK_CATEGORY_CODES
    .map((code) => managementCategories.find((c) => c.code === code))
    .filter((c): c is ManagementCategory => Boolean(c))
    .map((c) => ({ id: c.id, code: c.code, label: c.name }));
}

/**
 * Resolve the dashboard configuration for a selected categoria id. Returns
 * undefined when nothing is selected (caller renders the global overview).
 * Legacy Viagens (C.6) is routed to the logistics dashboard. Unmapped
 * categories get a generic, single-subtree dashboard built from their own name.
 */
export function resolveCategoryDashboard(categoryId: string | null | undefined): CategoryDashboardConfig | undefined {
  if (!categoryId) return undefined;
  const cat = findCategoryById(categoryId);
  if (!cat) return undefined;

  const explicit = categoryDashboardConfigs[cat.code];
  if (explicit) return explicit;

  // Historical Viagens → fold into Mobilização e Logística.
  if (cat.code === 'C.6' || cat.code.startsWith('C.6.')) return categoryDashboardConfigs['B.2'];

  // Generic single-subtree dashboard for any other categoria.
  return {
    ...BASE,
    key: `generic_${cat.code}`,
    title: cat.name,
    description: `Composição de ${cat.name} por subcategoria, projeto e fornecedor`,
    dashboardType: 'generic',
    scopeRootCodes: [cat.code],
  } as CategoryDashboardConfig;
}
