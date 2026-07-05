/**
 * Report document shell: the `<!doctype>` + `<style>` scaffold shared by every
 * enterprise PDF report. Owns the light print theme, A4 pagination, cover band,
 * KPI/mini cards, tables, warning boxes and the screen-only print toolbar.
 *
 * Pagination: CSS `counter(pages)` renders "0" in Chromium print, so each page
 * is an explicit section and the footer "Página N de TOTAL" is computed here at
 * build time — never "Página 0 de 0".
 */

import { esc } from './report-formatters';
import { C } from './report-theme';
import { FONT_FAMILY_SANS, buildGilroyFontFaceCss } from '@/lib/fonts';

export interface RenderReportDocumentInput {
  /** Document <title> and default download filename. */
  fileName: string;
  /** Brand label shown in the footer (e.g. "INSIGHT — Governança Corporativa"). */
  brand: string;
  /** Absolute/root-relative logo URL for the footer mark. */
  logoUrl: string;
  /** Footer context label (e.g. project / module name). */
  footerLabel: string;
  /** One entry per printed page (HTML body of that page). */
  pages: string[];
  /** Page size. Landscape for dense finance dashboards, portrait for lists. */
  orientation?: 'landscape' | 'portrait';
}

const REPORT_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: ${C.ink};
    font-size: 12px; line-height: 1.5; font-family: ${FONT_FAMILY_SANS};
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  .page { display: flex; flex-direction: column; min-height: 186mm; padding: 0 1mm; }
  .page-break { page-break-before: always; }
  .page-body { flex: 1 1 auto; }
  .pfoot { margin-top: auto; display: flex; justify-content: space-between; align-items: center;
    border-top: 1px solid ${C.border}; padding-top: 5px; font-size: 8.5px; color: ${C.subtle}; }
  .pf-brand { display: inline-flex; align-items: center; gap: 5px; }
  .pf-logo { height: 11px; width: auto; object-fit: contain; display: inline-block; }

  .section { margin: 0 0 12px; page-break-inside: avoid; }
  h2 { font-size: 14px; margin: 0; color: ${C.ink}; letter-spacing: .02em; }
  h3 { font-size: 10.5px; margin: 0 0 6px; color: ${C.muted}; text-transform: uppercase; letter-spacing: .08em; }
  .sec-head { display: flex; align-items: center; gap: 10px; margin: 0 0 10px; padding-bottom: 6px;
    border-bottom: 1px solid ${C.border}; }
  .sec-rule { width: 4px; height: 26px; border-radius: 99px;
    background: linear-gradient(180deg, ${C.brandOrange}, ${C.brandGreen}); }
  .sec-sub { margin: 1px 0 0; font-size: 9.5px; color: ${C.subtle}; }

  .mono { font-variant-numeric: tabular-nums; font-family: inherit; }
  .num { text-align: right; }
  .muted { color: ${C.subtle}; }
  .empty { color: ${C.subtle}; font-size: 11px; font-style: italic; padding: 6px 0; }
  .interp { font-size: 10.5px; color: ${C.body}; margin: 6px 0 0; max-width: 980px; }

  /* ── Cover band (glass-inspired, light) ── */
  .cover-band { position: relative; text-align: center; padding: 22px 28px 16px; margin-bottom: 14px;
    border: 1px solid ${C.border}; border-radius: 16px; overflow: hidden;
    background:
      radial-gradient(120% 140% at 0% 0%, ${C.brandOrange}14 0%, transparent 45%),
      radial-gradient(120% 140% at 100% 0%, ${C.brandGreen}14 0%, transparent 45%),
      linear-gradient(180deg, #FFFFFF 0%, #FAFCFB 100%); }
  .cover-band::after { content: ''; position: absolute; inset-inline: 0; bottom: 0; height: 3px;
    background: linear-gradient(90deg, ${C.brandOrange}, #F5C518, ${C.brandGreen}); }
  .cover-logo { height: 52px; max-width: 360px; object-fit: contain; margin: 0 auto 10px; display: block; }
  .cover-kicker { font-size: 9px; font-weight: 700; letter-spacing: .22em; text-transform: uppercase; color: ${C.subtle}; }
  .cover-title { font-size: 26px; font-weight: 800; margin: 6px 0 12px; color: ${C.ink}; letter-spacing: -0.01em; }
  .cover-proj { font-size: 13.5px; color: ${C.body}; }
  .cover-proj b { color: ${C.ink}; }
  .cover-proj .sep { margin: 0 7px; color: ${C.borderStrong}; }
  .status-chip { display: inline-block; margin-left: 10px; padding: 2px 10px; border: 1px solid; border-radius: 999px;
    font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .12em; vertical-align: 2px; }
  .cover-meta { display: flex; justify-content: center; flex-wrap: wrap; gap: 6px 22px; margin-top: 10px;
    font-size: 10px; color: ${C.muted}; }
  .cover-meta b { color: ${C.ink}; }
  .cover-note { margin-top: 9px; font-size: 8.5px; color: ${C.subtle}; }

  /* ── Executive summary ── */
  .exec { display: grid; grid-template-columns: 1.15fr 1fr; gap: 18px; align-items: start; }
  .narrative p { margin: 0 0 7px; font-size: 11.5px; color: ${C.body}; }
  table.summary { width: 100%; border-collapse: collapse; }
  table.summary td { padding: 4px 6px; border-bottom: 1px solid ${C.border}; font-size: 10.5px; }
  table.summary tr:nth-child(even) td { background: #FAFCFB; }
  table.summary td:last-child { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }

  /* ── KPI cards ── */
  .kpis { display: grid; gap: 8px; }
  .kpis.cols-2 { grid-template-columns: repeat(2, 1fr); }
  .kpis.cols-3 { grid-template-columns: repeat(3, 1fr); }
  .kpis.cols-4 { grid-template-columns: repeat(4, 1fr); }
  .kpis.cols-5 { grid-template-columns: repeat(5, 1fr); }
  .kpi { position: relative; display: flex; flex-direction: column; min-height: 64px;
    border: 1px solid ${C.border}; border-radius: 10px; padding: 9px 11px 8px;
    background: linear-gradient(180deg, #FFFFFF 0%, #FBFDFC 100%); overflow: hidden; page-break-inside: avoid;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04); }
  .kpi .bar { position: absolute; top: 0; left: 10%; right: 10%; height: 2px; }
  .kpi-l { font-size: 8px; text-transform: uppercase; letter-spacing: .1em; color: ${C.subtle}; font-weight: 700; }
  .kpi-v { font-size: 15.5px; font-weight: 800; margin-top: 3px; font-variant-numeric: tabular-nums; }
  .kpi-foot { margin-top: auto; display: flex; justify-content: space-between; align-items: center; gap: 4px; padding-top: 2px; }
  .kpi-h { font-size: 8.5px; color: ${C.subtle}; }

  /* ── Mini cards ── */
  .mini-cards { display: grid; gap: 8px; margin-bottom: 10px; }
  .mini-cards.cols-4 { grid-template-columns: repeat(4, 1fr); }
  .mini-cards.cols-5 { grid-template-columns: repeat(5, 1fr); }
  .mini-cards.cols-6 { grid-template-columns: repeat(6, 1fr); }
  .mini-cards.cols-8 { grid-template-columns: repeat(8, 1fr); }
  .mini-card { position: relative; border: 1px solid ${C.border}; border-radius: 10px; padding: 8px 10px; overflow: hidden;
    background: linear-gradient(180deg, #FFFFFF 0%, #FBFDFC 100%); box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04); }
  .mini-card .bar { position: absolute; top: 0; left: 10%; right: 10%; height: 2px; }
  .mc-l { font-size: 7.5px; text-transform: uppercase; letter-spacing: .09em; color: ${C.subtle}; font-weight: 700;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mc-v { font-size: 13.5px; font-weight: 800; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .mc-h { font-size: 8px; color: ${C.subtle}; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* ── Callout chips ── */
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border: 1px solid; border-radius: 999px; }
  .chip .dot { width: 6px; height: 6px; border-radius: 99px; }
  .chip-l { font-size: 8.5px; text-transform: uppercase; letter-spacing: .08em; color: ${C.muted}; }
  .chip-v { font-size: 10px; font-weight: 800; font-variant-numeric: tabular-nums; }

  /* ── Charts ── */
  .chart { border: 1px solid ${C.border}; border-radius: 12px; padding: 10px 12px 8px; background: #fff;
    page-break-inside: avoid; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04); margin-bottom: 10px; }
  .chart-title { font-size: 10.5px; font-weight: 800; color: ${C.body}; margin: 0 0 1px; }
  .chart-sub { font-size: 8.5px; color: ${C.subtle}; margin: 0 0 6px; }
  .legend { display: flex; flex-wrap: wrap; gap: 5px 14px; margin-top: 6px; justify-content: center; }
  .legend .lg { display: inline-flex; align-items: center; gap: 5px; font-size: 9px; color: ${C.muted}; }
  .legend .sw { width: 16px; height: 3px; border-radius: 2px; display: inline-block; }

  .two-col { display: grid; grid-template-columns: 1.05fr 1fr; gap: 16px; align-items: start; }

  /* ── Tables ── */
  table.data { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 4px; }
  table.data thead th { text-align: left; background: #F6F9F8; border-bottom: 1.5px solid ${C.borderStrong};
    padding: 5px 7px; font-size: 8.5px; text-transform: uppercase; letter-spacing: .06em; color: ${C.muted}; }
  table.data thead th.num { text-align: right; }
  table.data tbody td { padding: 4.5px 7px; border-bottom: 1px solid ${C.border}; }
  table.data tbody td.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.data tbody tr { page-break-inside: avoid; }
  table.data tbody tr:nth-child(even) { background: #FBFDFC; }
  table.data thead { display: table-header-group; }
  .pill { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 8.5px; font-weight: 700;
    background: #EEF2F6; color: ${C.muted}; }
  .pill.ok { background: #ECFDF5; color: ${C.success}; }
  .pill.warn { background: #FFFBEB; color: ${C.warning}; }
  .pill.crit { background: #FEF2F2; color: ${C.critical}; }
  .pill.info { background: #EFF6FF; color: ${C.info}; }

  .event-group { margin-bottom: 10px; page-break-inside: avoid; }
  .group-title { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; color: ${C.body};
    padding: 3px 0 3px 9px; border-left: 3px solid ${C.borderStrong}; }
  .group-title.crit { border-left-color: ${C.critical}; color: ${C.critical}; }
  .group-title.warn { border-left-color: ${C.warning}; color: ${C.warning}; }
  .group-title.ok { border-left-color: ${C.success}; color: ${C.success}; }

  /* ── Waterfall / result extras ── */
  .wf-head { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 8px; }
  .result-badge { display: flex; flex-direction: column; gap: 1px; border: 1px solid; border-radius: 12px;
    padding: 8px 14px; flex-shrink: 0; }
  .rb-l { font-size: 8px; text-transform: uppercase; letter-spacing: .1em; color: ${C.subtle}; font-weight: 700; }
  .rb-v { font-size: 18px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .rb-m { font-size: 9px; color: ${C.muted}; }

  /* ── Warning / summary boxes ── */
  .warn-box { margin-top: 10px; border: 1px solid ${C.warning}40; background: ${C.warning}0A;
    border-radius: 12px; padding: 10px 14px; page-break-inside: avoid; }
  .warn-box.ok { border-color: ${C.success}40; background: ${C.success}0A; }
  .warn-box.crit { border-color: ${C.critical}40; background: ${C.critical}0A; }
  .warn-box.info { border-color: ${C.info}40; background: ${C.info}0A; }
  .warn-title { font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; color: ${C.warning}; margin-bottom: 4px; }
  .warn-box.ok .warn-title { color: ${C.success}; }
  .warn-box.crit .warn-title { color: ${C.critical}; }
  .warn-box.info .warn-title { color: ${C.info}; }
  .warn-list { margin: 2px 0 0; padding-left: 16px; }
  .warn-list li { font-size: 10px; color: ${C.body}; margin-bottom: 3px; }

  /* ── Screen-only toolbar & preview ── */
  .toolbar { position: fixed; top: 12px; right: 12px; z-index: 20; background: ${C.ink}; color: #fff;
    padding: 8px 12px; border-radius: 10px; display: flex; gap: 8px; box-shadow: 0 6px 18px rgba(0,0,0,.18); }
  .toolbar button { background: ${C.brandGreen}; color: #fff; border: 0; border-radius: 6px; padding: 6px 12px;
    font-weight: 600; cursor: pointer; font-size: 11px; }
  .toolbar button.alt { background: transparent; border: 1px solid rgba(255,255,255,.25); }

  @media print { .no-print { display: none !important; } }
`;

const SCREEN_LANDSCAPE = `
  @media screen {
    body { background: #E9EEF2; }
    .page { background: #fff; width: 297mm; min-height: 190mm; margin: 16px auto; padding: 10mm 12mm 8mm;
      box-shadow: 0 2px 14px rgba(15, 23, 42, .14); border-radius: 4px; }
  }`;

const SCREEN_PORTRAIT = `
  @media screen {
    body { background: #E9EEF2; }
    .page { background: #fff; width: 210mm; min-height: 277mm; margin: 16px auto; padding: 12mm 14mm 10mm;
      box-shadow: 0 2px 14px rgba(15, 23, 42, .14); border-radius: 4px; }
  }`;

/** Wrap page bodies into a complete, print-ready HTML document. */
export function renderReportDocument(input: RenderReportDocumentInput): string {
  const { fileName, brand, logoUrl, footerLabel, pages } = input;
  const orientation = input.orientation ?? 'landscape';
  const pageRule = orientation === 'portrait'
    ? `@page { size: A4 portrait; margin: 12mm 14mm 10mm; }`
    : `@page { size: A4 landscape; margin: 10mm 12mm 8mm; }`;
  const screenRule = orientation === 'portrait' ? SCREEN_PORTRAIT : SCREEN_LANDSCAPE;
  const totalPages = Math.max(1, pages.length);

  const pagesHtml = pages
    .map((body, i) => `
  <div class="page${i > 0 ? ' page-break' : ''}">
    <div class="page-body">${body}</div>
    <div class="pfoot">
      <span class="pf-brand"><img class="pf-logo" src="${esc(logoUrl)}" alt="${esc(brand)}" /> · ${esc(footerLabel)} · Confidencial</span>
      <span>Página ${i + 1} de ${totalPages}</span>
    </div>
  </div>`)
    .join('');

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" />
<title>${esc(fileName)}</title>
<style>
${buildGilroyFontFaceCss()}
  ${pageRule}
${REPORT_CSS}
${screenRule}
</style></head>
<body>
  <div class="toolbar no-print">
    <button onclick="window.print()">Imprimir / Salvar PDF</button>
    <button class="alt" onclick="window.close()">Fechar</button>
  </div>
${pagesHtml}
  <script>
    document.title = ${JSON.stringify(fileName)};
  </script>
</body></html>`;
}
