/**
 * Build-time page composer for the report engine.
 *
 * The shell keeps the explicit `pages: string[]` model (Chromium renders CSS
 * `counter(pages)` as "0", so "Página N de TOTAL" must be computed at build
 * time). Builders used to hand-pack sections into pages, which produced
 * half-empty pages and, when a section grew, silent overflow that desynced the
 * footer numbering. `composePages` replaces the hand packing: builders emit a
 * flat list of measured blocks and the composer bins them into pages.
 *
 * Heights are estimates (all report CSS uses fixed px sizes and SVG charts
 * have fixed viewBox heights, so estimates are deterministic). A safety margin
 * per page plus `page-break-inside: avoid` on every block absorbs the error.
 */

export interface ReportBlock {
  /** Rendered HTML of the block. */
  html: string;
  /** Estimated printed height in mm. */
  estMm: number;
  /**
   * Chapter start: forces a new page — but only when the current page is
   * already filled beyond `minFillForBreak` (sparse chapters merge onto the
   * previous page instead of creating a near-empty one).
   */
  breakBefore?: boolean;
  /** Never leave this block orphaned at the bottom of a page (section titles). */
  keepWithNext?: boolean;
}

export interface ComposeOptions {
  orientation?: 'landscape' | 'portrait';
  /** 0..1 — minimum page fill for `breakBefore` to actually break. Default 0.4. */
  minFillForBreak?: number;
}

/**
 * Usable page-body height (A4 minus @page margins, footer and a safety
 * margin). Deliberately conservative: a slightly under-filled page beats a
 * silent overflow that breaks the page numbering.
 */
export const USABLE_MM = { landscape: 180, portrait: 262 } as const;

const PX_PER_MM = 96 / 25.4; // ≈ 3.78 CSS px per mm

export function pxToMm(px: number): number {
  return px / PX_PER_MM;
}

/** Pack measured blocks into pages (first-fit, sequential — order preserved). */
export function composePages(blocks: ReportBlock[], opts?: ComposeOptions): string[] {
  const usable = USABLE_MM[opts?.orientation ?? 'landscape'];
  const minFill = (opts?.minFillForBreak ?? 0.4) * usable;

  // Chain keepWithNext blocks to their successor so titles never orphan.
  const groups: ReportBlock[][] = [];
  let chain: ReportBlock[] = [];
  for (const b of blocks) {
    if (!b.html) continue;
    chain.push(b);
    if (!b.keepWithNext) {
      groups.push(chain);
      chain = [];
    }
  }
  if (chain.length) groups.push(chain);

  const pages: string[] = [];
  let cur: string[] = [];
  let used = 0;
  const flush = () => {
    if (cur.length) pages.push(cur.join(''));
    cur = [];
    used = 0;
  };

  for (const group of groups) {
    const h = group.reduce((s, b) => s + b.estMm, 0);
    if (group[0].breakBefore && used > minFill) flush();
    if (cur.length && used + h > usable) flush();
    cur.push(...group.map((b) => b.html));
    used += h;
    // A group taller than one page keeps its own page; estimators must
    // pre-chunk anything that can outgrow A4 (see dataTableChunked).
  }
  flush();

  return pages.length ? pages : [''];
}

/** Convenience creator. */
export function block(html: string, estMm: number, opts?: Pick<ReportBlock, 'breakBefore' | 'keepWithNext'>): ReportBlock {
  return { html, estMm, ...opts };
}

/* ── Height estimators (mm) for the shared shell components ──
 * Calibrated against headless-Chrome measurements of the rendered shell CSS
 * (see scripts/preview-reports.ts). Estimates lean slightly high on purpose:
 * a marginally under-filled page beats an overflow that desyncs numbering. */

/** `sectionTitle()` head: rule + title (+subtitle) + margins. */
export function mmForSectionTitle(hasSubtitle = false): number {
  return hasSubtitle ? 13 : 12;
}

/** `reportCover()` band (logo + title + meta, optionally the KPI strip). */
export function mmForCover(hasCoverKpis = false): number {
  return hasCoverKpis ? 76 : 58;
}

/** `table.data`: header + body rows (~6.3mm each with pills/wrapping) + margin. */
export function mmForTable(rowCount: number, opts?: { rowMm?: number }): number {
  if (rowCount <= 0) return 8; // "Sem dados" empty line
  return 10 + rowCount * (opts?.rowMm ?? 6.3);
}

/** `kpiGrid`: rows of min-height cards + gaps. */
export function mmForKpiGrid(cardCount: number, cols: number): number {
  const rows = Math.ceil(cardCount / Math.max(1, cols));
  return rows * 18.7 + (rows - 1) * 2.2 + 1;
}

/** `mini-cards` strip. */
export function mmForMiniCards(cardCount: number, cols: number): number {
  const rows = Math.ceil(cardCount / Math.max(1, cols));
  return rows * 14 + (rows - 1) * 2.2 + 2.6;
}

/** Rendered content width (px) of one column in the page grid. */
function columnContentPx(cols: 1 | 2 | 3, orientation: 'landscape' | 'portrait'): number {
  const pagePx = orientation === 'portrait' ? 688 : 1032; // A4 minus @page margins
  const gap = 14;
  // minus chart-panel padding (10px×2) + 1px borders
  return (pagePx - (cols - 1) * gap) / cols - 22;
}

/**
 * `chartBlock`: panel chrome + optional title/sub + rendered SVG height.
 * SVGs render at `width:100%`, so the printed height is the viewBox height
 * scaled by (column width / viewBox width) — pass `svgWidthPx` for charts
 * whose design width differs from the column they are placed in.
 */
export function mmForChart(
  svgHeightPx: number,
  opts?: { svgWidthPx?: number; cols?: 1 | 2 | 3; orientation?: 'landscape' | 'portrait'; title?: boolean; legend?: boolean; tableRows?: number },
): number {
  const colPx = columnContentPx(opts?.cols ?? 1, opts?.orientation ?? 'landscape');
  const scale = opts?.svgWidthPx ? colPx / opts.svgWidthPx : 1;
  let mm = pxToMm(svgHeightPx * scale) + 8;
  if (opts?.title) mm += 7;
  if (opts?.legend) mm += 5;
  if (opts?.tableRows) mm += mmForTable(opts.tableRows);
  return mm;
}

/** `warningBox` / `dataQualityBox`: title + bullet lines. */
export function mmForWarningBox(itemCount: number): number {
  return 11 + Math.max(1, itemCount) * 4.4;
}

/** `summaryBox` narrative paragraphs (~95 chars per printed line). */
export function mmForSummary(paragraphs: string[]): number {
  const lines = paragraphs.reduce((s, p) => s + Math.max(1, Math.ceil(p.length / 95)), 0);
  return lines * 4.6 + paragraphs.length * 2.5;
}

/** Two/three-column grid: height of the tallest column. */
export function mmForColumns(...columnHeights: number[]): number {
  return Math.max(0, ...columnHeights);
}
