/**
 * Documento impresso de Pessoas & Custos (A4 paisagem).
 *
 * ─── Mesma anatomia da Projeção Financeira ─────────────────────────────────
 *
 * Este documento é a transcrição literal do shell de `apex-pdf.ts`: mesma
 * altura útil (209mm), mesma moldura de cockpit, mesma faixa executiva com
 * trilhos (padrão HudKpiStrip / Executive Band), mesmos painéis de vidro,
 * mesma faixa de leitura no pé das páginas de gráfico, mesma capa em três
 * tempos e mesmo fecho só com a marca.
 *
 * A razão é editorial, não estética: os dois relatórios vão para o mesmo board,
 * muitas vezes na mesma reunião. Dois desenhos diferentes fazem o leitor
 * gastar atenção reaprendendo onde ficam as coisas, em vez de ler os números.
 *
 * O que muda entre eles é só a paleta de série e o conteúdo — porque as
 * perguntas são outras.
 *
 * ─── Por que um shell próprio, e não `report-shell.ts` ─────────────────────
 *
 * Pela mesma razão que a Projeção Financeira tem o dela: aquele shell é o
 * padrão claro de ~15 telas e alterá-lo mudaria todas. Aqui o material é de
 * board, com dois temas — `dark` para projetar e `light` para imprimir.
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
  isEmptyChart,
  wfDonut,
  wfGauge,
  wfGroupedBars,
  wfLineChart,
  wfParetoChart,
  wfSCurve,
  wfStackedBars,
  wfLegend,
  wfLegendCss,
  type WfLegendItem,
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
  wfBandShadow,
  wfCardShadow,
  wfCompactCurrency,
  wfCurrency,
  wfDueDate,
  wfInt,
  wfPalette,
  wfPanelShadow,
  wfPct,
  wfSurface,
  type WorkforcePalette,
} from './theme';
import { OBLIGATION_STATUS_META } from '@/lib/workforce/compliance';
import { measuredText } from './format';
import { logoBackgroundCss, type ReportBranding } from '@/lib/reports/report-branding';
import type { Measured, WorkforceOverviewModel, WorkforceReportTheme } from '../types';

/**
 * Caixa dos gráficos impressos.
 *
 * A largura útil da folha é fixa (281mm ≈ 1062px), e a viewBox mais estreita
 * que o quadro impresso é o que aumenta a fonte do gráfico — o mesmo truque de
 * `apex-pdf.ts`: eixos, competências e valores crescem junto com as marcas sem
 * tocar no motor de gráficos.
 */
const CHART_W = 980;
/** Altura de página com um gráfico só e faixa de leitura no pé. */
const CHART_H = 452;
/**
 * Duas caixas empilhadas na mesma folha.
 *
 * Os valores são apertados: o SVG escala pela largura, então a viewBox de 980
 * rende a 1,06× na folha e cada pixel a mais aqui vira ~1,06 na página. Com
 * 268/214 a faixa de leitura da página de Eficiência descia 31px sobre o
 * rodapé — sem transbordar `.page` (que é `overflow:hidden`), o que é
 * justamente o motivo de o portão do harness checar a colisão com o rodapé, e
 * não só `scrollHeight`.
 */
const CHART_H_STACK_A = 244;
const CHART_H_STACK_B = 192;
/** Caixa de meia largura (duas colunas). */
const CHART_W_HALF = 478;
const CHART_H_HALF = 196;

interface Page {
  /** Sobrelinha da seção (canto superior esquerdo). */
  eyebrow: string;
  html: string;
  /** Capa e fecho recebem tratamento full-bleed, sem cabeçalho de seção. */
  cover?: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Primitivas de impressão — transcritas de `apex-pdf.ts`
   ═══════════════════════════════════════════════════════════════════════════ */

function sectionHead(title: string, sub?: string): string {
  return `<div class="sec"><h2>${esc(title)}</h2>${
    sub ? `<p class="sec-sub">${esc(sub)}</p>` : ''
  }</div>`;
}

/**
 * Faixa executiva — um contêiner de vidro com trilhos nas bordas agrupando
 * células de 4px de gap, em vez de cartões soltos de borda uniforme.
 *
 * É a linguagem que o app já usa no topo de todo módulo (Executive Band de
 * Contratos), e a mesma que a Projeção Financeira leva para o papel.
 */
function band(cells: string, columns = 4, extraClass = ''): string {
  return `<div class="band${extraClass ? ` ${extraClass}` : ''}">
    <div class="band-grid" style="--cols:${columns}">${cells}</div>
  </div>`;
}

/**
 * Célula da faixa: ponto de acento + rótulo, valor tabular, sublinha discreta.
 *
 * `measured: false` é o único caso em que o valor NÃO recebe a cor de acento:
 * um traço pintado de ciano lê como número. Ele fica no tom neutro do "não
 * apurado", em peso normal.
 */
function cell(args: {
  label: string;
  value: string;
  accent: string;
  helper?: string;
  measured?: boolean;
  tag?: string;
  detail?: string;
  p: WorkforcePalette;
}): string {
  const unmeasured = args.measured === false;
  return `<div class="cell" style="--accent:${args.accent}">
    <span class="cell-top">
      <i class="cell-dot"></i><span class="cell-l">${esc(args.label)}</span>
      ${args.tag ? `<span class="cell-tag">${esc(args.tag)}</span>` : ''}
    </span>
    <b class="cell-v"${
      unmeasured ? ` style="color:${args.p.unmeasured};font-weight:400"` : ''
    }>${esc(args.value)}</b>
    ${args.helper ? `<span class="cell-h">${esc(args.helper)}</span>` : ''}
    ${args.detail ? `<p class="cell-d">${esc(args.detail)}</p>` : ''}
  </div>`;
}

function insightCell(card: WorkforceInsightCard, p: WorkforcePalette): string {
  const accent = card.kind === 'alert' ? p.negative : card.kind === 'watch' ? p.attention : p.accent;
  const tag = card.kind === 'alert' ? 'Atenção' : card.kind === 'watch' ? 'Monitorar' : 'Sinal';
  return cell({
    label: card.title,
    value: card.value ?? UNMEASURED_DASH,
    accent,
    tag,
    detail: card.detail,
    p,
  });
}

/**
 * Painel de gráfico.
 *
 * A legenda é suprimida quando o gráfico é o quadro do "não apurado": listar
 * "Salário · Benefícios · Encargos" sob um painel que acabou de declarar que as
 * rubricas não foram classificadas sugere séries que não existem.
 */
function panel(chartSvg: string, legendHtml = '', caption?: string): string {
  const legend = isEmptyChart(chartSvg) ? '' : legendHtml;
  return `<div class="panel">${chartSvg}${legend}${
    caption ? `<p class="panel-cap">${esc(caption)}</p>` : ''
  }</div>`;
}

/**
 * Faixa de leitura do pé da página — pares rótulo/valor que fecham cada folha
 * de gráfico, exatamente como `.read` do Apex.
 *
 * `margin-top:auto` empurra a faixa para a base: é o que faz páginas com
 * gráficos de alturas diferentes terminarem todas na mesma linha.
 */
interface ReadItem {
  label: string;
  value: string;
  color?: string;
}

function read(items: ReadItem[]): string {
  const usable = items.filter((i) => i.value.length > 0);
  if (usable.length === 0) return '';
  return `<div class="read">${usable
    .map(
      (i) =>
        `<span><em>${esc(i.label)}</em><strong${
          i.color ? ` style="color:${i.color}"` : ''
        }>${esc(i.value)}</strong></span>`,
    )
    .join('')}</div>`;
}

/** Valor apurado, ou o traço. Nunca zero por descuido. */
function show(m: Measured<number>, fmt: (v: number) => string): string {
  return m.measured ? fmt(m.value) : UNMEASURED_DASH;
}

function dataTable(
  cols: { key: string; label: string; num?: boolean }[],
  rows: Record<string, string>[],
): string {
  return (
    `<table class="data"><thead><tr>` +
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
  const { meta, executive, efficiency, dynamics, costStructure, concentration, compliance } = model;
  const branding = meta.branding;

  const agenda = wfAgenda({
    hasEfficiency: efficiency.series.length > 0,
    hasDynamics: dynamics.movement.length > 0 || dynamics.turnover.length > 0,
    hasCostStructure: costStructure.composition.length > 0 || costStructure.scurve.length > 0,
    hasConcentration: concentration.data.costCenters.length > 0,
  });

  const pages: Page[] = [];

  /* 01 — Capa
   *
   * Mesma anatomia da capa do deck HTML — marca, título, leitura de abertura e
   * a linha de meta — só que o bloco inteiro é centrado no eixo da folha, em
   * vez de ancorado na base. Numa folha A4 paisagem o texto ancorado embaixo
   * deixa dois terços de vazio no topo; centrado, o vazio vira respiro
   * simétrico. */
  pages.push({
    eyebrow: '',
    cover: true,
    html: `<div class="cover">
      <div class="cover-block">
        <span class="cover-logo" role="img" aria-label="${esc(branding.logoAlt)}"></span>
        <h1>${esc(REPORT_NAME)}</h1>
        <p class="cover-sub">${esc(insights.headline)}</p>
        <span class="cover-rule"></span>
        <div class="cover-meta">
          <span><em>Período</em><strong>${esc(meta.periodLabel)}</strong></span>
          <span><em>Recorte</em><strong>${esc(meta.filtersLabel)}</strong></span>
          <span><em>Comparação</em><strong>${esc(
            meta.comparison.label.measured ? meta.comparison.label.value : 'sem base no período',
          )}</strong></span>
        </div>
      </div>
    </div>`,
  });

  /* 02 — Roteiro */
  pages.push({
    eyebrow: 'Roteiro do relatório',
    html: `${sectionHead('O que esta leitura cobre')}
    <ol class="agenda">${agenda
      .map((item) => `<li><b>${esc(item.title)}</b><span>${esc(item.sub)}</span></li>`)
      .join('')}</ol>`,
  });

  /* 03 — Síntese executiva */
  const headlineKpis = executive.kpis.filter(
    (k) => k.group === 'custo' || k.group === 'volume' || k.group === 'eficiencia',
  );
  const kpiCell = (k: (typeof headlineKpis)[number]) => {
    const isMeasured = k.display ? k.display.measured : k.value.measured;
    const delta = k.delta.measured ? k.delta.value : null;
    const accent = !isMeasured
      ? p.unmeasured
      : k.tone === 'danger'
        ? p.negative
        : k.tone === 'warning'
          ? p.attention
          : k.tone === 'success'
            ? p.positive
            : p.accent;
    return cell({
      label: k.label,
      value: measuredText(k.value, k.format, k.display),
      accent,
      measured: isMeasured,
      helper: delta
        ? `${delta.pct > 0 ? '+' : ''}${delta.pct.toFixed(1).replace('.', ',')}% ${delta.label}`
        : isMeasured
          ? k.helper
          : 'não apurado no período',
      p,
    });
  };
  const kpiCells = headlineKpis.slice(0, 4).map(kpiCell);

  pages.push({
    eyebrow: 'Síntese executiva',
    html: `${sectionHead(insights.verdict, `${meta.periodLabel} · ${meta.filtersLabel}`)}
    <div class="exec">
      <div>
        <p class="copy">${esc(insights.headline)}</p>
        ${band(kpiCells.join(''), Math.max(1, kpiCells.length))}
      </div>
      <div class="dial">
        ${wfGauge(executive.risk.score.measured ? executive.risk.score.value : null, {
          palette: p,
          width: 320,
          height: 224,
          valueText: executive.risk.score.measured
            ? `${executive.risk.score.value}/100`
            : undefined,
          // ATENÇÃO À ESCALA: `calculatePayrollRiskScore` é documentado como
          // "higher = healthier" — 100 é o melhor resultado, 10 o pior.
          // Inverter as faixas pinta de vermelho uma folha perfeitamente
          // alinhada à receita.
          bands: [
            [0, 40, p.negative],
            [40, 70, p.attention],
            [70, 100, p.positive],
          ],
        })}
        <p class="dial-label">Saúde da folha (100 = melhor)</p>
        <p class="dial-note">${esc(
          executive.risk.score.measured
            ? executive.risk.message
            : 'O risco compara o crescimento da folha com o da receita. Sem receita lançada, o diagnóstico não é apurável.',
        )}</p>
      </div>
    </div>
    ${band(
      insights.cards
        .slice(0, 4)
        .map((c) => insightCell(c, p))
        .join(''),
      Math.max(1, Math.min(4, insights.cards.length)),
      'ins-band',
    )}`,
  });

  /* 04 — Painel completo de indicadores
   *
   * A síntese cabe em quatro células — é o que a faixa executiva do Apex
   * comporta sem apertar. Os demais indicadores não são descartados: ganham a
   * própria folha, em faixas de quatro, para que a leitura de cada linha
   * continue horizontal. */
  const restKpis = [...headlineKpis.slice(4), ...executive.kpis.filter((k) => k.group === 'conformidade')];
  if (restKpis.length > 0) {
    const rows: string[] = [];
    for (let i = 0; i < restKpis.length; i += 4) {
      const chunk = restKpis.slice(i, i + 4);
      rows.push(band(chunk.map(kpiCell).join(''), 4));
    }
    pages.push({
      eyebrow: 'Indicadores do período',
      html: `${sectionHead(
        'Todos os indicadores apurados no recorte',
        `${meta.periodLabel} · ${meta.filtersLabel}. ${
          meta.comparison.label.measured
            ? `A variação de cada indicador compara ${meta.comparison.label.value}.`
            : 'O período não tem janela anterior na série apurada, então as variações não são calculáveis.'
        }`,
      )}
      <div class="kpi-stack">${rows.join('')}</div>`,
    });
  }

  /* 05 — Eficiência */
  if (efficiency.series.length > 0) {
    const effLegend: WfLegendItem[] = [
      { label: 'Receita por colaborador', color: p.success },
      { label: 'Custo por colaborador', color: p.info, shape: 'line' },
    ];
    const ratioLegend: WfLegendItem[] = [
      { label: 'Folha sobre receita', color: p.warning },
      { label: `Limite de política (${efficiency.threshold}%)`, color: p.danger, shape: 'dash' },
    ];
    pages.push({
      eyebrow: 'Eficiência & produtividade',
      html: `${sectionHead(
        'Quanto cada pessoa produz e quanto a folha consome da receita',
        'Receita e custo por colaborador, competência a competência, e a razão folha/receita contra o limite de política.',
      )}
      ${panel(
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
            height: CHART_H_STACK_A,
            caption: 'Receita e custo por colaborador',
            emptyTitle: 'Receita não lançada',
            emptyReason:
              'A produtividade por colaborador precisa da receita do contas a receber nas competências do período.',
          },
        ),
        wfLegend(effLegend),
      )}
      ${panel(
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
            height: CHART_H_STACK_B,
            fmt: (v) => wfPct(v, 0),
            caption: `Folha sobre receita — limite de política em ${efficiency.threshold}%`,
            emptyTitle: 'Razão não apurável',
            emptyReason: 'A razão folha/receita precisa das duas pontas apuradas.',
          },
        ),
        wfLegend(ratioLegend),
      )}
      ${read([
        {
          label: 'Receita por colaborador',
          value: show(efficiency.revenuePerEmployee, wfCurrency),
        },
        { label: 'Custo por colaborador', value: show(efficiency.costPerEmployee, wfCurrency) },
        {
          label: 'Folha sobre receita',
          value: show(efficiency.payrollAsRevenuePct, (v) => wfPct(v)),
          color: efficiency.payrollAsRevenuePct.measured
            ? efficiency.payrollAsRevenuePct.value >= efficiency.threshold
              ? p.negative
              : p.positive
            : undefined,
        },
        { label: 'Limite de política', value: `${efficiency.threshold}%` },
      ])}`,
    });
  }

  /* 05 — Dinâmica do quadro */
  if (dynamics.movement.length > 0 || dynamics.turnover.length > 0) {
    const netMovement = dynamics.movement.reduce((sum, d) => sum + d.net, 0);
    pages.push({
      eyebrow: 'Dinâmica do quadro',
      html: `${sectionHead(
        'Movimentação declarada, rotatividade e pressão de horas extras',
        'Admissões e desligamentos vêm dos eventos do eSocial; o turnover e as horas extras são derivados das mesmas competências.',
      )}
      ${panel(
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
            height: CHART_H_STACK_A,
            fmt: (v) => wfInt(v),
            caption: 'Admissões × Desligamentos (S-2200 / S-2299)',
            emptyTitle: 'Movimentação não apurada',
            emptyReason:
              'Admissões e desligamentos vêm dos eventos do eSocial; nenhuma competência do período os trouxe.',
          },
        ),
        wfLegend([
          { label: 'Admissões', color: p.success },
          { label: 'Desligamentos', color: p.danger },
        ]),
      )}
      <div class="cols-2">
        ${panel(
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
              height: CHART_H_HALF,
              fmt: (v) => wfPct(v, 1),
              caption: 'Turnover mensal',
              emptyTitle: 'Turnover não apurado',
              emptyReason: 'Exige desligamentos declarados e quadro apurado na mesma competência.',
            },
          ),
        )}
        ${panel(
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
              height: CHART_H_HALF,
              fmt: (v) => wfPct(v, 0),
              caption: 'Horas extras sobre a massa',
              emptyTitle: 'Horas extras não classificadas',
              emptyReason:
                'Identificar a verba de hora extra depende da tabela de rubricas do eSocial (S-1010).',
            },
          ),
        )}
      </div>
      ${read([
        {
          label: 'Saldo do quadro',
          value: dynamics.movement.length
            ? `${netMovement > 0 ? '+' : ''}${wfInt(netMovement)}`
            : UNMEASURED_DASH,
          color: netMovement > 0 ? p.positive : netMovement < 0 ? p.negative : undefined,
        },
        {
          label: 'Turnover da competência',
          value: show(dynamics.latestTurnoverPct, (v) => wfPct(v, 2)),
        },
        { label: 'Horas extras', value: show(dynamics.latestOvertimePct, (v) => wfPct(v)) },
        { label: 'Absenteísmo máximo', value: show(dynamics.maxAbsenteeismPct, (v) => wfPct(v)) },
      ])}`,
    });
  }

  /* 06 — Estrutura de custo */
  if (costStructure.composition.length > 0 || costStructure.scurve.length > 0) {
    pages.push({
      eyebrow: 'Estrutura de custo',
      html: `${sectionHead(
        'De que a folha é feita e como ela acumula no período',
        'A separação entre salário, benefícios e encargos depende da tabela de rubricas do eSocial (S-1010).',
      )}
      ${panel(
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
            height: CHART_H_STACK_A,
            caption: 'Composição da folha por competência',
            emptyTitle: 'Rubricas não classificadas',
            emptyReason:
              'Separar salário, benefícios e encargos depende da tabela de rubricas do eSocial (S-1010).',
          },
        ),
        wfLegend([
          { label: 'Salário', color: p.accent },
          { label: 'Benefícios', color: p.success },
          { label: 'Encargos', color: p.warning },
        ]),
      )}
      <div class="cols-2">
        ${panel(
          wfSCurve(
            costStructure.scurve.map((d) => d.period),
            costStructure.scurve.map((d) => d.cumulative),
            costStructure.scurve.map((d) => d.cumulativePrev ?? 0),
            {
              palette: p,
              width: CHART_W_HALF,
              height: CHART_H_HALF,
              caption: 'Curva S acumulada',
            },
          ),
        )}
        ${panel(
          wfDonut(benefitSlices(model, p), {
            palette: p,
            width: CHART_W_HALF,
            height: CHART_H_HALF,
            centerLabel: 'Benefícios',
            centerValue: costStructure.benefitsTotal.measured
              ? wfCompactCurrency(costStructure.benefitsTotal.value)
              : UNMEASURED_DASH,
            emptyTitle: 'Benefícios não classificados',
            emptyReason:
              'A abertura por natureza exige rubricas de benefício declaradas no S-1010.',
          }),
        )}
      </div>
      ${read([
        { label: 'Folha acumulada', value: wfCurrency(costStructure.totalPayrollAccum) },
        { label: 'Benefícios', value: show(costStructure.benefitsTotal, wfCurrency) },
        { label: 'Encargos', value: show(costStructure.chargesTotal, wfCurrency) },
        { label: 'Salário direto', value: show(costStructure.directPct, (v) => wfPct(v)) },
      ])}`,
    });
  }

  /* 07 — Risco & concentração */
  if (concentration.data.costCenters.length > 0) {
    const sorted = [...concentration.data.costCenters].sort(
      (a, b) => b.payrollValue - a.payrollValue,
    );
    pages.push({
      eyebrow: 'Risco & concentração',
      html: `${sectionHead(
        'Dependência dos maiores centros de custo',
        `Total de ${wfCurrency(concentration.data.totalPayroll)} rateados no período. A linha acumulada responde quantos centros explicam a maior parte da folha.`,
      )}
      ${panel(
        wfParetoChart(
          sorted.map((c) => ({
            label: c.name,
            value: c.payrollValue,
            highlight: c.isAbnormal,
          })),
          {
            palette: p,
            width: CHART_W,
            height: CHART_H,
          },
        ),
        wfLegend([
          { label: 'Folha do centro', color: p.accent },
          { label: 'Variação atípica', color: p.danger },
          { label: 'Acumulado (eixo direito)', color: p.warning, shape: 'line' },
        ]),
      )}
      ${read([
        { label: 'Top 3 da folha', value: show(concentration.top3, (v) => wfPct(v)) },
        { label: 'Maior centro', value: sorted[0]?.name ?? UNMEASURED_DASH },
        { label: 'Centros no recorte', value: wfInt(sorted.length) },
        {
          label: 'Variações atípicas',
          value: wfInt(concentration.abnormal.length),
          color: concentration.abnormal.length > 0 ? p.attention : undefined,
        },
      ])}`,
    });

    /* 07b — Tabela dos centros */
    pages.push({
      eyebrow: 'Risco & concentração',
      html: `${sectionHead(
        'Todos os valores por trás do Pareto',
        // Sem janela anterior o seletor devolve 0; imprimir "0,0%" numa coluna
        // de variação afirmaria estabilidade onde não houve comparação nenhuma.
        concentration.hasBaseline
          ? 'A variação compara cada centro com a mesma janela do período anterior.'
          : 'O período não tem linha de base na série apurada, então a variação não é calculável.',
      )}
      ${dataTable(
        [
          { key: 'centro', label: 'Centro de custo' },
          { key: 'folha', label: 'Folha', num: true },
          { key: 'share', label: 'Participação', num: true },
          { key: 'quadro', label: 'Quadro', num: true },
          { key: 'variacao', label: 'Variação', num: true },
        ],
        sorted.slice(0, 16).map((c) => ({
          centro: c.name,
          folha: wfCurrency(c.payrollValue),
          share: wfPct((c.payrollValue / (concentration.data.totalPayroll || 1)) * 100),
          quadro: c.headcount > 0 ? wfInt(c.headcount) : UNMEASURED_DASH,
          variacao: concentration.hasBaseline
            ? `${c.growthVsPrevious > 0 ? '+' : ''}${c.growthVsPrevious.toFixed(1).replace('.', ',')}%${c.isAbnormal ? ' ⚠' : ''}`
            : UNMEASURED_DASH,
        })),
      )}`,
    });
  }

  /* 08 — Conformidade */
  pages.push({
    eyebrow: 'Conformidade',
    html: `${sectionHead(
      'Ciclo folha → eSocial → guias',
      `Situação das obrigações de ${compliance.currentCompetenceLabel}.`,
    )}
    <div class="exec">
      <div>
        ${dataTable(
          [
            { key: 'obrigacao', label: 'Obrigação' },
            { key: 'venc', label: 'Vencimento' },
            { key: 'status', label: 'Situação' },
          ],
          compliance.snapshot.obligations.slice(0, 12).map((o) => ({
            obrigacao: `${o.code} · ${o.label}`,
            venc: wfDueDate(o.dueDate),
            status: OBLIGATION_STATUS_META[o.status].label,
          })),
        )}
      </div>
      <div class="dial">
        ${wfGauge(compliance.snapshot.score, {
          palette: p,
          width: 320,
          height: 224,
          valueText: `${compliance.snapshot.score}/100`,
          bands: [
            [0, 60, p.negative],
            [60, 85, p.attention],
            [85, 100, p.positive],
          ],
        })}
        <p class="dial-label">Conformidade da competência</p>
        <p class="dial-note">${esc(
          compliance.snapshot.nextDue
            ? `Próxima obrigação: ${compliance.snapshot.nextDue.label}, vencimento em ${wfDueDate(compliance.snapshot.nextDue.dueDate)}.`
            : 'Nenhuma obrigação pendente na competência.',
        )}</p>
      </div>
    </div>`,
  });

  /* 09 — Procedência & método */
  pages.push({
    eyebrow: 'Procedência & método',
    html: `${sectionHead(
      'De onde vem cada número e o que este relatório NÃO afirma',
      'Somente dado apurado: onde a fonte não respondeu, o indicador aparece como traço.',
    )}
    <div class="cols">
      <div class="col" style="--accent:${p.accent}">
        <h3>Fontes</h3>
        <ul>
          <li><b>Folha</b> — lotes de fechamento APROVADOS, com o rateio por centro de custo declarado na importação.</li>
          <li><b>Quadro e movimentação</b> — eventos apurados do eSocial (S-1200, S-2200, S-2299, S-2230).</li>
          <li><b>Composição e horas extras</b> — classificação de verbas pela tabela de rubricas (S-1010).</li>
          <li><b>Receita</b> — títulos do contas a receber, por competência.</li>
        </ul>
      </div>
      <div class="col" style="--accent:${p.info}">
        <h3>Recorte</h3>
        <ul>
          <li><b>Período</b> — ${esc(meta.periodLabel)}</li>
          <li><b>Unidades</b> — ${esc(meta.filtersLabel)}</li>
          <li><b>Comparação</b> — ${esc(
            meta.comparison.windowLabel.measured
              ? meta.comparison.windowLabel.value
              : 'sem linha de base na série apurada',
          )}</li>
          <li><b>Competências</b> — ${wfInt(meta.monthsInRange)} no recorte</li>
        </ul>
      </div>
      <div class="col" style="--accent:${p.attention}">
        <h3>O que não foi apurado</h3>
        ${
          insights.gaps.length > 0
            ? `<ul>${insights.gaps
                .slice(0, 6)
                .map((g) => `<li>${esc(g)}</li>`)
                .join('')}</ul>`
            : `<p class="empty">Todos os indicadores do escopo foram apurados no período.</p>`
        }
      </div>
    </div>
    <div class="dq ${insights.gaps.length > 0 ? 'warn' : 'ok'}">
      <b>Regra do material</b>
      <ul><li>Onde a fonte não respondeu, o indicador aparece como “${UNMEASURED_DASH}” — nunca como zero, e nunca como valor estimado.</li></ul>
    </div>`,
  });

  /* 10 — Fecho institucional (só a marca, centralizada) */
  pages.push({
    eyebrow: '',
    cover: true,
    html: `<div class="closing">
      <span class="closing-logo" role="img" aria-label="${esc(branding.logoAlt)}"></span>
    </div>`,
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
   Documento — CSS transcrito de `apex-pdf.ts`
   ═══════════════════════════════════════════════════════════════════════════ */

function documentCss(p: WorkforcePalette, branding: ReportBranding): string {
  const backdrop = wfBackdrop(p, { intensity: 0.85 });
  const light = p.mode === 'light';
  const coverLogoW = Math.min(WF_LOGO.coverMaxWidth, WF_LOGO.coverHeight * branding.logoAspect);
  return `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: ${p.void}; color: ${p.ink};
    font-family: ${WF_FONT}; font-size: 14.5px; line-height: 1.5;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  /**
   * Altura da folha inteira (A4 paisagem = 210mm) menos 1mm de folga contra
   * arredondamento do Chromium — sem isso, cada quebra empurraria uma folha em
   * branco.
   */
  .page { position: relative; display: flex; flex-direction: column; gap: 10px;
    height: 209mm; overflow: hidden; padding: 0;
    background-color: ${p.void}; background-image: ${backdrop.image}; background-size: ${backdrop.size}; }
  .page-break { page-break-before: always; break-before: page; }
  .page::before { content: ''; position: absolute; inset: 0; border: 1px solid ${p.lineSoft};
    border-radius: 14px; pointer-events: none; }
  .page-inner { position: relative; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column;
    gap: 8px; padding: 8mm 8mm 0; }

  .phead { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; }
  .eyebrow { font-size: 10.5px; font-weight: 700; letter-spacing: .2em; text-transform: uppercase; color: ${p.accent}; }
  .phead .no { font-size: 10.5px; letter-spacing: .16em; color: ${p.subtle}; font-variant-numeric: tabular-nums; }
  .pfoot { display: flex; justify-content: space-between; align-items: center; gap: 14px;
    margin: 0 8mm; padding: 4px 0 5mm; border-top: 1px solid ${p.lineSoft};
    font-size: 9.5px; color: ${p.subtle}; }
  .pf-brand { display: inline-flex; align-items: center; gap: 7px; }
  .pf-logo { ${logoBackgroundCss(branding.logoSmallDataUri, {
    height: `${WF_LOGO.footerHeight}px`,
    maxWidth: `${Math.min(WF_LOGO.footerMaxWidth, WF_LOGO.footerHeight * branding.logoAspect)}px`,
  })} flex: 0 0 auto; }

  .sec h2 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -.02em; color: ${p.ink}; max-width: 62ch; }
  .sec-sub { margin: 3px 0 0; font-size: 12.5px; color: ${p.muted}; max-width: 96ch; }
  .copy { margin: 0 0 9px; font-size: 13.5px; line-height: 1.55; color: ${p.body}; max-width: 60ch; }
  .empty { font-size: 12px; color: ${p.subtle}; font-style: italic; margin: 0; }

  /* Capa — bloco único, centrado nos dois eixos */
  .cover { flex: 1 1 auto; display: flex; align-items: center; justify-content: center; padding: 8mm 16mm 4mm; }
  .cover-block { display: flex; flex-direction: column; align-items: center; text-align: center;
    width: 100%; max-width: 215mm; }
  .cover-logo { ${logoBackgroundCss(branding.logoDataUri, {
    height: `${WF_LOGO.coverHeight}px`,
    maxWidth: `${coverLogoW}px`,
    align: 'center',
  })} flex: 0 0 auto; margin-bottom: 13mm; }
  .cover h1 { margin: 0; font-size: 54px; line-height: .96; letter-spacing: -.045em; max-width: 19ch; color: ${p.ink}; }
  .cover-sub { margin: 8mm 0 0; font-size: 15px; line-height: 1.55; color: ${p.body}; max-width: 62ch; }
  /* Fio de acento esmaecido nas pontas — a mesma assinatura do traço do slide. */
  .cover-rule { display: block; width: 96px; height: 2px; border-radius: 2px; margin: 11mm 0 9mm;
    background: linear-gradient(90deg, transparent, ${p.accent}, transparent); }
  .cover-meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 26px;
    width: 100%; max-width: 205mm; }
  .cover-meta span { display: flex; flex-direction: column; align-items: center; gap: 3px; }
  .cover-meta em { font-style: normal; font-size: 9.5px; letter-spacing: .15em; text-transform: uppercase; color: ${p.subtle}; }
  .cover-meta strong { font-size: 14px; font-weight: 600; color: ${p.body}; }

  /* Roteiro — duas colunas de itens numerados */
  .agenda { flex: 1 1 auto; list-style: none; counter-reset: ag; margin: 6px 0 0; padding: 0;
    display: grid; grid-template-columns: 1fr 1fr; gap: 0 28px; align-content: center; }
  .agenda li { counter-increment: ag; display: grid; grid-template-columns: auto 1fr; gap: 12px;
    align-items: baseline; padding: 9px 0; border-top: 1px solid ${p.lineSoft}; }
  .agenda li::before { content: counter(ag, decimal-leading-zero); font-size: 11.5px; font-weight: 700;
    letter-spacing: .1em; color: ${p.accent}; font-variant-numeric: tabular-nums; }
  .agenda b { grid-column: 2; font-size: 16.5px; font-weight: 700; letter-spacing: -.01em; color: ${p.ink}; }
  .agenda span { grid-column: 2; margin-top: 2px; font-size: 12px; color: ${p.subtle}; }

  /* Faixa executiva (padrão HudKpiStrip / Executive Band) */
  .band { position: relative; overflow: hidden; border-radius: 18px; padding: 4px;
    border: 1px solid ${light ? p.line : `color-mix(in srgb, ${p.accent} 18%, transparent)`};
    background: linear-gradient(180deg, ${p.panelTop} 0%, ${p.panelBottom} 100%);
    box-shadow: ${
      light
        ? wfBandShadow(p)
        : `${wfBandShadow(p)}, inset 0 0 0 1px color-mix(in srgb, ${p.accent} 6%, transparent)`
    }; }
  /* Trilhos de borda — a assinatura contida da Executive Band. */
  .band::before, .band::after { content: ''; position: absolute; top: 9px; bottom: 9px; width: 1px; }
  .band::before { left: 9px; background: ${p.accent}; }
  .band::after { right: 9px; background: ${p.line}; }
  .band-grid { position: relative; display: grid; grid-template-columns: repeat(var(--cols, 4), 1fr); gap: 4px; }

  .cell { position: relative; overflow: hidden; padding: 9px 12px 10px; border-radius: 12px;
    border: 1px solid ${p.lineSoft}; background: ${wfSurface(p, 0.88, 0.42)};
    box-shadow: ${wfCardShadow(p)}, inset 0 1px 0 ${light ? 'rgba(255, 255, 255, .9)' : 'rgba(255, 255, 255, .05)'}; }
  /* Fio de acento no topo, esmaecido nas pontas (não a barra sólida de borda). */
  .cell::before { content: ''; position: absolute; top: 0; left: 24%; right: 24%; height: 1px;
    background: linear-gradient(90deg, transparent, var(--accent), transparent); }
  .cell-top { display: flex; align-items: flex-start; gap: 6px; }
  .cell-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); flex: 0 0 auto; margin-top: 3px; }
  /**
   * Rótulo quebra em duas linhas em vez de truncar: reticências em relatório
   * viram dúvida. As duas linhas ficam RESERVADAS mesmo quando o rótulo usa
   * uma só — sem isso o valor de "Total de colaboradores" (rótulo de duas
   * linhas) desce e desalinha da célula vizinha, e a faixa perde a leitura
   * horizontal que é a razão de ela existir.
   */
  .cell-l { flex: 1 1 auto; min-height: 2.6em; font-size: 9.5px; line-height: 1.35; font-weight: 700;
    letter-spacing: .12em; text-transform: uppercase; color: ${p.muted}; }
  .cell-tag { margin-left: auto; flex: 0 0 auto; padding: 1px 6px; border: 1px solid var(--accent);
    border-radius: 999px; font-size: 8px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
    color: var(--accent); }
  .cell-v { display: block; margin-top: 5px; font-size: 21px; font-weight: 700; letter-spacing: -.03em;
    color: var(--accent); font-variant-numeric: tabular-nums; }
  .cell-h { display: block; margin-top: 3px; font-size: 10.5px; color: ${p.subtle}; }
  .cell-d { margin: 5px 0 0; font-size: 11px; line-height: 1.4; color: ${p.subtle}; }

  /* Síntese */
  .exec { flex: 1 1 auto; display: grid; grid-template-columns: 1.35fr .65fr; gap: 18px; align-items: center; }
  .dial { display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .dial svg { display: block; width: 100%; max-width: 300px; height: auto; }
  .dial-label { margin: 0; font-size: 10.5px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase;
    color: ${p.muted}; text-align: center; }
  .dial-note { margin: 3px 0 0; font-size: 10.5px; line-height: 1.4; color: ${p.subtle}; text-align: center; max-width: 34ch; }

  .ins-band { margin-top: auto; }
  .ins-band .cell-v { font-size: 18.5px; }
  /* Faixas de indicador empilhadas, centradas no corpo da folha. */
  .kpi-stack { flex: 1 1 auto; display: flex; flex-direction: column; justify-content: center; gap: 10px; }

  /* Painéis de gráfico */
  .panel { border: 1px solid ${p.lineSoft}; border-radius: 14px; padding: 9px 11px 8px;
    background: ${wfSurface(p, 0.7, 0.4)}; box-shadow: ${wfPanelShadow(p)}; }
  .panel svg { display: block; width: 100%; height: auto; }
  .panel-cap { margin: 6px 0 0; font-size: 10.5px; color: ${p.subtle}; }
  .cols-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-items: start; }

  .read { display: flex; flex-wrap: wrap; gap: 6px 28px; margin-top: auto; padding-top: 6px;
    border-top: 1px solid ${p.lineSoft}; }
  .read span { display: flex; flex-direction: column; gap: 1px; }
  .read em { font-style: normal; font-size: 9.5px; letter-spacing: .14em; text-transform: uppercase; color: ${p.subtle}; }
  .read strong { font-size: 14.5px; font-weight: 700; color: ${p.ink}; font-variant-numeric: tabular-nums; }

  /* Tabela */
  table.data { width: 100%; border-collapse: collapse; font-size: 12px; font-variant-numeric: tabular-nums; }
  table.data thead th { text-align: left; padding: 7px 8px; font-size: 9.5px; font-weight: 700;
    letter-spacing: .1em; text-transform: uppercase; color: ${p.muted};
    background: ${p.raised}; border-bottom: 1px solid ${p.line}; }
  table.data thead th.num { text-align: right; }
  table.data tbody td { padding: 7px 8px; border-bottom: 1px solid ${p.lineSoft}; color: ${p.body}; }
  table.data tbody td.num { text-align: right; }
  table.data tbody tr:nth-child(even) td { background: ${light ? 'rgba(11, 26, 32, .02)' : 'rgba(255, 255, 255, .018)'}; }
  /* A tabela estica até o rodapé: as linhas dividem entre si a altura que sobra
     na folha, em vez de deixar uma faixa vazia no pé da página. */
  .page-inner > table.data { flex: 1 1 auto; }
  .exec table.data { width: 100%; }

  /* Colunas de método */
  .cols { flex: 1 1 auto; display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; align-content: center; }
  .col { border-top: 2px solid var(--accent); padding-top: 9px; }
  .col h3 { margin: 0 0 7px; font-size: 10px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--accent); }
  .col ul { margin: 0; padding-left: 15px; }
  .col li { font-size: 12.5px; line-height: 1.45; color: ${p.body}; margin-bottom: 6px; }
  .col b { color: ${p.ink}; }
  .dq { margin-top: auto; border-radius: 12px; padding: 9px 13px; border: 1px solid; }
  .dq.warn { border-color: color-mix(in srgb, ${p.attention} 38%, transparent); background: color-mix(in srgb, ${p.attention} 7%, transparent); }
  .dq.ok { border-color: color-mix(in srgb, ${p.accent} 32%, transparent); background: color-mix(in srgb, ${p.accent} 6%, transparent); }
  .dq b { font-size: 9px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
  .dq.warn b { color: ${p.attention}; }
  .dq.ok b { color: ${p.accent}; }
  .dq ul { margin: 5px 0 0; padding-left: 15px; }
  .dq li { font-size: 12px; color: ${p.body}; margin-bottom: 3px; }

  /* Fecho institucional — apenas a marca centralizada */
  .closing { flex: 1 1 auto; display: flex; flex-direction: column; justify-content: center; align-items: center;
    text-align: center; padding: 0 14mm; }
  .closing-logo { ${logoBackgroundCss(branding.logoDataUri, {
    height: '18mm',
    // 18mm ≈ 68px: a largura sai da proporção real e nunca passa de 136mm.
    maxWidth: `${Math.min(514, 68 * branding.logoAspect)}px`,
    align: 'center',
  })} }

${wfLegendCss(p)}
  /* Legenda impressa acompanha a escala do documento. */
  .wf-legend { gap: 6px 24px; margin-top: 9px; }
  .wf-lg { font-size: 13px; }
  .wf-sw { width: 18px; height: 10px; }

  /* Barra de ação (só em tela) */
  .toolbar { position: fixed; bottom: 16px; right: 16px; z-index: 30; display: flex; flex-direction: column; gap: 7px;
    max-width: 330px; padding: 10px 12px; border: 1px solid ${p.line}; border-radius: 12px;
    background: ${light ? 'rgba(255, 255, 255, .97)' : 'rgba(7, 18, 26, .95)'};
    box-shadow: 0 18px 40px rgba(0, 0, 0, ${light ? '.2' : '.5'}); }
  .toolbar-row { display: flex; gap: 8px; }
  .toolbar button { flex: 1 1 auto; padding: 7px 12px; border: 0; border-radius: 8px; cursor: pointer;
    font-family: inherit; font-size: 11px; font-weight: 700; color: ${light ? '#FFFFFF' : p.void}; background: ${p.accent}; }
  .toolbar button.alt { color: ${p.body}; background: transparent; border: 1px solid ${p.line}; }
  .toolbar-hint { font-size: 9px; line-height: 1.45; color: ${p.muted}; }
  .toolbar-hint b { color: ${p.ink}; }

  @media screen {
    body { background: ${light ? '#E7EDF0' : '#02060A'}; padding: 18px 0; }
    .page { width: 297mm; margin: 0 auto 18px; border-radius: 10px;
      box-shadow: 0 24px 60px rgba(0, 0, 0, ${light ? '.18' : '.6'}); }
  }
  @media print { .no-print { display: none !important; } .page { margin: 0; border-radius: 0; } }
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
