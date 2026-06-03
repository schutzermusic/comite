/**
 * Demo / visual-fallback fixtures for the Análise de Custos category dashboards.
 *
 * ─────────────────────────────────────────────────────────────────
 * THESE ARE NOT OFFICIAL LEDGER DATA. They exist ONLY so each category
 * dashboard can be visually validated when the unified mock ledger has
 * no real entries for the selected category subtree (e.g. Frota / B.6
 * and Administrativo / C.7, which currently have no postings).
 *
 * Isolation guarantees:
 *  - Generated on demand by {@link demoEntriesForScope}; never spread into
 *    `mockLedgerEntries`, so DRE / Control Room / project numbers are untouched.
 *  - Every entry is flagged (`metadata.demo = true`, `tags: ['demo']`,
 *    `source_system: 'other'`, id prefix `demo-`) and only flows through the
 *    category-analysis selectors when the page is in demo-fallback mode.
 *  - They reuse the canonical category / project / supplier / cost-center /
 *    collaborator ids so they render with the same labels and respect the same
 *    filters & drilldowns as real data — no parallel taxonomy.
 * ─────────────────────────────────────────────────────────────────
 */

import type { LedgerEntry } from '@/lib/types/finance';
import { managementCategories } from './seed-categories';

const DEMO_USER = 'demo-fixture';

/** Six months so the trend has spread and the latest month (2026-06) matches the page default. */
const DEMO_PERIODS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'] as const;
const DEMO_LAST_DAY: Record<string, string> = {
  '2026-01': '28', '2026-02': '26', '2026-03': '27', '2026-04': '25', '2026-05': '28', '2026-06': '24',
};

/**
 * One demo run-rate line. `monthlyReais` is the base monthly spend; a small
 * deterministic wobble is applied per period so trends and MoM read naturally.
 */
interface DemoRecipe {
  /** L3 subcategoria code (e.g. 'B.6.1'); resolved to the canonical category id. */
  code: string;
  label: string;
  monthlyReais: number;
  costCenterId: string;
  projectId?: string;
  contractId?: string;
  supplierId?: string;
  collaboratorId?: string;
  collaboratorName?: string;
  departmentName?: string;
  /** Wobble amplitude (0..1). Defaults to 0.12. */
  wobble?: number;
  /**
   * Disambiguator so two recipes can share the same code + cost center without
   * colliding ids (e.g. multiple collaborators on the same subcategoria).
   */
  idSuffix?: string;
  /** Recurring (monthly contract) vs one-off spend — powers the recurring mix cards. */
  recurring?: boolean;
}

// Deterministic, smooth monthly variation — keeps demos reproducible.
function periodFactor(recipeIdx: number, periodIdx: number, amp: number): number {
  return 1 + amp * Math.sin(recipeIdx * 1.7 + periodIdx * 0.9);
}

function buildEntries(recipes: DemoRecipe[]): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  recipes.forEach((r, ri) => {
    const cat = managementCategories.find((c) => c.code === r.code);
    if (!cat) return; // defensive: skip unknown codes
    DEMO_PERIODS.forEach((period, pi) => {
      const cents = Math.round(r.monthlyReais * 100 * periodFactor(ri, pi, r.wobble ?? 0.12));
      const day = DEMO_LAST_DAY[period] ?? '15';
      const date = `${period}-${day}`;
      out.push({
        id: `demo-${r.code}-${r.costCenterId}${r.idSuffix ? `-${r.idSuffix}` : ''}-${period}`,
        entry_date: date,
        competence_month: period,
        due_date: `${period}-${day}`,
        description: `${r.label} — ${period} (demo)`,
        amount_cents: cents,
        currency: 'BRL',
        category_id: cat.id,
        cost_center_id: r.costCenterId,
        project_id: r.projectId,
        contract_id: r.contractId,
        supplier_id: r.supplierId,
        business_unit_id: 'bu-rj',
        period_key: period,
        entry_type: 'actual',
        scenario: 'realized',
        status: 'posted',
        source_system: 'other',
        evidence_required: false,
        evidence_provided: true,
        tags: ['demo', ...(r.recurring !== undefined ? [r.recurring ? 'recurring' : 'one-off'] : [])],
        metadata: {
          demo: true,
          ...(r.recurring !== undefined ? { recurring: r.recurring } : {}),
          ...(r.collaboratorId ? { collaborator_id: r.collaboratorId, collaborator_name: r.collaboratorName } : {}),
          ...(r.departmentName ? { department_name: r.departmentName } : {}),
        },
        created_by: DEMO_USER,
        posted_by: DEMO_USER,
        posted_at: `${date}T10:00:00Z`,
        created_at: `${date}T08:00:00Z`,
        updated_at: `${date}T10:00:00Z`,
      });
    });
  });
  return out;
}

// ─────────────────────────────────────────────────────────────────
// Recipes per category subtree. Reuse canonical ids so labels/filters
// resolve exactly like real data. Suppliers reuse the 10 seeded vendors
// (thematic where possible) to avoid polluting the supplier master.
// ─────────────────────────────────────────────────────────────────

// 1) Mobilização e Logística (B.2 + historical C.6) ────────────────
// Spread across many collaborators so the Top-20 ranking and the concentration
// risk metric read naturally (one dominant traveller + a long tail).
const MOB: DemoRecipe[] = [
  { code: 'B.2.1', label: 'Hospedagem equipe campo', monthlyReais: 74_000, costCenterId: 'cc-mob', projectId: 'proj-1', supplierId: 'sup-1', collaboratorId: 'emp-006', collaboratorName: 'Marcos Pereira' },
  { code: 'B.2.1', label: 'Hospedagem supervisão', monthlyReais: 28_000, costCenterId: 'cc-mob', projectId: 'proj-3', supplierId: 'sup-1', collaboratorId: 'emp-002', collaboratorName: 'Felipe Santos', idSuffix: 'sup' },
  { code: 'B.2.2', label: 'Passagens aéreas', monthlyReais: 19_000, costCenterId: 'cc-mob', projectId: 'proj-1', supplierId: 'sup-2', collaboratorId: 'emp-001', collaboratorName: 'Carla Mendes' },
  { code: 'B.2.2', label: 'Passagens aéreas diretoria', monthlyReais: 12_500, costCenterId: 'cc-mob', projectId: 'proj-2', supplierId: 'sup-2', collaboratorId: 'emp-004', collaboratorName: 'Diego Lopes', idSuffix: 'dir' },
  { code: 'B.2.3', label: 'Locação de veículos', monthlyReais: 21_000, costCenterId: 'cc-mob', projectId: 'proj-2', supplierId: 'sup-3', collaboratorId: 'emp-103', collaboratorName: 'Rogério Alves' },
  { code: 'B.2.4', label: 'Combustível mobilização', monthlyReais: 9_000, costCenterId: 'cc-mob', projectId: 'proj-2', supplierId: 'sup-5', collaboratorId: 'emp-101', collaboratorName: 'João Batista' },
  { code: 'B.2.5', label: 'Alimentação em campo', monthlyReais: 13_000, costCenterId: 'cc-mob', projectId: 'proj-1', supplierId: 'sup-9', collaboratorId: 'emp-102', collaboratorName: 'Sandra Lima' },
  { code: 'B.2.7', label: 'Diárias de equipe', monthlyReais: 16_500, costCenterId: 'cc-mob', projectId: 'proj-3', collaboratorId: 'emp-006', collaboratorName: 'Marcos Pereira' },
  { code: 'B.2.8', label: 'Frete de material', monthlyReais: 11_500, costCenterId: 'cc-mob', projectId: 'proj-2', supplierId: 'sup-10', collaboratorId: 'emp-103', collaboratorName: 'Rogério Alves' },
  { code: 'B.2.9', label: 'Transporte rodoviário (ônibus)', monthlyReais: 6_800, costCenterId: 'cc-mob', projectId: 'proj-3', supplierId: 'sup-7', collaboratorId: 'emp-101', collaboratorName: 'João Batista' },
  { code: 'B.2.10', label: 'Pedágios frota', monthlyReais: 3_200, costCenterId: 'cc-mob', projectId: 'proj-2', supplierId: 'sup-8', collaboratorId: 'emp-004', collaboratorName: 'Diego Lopes' },
];

// 2) Materiais e Insumos (B.3) ─────────────────────────────────────
const MAT: DemoRecipe[] = [
  { code: 'B.3.1', label: 'Materiais de consumo', monthlyReais: 22_000, costCenterId: 'cc-eng-campo', projectId: 'proj-1', supplierId: 'sup-6' },
  { code: 'B.3.2', label: 'EPIs e uniformes', monthlyReais: 16_000, costCenterId: 'cc-eng-campo', projectId: 'proj-1', supplierId: 'sup-6' },
  { code: 'B.3.3', label: 'Ferramentas e instrumentação', monthlyReais: 13_500, costCenterId: 'cc-manut', projectId: 'proj-2', supplierId: 'sup-4' },
  { code: 'B.3.4', label: 'Cabos e condutores', monthlyReais: 28_000, costCenterId: 'cc-eng-campo', projectId: 'proj-1', supplierId: 'sup-4' },
  { code: 'B.3.5', label: 'Peças de reposição', monthlyReais: 18_500, costCenterId: 'cc-manut', projectId: 'proj-2', supplierId: 'sup-4' },
  { code: 'B.3.6', label: 'Equipamentos (consumo)', monthlyReais: 24_000, costCenterId: 'cc-manut', projectId: 'proj-3', supplierId: 'sup-3' },
];

// 3) Frota (B.6) ───────────────────────────────────────────────────
const FLEET: DemoRecipe[] = [
  { code: 'B.6.1', label: 'Locação de frota', monthlyReais: 38_000, costCenterId: 'cc-mob', projectId: 'proj-1', supplierId: 'sup-3' },
  { code: 'B.6.2', label: 'Combustível frota', monthlyReais: 27_000, costCenterId: 'cc-mob', projectId: 'proj-2', supplierId: 'sup-5', wobble: 0.18 },
  { code: 'B.6.3', label: 'Manutenção de veículos', monthlyReais: 14_500, costCenterId: 'cc-manut', projectId: 'proj-1', supplierId: 'sup-4', wobble: 0.25 },
  { code: 'B.6.4', label: 'Seguro de frota', monthlyReais: 8_200, costCenterId: 'cc-mob', projectId: 'proj-2', supplierId: 'sup-3' },
  { code: 'B.6.5', label: 'Pedágios frota', monthlyReais: 5_400, costCenterId: 'cc-mob', projectId: 'proj-3', supplierId: 'sup-8' },
];

// 4) Serviços / Subcontratados (B.4) ───────────────────────────────
const SERV: DemoRecipe[] = [
  { code: 'B.4.1', label: 'Subcontratação de serviços', monthlyReais: 89_000, costCenterId: 'cc-eng-campo', projectId: 'proj-1', contractId: 'ctr-1', supplierId: 'sup-4', recurring: true },
  { code: 'B.4.2', label: 'Consultoria técnica', monthlyReais: 32_000, costCenterId: 'cc-eng-campo', projectId: 'proj-2', contractId: 'ctr-2', supplierId: 'sup-4', recurring: false, wobble: 0.22 },
  { code: 'B.4.3', label: 'Locação de equipamentos', monthlyReais: 27_500, costCenterId: 'cc-manut', projectId: 'proj-2', contractId: 'ctr-2', supplierId: 'sup-3', recurring: true },
  { code: 'B.4.4', label: 'Engenharia terceirizada', monthlyReais: 41_000, costCenterId: 'cc-eng-campo', projectId: 'proj-3', contractId: 'ctr-3', supplierId: 'sup-4', recurring: true },
  { code: 'B.4.5', label: 'Manutenção (terceiros)', monthlyReais: 23_000, costCenterId: 'cc-manut', projectId: 'proj-1', contractId: 'ctr-1', supplierId: 'sup-3', recurring: false, wobble: 0.2 },
];

// 5) Administrativo (C.7) ──────────────────────────────────────────
const ADMIN: DemoRecipe[] = [
  { code: 'C.7.1', label: 'Software / SaaS', monthlyReais: 28_000, costCenterId: 'cc-ti', supplierId: 'sup-6', wobble: 0.05, recurring: true },
  { code: 'C.7.2', label: 'Materiais de escritório', monthlyReais: 6_500, costCenterId: 'cc-admin-sp', supplierId: 'sup-6', recurring: false, wobble: 0.2 },
  { code: 'C.7.3', label: 'Telefonia', monthlyReais: 4_200, costCenterId: 'cc-admin-sp', supplierId: 'sup-2', wobble: 0.05, recurring: true },
  { code: 'C.7.4', label: 'Internet / Links', monthlyReais: 5_800, costCenterId: 'cc-ti', supplierId: 'sup-2', wobble: 0.04, recurring: true },
  { code: 'C.7.5', label: 'Contabilidade', monthlyReais: 9_000, costCenterId: 'cc-financeiro', supplierId: 'sup-4', wobble: 0.03, recurring: true },
  { code: 'C.7.6', label: 'Jurídico', monthlyReais: 11_000, costCenterId: 'cc-admin-sp', supplierId: 'sup-4', recurring: false, wobble: 0.28 },
];

// 6) Tributos (E) — provisions only, never clearing/settlement ──────
const TAX: DemoRecipe[] = [
  { code: 'E.1.1', label: 'ISS sobre serviços', monthlyReais: 28_000, costCenterId: 'cc-financeiro', contractId: 'ctr-1' },
  { code: 'E.1.4', label: 'PIS', monthlyReais: 9_500, costCenterId: 'cc-financeiro' },
  { code: 'E.1.5', label: 'COFINS', monthlyReais: 31_000, costCenterId: 'cc-financeiro' },
  { code: 'E.1.6', label: 'CSLL (provisão)', monthlyReais: 18_000, costCenterId: 'cc-financeiro' },
  { code: 'E.1.3', label: 'IRPJ / CSLL (provisão)', monthlyReais: 26_000, costCenterId: 'cc-financeiro' },
  { code: 'E.4.1', label: 'INSS', monthlyReais: 22_000, costCenterId: 'cc-financeiro' },
  { code: 'E.4.2', label: 'FGTS', monthlyReais: 12_000, costCenterId: 'cc-financeiro' },
  { code: 'E.4.3', label: 'IRRF', monthlyReais: 8_000, costCenterId: 'cc-financeiro' },
];

// 7) Folha Direta (B.1) ────────────────────────────────────────────
const PAY_DIRECT: DemoRecipe[] = [
  { code: 'B.1.1', label: 'Salários — Equipe de Campo', monthlyReais: 341_000, costCenterId: 'cc-eng-campo', projectId: 'proj-1', departmentName: 'Engenharia', wobble: 0.04 },
  { code: 'B.1.2', label: 'Encargos trabalhistas', monthlyReais: 122_000, costCenterId: 'cc-eng-campo', projectId: 'proj-1', departmentName: 'Engenharia', wobble: 0.04 },
  { code: 'B.1.3', label: 'Benefícios (VT, VR, Saúde)', monthlyReais: 68_000, costCenterId: 'cc-manut', projectId: 'proj-2', departmentName: 'Manutenção', wobble: 0.03 },
  { code: 'B.1.4', label: 'Horas extras / adicionais', monthlyReais: 31_000, costCenterId: 'cc-mob', projectId: 'proj-3', departmentName: 'Mobilização', wobble: 0.22 },
];

// 8) Folha Indireta (C.1) ──────────────────────────────────────────
const PAY_INDIRECT: DemoRecipe[] = [
  { code: 'C.1.1', label: 'Salários — Administração', monthlyReais: 198_000, costCenterId: 'cc-admin-sp', departmentName: 'Administrativo', wobble: 0.03 },
  { code: 'C.1.2', label: 'Encargos e benefícios — indireto', monthlyReais: 71_000, costCenterId: 'cc-admin-sp', departmentName: 'Administrativo', wobble: 0.03 },
  { code: 'C.1.3', label: 'Pró-labore / Diretoria', monthlyReais: 95_000, costCenterId: 'cc-financeiro', departmentName: 'Diretoria', wobble: 0.02 },
  { code: 'C.1.1', label: 'Salários — TI', monthlyReais: 64_000, costCenterId: 'cc-ti', departmentName: 'TI', wobble: 0.04 },
  { code: 'C.1.1', label: 'Salários — Comercial', monthlyReais: 52_000, costCenterId: 'cc-comercial', departmentName: 'Comercial', wobble: 0.06 },
];

/** All demo recipes, grouped by the category code root they belong to. */
const DEMO_BY_ROOT: Record<string, DemoRecipe[]> = {
  'B.2': MOB,
  'C.6': MOB,
  'B.3': MAT,
  'B.6': FLEET,
  'B.4': SERV,
  'C.7': ADMIN,
  E: TAX,
  'B.1': PAY_DIRECT,
  'C.1': PAY_INDIRECT,
};

// Lazily-built, memoized entry cache per root so repeated renders are cheap.
const cache = new Map<string, LedgerEntry[]>();

/**
 * Demo ledger entries for a category subtree, identified by its code root(s)
 * (the same `scopeRootCodes` the dashboard config uses). Returns an empty array
 * when no fixtures are defined for the scope. Memoized per root.
 */
export function demoEntriesForScope(rootCodes: string[]): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  const seen = new Set<string>();
  for (const root of rootCodes) {
    const recipes = DEMO_BY_ROOT[root];
    if (!recipes || seen.has(root)) continue;
    seen.add(root);
    let entries = cache.get(root);
    if (!entries) {
      entries = buildEntries(recipes);
      cache.set(root, entries);
    }
    out.push(...entries);
  }
  return out;
}
