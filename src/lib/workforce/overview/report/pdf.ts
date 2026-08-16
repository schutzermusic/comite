/**
 * Documento impresso de Pessoas & Custos (A4 paisagem).
 *
 * Shell próprio, e não `report-shell.ts`, pela mesma razão que a Projeção
 * Financeira tem o dela: aquele shell é o padrão claro de ~15 telas e alterá-lo
 * mudaria todas. Aqui o material é de board, com dois temas — `dark` para
 * projetar e `light` para imprimir e anexar.
 *
 * O tema é SÓ paleta: nenhuma página, número ou seção muda entre os dois.
 *
 * Paginação explícita ("Página N de TOTAL" calculado na montagem) porque o
 * Chromium renderiza `counter(pages)` como 0 na impressão.
 *
 * Camada de apresentação apenas — todo número vem do `WorkforceOverviewModel`,
 * o mesmo que a tela consome.
 */

import { buildGilroyFontFaceCss } from '@/lib/fonts';
import { esc } from '@/lib/reports/report-formatters';
import { buildReportFileName, openReport } from '@/lib/reports/report-export';
import type { ReportExportResult } from '@/lib/reports/report-types';

import {
  wfDonut,
  wfGauge,
  wfGroupedBars,
  wfLineChart,
  wfParetoChart,
  wfSCurve,
  wfStackedBars,
  wfLegend,
  wfLegendCss,
} from './charts';
import { buildWorkforceInsights, type WorkforceInsightCard } from './insights';
import {
  REPORT_FILE_SLUG,
  REPORT_NAME,
  UNMEASURED_DASH,
  WF_FONT,
  WF_LOGO,
  WF_SOURCE,
  wfAgenda,
  wfBackdrop,
  wfCompactCurrency,
  wfCurrency,
  wfInt,
  wfPalette,
  wfPct,
  type WorkforcePalette,
} from './theme';
import { measuredText } from './format';
import { logoBackgroundCss, type ReportBranding } from '@/lib/reports/report-branding';
import type { WorkforceOverviewModel, WorkforceReportTheme } from '../types';

const CHART_W = 1000;
const CHART_H = 340;
const CHART_W_HALF = 486;

interface Page {
  eyebrow: string;
  html: string;
  cover?: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Primitivas de impressão
   ═══════════════════════════════════════════════════════════════════════════ */

function sectionHead(title: string, sub?: string): string {
  return (
    `<div class="shead"><h2>${esc(title)}</h2>` +
    (sub ? `<p>${esc(sub)}</p>` : '') +
    `</div>`
  );
}

/** Célula da faixa executiva — o mesmo desenho da banda de KPI da tela. */
function tile(args: {
  label: string;
  value: string;
  helper?: string;
  delta?: { text: string; color: string };
  measured: boolean;
  p: WorkforcePalette;
}): string {
  const { p } = args;
  return (
    `<div class="tile">` +
    `<span class="t-label">${esc(args.label)}</span>` +
    `<span class="t-value" style="color:${args.measured ? p.ink : p.unmeasured};font-weight:${args.measured ? 800 : 400}">${esc(args.value)}</span>` +
    (args.delta
      ? `<span class="t-delta" style="color:${args.delta.color}">${esc(args.delta.text)}</span>`
      : '') +
    (args.helper ? `<span class="t-helper">${esc(args.helper)}</span>` : '') +
    `</div>`
  );
}

function band(tiles: string[]): string {
  return `<div class="band">${tiles.join('')}</div>`;
}

function panel(inner: string, className = ''): string {
  return `<div class="panel ${className}">${inner}</div>`;
}

function insightCard(card: WorkforceInsightCard, p: WorkforcePalette): string {
  const color =
    card.kind === 'alert' ? p.negative : card.kind === 'watch' ? p.attention : p.positive;
  const kindLabel =
    card.kind === 'alert' ? 'Alerta' : card.kind === 'watch' ? 'Observar' : 'Sinal';
  return (
    `<div class="ins" style="border-left-color:${color}">` +
    `<div class="ins-top"><span class="ins-kind" style="color:${color}">${kindLabel}</span>` +
    (card.value ? `<span class="ins-value">${esc(card.value)}</span>` : '') +
    `</div>` +
    `<h4>${esc(card.title)}</h4><p>${esc(card.detail)}</p></div>`
  );
}

function dataTable(
  cols: { key: string; label: string; num?: boolean }[],
  rows: Record<string, string>[],
): string {
  return (
    `<table class="dt"><thead><tr>` +
    cols.map((c) => `<th${c.num ? ' class="num"' : ''}>${esc(c.label)}</th>`).join('') +
    `</tr></thead><tbody>` +
    rows
      .map(
        (r) =>
          `<tr>${cols
            .map((c) => `<td${c.num ? ' class="num"' : ''}>${esc(r[c.key] ?? UNMEASURED_DASH)}</td>`)
            .join('')}</tr>`,
      )
      .join('') +
    `</tbody></table>`
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Páginas
   ═══════════════════════════════════════════════════════════════════════════ */

function buildPages(model: WorkforceOverviewModel, p: WorkforcePalette): Page[] {
  const insights = buildWorkforceInsights(model);
  const { meta, scope, executive, efficiency, dynamics, costStructure, concentration, compliance } =
    model;
  const branding = meta.branding;

  const agenda = wfAgenda({
    hasEfficiency: efficiency.series.length > 0,
    hasDynamics: dynamics.movement.length > 0 || dynamics.turnover.length > 0,
    hasCostStructure: costStructure.composition.length > 0 || costStructure.scurve.length > 0,
    hasConcentration: concentration.data.costCenters.length > 0,
  });

  const pages: Page[] = [];

  /* ── Capa ── */
  pages.push({
    eyebrow: 'Capa',
    cover: true,
    html:
      `<div class="cover">` +
      // A marca da empresa abre o documento. O nome só aparece ao lado quando o
      // logo é o do produto — com a marca do cliente, repetir o nome ao lado do
      // wordmark polui a capa.
      `<div class="cover-top">` +
      `<span class="cover-logo" role="img" aria-label="${esc(branding.logoAlt)}"></span>` +
      `<span class="cover-kicker">${esc(REPORT_NAME)}</span></div>` +
      `<h1 class="cover-title">Cockpit Executivo de Pessoas &amp; Custos</h1>` +
      `<p class="cover-sub">${esc(insights.headline)}</p>` +
      `<div class="cover-meta">` +
      `<span><b>Período</b>${esc(meta.periodLabel)}</span>` +
      `<span><b>Recorte</b>${esc(meta.filtersLabel)}</span>` +
      `<span><b>Comparação</b>${esc(meta.comparison.label.measured ? meta.comparison.label.value : 'sem base no período')}</span>` +
      `<span><b>Fonte</b>${esc(WF_SOURCE)}</span>` +
      `</div>` +
      `<div class="cover-verdict"><span>${esc(insights.verdict)}</span></div>` +
      `<ol class="cover-agenda">` +
      agenda
        .map((a) => `<li><b>${esc(a.title)}</b><span>${esc(a.sub)}</span></li>`)
        .join('') +
      `</ol></div>`,
  });

  /* ── Resumo executivo ── */
  const kpiTiles = executive.kpis
    .filter((k) => k.group === 'custo' || k.group === 'volume' || k.group === 'eficiencia')
    .slice(0, 8)
    .map((k) => {
      const isMeasured = k.display ? k.display.measured : k.value.measured;
      const delta = k.delta.measured
        ? {
            text: `${k.delta.value.pct > 0 ? '+' : ''}${k.delta.value.pct.toFixed(1).replace('.', ',')}% ${k.delta.value.label}`,
            color:
              k.delta.value.pct === 0
                ? p.muted
                : k.delta.value.pct > 0 === k.delta.value.upIsGood
                  ? p.positive
                  : p.negative,
          }
        : undefined;
      return tile({
        label: k.label,
        value: measuredText(k.value, k.format, k.display),
        helper: isMeasured ? k.helper : 'não apurado no período',
        delta,
        measured: isMeasured,
        p,
      });
    });

  pages.push({
    eyebrow: 'Resumo executivo',
    html:
      sectionHead('Resumo executivo', `${meta.periodLabel} · ${meta.filtersLabel}`) +
      band(kpiTiles) +
      `<div class="cols-2">` +
      panel(
        // ATENÇÃO À ESCALA: `calculatePayrollRiskScore` é documentado como
        // "higher = healthier" — 100 é o melhor resultado, 10 o pior. As faixas
        // seguem essa direção; invertê-las pinta de vermelho uma folha
        // perfeitamente alinhada à receita.
        wfGauge(executive.risk.score.measured ? executive.risk.score.value : null, {
          palette: p,
          width: CHART_W_HALF,
          height: 216,
          label: 'Saúde da folha (100 = melhor)',
          valueText: executive.risk.score.measured
            ? `${executive.risk.score.value}/100`
            : undefined,
          bands: [
            [0, 40, p.negative],
            [40, 70, p.attention],
            [70, 100, p.positive],
          ],
        }) +
          `<p class="panel-note">${esc(
            executive.risk.score.measured
              ? executive.risk.message
              : 'O risco compara o crescimento da folha com o da receita. Sem receita lançada, o diagnóstico não é apurável.',
          )}</p>`,
      ) +
      `<div class="ins-grid">${insights.cards.slice(0, 4).map((c) => insightCard(c, p)).join('')}</div>` +
      `</div>`,
  });

  /* ── Eficiência ── */
  if (efficiency.series.length > 0) {
    pages.push({
      eyebrow: 'Eficiência & produtividade',
      html:
        sectionHead(
          'Eficiência & produtividade',
          'Quanto cada pessoa produz, quanto custa e que parcela da receita a folha consome',
        ) +
        panel(
          wfLineChart(
            efficiency.series.map((d) => d.period),
            [
              {
                name: 'Receita por colaborador',
                values: efficiency.series.map((d) => d.revenuePerEmployee),
                color: p.success,
                area: true,
              },
              {
                name: 'Custo por colaborador',
                values: efficiency.series.map((d) => d.costPerEmployee),
                color: p.info,
              },
            ],
            {
              palette: p,
              width: CHART_W,
              height: 292,
              caption: 'Receita e custo por colaborador',
              emptyTitle: 'Receita não lançada',
              emptyReason:
                'A produtividade por colaborador precisa da receita do contas a receber nas competências do período.',
            },
          ) +
            wfLegend([
              { label: 'Receita por colaborador', color: p.success },
              { label: 'Custo por colaborador', color: p.info },
            ]),
        ) +
        panel(
          wfLineChart(
            efficiency.series.map((d) => d.period),
            [
              {
                name: 'Folha sobre receita',
                values: efficiency.series.map((d) => d.payrollAsRevenuePct),
                color: p.warning,
                area: true,
              },
              {
                name: `Limite (${efficiency.threshold}%)`,
                values: efficiency.series.map(() => efficiency.threshold),
                color: p.danger,
                dashed: true,
              },
            ],
            {
              palette: p,
              width: CHART_W,
              height: 198,
              fmt: (v) => wfPct(v, 0),
              caption: `Folha sobre receita — limite de política em ${efficiency.threshold}%`,
              emptyTitle: 'Razão não apurável',
              emptyReason: 'A razão folha/receita precisa das duas pontas apuradas.',
            },
          ) +
            wfLegend([
              { label: 'Folha sobre receita', color: p.warning },
              { label: `Limite de política (${efficiency.threshold}%)`, color: p.danger },
            ]),
        ),
    });
  }

  /* ── Dinâmica do quadro ── */
  if (dynamics.movement.length > 0 || dynamics.turnover.length > 0) {
    pages.push({
      eyebrow: 'Dinâmica do quadro',
      html:
        sectionHead(
          'Dinâmica do quadro',
          'Movimentação declarada, rotatividade e pressão de horas extras',
        ) +
        panel(
          wfGroupedBars(
            dynamics.movement.map((d) => d.period),
            [
              {
                name: 'Admissões',
                values: dynamics.movement.map((d) => d.admissions),
                color: p.success,
              },
              {
                name: 'Desligamentos',
                values: dynamics.movement.map((d) => d.dismissals),
                color: p.danger,
              },
            ],
            {
              palette: p,
              width: CHART_W,
              height: 296,
              fmt: (v) => wfInt(v),
              caption: 'Admissões × Desligamentos (S-2200 / S-2299)',
              emptyTitle: 'Movimentação não apurada',
              emptyReason:
                'Admissões e desligamentos vêm dos eventos do eSocial; nenhuma competência do período os trouxe.',
            },
          ) +
            wfLegend([
              { label: 'Admissões', color: p.success },
              { label: 'Desligamentos', color: p.danger },
            ]),
        ) +
        `<div class="cols-2">` +
        panel(
          wfLineChart(
            dynamics.turnover.map((d) => d.period),
            [
              {
                name: 'Turnover',
                values: dynamics.turnover.map((d) => d.turnoverPct),
                color: p.warning,
                area: true,
              },
            ],
            {
              palette: p,
              width: CHART_W_HALF,
              height: 230,
              fmt: (v) => wfPct(v, 1),
              caption: 'Turnover mensal',
              emptyTitle: 'Turnover não apurado',
              emptyReason: 'Exige desligamentos declarados e quadro apurado na mesma competência.',
            },
          ),
        ) +
        panel(
          wfLineChart(
            dynamics.overtime.map((d) => d.period),
            [
              {
                name: 'Horas extras',
                values: dynamics.overtime.map((d) => d.overtimePct),
                color: p.accent,
                area: true,
              },
            ],
            {
              palette: p,
              width: CHART_W_HALF,
              height: 230,
              fmt: (v) => wfPct(v, 0),
              caption: 'Horas extras sobre a massa',
              emptyTitle: 'Horas extras não classificadas',
              emptyReason:
                'Identificar a verba de hora extra depende da tabela de rubricas do eSocial (S-1010).',
            },
          ),
        ) +
        `</div>`,
    });
  }

  /* ── Estrutura de custo ── */
  if (costStructure.composition.length > 0 || costStructure.scurve.length > 0) {
    pages.push({
      eyebrow: 'Estrutura de custo',
      html:
        sectionHead(
          'Estrutura de custo',
          'De que a folha é feita e como ela acumula ao longo do período',
        ) +
        panel(
          wfStackedBars(
            costStructure.composition.map((d) => d.period),
            [
              {
                name: 'Salário',
                values: costStructure.composition.map((d) => d.salary),
                color: p.accent,
              },
              {
                name: 'Benefícios',
                values: costStructure.composition.map((d) => d.benefits),
                color: p.success,
              },
              {
                name: 'Encargos',
                values: costStructure.composition.map((d) => d.charges),
                color: p.warning,
              },
            ],
            {
              palette: p,
              width: CHART_W,
              height: 268,
              caption: 'Composição da folha por competência',
              emptyTitle: 'Rubricas não classificadas',
              emptyReason:
                'Separar salário, benefícios e encargos depende da tabela de rubricas do eSocial (S-1010).',
            },
          ) +
            wfLegend([
              { label: 'Salário', color: p.accent },
              { label: 'Benefícios', color: p.success },
              { label: 'Encargos', color: p.warning },
            ]),
        ) +
        `<div class="cols-2">` +
        panel(
          wfSCurve(
            costStructure.scurve.map((d) => d.period),
            costStructure.scurve.map((d) => d.cumulative),
            costStructure.scurve.map((d) => d.cumulativePrev ?? 0),
            {
              palette: p,
              width: CHART_W_HALF,
              height: 224,
              caption: 'Curva S acumulada',
            },
          ),
        ) +
        panel(
          wfDonut(
            benefitSlices(model, p),
            {
              palette: p,
              width: CHART_W_HALF,
              height: 224,
              centerLabel: 'Benefícios',
              centerValue: costStructure.benefitsTotal.measured
                ? wfCompactCurrency(costStructure.benefitsTotal.value)
                : UNMEASURED_DASH,
              emptyTitle: 'Benefícios não classificados',
              emptyReason:
                'A abertura por natureza exige rubricas de benefício declaradas no S-1010.',
            },
          ),
        ) +
        `</div>`,
    });
  }

  /* ── Risco & concentração ── */
  if (concentration.data.costCenters.length > 0) {
    const sorted = [...concentration.data.costCenters].sort(
      (a, b) => b.payrollValue - a.payrollValue,
    );
    pages.push({
      eyebrow: 'Risco & concentração',
      html:
        sectionHead(
          'Risco & concentração',
          `Dependência dos maiores centros de custo — total de ${wfCurrency(concentration.data.totalPayroll)} no período`,
        ) +
        panel(
          wfParetoChart(
            sorted.map((c) => ({
              label: c.name,
              value: c.payrollValue,
              highlight: c.isAbnormal,
            })),
            {
              palette: p,
              width: CHART_W,
              height: 340,
              caption: 'Folha por centro de custo, com acumulado',
            },
          ),
        ) +
        panel(
          dataTable(
            [
              { key: 'centro', label: 'Centro de custo' },
              { key: 'folha', label: 'Folha', num: true },
              { key: 'quadro', label: 'Quadro', num: true },
              { key: 'variacao', label: 'Variação', num: true },
            ],
            sorted.slice(0, 12).map((c) => ({
              centro: c.name,
              folha: wfCurrency(c.payrollValue),
              quadro: c.headcount > 0 ? wfInt(c.headcount) : UNMEASURED_DASH,
              // Sem janela anterior o seletor devolve 0; imprimir "0,0%" numa
              // coluna de variação afirmaria estabilidade onde não houve
              // comparação nenhuma.
              variacao: concentration.hasBaseline
                ? `${c.growthVsPrevious > 0 ? '+' : ''}${c.growthVsPrevious.toFixed(1).replace('.', ',')}%${c.isAbnormal ? ' ⚠' : ''}`
                : UNMEASURED_DASH,
            })),
          ),
          'tight',
        ),
    });
  }

  /* ── Conformidade ── */
  const obligations = compliance.snapshot.obligations.slice(0, 12);
  pages.push({
    eyebrow: 'Conformidade',
    html:
      sectionHead(
        'Conformidade da competência',
        `Ciclo folha → eSocial → guias em ${compliance.currentCompetenceLabel}`,
      ) +
      `<div class="cols-2">` +
      panel(
        wfGauge(compliance.snapshot.score, {
          palette: p,
          width: CHART_W_HALF,
          height: 216,
          label: 'Conformidade da competência',
          valueText: `${compliance.snapshot.score}/100`,
          bands: [
            [0, 60, p.negative],
            [60, 85, p.attention],
            [85, 100, p.positive],
          ],
        }) +
          `<p class="panel-note">${esc(
            compliance.snapshot.nextDue
              ? `Próxima obrigação: ${compliance.snapshot.nextDue.label}, vencimento em ${compliance.snapshot.nextDue.dueDate}.`
              : 'Nenhuma obrigação pendente na competência.',
          )}</p>`,
      ) +
      panel(
        dataTable(
          [
            { key: 'obrigacao', label: 'Obrigação' },
            { key: 'venc', label: 'Vencimento' },
            { key: 'status', label: 'Situação' },
          ],
          obligations.map((o) => ({
            obrigacao: `${o.code} · ${o.label}`,
            venc: o.dueDate,
            status: o.status,
          })),
        ),
        'tight',
      ) +
      `</div>`,
  });

  /* ── Procedência & método ── */
  pages.push({
    eyebrow: 'Procedência & método',
    html:
      sectionHead(
        'Procedência & método',
        'De onde vem cada número e o que este relatório NÃO afirma',
      ) +
      panel(
        `<h3 class="mini">Fontes</h3>` +
          `<ul class="meth">` +
          `<li><b>Folha</b> — lotes de fechamento APROVADOS, com o rateio por centro de custo declarado na importação.</li>` +
          `<li><b>Quadro e movimentação</b> — eventos apurados do eSocial (S-1200, S-2200, S-2299, S-2230).</li>` +
          `<li><b>Composição e horas extras</b> — classificação de verbas pela tabela de rubricas (S-1010).</li>` +
          `<li><b>Receita</b> — títulos do contas a receber, por competência.</li>` +
          `</ul>` +
          `<h3 class="mini">Recorte</h3>` +
          `<ul class="meth"><li>${esc(meta.periodLabel)} · ${esc(meta.filtersLabel)}</li>` +
          `<li>Comparação: ${esc(meta.comparison.windowLabel.measured ? meta.comparison.windowLabel.value : 'sem linha de base na série apurada')}</li></ul>`,
      ) +
      panel(
        `<h3 class="mini">O que não foi apurado</h3>` +
          (insights.gaps.length > 0
            ? `<ul class="meth gaps">${insights.gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>`
            : `<p class="panel-note">Todos os indicadores do escopo foram apurados no período.</p>`) +
          `<p class="disclaimer">Este relatório exibe somente dado apurado. Onde a fonte não respondeu, o indicador aparece como “${UNMEASURED_DASH}” — nunca como zero, e nunca como valor estimado.</p>`,
      ),
  });

  return pages;
}

/** Benefícios acumulados no período, por natureza. */
function benefitSlices(
  model: WorkforceOverviewModel,
  p: WorkforcePalette,
): { name: string; value: number; color: string }[] {
  const { benefits } = model.costStructure;
  const spec: [keyof (typeof benefits)[number], string, string][] = [
    ['va', 'Vale-alimentação', p.accent],
    ['vr', 'Vale-refeição', p.success],
    ['health', 'Saúde', p.info],
    ['dental', 'Odontológico', p.budget],
    ['transport', 'Transporte', p.warning],
    ['other', 'Outros', p.danger],
  ];
  return spec
    .map(([key, name, color]) => ({
      name,
      value: benefits.reduce((sum, b) => sum + (b[key] as number), 0),
      color,
    }))
    .filter((s) => s.value > 0);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Documento
   ═══════════════════════════════════════════════════════════════════════════ */

function documentCss(p: WorkforcePalette, branding: ReportBranding): string {
  const light = p.mode === 'light';
  return `
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:${WF_FONT};color:${p.body};background:${p.void};-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .page{position:relative;width:297mm;height:210mm;overflow:hidden;display:flex;flex-direction:column;${wfBackdrop(p)}}
  .page-break{page-break-before:always;break-before:page;}
  .page-inner{flex:1 1 auto;display:flex;flex-direction:column;gap:7mm;padding:11mm 13mm 4mm;min-height:0;}
  .phead{display:flex;align-items:baseline;justify-content:space-between;border-bottom:1px solid ${p.lineSoft};padding-bottom:3mm;}
  .eyebrow{font-size:10.5px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:${p.subtle};}
  .no{font-size:10.5px;font-weight:700;color:${p.subtle};}
  .pfoot{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:10px;
    padding:0 13mm 6mm;font-size:9px;color:${p.subtle};}
  .pf-brand{display:flex;align-items:center;gap:8px;min-width:0;}
  .pf-logo{${logoBackgroundCss(branding.logoSmallDataUri, {
    height: `${WF_LOGO.footerHeight}px`,
    maxWidth: `${Math.min(WF_LOGO.footerMaxWidth, WF_LOGO.footerHeight * branding.logoAspect)}px`,
  })}flex:0 0 auto;}

  .shead h2{font-size:22px;font-weight:800;color:${p.ink};letter-spacing:-.01em;}
  .shead p{margin-top:2px;font-size:12px;color:${p.muted};}
  .mini{font-size:12px;font-weight:800;color:${p.ink};margin-bottom:5px;}

  .band{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;}
  .tile{display:flex;flex-direction:column;gap:2px;padding:4mm;border:1px solid ${p.line};border-radius:9px;
    background:linear-gradient(150deg, ${p.panelTop}, ${p.panelBottom});}
  .t-label{font-size:9.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${p.subtle};}
  .t-value{font-size:21px;line-height:1.1;font-variant-numeric:tabular-nums;}
  .t-delta{font-size:10px;font-weight:700;}
  .t-helper{font-size:9.5px;color:${p.muted};}

  .panel{border:1px solid ${p.line};border-radius:11px;padding:4mm;background:linear-gradient(160deg, ${p.panelTop}, ${p.panelBottom});}
  .panel.tight{padding:3mm;}
  .panel svg{display:block;width:100%;height:auto;}
  .panel-note{margin-top:3mm;font-size:10.5px;line-height:1.5;color:${p.muted};}
  .cols-2{display:grid;grid-template-columns:1fr 1fr;gap:4mm;align-items:start;}

  .ins-grid{display:grid;grid-template-columns:1fr 1fr;gap:3mm;align-content:start;}
  .ins{border:1px solid ${p.line};border-left-width:3px;border-radius:9px;padding:3.4mm;
    background:${p.raised};}
  .ins-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px;}
  .ins-kind{font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;}
  .ins-value{font-size:12px;font-weight:800;color:${p.ink};font-variant-numeric:tabular-nums;}
  .ins h4{margin-top:2px;font-size:12px;font-weight:700;color:${p.ink};}
  .ins p{margin-top:2px;font-size:10px;line-height:1.5;color:${p.muted};}

  .dt{width:100%;border-collapse:collapse;font-size:10.5px;}
  .dt th{text-align:left;font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;
    color:${p.subtle};padding:2mm 2mm;border-bottom:1px solid ${p.line};}
  .dt td{padding:1.7mm 2mm;color:${p.body};border-bottom:1px solid ${p.lineSoft};}
  .dt .num{text-align:right;font-variant-numeric:tabular-nums;}
  .dt tbody tr:nth-child(even){background:${p.raised};}

  .meth{list-style:none;display:flex;flex-direction:column;gap:2mm;}
  .meth li{position:relative;padding-left:4.5mm;font-size:10.5px;line-height:1.5;color:${p.muted};}
  .meth li::before{content:'';position:absolute;left:0;top:5px;width:5px;height:5px;border-radius:2px;background:${p.accent};}
  .meth.gaps li::before{background:${p.attention};}
  .meth b{color:${p.ink};}
  .disclaimer{margin-top:4mm;padding-top:3mm;border-top:1px solid ${p.lineSoft};font-size:10px;line-height:1.55;color:${p.subtle};}

  /* Capa */
  .cover{flex:1 1 auto;display:flex;flex-direction:column;gap:6mm;padding:6mm 2mm;}
  .cover-top{display:flex;align-items:center;justify-content:space-between;gap:${WF_LOGO.safeArea}px;}
  .cover-logo{${logoBackgroundCss(branding.logoDataUri, {
    height: `${WF_LOGO.coverHeight}px`,
    maxWidth: `${Math.min(WF_LOGO.coverMaxWidth, WF_LOGO.coverHeight * branding.logoAspect)}px`,
  })}flex:0 0 auto;}
  .cover-kicker{font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${p.subtle};}
  .cover-title{font-size:40px;line-height:1.08;font-weight:800;letter-spacing:-.02em;color:${p.ink};max-width:80%;}
  .cover-sub{font-size:14px;line-height:1.55;color:${p.body};max-width:74%;}
  .cover-meta{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;padding:4mm 0;border-top:1px solid ${p.lineSoft};border-bottom:1px solid ${p.lineSoft};}
  .cover-meta span{display:flex;flex-direction:column;gap:2px;font-size:11px;color:${p.body};}
  .cover-meta b{font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${p.subtle};}
  .cover-verdict{padding:3.5mm 4mm;border-left:3px solid ${p.accent};background:${p.raised};border-radius:0 8px 8px 0;}
  .cover-verdict span{font-size:12.5px;font-weight:600;color:${p.ink};}
  .cover-agenda{margin-top:auto;list-style:none;counter-reset:ag;display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;}
  .cover-agenda li{counter-increment:ag;display:flex;flex-direction:column;gap:1px;padding-top:2.5mm;border-top:1px solid ${p.line};}
  .cover-agenda li::before{content:counter(ag,decimal-leading-zero);font-size:9px;font-weight:800;color:${p.accent};}
  .cover-agenda b{font-size:11px;color:${p.ink};}
  .cover-agenda span{font-size:9.5px;line-height:1.4;color:${p.muted};}

${wfLegendCss(p)}

  .toolbar{position:fixed;bottom:16px;right:16px;z-index:30;display:flex;flex-direction:column;gap:7px;
    max-width:330px;padding:10px 12px;border:1px solid ${p.line};border-radius:12px;
    background:${light ? 'rgba(255,255,255,.97)' : 'rgba(7,18,26,.95)'};
    box-shadow:0 18px 40px rgba(0,0,0,${light ? '.2' : '.5'});}
  .toolbar-row{display:flex;gap:8px;}
  .toolbar button{flex:1 1 auto;padding:7px 12px;border:0;border-radius:8px;cursor:pointer;
    font-family:inherit;font-size:11px;font-weight:700;color:${light ? '#FFFFFF' : p.void};background:${p.accent};}
  .toolbar button.alt{color:${p.body};background:transparent;border:1px solid ${p.line};}
  .toolbar-hint{font-size:9px;line-height:1.45;color:${p.muted};}
  .toolbar-hint b{color:${p.ink};}

  @media screen{
    body{background:${light ? '#E7EDF0' : '#02060A'};padding:18px 0;}
    .page{margin:0 auto 18px;border-radius:10px;box-shadow:0 24px 60px rgba(0,0,0,${light ? '.18' : '.6'});}
  }
  @media print{.no-print{display:none !important;}.page{margin:0;border-radius:0;}}
`;
}

export interface WorkforceOverviewPdfOptions {
  /** Tema do documento. Omitido = escuro. */
  theme?: WorkforceReportTheme;
}

export function buildWorkforceOverviewPdfHtml(
  model: WorkforceOverviewModel,
  options?: WorkforceOverviewPdfOptions,
): string {
  const mode: WorkforceReportTheme = options?.theme ?? 'dark';
  const p = wfPalette(mode);
  const pages = buildPages(model, p);
  const total = pages.length;
  const fileName = buildReportFileName({
    module: 'pessoas-custos',
    context: `${REPORT_FILE_SLUG}-${model.meta.periodLabel}`,
  });

  const pagesHtml = pages
    .map(
      (page, index) => `
  <section class="page${index > 0 ? ' page-break' : ''}">
    <div class="page-inner">
      ${
        page.cover
          ? ''
          : `<div class="phead"><span class="eyebrow">${esc(page.eyebrow)}</span><span class="no">${String(
              index + 1,
            ).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span></div>`
      }
      ${page.html}
    </div>
    <div class="pfoot">
      <span class="pf-brand">
        <span class="pf-logo" role="img" aria-label="${esc(model.meta.branding.logoAlt)}"></span>
        <span>${esc(REPORT_NAME)} · ${esc(model.meta.periodLabel)}</span>
      </span>
      <span>${esc(WF_SOURCE)}</span>
      <span>Página ${index + 1} de ${total}</span>
    </div>
  </section>`,
    )
    .join('');

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" />
<meta name="color-scheme" content="${mode}" />
<title>${esc(fileName)}</title>
<style>
${buildGilroyFontFaceCss()}
  @page { size: A4 landscape; margin: 0; }
${documentCss(p, model.meta.branding)}
</style></head>
<body>
  <div class="toolbar no-print">
    <div class="toolbar-row">
      <button type="button" onclick="window.print()">Imprimir / Salvar PDF</button>
      <button type="button" class="alt" onclick="window.close()">Fechar</button>
    </div>
    <div class="toolbar-hint">Tema ${mode === 'light' ? 'claro' : 'escuro'}: na impressão ative <b>Gráficos de fundo</b>, desative <b>Cabeçalhos e rodapés</b> e mantenha <b>Margens: nenhuma</b>.</div>
  </div>
${pagesHtml}
  <script>
    document.title = ${JSON.stringify(fileName)};
    // Guarda de transbordo (só na pré-visualização em tela): sinaliza páginas
    // cujo conteúdo excede a altura útil, para pegar layout estourado em dev.
    window.addEventListener('load', function () {
      var pages = document.querySelectorAll('.page');
      for (var i = 0; i < pages.length; i++) {
        if (pages[i].scrollHeight > pages[i].clientHeight + 2) {
          pages[i].style.outline = '2px dashed ${p.negative}';
          console.warn('[pessoas-custos] Página ' + (i + 1) + ' excede a altura útil.');
        }
      }
    });
  </script>
</body></html>`;
}

export function openWorkforceOverviewPdf(
  model: WorkforceOverviewModel,
  options?: WorkforceOverviewPdfOptions,
): ReportExportResult {
  try {
    return openReport(buildWorkforceOverviewPdfHtml(model, options), { width: 1320, height: 900 });
  } catch (error) {
    return {
      ok: false,
      reason: 'error',
      message: error instanceof Error ? error.message : 'Falha ao gerar o relatório.',
    };
  }
}
