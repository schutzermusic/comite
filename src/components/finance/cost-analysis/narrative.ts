import type { FinanceInsight } from '@/components/finance/shared';
import { fmtCompactBRL, fmtPct } from '@/components/finance/shared';
import type {
  CostAnalysisSummary,
  DimensionCostRow,
  SubcategoryCostRow,
  CollaboratorCostRow,
} from '@/lib/finance/selectors';

// ─────────────────────────────────────────────────────────────────
// Executive narrative builders.
//
// Pure functions that turn already-computed selector outputs into the small
// "leitura executiva" insight cards shown at the top of each dashboard. They
// NEVER aggregate the ledger themselves — they only phrase what the selectors
// already calculated, so the narrative can never disagree with the charts.
// ─────────────────────────────────────────────────────────────────

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

export interface CategoryNarrativeInput {
  summary: CostAnalysisSummary;
  subcategories: SubcategoryCostRow[];
  byProject: DimensionCostRow[];
  bySupplier: DimensionCostRow[];
  byCollaborator?: CollaboratorCostRow[];
  supplierLabel?: string;
  supportsProject?: boolean;
  subLabel?: string;
}

/**
 * Category dashboard narrative: principal driver, MoM swing, cost concentration,
 * dominant project / supplier / collaborator. Returns 3–5 ranked insights.
 */
export function buildCategoryInsights({
  summary, subcategories, byProject, bySupplier, byCollaborator = [],
  supplierLabel = 'Fornecedor', supportsProject = true, subLabel = 'subcategoria',
}: CategoryNarrativeInput): FinanceInsight[] {
  const out: FinanceInsight[] = [];

  // Principal driver (top subcategoria).
  const driver = subcategories[0];
  if (driver) {
    out.push({
      id: 'driver',
      tone: 'neutral',
      title: `Principal driver: ${driver.name}`,
      detail: `${fmtCompactBRL(driver.value)} · ${pct(driver.share)} do custo da categoria no recorte.`,
    });
  }

  // Maior variação m/m.
  if (summary.momPct !== undefined) {
    const up = summary.momPct > 0;
    out.push({
      id: 'mom',
      tone: up ? 'negative' : 'positive',
      title: `Variação ${fmtPct(summary.momPct)} m/m`,
      detail: up
        ? `Custo subiu ${fmtPct(summary.momPct)} vs o mês anterior (${fmtCompactBRL(summary.lastPeriodValue)}).`
        : `Custo recuou ${fmtPct(summary.momPct)} vs o mês anterior (${fmtCompactBRL(summary.lastPeriodValue)}).`,
    });
  }

  // Concentração de custo (top 3 subcategorias).
  const top3 = subcategories.slice(0, 3).reduce((s, r) => s + r.share, 0);
  if (subcategories.length >= 3) {
    out.push({
      id: 'concentration',
      tone: top3 >= 0.7 ? 'warning' : 'neutral',
      title: `Concentração de custo: ${pct(top3)}`,
      detail: `As 3 maiores ${subLabel}s concentram ${pct(top3)} do gasto${top3 >= 0.7 ? ' — risco de concentração.' : '.'}`,
    });
  }

  // Projeto com maior consumo.
  const proj = supportsProject ? byProject.find((r) => r.id) : undefined;
  if (proj) {
    out.push({
      id: 'project',
      tone: 'neutral',
      title: `Projeto com maior consumo: ${proj.name}`,
      detail: `${fmtCompactBRL(proj.value)} · ${pct(proj.share)} do custo atribuído a projetos.`,
    });
  }

  // Fornecedor / agência dominante.
  const sup = bySupplier.find((r) => r.id);
  if (sup && sup.share >= 0.25) {
    out.push({
      id: 'supplier',
      tone: sup.share >= 0.5 ? 'warning' : 'neutral',
      title: `${supplierLabel} dominante: ${sup.name}`,
      detail: `${fmtCompactBRL(sup.value)} · ${pct(sup.share)} do gasto com fornecedores.`,
    });
  }

  // Concentração por colaborador (logística).
  const collabTotal = byCollaborator.reduce((s, c) => s + c.value, 0);
  if (collabTotal > 0 && byCollaborator.length >= 3) {
    const conc = byCollaborator.slice(0, 3).reduce((s, c) => s + c.value, 0) / collabTotal;
    out.push({
      id: 'collab',
      tone: conc >= 0.6 ? 'warning' : 'neutral',
      title: `Top 3 colaboradores: ${pct(conc)}`,
      detail: `${byCollaborator[0].name} lidera com ${fmtCompactBRL(byCollaborator[0].value)}.`,
    });
  }

  return out.slice(0, 5);
}

export interface GlobalNarrativeInput {
  summary: CostAnalysisSummary;
  categories: { name: string; value: number; share: number }[];
  subcategories: { name: string; value: number; share: number }[];
}

/** Global overview narrative shown when no category is selected. */
export function buildGlobalInsights({ summary, categories, subcategories }: GlobalNarrativeInput): FinanceInsight[] {
  const out: FinanceInsight[] = [];

  if (categories[0]) {
    out.push({
      id: 'top-cat',
      tone: 'neutral',
      title: `Maior categoria: ${categories[0].name}`,
      detail: `${fmtCompactBRL(categories[0].value)} · ${pct(categories[0].share)} do custo total.`,
    });
  }

  if (summary.momPct !== undefined) {
    const up = summary.momPct > 0;
    out.push({
      id: 'mom',
      tone: up ? 'negative' : 'positive',
      title: `Custo ${up ? 'subiu' : 'recuou'} ${fmtPct(summary.momPct)} m/m`,
      detail: `Último mês fechou em ${fmtCompactBRL(summary.lastPeriodValue)}.`,
    });
  }

  const top3 = categories.slice(0, 3).reduce((s, r) => s + r.share, 0);
  if (categories.length >= 3) {
    out.push({
      id: 'concentration',
      tone: top3 >= 0.75 ? 'warning' : 'neutral',
      title: `Concentração: ${pct(top3)} em 3 categorias`,
      detail: `O custo está distribuído em ${summary.categoryCount} categorias e ${summary.subcategoryCount} subcategorias.`,
    });
  }

  if (subcategories[0]) {
    out.push({
      id: 'top-sub',
      tone: subcategories[0].share >= 0.3 ? 'warning' : 'neutral',
      title: `Subcategoria crítica: ${subcategories[0].name}`,
      detail: `${fmtCompactBRL(subcategories[0].value)} · ${pct(subcategories[0].share)} do total.`,
    });
  }

  return out.slice(0, 4);
}
