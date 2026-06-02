// ============================================================
// Finance Category Matching & Duplicate Prevention
// ============================================================
// Resolves free-text labels (Excel/finance imports, payroll handoff) to the
// management-category master data, and flags would-be duplicate categories so
// the system suggests mapping to an existing entry instead of creating a new
// one. Mirrors the proven cost-center mapping ladder in
// src/lib/payroll/cost-center-mapping.ts, but reuses the shared normalize util.

import type { ManagementCategory } from '@/lib/types/finance';
import { managementCategories } from '@/data/finance/seed-categories';
import { normalizeKey, foldAccents, diceCoefficient } from '@/lib/utils/normalize';

/** Minimum Dice (bigram) similarity to accept a fuzzy match as a suggestion. */
export const FUZZY_THRESHOLD = 0.62;

export type CategoryMatchMethod =
  | 'alias'
  | 'exact'
  | 'case_insensitive'
  | 'accent_insensitive'
  | 'normalized'
  | 'fuzzy'
  | 'none';

export interface CategoryMatch {
  category_id?: string;
  confidence: number;
  method: CategoryMatchMethod;
}

const NO_MATCH: CategoryMatch = { confidence: 0, method: 'none' };

/** Re-exported for callers that build their own keys. */
export function normalizeCategoryName(input: unknown): string {
  return normalizeKey(input);
}

/**
 * Resolve one imported label to a management category. Tries, in order: saved
 * alias → exact name/code → case-insensitive → accent-insensitive → normalized
 * → fuzzy (best Dice ≥ threshold). The first hit wins, so an explicit alias or
 * exact name always beats a fuzzy guess. Only matches at/above the fuzzy
 * threshold are returned; everything weaker is `none`.
 *
 * @param aliasIndex normalized_name → category_id (saved finance_category_aliases)
 */
export function matchCategory(
  label: string,
  categories: ManagementCategory[] = managementCategories,
  aliasIndex: Map<string, string> = new Map(),
): CategoryMatch {
  const trimmed = (label ?? '').trim();
  if (!trimmed) return NO_MATCH;
  const norm = normalizeKey(trimmed);

  // 1. Saved alias (strongest — explicit prior human decision).
  const aliasId = aliasIndex.get(norm);
  if (aliasId && categories.some((c) => c.id === aliasId)) {
    return { category_id: aliasId, confidence: 1, method: 'alias' };
  }

  // 2. Exact name or code.
  const exact = categories.find((c) => c.name === trimmed || c.code === trimmed);
  if (exact) return { category_id: exact.id, confidence: 1, method: 'exact' };

  // 3. Case-insensitive.
  const lower = trimmed.toLowerCase();
  const ci = categories.find((c) => c.name.toLowerCase() === lower || c.code.toLowerCase() === lower);
  if (ci) return { category_id: ci.id, confidence: 0.97, method: 'case_insensitive' };

  // 4. Accent-insensitive.
  const folded = foldAccents(trimmed);
  const ai = categories.find((c) => foldAccents(c.name) === folded || foldAccents(c.code) === folded);
  if (ai) return { category_id: ai.id, confidence: 0.95, method: 'accent_insensitive' };

  // 5. Normalized (accents + punctuation removed).
  const nm = categories.find(
    (c) => normalizeKey(c.name) === norm || normalizeKey(c.code) === norm,
  );
  if (nm) return { category_id: nm.id, confidence: 0.9, method: 'normalized' };

  // 6. Fuzzy — best bigram similarity above threshold (leaves only).
  let best: CategoryMatch = NO_MATCH;
  for (const c of categories) {
    const score = diceCoefficient(trimmed, c.name);
    if (score >= FUZZY_THRESHOLD && score > best.confidence) {
      best = { category_id: c.id, confidence: Number(score.toFixed(3)), method: 'fuzzy' };
    }
  }
  return best;
}

/** Build a normalized_name → category_id index from saved aliases. */
export function buildCategoryAliasIndex(
  aliases: Array<{ normalized_name: string; category_id: string }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of aliases) {
    if (a.normalized_name && a.category_id) map.set(a.normalized_name, a.category_id);
  }
  return map;
}

// ── Duplicate prevention ────────────────────────────────────

export interface DuplicateCheckResult {
  /** True when an equivalent category already exists — caller should map, not create. */
  isDuplicate: boolean;
  method: CategoryMatchMethod;
  existing?: ManagementCategory;
  /** Human-readable suggestion to surface in the UI. */
  suggestion?: string;
}

/**
 * Detect whether creating a category with `name` under `parentId` would
 * duplicate an existing one. Checks (in order of strength): exact code,
 * exact name, accent-insensitive, normalized name, and — when a parent is
 * given — a sibling collision. Prevents dupes like "Hotel" / "HOTEL" /
 * "Hospedagem Hotel" / "Hotel / Hospedagem" by suggesting the existing entry.
 */
export function detectDuplicateCategory(
  name: string,
  parentId?: string,
  options: { code?: string; categories?: ManagementCategory[] } = {},
): DuplicateCheckResult {
  const categories = options.categories ?? managementCategories;
  const trimmed = (name ?? '').trim();
  if (!trimmed) return { isDuplicate: false, method: 'none' };

  // Exact code collision (strongest, codes are unique).
  if (options.code) {
    const byCode = categories.find((c) => c.code === options.code);
    if (byCode) {
      return {
        isDuplicate: true, method: 'exact', existing: byCode,
        suggestion: `Já existe a categoria "${byCode.name}" com o código ${byCode.code}.`,
      };
    }
  }

  const norm = normalizeKey(trimmed);
  const folded = foldAccents(trimmed);

  // Prefer collisions among siblings (same parent), then global.
  const scopes = parentId
    ? [categories.filter((c) => c.parent_id === parentId), categories]
    : [categories];

  for (const scope of scopes) {
    const exact = scope.find((c) => c.name === trimmed);
    if (exact) {
      return {
        isDuplicate: true, method: 'exact', existing: exact,
        suggestion: `Categoria "${exact.name}" já existe. Vincule a ela em vez de criar uma nova.`,
      };
    }
    const ai = scope.find((c) => foldAccents(c.name) === folded);
    if (ai) {
      return {
        isDuplicate: true, method: 'accent_insensitive', existing: ai,
        suggestion: `Categoria semelhante já existe: "${ai.name}" (${ai.code}). Sugerimos vincular a ela.`,
      };
    }
    const nm = scope.find((c) => normalizeKey(c.name) === norm);
    if (nm) {
      return {
        isDuplicate: true, method: 'normalized', existing: nm,
        suggestion: `Categoria equivalente já existe: "${nm.name}" (${nm.code}). Sugerimos vincular a ela.`,
      };
    }
  }

  // Soft fuzzy suggestion (does not block, but flags a likely match).
  let best: { cat?: ManagementCategory; score: number } = { score: 0 };
  for (const c of categories) {
    const score = diceCoefficient(trimmed, c.name);
    if (score > best.score) best = { cat: c, score };
  }
  if (best.cat && best.score >= FUZZY_THRESHOLD) {
    return {
      isDuplicate: false, method: 'fuzzy', existing: best.cat,
      suggestion: `Possível duplicata de "${best.cat.name}" (${best.cat.code}). Confirme antes de criar.`,
    };
  }

  return { isDuplicate: false, method: 'none' };
}
