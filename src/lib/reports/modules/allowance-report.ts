/**
 * Pessoas & Custos · Diárias de Campo → board-ready PDF report.
 *
 * Consome o estado da semana em tela (semana + diárias + inteligência) e
 * produz um relatório executivo com capa (logo Insight), KPIs, custo por
 * projeto (gráfico + tabela), alertas de inconsistência ("requer análise",
 * nunca fraude — ADR-006) e a relação de diárias por colaborador.
 * Valores monetários chegam em centavos.
 */
import type { AllowanceWeek, DailyAllowance } from '@/lib/types/allowances';
import {
  ALLOWANCE_WEEK_STATUS_LABELS,
  classifyReason,
  type EligibilityReason,
} from '@/lib/types/allowances';
import type { AllowanceAlert, AlertSeverity } from '@/lib/services/allowance-intelligence';
import { BRL, compactBRL, esc, fmtInt, fmtDate } from '@/lib/reports/report-formatters';
import { C, REPORT_BRAND_NAME } from '@/lib/reports/report-theme';
import { svgHorizontalBar } from '@/lib/reports/report-charts';
import {
  reportCover, sectionTitle, kpiGrid, chartBlock, dataTable, warningBox, summaryBox,
  type KpiCardSpec,
} from '@/lib/reports/report-blocks';
import {
  composePages, block, mmForChart, mmForColumns, mmForCover, mmForKpiGrid,
  mmForSectionTitle, mmForSummary, mmForTable, mmForWarningBox, type ReportBlock,
} from '@/lib/reports/report-compose';
import { renderReportDocument } from '@/lib/reports/report-shell';
import { openReport, buildReportMeta, buildReportFileName } from '@/lib/reports/report-export';
import type { ReportExportResult } from '@/lib/reports/report-types';

export interface AllowanceCostRow {
  projectId: string;
  amountCents: number;
  people: number;
  items: number;
}

export interface AllowanceReportPayload {
  week: AllowanceWeek;
  items: DailyAllowance[];
  projectNames: Record<string, string>;
  alerts?: AllowanceAlert[];
  costByProject?: AllowanceCostRow[];
  previous?: { totalCents: number; people: number } | null;
  brandName?: string;
  source?: string;
  generatedBy?: string;
}

const COUNTED = ['planned', 'approved', 'included_in_batch', 'paid', 'confirmed', 'divergent'];
const cents = (n: number) => n / 100;

const ALERT_TONE: Record<AlertSeverity, 'crit' | 'warn' | 'info'> = {
  critical: 'crit',
  warning: 'warn',
  info: 'info',
};

function fmtWeek(week: AllowanceWeek): string {
  return `${fmtDate(week.weekStart)} – ${fmtDate(week.weekEnd)}`;
}

export function buildAllowanceReportHtml(payload: AllowanceReportPayload): string {
  const { week, items, projectNames } = payload;
  const brand = payload.brandName ?? REPORT_BRAND_NAME;
  const proj = (id: string) => projectNames[id] ?? id;
  const fileName = buildReportFileName({ module: 'pessoas-custos', context: `diarias-${week.weekStart}` });

  const meta = buildReportMeta({
    brand,
    periodLabel: `Semana ${fmtWeek(week)}`,
    filtersLabel: `Status: ${ALLOWANCE_WEEK_STATUS_LABELS[week.status]}${week.simulationMode ? ' · simulação' : ''}`,
    source: payload.source ?? 'Supabase',
    generatedBy: payload.generatedBy,
  });

  // ── agregações a partir das diárias ──
  const counted = items.filter((d) => COUNTED.includes(d.status));
  const klassOf = (d: DailyAllowance) =>
    classifyReason((d.eligibilityReason ?? 'planned_eligible') as EligibilityReason);

  const eligible = counted.filter((d) => klassOf(d) === 'eligible');
  const review = items.filter((d) => klassOf(d) === 'review').length;
  const blocked = items.filter((d) => d.status === 'blocked').length;
  const confirmed = items.filter((d) => d.status === 'confirmed').length;
  const divergent = items.filter((d) => d.status === 'divergent').length;
  const totalCents = eligible.reduce((s, d) => s + d.amountCents, 0);
  const people = new Set(counted.map((d) => d.personId)).size;

  // custo por projeto (usa o payload quando disponível; senão deriva)
  const costRows: AllowanceCostRow[] =
    payload.costByProject && payload.costByProject.length > 0
      ? payload.costByProject
      : Object.values(
          counted.reduce<Record<string, AllowanceCostRow>>((acc, d) => {
            const r = (acc[d.projectId] ??= { projectId: d.projectId, amountCents: 0, people: 0, items: 0 });
            r.amountCents += d.amountCents;
            r.items += 1;
            return acc;
          }, {}),
        )
          .map((r) => ({
            ...r,
            people: new Set(counted.filter((d) => d.projectId === r.projectId).map((d) => d.personId)).size,
          }))
          .sort((a, b) => b.amountCents - a.amountCents);

  const prevGrowth =
    payload.previous && payload.previous.totalCents > 0
      ? ((totalCents - payload.previous.totalCents) / payload.previous.totalCents) * 100
      : null;

  const blocks: ReportBlock[] = [];

  // ── capa ──
  blocks.push(block(reportCover({
    meta,
    kicker: 'Relatório de Diárias de Alimentação · Pessoas & Custos',
    title: 'Diárias de Alimentação',
    context: `Semana <b>${esc(fmtWeek(week))}</b><span class="sep">·</span>previstas <b>${esc(fmtInt(eligible.length))}</b><span class="sep">·</span>valor <b>${esc(compactBRL(cents(totalCents)))}</b>`,
    statusChip: {
      label: ALLOWANCE_WEEK_STATUS_LABELS[week.status],
      color: week.status === 'closed' || week.status === 'finance_approved' ? C.success : week.status === 'cancelled' ? C.critical : C.info,
    },
    coverKpis: [
      { label: 'Colaboradores', value: fmtInt(people) },
      { label: 'Diárias previstas', value: fmtInt(eligible.length) },
      { label: 'Valor previsto', value: compactBRL(cents(totalCents)) },
      { label: 'Bloqueadas', value: fmtInt(blocked) },
    ],
  }), mmForCover(true)));

  // ── KPIs ──
  const kpiCards: KpiCardSpec[] = [
    { label: 'Diárias previstas', value: fmtInt(eligible.length), color: C.primary },
    { label: 'Valor previsto', value: BRL(cents(totalCents)), color: C.cost, helper: prevGrowth != null ? `${prevGrowth >= 0 ? '+' : ''}${prevGrowth.toFixed(0)}% vs. semana ant.` : undefined },
    { label: 'Aguardando revisão', value: fmtInt(review), color: C.warning },
    { label: 'Bloqueadas', value: fmtInt(blocked), color: C.critical },
    { label: 'Confirmadas', value: fmtInt(confirmed), color: C.success },
    { label: 'Divergentes', value: fmtInt(divergent), color: divergent > 0 ? C.critical : C.subtle },
  ];
  blocks.push(block(sectionTitle('Indicadores da Semana', undefined, 1), mmForSectionTitle(true), { keepWithNext: true }));
  blocks.push(block(kpiGrid(kpiCards, 3), mmForKpiGrid(kpiCards.length, 3)));

  // ── custo por projeto (gráfico + tabela) ──
  if (costRows.length > 0) {
    const chart = chartBlock({
      title: 'Custo por projeto',
      svg: svgHorizontalBar(
        costRows.slice(0, 8).map((r) => ({ label: proj(r.projectId), value: cents(r.amountCents) })),
        { width: 490, fmtValue: compactBRL },
      ),
    });
    const table = dataTable(
      [
        { key: 'proj', label: 'Projeto' },
        { key: 'people', label: 'Colab.', num: true },
        { key: 'items', label: 'Diárias', num: true },
        { key: 'cost', label: 'Custo', num: true },
      ],
      costRows.map((r) => ({
        proj: proj(r.projectId),
        people: { html: `<span class="mono">${fmtInt(r.people)}</span>` },
        items: { html: `<span class="mono">${fmtInt(r.items)}</span>` },
        cost: { html: `<span class="mono">${esc(BRL(cents(r.amountCents)))}</span>` },
      })),
    );
    blocks.push(block(sectionTitle('Apropriação de Custo por Projeto'), mmForSectionTitle(), { keepWithNext: true }));
    blocks.push(block(
      `<div class="two-col">${chart}<div>${table}</div></div>`,
      mmForColumns(
        mmForChart(Math.min(costRows.length, 8) * 26 + 8, { svgWidthPx: 490, cols: 2, title: true }),
        mmForTable(costRows.length, { rowMm: 5 }),
      ),
    ));
  }

  // ── alertas de inconsistência ──
  blocks.push(block(sectionTitle('Alertas de Inconsistência', 'sinais para análise — nunca acusação de fraude', 2), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));
  const alerts = payload.alerts ?? [];
  if (alerts.length === 0) {
    const okParas = ['Nenhuma inconsistência detectada: a semana está consistente com alocação, escala e ausências conhecidas.'];
    blocks.push(block(summaryBox(okParas), mmForSummary(okParas)));
  } else {
    for (const a of alerts) {
      const lines = [a.detail + (a.projectId ? ` (projeto: ${proj(a.projectId)})` : '')];
      blocks.push(block(warningBox(a.title, lines, ALERT_TONE[a.severity]), mmForWarningBox(lines.length)));
    }
  }

  // ── diárias por colaborador ──
  type Agg = {
    name: string;
    projectId: string;
    days: number;
    cents: number;
    klass: string;
    /** faixa de valor aplicada pelo motor (função do colaborador) */
    tier: string;
  };
  const byPerson = new Map<string, Agg>();
  for (const d of counted) {
    const agg = byPerson.get(d.personId) ?? {
      name: d.person?.fullName ?? d.personId,
      projectId: d.projectId,
      days: 0,
      cents: 0,
      klass: 'eligible',
      tier: d.tierLabel ?? 'Base',
    };
    agg.days += 1;
    agg.cents += d.amountCents;
    if (d.status === 'divergent') agg.klass = 'divergent';
    byPerson.set(d.personId, agg);
  }
  const personRows = Array.from(byPerson.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  blocks.push(block(sectionTitle('Diárias por Colaborador', `${fmtInt(personRows.length)} colaborador(es) na semana`, 3), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));
  blocks.push(block(
    personRows.length
      ? dataTable(
          [
            { key: 'name', label: 'Colaborador' },
            { key: 'proj', label: 'Projeto' },
            { key: 'tier', label: 'Faixa' },
            { key: 'days', label: 'Diárias', num: true },
            { key: 'value', label: 'Valor', num: true },
            { key: 'status', label: 'Situação' },
          ],
          personRows.map((r) => ({
            name: r.name,
            proj: proj(r.projectId),
            tier: r.tier,
            days: { html: `<span class="mono">${fmtInt(r.days)}</span>` },
            value: { html: `<span class="mono">${esc(BRL(cents(r.cents)))}</span>` },
            status: {
              html: `<span style="color:${r.klass === 'divergent' ? C.critical : C.success}">${r.klass === 'divergent' ? 'Divergente' : 'Confirmada/Prevista'}</span>`,
            },
          })),
        )
      : '<p class="empty">Nenhuma diária prevista na semana.</p>',
    personRows.length ? mmForTable(personRows.length, { rowMm: 5.4 }) : 8,
  ));

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: `Diárias de Alimentação · ${fmtWeek(week)}`,
    pages: composePages(blocks, { orientation: 'landscape' }),
    orientation: 'landscape',
  });
}

export function openAllowanceReport(payload: AllowanceReportPayload): ReportExportResult {
  try {
    return openReport(buildAllowanceReportHtml(payload), { width: 1280, height: 860 });
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : 'Falha ao gerar o relatório.' };
  }
}
