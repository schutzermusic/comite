/**
 * Pessoas & Custos · Folha & Encargos → relatório PDF de custo de folha.
 *
 * Só layout. Massa, encargos, recorte por lotação e variação salarial chegam
 * prontos dos mesmos seletores da tela (`esocial-coverage`, `salary-history`),
 * porque um relatório que recalcula é um relatório que diverge da tela sem
 * ninguém perceber.
 *
 * A cobertura de rubricas atravessa o documento: onde a tabela S-1010 não
 * cobre a folha, a composição não é impressa — imprime-se a base apurada pelo
 * eSocial e a razão de a composição estar ausente. Um zero ali seria lido como
 * "não houve horas extras", quando o que houve foi ausência de classificação.
 */
import { fmtInt } from '@/lib/reports/report-formatters';
import { C, REPORT_BRAND_NAME } from '@/lib/reports/report-theme';
import { svgHorizontalBar, svgLineChart } from '@/lib/reports/report-charts';
import {
  reportCover, sectionTitle, kpiGrid, chartBlock, dataTable, dataQualityBox, summaryBox,
  type KpiCardSpec,
} from '@/lib/reports/report-blocks';
import {
  composePages, block, mmForChart, mmForCover, mmForKpiGrid,
  mmForSectionTitle, mmForSummary, mmForTable, mmForWarningBox, type ReportBlock,
} from '@/lib/reports/report-compose';
import { renderReportDocument } from '@/lib/reports/report-shell';
import { openReport, buildReportMeta, buildReportFileName } from '@/lib/reports/report-export';
import type { ReportExportResult } from '@/lib/reports/report-types';
import type { CompetenceCoverage } from '@/lib/workforce/esocial-coverage';
import type { EsocialAreaMetrics, EsocialCompetenceMetrics } from '@/hooks/use-esocial-overview';
import type { SalaryHistoryResult } from '@/lib/workforce/salary-history';
import type { EmployeeCostSnapshot } from '@/lib/types/people';

const NA = '—';

export interface PayrollCostReportPayload {
  competences: EsocialCompetenceMetrics[];
  coverageByCompetence: Record<string, CompetenceCoverage>;
  areas: EsocialAreaMetrics[];
  snapshots: EmployeeCostSnapshot[];
  snapshotMonth: string;
  salary: SalaryHistoryResult | null;
  brandName?: string;
  generatedBy?: string;
}

function shortMonth(month: string): string {
  if (/^\d{4}-13$/.test(month)) return `13º ${month.slice(0, 4)}`;
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
}

function brl(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return NA;
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

function compositionCents(metric: EsocialCompetenceMetrics | undefined, coverage: CompetenceCoverage | undefined) {
  const provisional = coverage?.classificationBasis === 'payslip_pdf';
  return {
    overtime: provisional ? metric?.payslip_overtime_cents : metric?.overtime_cents,
    benefits: provisional ? metric?.payslip_benefits_cents : metric?.benefits_cents,
    headcount: metric ? (metric.headcount || (provisional ? metric.payslip_headcount : 0)) : 0,
  };
}

export function buildPayrollCostReportHtml(payload: PayrollCostReportPayload): string {
  const { competences, coverageByCompetence, areas, snapshots, snapshotMonth, salary } = payload;

  const brand = payload.brandName ?? REPORT_BRAND_NAME;
  const fileName = buildReportFileName({ module: 'pessoas-custos', context: 'folha-encargos' });

  const ordered = [...competences].sort((a, b) => a.competence.localeCompare(b.competence));
  const latest = ordered[ordered.length - 1];
  const latestCoverage = latest ? coverageByCompetence[latest.competence] : undefined;
  const latestComposition = compositionCents(latest, latestCoverage);
  const hasPayslipFallback = ordered.some((c) => coverageByCompetence[c.competence]?.classificationBasis === 'payslip_pdf');
  const range = ordered.length
    ? `${shortMonth(ordered[0].competence)} – ${shortMonth(ordered[ordered.length - 1].competence)}`
    : 'sem competência apurada';

  const meta = buildReportMeta({
    brand,
    periodLabel: range,
    source: hasPayslipFallback
      ? 'eSocial + fechamentos aprovados + contracheque PDF provisório'
      : 'eSocial + fechamentos de folha aprovados',
    generatedBy: payload.generatedBy,
  });

  const blocks: ReportBlock[] = [];

  blocks.push(block(
    reportCover({
      meta,
      kicker: 'Relatório Executivo · Pessoas & Custos',
      title: 'Folha & Encargos',
      context: 'Massa salarial, encargos, recorte por lotação e variação salarial',
      coverKpis: [
        { label: 'Massa (última competência)', value: latestCoverage ? brl(Math.round(latestCoverage.payroll * 100)) : NA },
        { label: 'INSS (última)', value: brl(latest?.inss_cents) },
        { label: 'Quadro (última)', value: latest ? fmtInt(latestComposition.headcount) : NA },
      ],
    }),
    mmForCover(true),
  ));

  // ── 1. Panorama ──
  const narrative: string[] = [];
  if (!latest) {
    narrative.push(
      'Nenhuma competência foi apurada a partir do eSocial. Os indicadores de folha e encargos ficam ausentes — não zerados, porque zero afirmaria que a folha foi nula.',
    );
  } else {
    narrative.push(
      `O acervo cobre ${range}, com ${fmtInt(ordered.length)} competência(s) apurada(s). Na competência mais recente (${shortMonth(latest.competence)}), a massa salarial foi de ${latestCoverage ? brl(Math.round(latestCoverage.payroll * 100)) : NA} para um quadro de ${fmtInt(latest.headcount)} trabalhador(es).`,
    );
    if (latestCoverage && !latestCoverage.compositionReliable) {
      narrative.push(
        'A composição da folha da competência mais recente NÃO está disponível: a tabela de rubricas (S-1010) não cobre a folha declarada, então proventos, horas extras, benefícios e descontos não puderam ser separados. A massa exibida vem da base apurada pelo próprio eSocial, que é completa.',
      );
    } else if (latestCoverage?.classificationBasis === 'payslip_pdf') {
      narrative.push('Classificação provisória por holerite/PDF. A tabela oficial S-1010 segue pendente.');
    }
  }

  blocks.push(block(sectionTitle('Panorama', range, 1), mmForSectionTitle(true), { keepWithNext: true }));
  blocks.push(block(summaryBox(narrative), mmForSummary(narrative), { keepWithNext: true }));

  const kpis: KpiCardSpec[] = [
    {
      label: 'Massa salarial (última)',
      value: latestCoverage ? brl(Math.round(latestCoverage.payroll * 100)) : NA,
      missing: !latestCoverage,
      color: C.primary,
      helper: latestCoverage?.payrollSource === 'rubricas'
        ? 'rubricas S-1010'
        : latestCoverage?.payrollSource === 'payslip_pdf'
          ? 'contracheque PDF (provisório)'
          : 'base apurada pelo eSocial',
    },
    { label: 'INSS (guia)', value: brl(latest?.inss_cents), missing: latest?.inss_cents == null, color: C.primary },
    { label: 'FGTS (guia)', value: brl(latest?.fgts_cents), missing: latest?.fgts_cents == null, color: C.primary },
    { label: 'IRRF (guia)', value: brl(latest?.irrf_cents), missing: latest?.irrf_cents == null, color: C.primary },
    {
      label: 'Horas extras',
      value: latestCoverage?.compositionReliable ? brl(latestComposition.overtime) : NA,
      missing: !latestCoverage?.compositionReliable,
      color: C.warning,
      helper: latestCoverage?.compositionReliable ? undefined : 'rubricas não classificadas',
    },
    {
      label: 'Benefícios',
      value: latestCoverage?.compositionReliable ? brl(latestComposition.benefits) : NA,
      missing: !latestCoverage?.compositionReliable,
      color: C.primary,
    },
    { label: 'Quadro apurado', value: latest ? fmtInt(latestComposition.headcount) : NA, missing: !latest, color: C.primary },
    {
      label: 'Sem reajuste há +12 meses',
      value: salary ? fmtInt(salary.counts.withoutRaise12m) : NA,
      missing: !salary,
      color: salary && salary.counts.withoutRaise12m > 0 ? C.warning : C.success,
    },
  ];
  blocks.push(block(kpiGrid(kpis, 4), mmForKpiGrid(kpis.length, 4) + 3));

  // ── 2. Evolução ──
  if (ordered.length >= 2) {
    blocks.push(block(sectionTitle('Evolução da Massa e das Guias', range, 2),
      mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));

    const monthly = ordered.filter((c) => /^\d{4}-\d{2}$/.test(c.competence));
    if (monthly.length >= 2) {
      const svg = svgLineChart(
        monthly.map((c) => c.competence),
        [
          {
            name: 'Massa salarial',
            color: C.primary,
            values: monthly.map((c) => coverageByCompetence[c.competence]?.payroll ?? null),
            area: true,
            endLabel: true,
          },
        ],
        { width: 900, height: 220, xLabel: shortMonth },
      );
      blocks.push(block(
        chartBlock({ title: 'Massa salarial por competência', sub: 'Base apurada quando a composição não é confiável', svg }),
        mmForChart(220, { title: true }),
      ));
    }

    blocks.push(block(
      dataTable(
        [
          { key: 'competence', label: 'Competência' },
          { key: 'mass', label: 'Massa', num: true },
          { key: 'inss', label: 'INSS', num: true },
          { key: 'fgts', label: 'FGTS', num: true },
          { key: 'irrf', label: 'IRRF', num: true },
          { key: 'head', label: 'Quadro', num: true },
          { key: 'cov', label: 'Rubricas', num: true },
        ],
        [...ordered].reverse().map((c) => {
          const cov = coverageByCompetence[c.competence];
          return {
            competence: shortMonth(c.competence),
            mass: cov ? brl(Math.round(cov.payroll * 100)) : NA,
            inss: brl(c.inss_cents),
            fgts: brl(c.fgts_cents),
            irrf: brl(c.irrf_cents),
            head: (c.headcount || (cov?.classificationBasis === 'payslip_pdf' ? c.payslip_headcount : 0))
              ? fmtInt(c.headcount || c.payslip_headcount || 0)
              : NA,
            cov: cov?.classificationBasis === 'payslip_pdf'
              ? { html: `<span style="color:${C.warning}">PDF</span>` }
              : cov && cov.rubricCoverage > 0
              ? { html: `<span style="color:${cov.compositionReliable ? C.success : C.warning}">${(cov.rubricCoverage * 100).toFixed(0)}%</span>` }
              : NA,
          };
        }),
      ),
      mmForTable(ordered.length, { rowMm: 5.4 }),
    ));
  }

  // ── 3. Lotação ──
  const latestAreas = latest ? areas.filter((a) => a.competence === latest.competence) : [];
  if (latestAreas.length > 0) {
    blocks.push(block(sectionTitle('Custo por Lotação', latest ? shortMonth(latest.competence) : undefined, 3),
      mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));

    const bars = [...latestAreas]
      .sort((a, b) => (b.base_cents || b.gross_cents) - (a.base_cents || a.gross_cents))
      .slice(0, 12)
      .map((a) => ({ label: a.area_label, value: (a.base_cents || a.gross_cents) / 100 }));

    blocks.push(block(
      chartBlock({
        title: 'Base apurada por lotação tributária',
        sub: 'Recorte do próprio eSocial, independente da tabela de rubricas',
        svg: svgHorizontalBar(bars, { width: 900 }),
      }),
      mmForChart(Math.max(140, bars.length * 26 + 40), { title: true }),
    ));

    blocks.push(block(
      dataTable(
        [
          { key: 'area', label: 'Lotação' },
          { key: 'code', label: 'Código' },
          { key: 'head', label: 'Quadro', num: true },
          { key: 'base', label: 'Base apurada', num: true },
          { key: 'gross', label: 'Bruto (rubricas)', num: true },
          { key: 'ot', label: 'Horas extras', num: true },
        ],
        [...latestAreas]
          .sort((a, b) => (b.base_cents || b.gross_cents) - (a.base_cents || a.gross_cents))
          .map((a) => ({
            area: a.area_label,
            code: a.area_code,
            head: a.headcount ? fmtInt(a.headcount) : NA,
            base: a.base_cents ? brl(a.base_cents) : NA,
            gross: a.gross_cents ? brl(a.gross_cents) : NA,
            ot: a.overtime_cents ? brl(a.overtime_cents) : NA,
          })),
      ),
      mmForTable(latestAreas.length),
    ));
  }

  // ── 4. Custo carregado por colaborador ──
  if (snapshots.length > 0) {
    blocks.push(block(sectionTitle('Custo Carregado por Colaborador', shortMonth(snapshotMonth), 4),
      mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));

    blocks.push(block(
      dataTable(
        [
          { key: 'name', label: 'Colaborador' },
          { key: 'salary', label: 'Salário', num: true },
          { key: 'taxes', label: 'Encargos', num: true },
          { key: 'benefits', label: 'Benefícios', num: true },
          { key: 'prov', label: 'Provisões', num: true },
          { key: 'loaded', label: 'Custo carregado', num: true },
          { key: 'hourly', label: 'Custo-hora', num: true },
        ],
        snapshots.map((s) => ({
          name: s.person?.fullName ?? NA,
          salary: brl(s.salaryCents),
          taxes: brl(s.payrollTaxesCents),
          benefits: brl(s.benefitsCents),
          prov: brl(s.provisionsCents),
          loaded: brl(s.loadedMonthlyCostCents),
          hourly: brl(s.loadedHourlyCostCents),
        })),
      ),
      mmForTable(snapshots.length, { rowMm: 5.4 }),
    ));
  }

  // ── 5. Variação salarial ──
  if (salary && salary.people.length > 0) {
    blocks.push(block(sectionTitle('Variação Salarial', 'Patamar = dois meses consecutivos no mesmo bruto', 5),
      mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));

    blocks.push(block(
      summaryBox([
        'O valor da folha absorve horas extras, 13º e férias, então uma comparação mês a mês registraria "reajuste" todo dezembro. Aqui só conta como reajuste a mudança de PATAMAR — dois meses consecutivos no mesmo bruto. Quem tem série curta demais para provar doze meses fica em "não determinado", e não é somado a nenhum dos outros dois grupos.',
      ]),
      mmForSummary(['x']),
      { keepWithNext: true },
    ));

    const stale = salary.people.filter((p) => p.raiseStatus === 'stale');
    blocks.push(block(
      stale.length
        ? dataTable(
            [
              { key: 'name', label: 'Colaborador' },
              { key: 'cc', label: 'Centro de custo' },
              { key: 'gross', label: 'Bruto atual', num: true },
              { key: 'since', label: 'Desde', num: false },
              { key: 'months', label: 'Meses', num: true },
            ],
            stale.map((p) => ({
              name: p.fullName,
              cc: p.costCenterLabel ?? NA,
              gross: brl(p.currentGrossCents),
              since: p.lastRaiseCompetence ? shortMonth(p.lastRaiseCompetence) : 'antes da janela',
              months: `${p.monthsIsLowerBound ? '≥ ' : ''}${p.monthsSinceLastRaise ?? NA}`,
            })),
          )
        : '<p class="empty">Nenhum colaborador com doze meses ou mais comprovados no mesmo patamar.</p>',
      stale.length ? mmForTable(stale.length, { rowMm: 5.4 }) : 8,
    ));
  }

  // ── 6. Qualidade dos dados ──
  const issues: string[] = [];
  const unreliable = ordered.filter((c) => !coverageByCompetence[c.competence]?.compositionReliable);
  const provisional = ordered.filter((c) => coverageByCompetence[c.competence]?.classificationBasis === 'payslip_pdf');
  if (!latest) {
    issues.push('Nenhuma competência apurada pelo eSocial: massa, encargos e composição estão ausentes.');
  }
  if (unreliable.length > 0) {
    issues.push(`${fmtInt(unreliable.length)} competência(s) sem composição publicável — a tabela de rubricas (S-1010) não cobre a folha. Horas extras, benefícios e descontos ficam indisponíveis nessas competências, e não zerados.`);
  }
  if (provisional.length > 0) {
    issues.push(`Classificação provisória por holerite/PDF. A tabela oficial S-1010 segue pendente. ${fmtInt(provisional.length)} competência(s) usam o fallback provisório.`);
  }
  const noTotalizers = ordered.filter((c) => c.inss_cents == null && c.fgts_cents == null);
  if (noTotalizers.length > 0) {
    issues.push(`${fmtInt(noTotalizers.length)} competência(s) sem nenhum totalizador no acervo — os valores de guia não podem ser afirmados.`);
  }
  if (salary && salary.unmatched.length > 0) {
    issues.push(`${fmtInt(salary.unmatched.length)} nome(s) da folha sem pessoa vinculada: ficam fora dos indicadores por colaborador.`);
  }
  if (salary && salary.competencesObserved.length < 12) {
    issues.push(`A série de folha aprovada tem ${fmtInt(salary.competencesObserved.length)} competência(s). Com menos de doze meses não é possível afirmar quem está sem reajuste há mais de um ano.`);
  }
  if (snapshots.length === 0) {
    issues.push(`Nenhum snapshot de custo carregado em ${shortMonth(snapshotMonth)}.`);
  }

  blocks.push(block(sectionTitle('Qualidade dos Dados', undefined, 6),
    mmForSectionTitle(), { breakBefore: true, keepWithNext: true }));
  blocks.push(block(dataQualityBox(issues), mmForWarningBox(Math.max(1, issues.length))));

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: `Folha & Encargos · ${range}`,
    pages: composePages(blocks, { orientation: 'landscape' }),
    orientation: 'landscape',
  });
}

export function openPayrollCostReport(payload: PayrollCostReportPayload): ReportExportResult {
  try {
    return openReport(buildPayrollCostReportHtml(payload), { width: 1280, height: 860 });
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : 'Falha ao gerar o relatório.' };
  }
}
