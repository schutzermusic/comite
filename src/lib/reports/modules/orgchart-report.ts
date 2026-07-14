/**
 * Organograma → board-ready PDF report on the shared engine.
 *
 * Consumes the SAME OrgMember[] the on-screen org chart renders. Wide trees are
 * exported as a clean reporting-lines summary table (avoids clipping; multi-page
 * safe), plus headcount-by-department and area-distribution charts.
 */

import type { OrgMember } from '@/lib/types';
import { esc, fmtInt } from '@/lib/reports/report-formatters';
import { C, REPORT_BRAND_NAME } from '@/lib/reports/report-theme';
import { svgHorizontalBar, svgDonut, svgBullet } from '@/lib/reports/report-charts';
import {
  reportCover, sectionTitle, kpiGrid, chartBlock, dataTable, dataTableChunked,
  dataQualityBox, type KpiCardSpec,
} from '@/lib/reports/report-blocks';
import {
  composePages, block, mmForChart, mmForColumns, mmForCover, mmForKpiGrid,
  mmForSectionTitle, mmForTable, mmForWarningBox, type ReportBlock,
} from '@/lib/reports/report-compose';
import { insightPanel, mmForInsightPanel, type InsightItem } from '@/lib/reports/report-insights';
import { renderReportDocument } from '@/lib/reports/report-shell';
import { openReport, buildReportMeta, buildReportFileName } from '@/lib/reports/report-export';
import type { ReportExportResult } from '@/lib/reports/report-types';

export interface OrgChartReportPayload {
  members: OrgMember[];
  brandName?: string;
  filtersLabel?: string;
  source?: string;
  generatedBy?: string;
}

const isOpenPosition = (m: OrgMember) => /\bvaga\b/i.test(m.name);

export function buildOrgChartReportHtml(payload: OrgChartReportPayload): string {
  const members = payload.members ?? [];
  const brand = payload.brandName ?? REPORT_BRAND_NAME;
  const fileName = buildReportFileName({ module: 'organograma' });
  const meta = buildReportMeta({
    brand,
    filtersLabel: payload.filtersLabel,
    source: payload.source,
    generatedBy: payload.generatedBy,
  });

  const byId = new Map(members.map((m) => [m.id, m]));
  const reportsByManager = new Map<string, OrgMember[]>();
  members.forEach((m) => {
    if (m.managerId) {
      const list = reportsByManager.get(m.managerId) ?? [];
      list.push(m);
      reportsByManager.set(m.managerId, list);
    }
  });
  const managers = members.filter((m) => reportsByManager.has(m.id));
  const departments = Array.from(new Set(members.map((m) => m.department)));
  const openPositions = members.filter(isOpenPosition).length;
  const spanOfControl = managers.length
    ? Math.round((members.filter((m) => m.managerId).length / managers.length) * 10) / 10
    : 0;

  const blocks: ReportBlock[] = [];
  blocks.push(block(reportCover({
    meta,
    kicker: 'Relatório Executivo · Organograma',
    title: 'Estrutura Organizacional',
    context: `<b>${fmtInt(members.length)}</b> posições<span class="sep">·</span><b>${fmtInt(departments.length)}</b> áreas<span class="sep">·</span>${fmtInt(managers.length)} líderes`,
    coverKpis: [
      { label: 'Headcount', value: fmtInt(members.length) },
      { label: 'Áreas', value: fmtInt(departments.length) },
      { label: 'Líderes', value: fmtInt(managers.length) },
      { label: 'Vagas abertas', value: fmtInt(openPositions) },
    ],
  }), mmForCover(true)));

  const kpiCards: KpiCardSpec[] = [
    { label: 'Headcount', value: fmtInt(members.length), color: C.primary },
    { label: 'Áreas / Departamentos', value: fmtInt(departments.length), color: C.info },
    { label: 'Líderes', value: fmtInt(managers.length), color: C.purple },
    { label: 'Posições em aberto', value: fmtInt(openPositions), color: openPositions ? C.warning : C.success, chip: openPositions ? { label: 'vagas', cls: 'warn' } : undefined },
    { label: 'Span of control', value: `${spanOfControl.toFixed(1)}`, color: C.cost, helper: 'reportes diretos / líder' },
  ];
  blocks.push(block(sectionTitle('Indicadores da Estrutura', undefined, 1), mmForSectionTitle(), { keepWithNext: true }));
  blocks.push(block(kpiGrid(kpiCards, 5), mmForKpiGrid(kpiCards.length, 5)));

  // ── Headcount by department + area distribution ──
  const byDept: Record<string, number> = {};
  members.forEach((m) => { byDept[m.department] = (byDept[m.department] || 0) + 1; });
  const deptRows = Object.entries(byDept).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  const deptBlock = chartBlock({
    title: 'Headcount por Departamento',
    svg: svgHorizontalBar(deptRows.slice(0, 10), { width: 490, fmtValue: fmtInt }),
  });
  const areaBlock = chartBlock({
    title: 'Distribuição por Área',
    svg: svgDonut(
      deptRows.slice(0, 8).map((d) => ({ label: d.label, value: d.value })),
      { width: 490, height: 150, centerLabel: fmtInt(members.length), fmtValue: fmtInt },
    ),
  });
  blocks.push(block(
    `<div class="two-col">${deptBlock}${areaBlock}</div>`,
    mmForColumns(
      mmForChart(Math.min(deptRows.length, 10) * 26 + 8, { svgWidthPx: 490, cols: 2, title: true }),
      mmForChart(150, { svgWidthPx: 490, cols: 2, title: true }),
    ),
  ));

  // ── Leadership / reporting lines ──
  const leaderTable = dataTable(
    [
      { key: 'lider', label: 'Líder' },
      { key: 'role', label: 'Cargo' },
      { key: 'dept', label: 'Departamento' },
      { key: 'reports', label: 'Reportes diretos', num: true },
    ],
    [...managers]
      .map((m) => ({ m, count: reportsByManager.get(m.id)?.length ?? 0 }))
      .sort((a, b) => b.count - a.count)
      .map(({ m, count }) => ({
        lider: m.name,
        role: m.role,
        dept: m.department,
        reports: { html: `<span class="mono">${fmtInt(count)}</span>` },
      })),
  );
  // Span-of-control bullet: direct reports per leader vs the org average.
  const topLeaders = [...managers]
    .map((m) => ({ m, count: reportsByManager.get(m.id)?.length ?? 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const spanBlock = chartBlock({
    title: 'Span of Control por Líder',
    sub: `marcador = média da organização (${spanOfControl.toFixed(1)})`,
    svg: svgBullet(
      topLeaders.map(({ m, count }) => ({ label: m.name, value: count, target: spanOfControl, color: C.purple })),
      { width: 1000, fmtValue: (n) => fmtInt(n), labelW: 190 },
    ),
  });
  blocks.push(block(sectionTitle('Liderança & Amplitude de Gestão', `${fmtInt(managers.length)} líderes`, 2), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));
  blocks.push(block(spanBlock, mmForChart(topLeaders.length * 26 + 8, { svgWidthPx: 1000, title: true })));
  blocks.push(block(managers.length ? leaderTable : '<p class="empty">Nenhuma liderança identificada.</p>', managers.length ? mmForTable(managers.length, { rowMm: 5 }) : 8));

  // ── Insights ──
  const insights: InsightItem[] = [];
  if (deptRows[0] && members.length) {
    insights.push({ kind: 'fact', title: 'Maior área', detail: `${deptRows[0].label} concentra ${Math.round((deptRows[0].value / members.length) * 100)}% do headcount (${fmtInt(deptRows[0].value)} posições).`, value: fmtInt(deptRows[0].value) });
  }
  if (topLeaders[0] && topLeaders[0].count > spanOfControl * 1.8) {
    insights.push({ kind: 'alert', title: 'Amplitude de gestão elevada', detail: `${topLeaders[0].m.name} tem ${fmtInt(topLeaders[0].count)} reportes diretos — quase o dobro da média (${spanOfControl.toFixed(1)}).` });
  }
  if (openPositions) {
    insights.push({ kind: 'recommendation', title: 'Vagas em aberto', detail: `${fmtInt(openPositions)} posição(ões) em aberto na estrutura — priorizar recrutamento.`, value: fmtInt(openPositions) });
  }
  if (insights.length) blocks.push(block(insightPanel(insights.slice(0, 4), { cols: 2 }), mmForInsightPanel(Math.min(insights.length, 4), 2)));


  // ── Graphical hierarchy (vertical indented tree — multi-page safe, no clipping) ──
  const roots = members.filter((m) => !m.managerId || !byId.has(m.managerId));
  const renderNode = (m: OrgMember, depth: number, seen: Set<string>): string => {
    if (seen.has(m.id)) return '';
    seen.add(m.id);
    const reports = (reportsByManager.get(m.id) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
    const accent = isOpenPosition(m) ? C.warning : depth === 0 ? C.brandGreen : depth === 1 ? C.primary : C.subtle;
    const node = `<div style="margin:3px 0 3px ${depth * 18}px;padding:4px 9px;border-left:3px solid ${accent};background:#FBFDFC;border-radius:0 6px 6px 0;page-break-inside:avoid">`
      + `<span style="font-size:10.5px;font-weight:700;color:${C.ink}">${esc(m.name)}</span>`
      + `<span style="font-size:9px;color:${C.subtle}"> · ${esc(m.role)} · ${esc(m.department)}</span>`
      + (reports.length ? `<span style="font-size:8px;color:${C.muted}"> (${reports.length})</span>` : '')
      + (isOpenPosition(m) ? ` <span class="pill warn">vaga</span>` : '')
      + `</div>`;
    return node + reports.map((r) => renderNode(r, depth + 1, seen)).join('');
  };
  blocks.push(block(sectionTitle('Linhas Hierárquicas', 'estrutura top-down · seguro para múltiplas páginas', 3), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));
  if (members.length) {
    // Each printed node is ~8mm. A whole root group can exceed one page, so
    // emit the root node alone and then one measured block per direct-report
    // sub-tree — the packer breaks cleanly between sub-trees.
    const NODE_MM = 8;
    const seen = new Set<string>();
    [...roots]
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((r) => {
        if (seen.has(r.id)) return;
        seen.add(r.id);
        const directs = (reportsByManager.get(r.id) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
        const rootHtml = `<div style="margin:3px 0;padding:4px 9px;border-left:3px solid ${C.brandGreen};background:#FBFDFC;border-radius:0 6px 6px 0;page-break-inside:avoid">`
          + `<span style="font-size:10.5px;font-weight:700;color:${C.ink}">${esc(r.name)}</span>`
          + `<span style="font-size:9px;color:${C.subtle}"> · ${esc(r.role)} · ${esc(r.department)}</span>`
          + (directs.length ? `<span style="font-size:8px;color:${C.muted}"> (${directs.length})</span>` : '')
          + `</div>`;
        blocks.push(block(rootHtml, NODE_MM, { keepWithNext: directs.length > 0 }));
        directs.forEach((d) => {
          const before = seen.size;
          const html = renderNode(d, 1, seen);
          if (html) blocks.push(block(`<div class="event-group">${html}</div>`, Math.max(1, seen.size - before) * NODE_MM));
        });
      });
    // Orphans (manager missing) rendered at the end so nobody is dropped.
    const orphanBefore = seen.size;
    const orphanHtml = members.filter((m) => !seen.has(m.id)).map((m) => renderNode(m, 0, seen)).join('');
    if (orphanHtml) blocks.push(block(orphanHtml, Math.max(1, seen.size - orphanBefore) * NODE_MM));
  } else {
    blocks.push(block('<p class="empty">Sem hierarquia para exibir.</p>', 8));
  }

  blocks.push(block(sectionTitle('Estrutura Completa', `${fmtInt(members.length)} posições · agrupadas por departamento`, 4), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));
  if (members.length) {
    blocks.push(...dataTableChunked(
      [
        { key: 'nome', label: 'Nome' },
        { key: 'role', label: 'Cargo' },
        { key: 'dept', label: 'Departamento' },
        { key: 'manager', label: 'Reporta a' },
        { key: 'status', label: 'Situação' },
      ],
      [...members]
        .sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name))
        .map((m) => ({
          nome: m.name,
          role: m.role,
          dept: m.department,
          manager: m.managerId ? (byId.get(m.managerId)?.name ?? '—') : '— (topo)',
          status: { html: isOpenPosition(m) ? '<span class="pill warn">vaga</span>' : '<span class="pill ok">ocupada</span>' },
        })),
      { rowsPerChunk: 26, rowMm: 5.6 },
    ));
  } else {
    blocks.push(block('<p class="empty">Nenhuma posição cadastrada.</p>', 8));
  }

  // ── Data quality ──
  const issues: string[] = [];
  if (!members.length) issues.push('Nenhuma posição na estrutura selecionada.');
  const orphans = members.filter((m) => m.managerId && !byId.has(m.managerId)).length;
  if (orphans) issues.push(`${fmtInt(orphans)} posição(ões) com gestor inexistente na base.`);
  const tops = members.filter((m) => !m.managerId).length;
  if (tops > 1) issues.push(`${fmtInt(tops)} posições sem gestor (múltiplos topos de hierarquia).`);
  blocks.push(block(sectionTitle('Qualidade dos Dados'), mmForSectionTitle(), { keepWithNext: true }));
  blocks.push(block(dataQualityBox(issues), mmForWarningBox(Math.max(1, issues.length))));

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: 'Organograma',
    pages: composePages(blocks, { orientation: 'landscape' }),
    orientation: 'landscape',
  });
}

export function openOrgChartReport(payload: OrgChartReportPayload): ReportExportResult {
  try {
    return openReport(buildOrgChartReportHtml(payload), { width: 1280, height: 860 });
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : 'Falha ao gerar o relatório.' };
  }
}
