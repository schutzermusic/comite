// ============================================================
// Shared string normalization utilities
// ============================================================
// Single source of truth for accent-insensitive / canonical-key matching
// used by cost-center mapping, finance category matching and duplicate
// detection. Kept dependency-free and pure so it is safe in SSR and tests.

/**
 * Canonical key: trimmed, lower-cased, accents stripped (NFD), every run of
 * non-alphanumeric characters collapsed to a single space.
 * "Engenharia & Projetos " → "engenharia projetos".
 */
export function normalizeKey(input: unknown): string {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Accent-stripped, lower-cased form that keeps punctuation/spacing. */
export function foldAccents(input: unknown): string {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Sørensen–Dice coefficient over character bigrams, in [0,1]. */
export function diceCoefficient(a: string, b: string): number {
  const x = normalizeKey(a).replace(/\s+/g, '');
  const y = normalizeKey(b).replace(/\s+/g, '');
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
