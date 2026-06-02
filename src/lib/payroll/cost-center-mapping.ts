/**
 * Cost-center mapping for the Fechamento da Folha workflow.
 *
 * The payroll spreadsheet names its cost centers freely ("LONDRINA",
 * "ENGENHARIA E PROJETOS", "Adm."), which rarely match the Finance cost-center
 * master data verbatim. This module turns those imported names into Finance
 * `cost_center_id`s through a deterministic ladder of strategies (exact →
 * case/accent-insensitive → normalized → saved alias → fuzzy) and persists the
 * human-confirmed links as aliases so the next import of the same name
 * auto-matches.
 *
 * Pure functions (`normalizeCostCenterName`, `matchCostCenter`, `diceCoefficient`)
 * are side-effect free and unit-testable. Alias persistence is browser
 * localStorage (org-scoped) with an in-memory fallback for SSR — a single seam
 * to later swap for a Supabase `payroll_cost_center_mapping` table without
 * touching callers. It never reads or writes payroll amounts: totals come from
 * the parser and are never altered here.
 */

import type {
  CostCenterMatchMethod,
  PayrollCostCenterMapping,
  PayrollCostCenterTotal,
} from '@/lib/types/payroll-closing';

/**
 * Minimal cost-center shape the matcher needs. Both the client store
 * (`CostCenter`) and the Supabase `finance_cost_centers` row satisfy it, so the
 * matching/aliasing logic is agnostic to where the cost centers come from.
 */
export interface CostCenterLike {
  id: string;
  code: string;
  name: string;
}

const ORG_ID = 'org-insight-001';
const CURRENT_USER = 'user-admin-001';
const STORAGE_KEY = `insight:payroll-cc-mappings:${ORG_ID}`;
/** Minimum Dice (bigram) similarity to accept a fuzzy match as a suggestion. */
export const FUZZY_THRESHOLD = 0.62;

// ── Normalization (pure) ────────────────────────────────────

/**
 * Canonical key for an imported cost-center name: trimmed, lower-cased, accents
 * stripped, every run of non-alphanumeric characters collapsed to one space.
 * "Engenharia & Projetos " → "engenharia projetos".
 */
export function normalizeCostCenterName(input: unknown): string {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Accent-stripped, lower-cased form that keeps punctuation/spacing. */
function foldAccents(input: unknown): string {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// ── Fuzzy similarity (pure) ─────────────────────────────────

/** Sørensen–Dice coefficient over character bigrams, in [0,1]. */
export function diceCoefficient(a: string, b: string): number {
  const x = normalizeCostCenterName(a).replace(/\s+/g, '');
  const y = normalizeCostCenterName(b).replace(/\s+/g, '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return x === y ? 1 : 0;

  const bigrams = new Map<string, number>();
  for (let i = 0; i < x.length - 1; i++) {
    const bg = x.slice(i, i + 2);
    bigrams.set(bg, (bigrams.get(bg) ?? 0) + 1);
  }
  let intersection = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const bg = y.slice(i, i + 2);
    const count = bigrams.get(bg) ?? 0;
    if (count > 0) {
      bigrams.set(bg, count - 1);
      intersection++;
    }
  }
  return (2 * intersection) / (x.length - 1 + (y.length - 1));
}

// ── Match ladder (pure) ─────────────────────────────────────

export interface CostCenterMatch {
  cost_center_id?: string;
  confidence: number;
  method: CostCenterMatchMethod;
}

const NO_MATCH: CostCenterMatch = { confidence: 0, method: 'none' };

/**
 * Resolve one imported label to a Finance cost center. Tries, in order: saved
 * alias → exact name/code → case-insensitive → accent-insensitive → normalized
 * → fuzzy (best Dice ≥ threshold). The first hit wins, so an explicit alias or
 * exact name always beats a fuzzy guess. Returns the best fuzzy candidate even
 * when below the accept threshold is avoided — only matches ≥ threshold are
 * returned, everything else is `none`.
 *
 * @param aliasIndex normalized_name → cost_center_id (see `buildAliasIndex`)
 */
export function matchCostCenter(
  label: string,
  costCenters: CostCenterLike[],
  aliasIndex: Map<string, string>,
): CostCenterMatch {
  const trimmed = label.trim();
  if (!trimmed) return NO_MATCH;
  const norm = normalizeCostCenterName(trimmed);

  // 1. Saved alias (strongest — explicit prior human decision).
  const aliasId = aliasIndex.get(norm);
  if (aliasId && costCenters.some((c) => c.id === aliasId)) {
    return { cost_center_id: aliasId, confidence: 1, method: 'alias' };
  }

  // 2. Exact name or code.
  const exact = costCenters.find((c) => c.name === trimmed || c.code === trimmed);
  if (exact) return { cost_center_id: exact.id, confidence: 1, method: 'exact' };

  // 3. Case-insensitive.
  const lower = trimmed.toLowerCase();
  const ci = costCenters.find((c) => c.name.toLowerCase() === lower || c.code.toLowerCase() === lower);
  if (ci) return { cost_center_id: ci.id, confidence: 0.97, method: 'case_insensitive' };

  // 4. Accent-insensitive.
  const folded = foldAccents(trimmed);
  const ai = costCenters.find((c) => foldAccents(c.name) === folded || foldAccents(c.code) === folded);
  if (ai) return { cost_center_id: ai.id, confidence: 0.95, method: 'accent_insensitive' };

  // 5. Normalized (accents + punctuation removed).
  const nm = costCenters.find(
    (c) => normalizeCostCenterName(c.name) === norm || normalizeCostCenterName(c.code) === norm,
  );
  if (nm) return { cost_center_id: nm.id, confidence: 0.9, method: 'normalized' };

  // 6. Fuzzy — best bigram similarity above threshold.
  let best: CostCenterMatch = NO_MATCH;
  for (const c of costCenters) {
    const score = Math.max(diceCoefficient(trimmed, c.name), diceCoefficient(trimmed, c.code));
    if (score >= FUZZY_THRESHOLD && score > best.confidence) {
      best = { cost_center_id: c.id, confidence: Number(score.toFixed(3)), method: 'fuzzy' };
    }
  }
  return best;
}

/**
 * Enrich parsed cost centers with a `cost_center_id` + match metadata WITHOUT
 * touching any amount. Returns a new array — the parser output is left intact.
 */
export function autoMatchCostCenters(
  costCenters: PayrollCostCenterTotal[],
  financeCostCenters: CostCenterLike[],
  aliasIndex: Map<string, string>,
): PayrollCostCenterTotal[] {
  return costCenters.map((cc) => {
    const m = matchCostCenter(cc.cost_center_label, financeCostCenters, aliasIndex);
    return {
      ...cc,
      cost_center_id: m.cost_center_id,
      match_method: m.method,
      match_confidence: m.confidence,
    };
  });
}

// ── Alias persistence (localStorage, org-scoped) ────────────

/** In-memory mirror so reads work during SSR / before hydration. */
let memoryCache: PayrollCostCenterMapping[] | null = null;

function readStore(): PayrollCostCenterMapping[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return memoryCache ?? [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as PayrollCostCenterMapping[]) : [];
    memoryCache = Array.isArray(parsed) ? parsed : [];
    return memoryCache;
  } catch {
    return memoryCache ?? [];
  }
}

function writeStore(mappings: PayrollCostCenterMapping[]): void {
  memoryCache = mappings;
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(mappings));
  } catch {
    /* quota / private mode — keep the in-memory mirror */
  }
}

/** All saved cost-center aliases for the current organization. */
export function getCostCenterMappings(): PayrollCostCenterMapping[] {
  return readStore();
}

/** normalized_name → cost_center_id, for `matchCostCenter`. */
export function buildAliasIndex(mappings: PayrollCostCenterMapping[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const m of mappings) index.set(m.normalized_name, m.cost_center_id);
  return index;
}

/**
 * cc-* → uuid bridge. A saved alias (or a freshly auto-matched id) may carry a
 * legacy client store id like 'cc-eng-campo'. When the dropdown is backed by
 * Supabase `finance_cost_centers` (uuid ids), translate the legacy id to the
 * matching uuid via the shared `code` (or, failing that, the normalized name).
 * Returns `rawId` unchanged when it's already a valid finance id or no bridge
 * is found — callers then treat it as unmatched.
 */
export function resolveFinanceCostCenterId(
  rawId: string,
  financeCenters: CostCenterLike[],
  legacyCenters: CostCenterLike[],
): string {
  if (!rawId) return rawId;
  if (financeCenters.some((c) => c.id === rawId)) return rawId; // already a finance uuid
  const legacy = legacyCenters.find((c) => c.id === rawId);
  if (legacy) {
    const bridged = financeCenters.find(
      (c) => c.code === legacy.code || normalizeCostCenterName(c.name) === normalizeCostCenterName(legacy.name),
    );
    if (bridged) return bridged.id;
  }
  return rawId;
}

/**
 * Build the alias index from saved mappings, translating any legacy cc-* values
 * to finance uuids via `resolveFinanceCostCenterId`. Use this in supabase mode
 * so pre-existing aliases still resolve to a valid dropdown option.
 */
export function buildResolvedAliasIndex(
  mappings: PayrollCostCenterMapping[],
  financeCenters: CostCenterLike[],
  legacyCenters: CostCenterLike[],
): Map<string, string> {
  const index = new Map<string, string>();
  for (const m of mappings) {
    index.set(m.normalized_name, resolveFinanceCostCenterId(m.cost_center_id, financeCenters, legacyCenters));
  }
  return index;
}

/**
 * Upsert an alias (keyed by normalized name). Saving "LONDRINA" → cc-londrina
 * makes every later import of LONDRINA / londrina / Londrina auto-match.
 */
export function saveCostCenterMapping(input: {
  imported_name: string;
  cost_center_id: string;
  confidence?: number;
}): PayrollCostCenterMapping {
  const normalized_name = normalizeCostCenterName(input.imported_name);
  const now = new Date().toISOString();
  const mappings = readStore();
  const idx = mappings.findIndex((m) => m.normalized_name === normalized_name);

  let record: PayrollCostCenterMapping;
  if (idx >= 0) {
    record = {
      ...mappings[idx],
      imported_name: input.imported_name,
      cost_center_id: input.cost_center_id,
      confidence: input.confidence ?? 1,
      updated_by: CURRENT_USER,
      updated_at: now,
    };
    mappings[idx] = record;
  } else {
    record = {
      id: `pccm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      organization_id: ORG_ID,
      imported_name: input.imported_name,
      normalized_name,
      cost_center_id: input.cost_center_id,
      confidence: input.confidence ?? 1,
      created_by: CURRENT_USER,
      updated_by: CURRENT_USER,
      created_at: now,
      updated_at: now,
    };
    mappings.unshift(record);
  }
  writeStore(mappings);
  return record;
}

/** Persist several aliases at once (e.g. on "Salvar mapeamentos"). */
export function saveCostCenterMappings(
  inputs: Array<{ imported_name: string; cost_center_id: string; confidence?: number }>,
): PayrollCostCenterMapping[] {
  return inputs.map((i) => saveCostCenterMapping(i));
}

/** Remove the alias for an imported name (or normalized form thereof). */
export function deleteCostCenterMapping(importedName: string): void {
  const normalized_name = normalizeCostCenterName(importedName);
  writeStore(readStore().filter((m) => m.normalized_name !== normalized_name));
}

// ── Finance handoff ─────────────────────────────────────────

/**
 * Build the Finance handoff payload from the (mapped) cost centers. Each line
 * carries the original imported name, the resolved `cost_center_id`, the amount,
 * the competence and the originating finance `payroll_batch_id` — exactly what
 * Financeiro > Folha & Alocação needs to allocate. Amounts are passed through
 * untouched from the parser.
 */
export function buildFinanceHandoffLines(
  costCenters: PayrollCostCenterTotal[],
  competenceMonth: string,
  payrollBatchId: string,
): import('@/lib/types/payroll-closing').PayrollFinanceHandoffLine[] {
  return costCenters.map((cc) => ({
    imported_name: cc.cost_center_label,
    cost_center_id: cc.cost_center_id ?? null,
    amount_cents: cc.amount_cents,
    competence_month: competenceMonth,
    payroll_batch_id: payrollBatchId,
  }));
}
