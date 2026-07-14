/**
 * Executive insight cards — factual statements derived by each module builder
 * from its own report payload. Kinds are visually distinguished so a reader
 * never confuses a fact with a recommendation:
 *
 *   fact            → blue    (neutral portfolio observation)
 *   alert           → red     (needs attention now)
 *   recommendation  → green   (management action supported by the data)
 *   data-quality    → amber   (gap in the underlying data)
 *
 * Derivation stays inside each builder and must be threshold-based and factual
 * — never speculative.
 */

import { esc } from './report-formatters';
import { KIND_COLORS } from './report-theme';

export type InsightKind = 'fact' | 'alert' | 'recommendation' | 'data-quality';

export interface InsightItem {
  kind: InsightKind;
  title: string;
  detail: string;
  /** Optional headline metric rendered big on the right of the card. */
  value?: string;
}

const KIND_LABEL: Record<InsightKind, string> = {
  fact: 'Fato',
  alert: 'Alerta',
  recommendation: 'Recomendação',
  'data-quality': 'Qualidade de dados',
};

function insightCard(item: InsightItem): string {
  const color = KIND_COLORS[item.kind];
  const value = item.value
    ? `<div class="ins-v" style="color:${color}">${esc(item.value)}</div>`
    : '';
  return `<div class="insight-card" style="border-left-color:${color}">` +
    `<div class="ins-main">` +
    `<span class="ins-kind" style="color:${color};background:${color}12;border-color:${color}30">${esc(KIND_LABEL[item.kind])}</span>` +
    `<div class="ins-t">${esc(item.title)}</div>` +
    `<div class="ins-d">${esc(item.detail)}</div>` +
    `</div>${value}</div>`;
}

/** Grid of insight cards (defaults to 2 columns). */
export function insightPanel(items: InsightItem[], opts?: { cols?: 2 | 3 }): string {
  if (!items.length) return '';
  const cols = opts?.cols ?? 2;
  return `<div class="insights cols-${cols}">${items.map(insightCard).join('')}</div>`;
}

/** Height estimator for composePages (mm) — calibrated vs headless render. */
export function mmForInsightPanel(itemCount: number, cols: 2 | 3 = 2): number {
  const rows = Math.ceil(itemCount / cols);
  return rows * 17.5 + (rows - 1) * 2.2;
}
