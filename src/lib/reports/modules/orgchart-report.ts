/**
 * Organograma → board-ready PDF report on the shared engine.
 *
 * Consumes the SAME OrgMember[] the on-screen org chart renders. Wide trees are
 * exported as a clean reporting-lines summary table (avoids clipping; multi-page
 * safe), plus headcount-by-department and area-distribution charts.
 */

import type { OrgMember } from '@/lib/types';
import { esc, fmtInt } from '@/lib/reports/report-formatters';
import { C } from '@/lib/reports/report-theme';
import { svgHorizontalBar, svgDonut } from '@/lib/reports/report-charts';
import {
  reportCover, sectionTitle, kpiGrid, chartBlock, dataTable, dataQualityBox,
  type KpiCardSpec,
} from '@/lib/reports/report-blocks';
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
  const brand = payload.brandName ?? 'INSIGHT — Governança Corporativa';
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

  const cover = reportCover({
    meta,
    kicker: 'Relatório Executivo · Organograma',
    title: 'Estrutura Organizacional',
    context: `<b>${fmtInt(members.length)}</b> posições<span class="sep">·</span><b>${fmtInt(departments.length)}</b> áreas<span class="sep">·</span>${fmtInt(managers.length)} líderes`,
  });

  const kpiCards: KpiCardSpec[] = [
    { label: 'Headcount', value: fmtInt(members.length), color: C.primary },
    { label: 'Áreas / Departamentos', value: fmtInt(departments.length), color: C.info },
    { label: 'Líderes', value: fmtInt(managers.length), color: C.purple },
    { label: 'Posições em aberto', value: fmtInt(openPositions), color: openPositions ? C.warning : C.success, chip: openPositions ? { label: 'vagas', cls: 'warn' } : undefined },
    { label: 'Span of control', value: `${spanOfControl.toFixed(1)}`, color: C.cost, helper: 'reportes diretos / líder' },
  ];
  const kpis = `${sectionTitle('Indicadores da Estrutura')}${kpiGrid(kpiCards)}`;

  // ── Headcount by department + area distribution ──
  const byDept: Record<string, number> = {};
  members.forEach((m) => { byDept[m.department] = (byDept[m.department] || 0) + 1; });
  const deptRows = Object.entries(byDept).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  const deptBlock = chartBlock({
    title: 'Headcount por Departamento',
    svg: svgHorizontalBar(deptRows.slice(0, 10), { width: 520, fmtValue: fmtInt }),
  });
  const areaBlock = chartBlock({
    title: 'Distribuição por Área',
    svg: svgDonut(
      deptRows.slice(0, 8).map((d) => ({ label: d.label, value: d.value })),
      { width: 360, centerLabel: fmtInt(members.length), fmtValue: fmtInt },
    ),
  });
  const chartsSection = `${sectionTitle('Distribuição de Pessoas')}<div class="two-col">${deptBlock}${areaBlock}</div>`;

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
  const leaderSection = `${sectionTitle('Linhas de Reporte / Liderança', `${fmtInt(managers.length)} líderes`)}${managers.length ? leaderTable : '<p class="empty">Nenhuma liderança identificada.</p>'}`;

  // ── Org tree as summary table (avoids clipping for wide structures) ──
  const memberTable = dataTable(
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
  );
  const memberSection = `${sectionTitle('Estrutura Completa', `${fmtInt(members.length)} posições · agrupadas por departamento`)}${members.length ? memberTable : '<p class="empty">Nenhuma posição cadastrada.</p>'}`;

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
  const seen = new Set<string>();
  const treeHtml = roots
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => `<div class="event-group">${renderNode(r, 0, seen)}</div>`)
    .join('');
  // Orphans (manager missing) rendered at the end so nobody is dropped.
  const orphanHtml = members.filter((m) => !seen.has(m.id)).map((m) => renderNode(m, 0, seen)).join('');
  const treeSection = `${sectionTitle('Linhas Hierárquicas', 'estrutura top-down · seguro para múltiplas páginas')}${members.length ? treeHtml + orphanHtml : '<p class="empty">Sem hierarquia para exibir.</p>'}`;

  // ── Data quality ──
  const issues: string[] = [];
  if (!members.length) issues.push('Nenhuma posição na estrutura selecionada.');
  const orphans = members.filter((m) => m.managerId && !byId.has(m.managerId)).length;
  if (orphans) issues.push(`${fmtInt(orphans)} posição(ões) com gestor inexistente na base.`);
  const tops = members.filter((m) => !m.managerId).length;
  if (tops > 1) issues.push(`${fmtInt(tops)} posições sem gestor (múltiplos topos de hierarquia).`);
  const dqSection = `${sectionTitle('Qualidade dos Dados')}${dataQualityBox(issues)}`;

  const page1 = `<section class="section">${cover}</section><section class="section">${kpis}</section><section class="section">${chartsSection}</section>`;
  const page2 = `<section class="section">${leaderSection}</section>`;
  const page3 = `<section class="section">${treeSection}</section>`;
  const page4 = `<section class="section">${memberSection}</section><section class="section">${dqSection}</section>`;

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: 'Organograma',
    pages: [page1, page2, page3, page4],
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
