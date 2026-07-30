/**
 * Apex PDF — Relatório de Faturamento vs Folha de Pagamento (documento impresso).
 *
 * Por que um shell próprio em vez do `report-shell` compartilhado: aquele shell
 * é o padrão claro de ~15 módulos do Financeiro e mudá-lo mudaria todos eles.
 * Este é material de investidor/board — tem o seu próprio documento, com as
 * mesmas fontes, a mesma paginação explícita ("Página N de TOTAL" calculado em
 * build time, porque o Chromium renderiza `counter(pages)` como 0) e as mesmas
 * travas de fonte de dado.
 *
 * Dois temas, mesma estrutura: `dark` (padrão, leitura em tela/projeção) e
 * `light` (documento para imprimir e anexar). O tema é só paleta — nenhuma
 * página, número ou seção muda entre eles.
 *
 * Camada de apresentação apenas — números vêm de `calculateInvestorPack`.
 */

import { buildGilroyFontFaceCss } from '@/lib/fonts';
import { esc } from '@/lib/reports/report-formatters';
import { buildReportFileName, openReport } from '@/lib/reports/report-export';
import type { ReportExportResult } from '@/lib/reports/report-types';
import {
  apexBalanceChart,
  apexChartCss,
  apexClientForecastChart,
  apexCoverageDial,
  apexCurveChart,
  apexLegend,
  apexLegendCss,
  apexMonthlyChart,
  balanceLegend,
  clientForecastColor,
  curveLegend,
  monthlyLegend,
} from './apex-charts';
import {
  buildApexInsights,
  curveReading,
  monthlyReading,
  type ApexInsightCard,
  type ApexInsights,
} from './apex-insights';
import { APEX_LOGO_ALT, APEX_LOGO_DATA_URI, APEX_LOGO_SMALL_DATA_URI } from './apex-logo';
import {
  APEX_CLIENT_FORECAST_DESCRIPTION,
  APEX_CLOSING_TITLE,
  APEX_FONT,
  APEX_SOURCE,
  REPORT_FILE_SLUG,
  REPORT_NAME,
  apexBackdrop,
  apexPalette,
  confidentialityLabel,
  dashIfZero,
  formatInvestorRatio,
  investorClosingMessage,
  type ApexPalette,
  type ApexThemeMode,
} from './apex-theme';
import { calculateInvestorPack, formatInvestorCurrency, formatInvestorPeriod } from './calculations';
import type { InvestorPack, InvestorPackSnapshot } from './types';

/** Linhas da base mensal por página impressa (A4 paisagem, corpo 10,5px). */
const TABLE_ROWS_PER_PAGE = 15;
/**
 * Carteira cabe inteira numa página: o backlog é lido como um bloco só — quebrá-lo
 * obrigava a comparar clientes virando a página. 18 é o teto que a altura útil
 * comporta na densidade compacta.
 */
const PORTFOLIO_ROWS_PER_PAGE = 18;
interface PageSpec {
  /** Sobrelinha da seção (canto superior esquerdo). */
  eyebrow: string;
  /** Corpo da página. */
  html: string;
  /** Capa recebe tratamento full-bleed sem cabeçalho de seção. */
  cover?: boolean;
}

function sectionHead(title: string, sub?: string): string {
  return `<div class="sec">
    <h2>${esc(title)}</h2>
    ${sub ? `<p class="sec-sub">${esc(sub)}</p>` : ''}
  </div>`;
}

function tile(label: string, value: string, accent: string, helper?: string): string {
  return `<div class="tile" style="--accent:${accent}">
    <span class="tile-l">${esc(label)}</span>
    <b class="tile-v">${esc(value)}</b>
    ${helper ? `<span class="tile-h">${esc(helper)}</span>` : ''}
  </div>`;
}

function insight(card: ApexInsightCard, P: ApexPalette): string {
  const accent = card.kind === 'alert' ? P.negative : card.kind === 'watch' ? P.attention : P.revenue;
  const kindLabel = card.kind === 'alert' ? 'Atenção' : card.kind === 'watch' ? 'Monitorar' : 'Sinal';
  return `<div class="ins" style="--accent:${accent}">
    <span class="ins-k">${esc(kindLabel)}</span>
    <b class="ins-v">${esc(card.value)}</b>
    <span class="ins-l">${esc(card.label)}</span>
    <p class="ins-d">${esc(card.detail)}</p>
  </div>`;
}

function panel(chartSvg: string, legendHtml: string, caption?: string): string {
  return `<div class="panel">${chartSvg}${legendHtml}${caption ? `<p class="panel-cap">${esc(caption)}</p>` : ''}</div>`;
}

/** Competência ainda não fechada — vira linha de projeção na base mensal. */
function isForecastPoint(point: InvestorPackSnapshot['points'][number]): boolean {
  return point.revenueForecastCents > 0 || point.payrollForecastCents > 0;
}

/**
 * Base mensal em uma única série de colunas (faturamento, folha, saldo,
 * acumulado). Realizado e projeção não disputam colunas paralelas: a projeção
 * entra na sequência cronológica, abaixo, marcada por cor — a leitura passa a
 * ser uma linha do tempo só, e não duas tabelas sobrepostas.
 */
function monthlyTableChunk(
  points: InvestorPackSnapshot['points'],
  snapshot: InvestorPackSnapshot,
  from: number,
  isLast: boolean,
  P: ApexPalette,
): string {
  const slice = points.slice(from, from + TABLE_ROWS_PER_PAGE);
  const rows = slice.map((point, index) => {
    const forecast = isForecastPoint(point);
    const globalIndex = from + index;
    const opensForecast = forecast && (globalIndex === 0 || !isForecastPoint(points[globalIndex - 1]));
    const split = opensForecast
      ? '<tr class="split"><td colspan="5">Projeção — competências ainda não fechadas</td></tr>'
      : '';
    const balanceColor = point.balanceCents < 0 ? P.negative : forecast ? P.revenueForecast : P.positive;
    return `${split}<tr${forecast ? ' class="fr"' : ''}>
      <td>${esc(formatInvestorPeriod(point.period))}</td>
      <td class="num">${esc(dashIfZero(point.revenueTotalCents, formatInvestorCurrency(point.revenueTotalCents)))}</td>
      <td class="num">${esc(dashIfZero(point.payrollTotalCents, formatInvestorCurrency(point.payrollTotalCents)))}</td>
      <td class="num" style="color:${balanceColor}">${esc(formatInvestorCurrency(point.balanceCents))}</td>
      <td class="num">${esc(formatInvestorCurrency(point.balanceCumulativeCents))}</td>
    </tr>`;
  }).join('');

  const m = snapshot.metrics;
  const foot = isLast ? `<tfoot>
    <tr class="sub">
      <td>Subtotal realizado</td>
      <td class="num">${esc(formatInvestorCurrency(m.revenueActualCents))}</td>
      <td class="num">${esc(formatInvestorCurrency(m.payrollActualCents))}</td>
      <td class="num">${esc(formatInvestorCurrency(m.revenueActualCents - m.payrollActualCents))}</td>
      <td class="num">—</td>
    </tr>
    <tr class="sub fr">
      <td>Subtotal projetado</td>
      <td class="num">${esc(formatInvestorCurrency(m.revenueForecastCents))}</td>
      <td class="num">${esc(formatInvestorCurrency(m.payrollForecastCents))}</td>
      <td class="num">${esc(formatInvestorCurrency(m.revenueForecastCents - m.payrollForecastCents))}</td>
      <td class="num">—</td>
    </tr>
    <tr>
      <td>Total do recorte</td>
      <td class="num">${esc(formatInvestorCurrency(m.revenueTotalCents))}</td>
      <td class="num">${esc(formatInvestorCurrency(m.payrollTotalCents))}</td>
      <td class="num">${esc(formatInvestorCurrency(m.balanceCents))}</td>
      <td class="num">${esc(formatInvestorCurrency(points.length ? points[points.length - 1].balanceCumulativeCents : 0))}</td>
    </tr>
  </tfoot>` : '';

  const cont = from > 0
    ? `<p class="cont-note">continuação — competências ${from + 1} a ${from + slice.length} de ${points.length}</p>`
    : '';

  return `${cont}<table class="data wide">
    <thead><tr>
      <th>Competência</th><th class="num">Faturamento</th>
      <th class="num">Folha + encargos</th>
      <th class="num">Saldo</th><th class="num">Acumulado</th>
    </tr></thead>
    <tbody>${rows}</tbody>${foot}
  </table>`;
}

function portfolioTableChunk(pack: InvestorPack, from: number, size = PORTFOLIO_ROWS_PER_PAGE): string {
  const clients = pack.narrative.portfolio.slice(from, from + size);
  return `<table class="data${clients.length > 12 ? ' dense' : ''}">
    <thead><tr><th>Cliente</th><th>Status</th><th class="num">Carteira</th><th class="num">Faturado</th>
      <th class="num">Backlog</th><th class="num">A receber</th><th class="num">Até 2028</th><th class="num">Pós-2028</th></tr></thead>
    <tbody>${clients.map((client) => `<tr>
      <td>${esc(client.client)}</td><td>${esc(client.status)}</td>
      <td class="num">${esc(formatInvestorCurrency(client.portfolioCents))}</td>
      <td class="num">${esc(formatInvestorCurrency(client.billedCents))}</td>
      <td class="num fc">${esc(formatInvestorCurrency(client.backlogCents))}</td>
      <td class="num">${esc(formatInvestorCurrency(client.receivableCents))}</td>
      <td class="num">${esc(formatInvestorCurrency(client.projectedThrough2028Cents))}</td>
      <td class="num">${esc(formatInvestorCurrency(client.remainingAfter2028Cents))}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function buildPages(pack: InvestorPack, snapshot: InvestorPackSnapshot, insights: ApexInsights, P: ApexPalette): PageSpec[] {
  const { metrics, points } = snapshot;
  const period = `${formatInvestorPeriod(pack.periodStart)} — ${formatInvestorPeriod(pack.periodEnd)}`;
  const confidential = confidentialityLabel(pack.confidentiality);
  const verdictAccent = insights.verdict === 'deficit'
    ? P.negative
    : insights.verdict === 'balanced' ? P.attention : P.revenue;
  const pages: PageSpec[] = [];

  /* 01 — Capa */
  pages.push({
    eyebrow: '',
    cover: true,
    html: `<div class="cover">
      <div class="cover-top">
        <span class="cover-logo" role="img" aria-label="${esc(APEX_LOGO_ALT)}"></span>
        <span class="conf">${esc(confidential)}</span>
      </div>
      <div class="cover-mid">
        ${pack.title.trim().toLowerCase() === REPORT_NAME.toLowerCase()
          ? ''
          : `<span class="cover-kicker">${esc(REPORT_NAME)}</span>`}
        <h1>${esc(pack.title)}</h1>
        <p class="cover-company">${esc(pack.company || 'Visão financeira executiva')}</p>
        <div class="cover-verdict" style="--accent:${verdictAccent}">
          <b>${esc(insights.coverageLabel)}</b>
          <span>${esc(insights.verdictLabel)}<em>cobertura receita / folha</em></span>
        </div>
      </div>
      <div class="cover-tiles">
        ${tile('Faturamento realizado', formatInvestorCurrency(metrics.revenueActualCents, true), P.revenue)}
        ${tile('Faturamento previsto', formatInvestorCurrency(metrics.revenueForecastCents, true), P.revenueForecast)}
        ${tile('Folha total', formatInvestorCurrency(metrics.payrollTotalCents, true), P.payrollForecast)}
        ${tile('Saldo acumulado', formatInvestorCurrency(insights.closingBalanceCents, true), insights.closingBalanceCents >= 0 ? P.positive : P.negative)}
      </div>
      <div class="cover-meta">
        <span><em>Período</em><strong>${esc(period)}</strong></span>
        <span><em>Data-base</em><strong>${esc(pack.referenceDate)}</strong></span>
        <span><em>Versão</em><strong>${pack.version} · ${esc(pack.status === 'published' ? 'Publicado' : pack.status === 'archived' ? 'Arquivado' : 'Rascunho')}</strong></span>
        <span><em>Preparado por</em><strong>${esc(pack.authorName || 'Financeiro')}</strong></span>
        <span><em>Gerado em</em><strong>${esc(new Date().toLocaleString('pt-BR'))}</strong></span>
      </div>
    </div>`,
  });

  /* 02 — Síntese executiva */
  pages.push({
    eyebrow: 'Síntese executiva',
    html: `${sectionHead(insights.verdictHeadline)}
    <div class="exec">
      <div>
        <p class="copy">${esc(pack.narrative.executiveSummary || 'Resumo executivo não informado.')}</p>
        <div class="tiles four">
          ${tile('Faturamento realizado', formatInvestorCurrency(metrics.revenueActualCents, true), P.revenue, `${insights.realizedMonths} competência(s)`)}
          ${tile('Faturamento previsto', formatInvestorCurrency(metrics.revenueForecastCents, true), P.revenueForecast, insights.forecastShare == null ? undefined : `${(insights.forecastShare * 100).toFixed(0)}% da receita`)}
          ${tile('Folha total', formatInvestorCurrency(metrics.payrollTotalCents, true), P.payrollForecast, 'fechada + projetada')}
          ${tile('Saldo acumulado', formatInvestorCurrency(insights.closingBalanceCents, true), insights.closingBalanceCents >= 0 ? P.positive : P.negative, 'no fecho do recorte')}
        </div>
      </div>
      <div class="dial">
        ${apexCoverageDial(metrics.coverageRatio, { size: 210, palette: P })}
        <p class="dial-label">Cobertura receita / folha</p>
        <p class="dial-note">Marca central do arco = ponto de equilíbrio (1,00x). ${insights.coverageMarginPct == null
          ? 'Sem folha informada no recorte.'
          : `${insights.coverageMarginPct >= 0 ? '+' : ''}${insights.coverageMarginPct.toFixed(0)} p.p. em relação ao equilíbrio.`}</p>
      </div>
    </div>
    <div class="ins-grid">${insights.cards.slice(0, 4).map((card) => insight(card, P)).join('')}</div>`,
  });

  /* 04 — Evolução mensal */
  pages.push({
    eyebrow: 'Evolução mensal',
    html: `${sectionHead('Receita e folha, competência a competência', monthlyReading(insights))}
    ${panel(apexMonthlyChart(points, { width: 1180, height: 505, palette: P }), apexLegend(monthlyLegend(P)))}
    <div class="read">
      ${insights.peakRevenue && insights.peakRevenue.valueCents > 0 ? `<span><em>Pico de receita</em><strong>${esc(insights.peakRevenue.label)} · ${esc(formatInvestorCurrency(insights.peakRevenue.valueCents, true))}</strong></span>` : ''}
      ${insights.peakPayroll && insights.peakPayroll.valueCents > 0 ? `<span><em>Pico de folha</em><strong>${esc(insights.peakPayroll.label)} · ${esc(formatInvestorCurrency(insights.peakPayroll.valueCents, true))}</strong></span>` : ''}
      ${insights.tightestCoverage ? `<span><em>Mês mais apertado</em><strong>${esc(insights.tightestCoverage.label)} · ${esc(formatInvestorRatio(insights.tightestCoverage.ratio))}</strong></span>` : ''}
      ${insights.averageBalanceCents == null ? '' : `<span><em>Saldo mensal médio</em><strong>${esc(formatInvestorCurrency(insights.averageBalanceCents, true))}</strong></span>`}
    </div>`,
  });

  /* 04 — Curva S */
  pages.push({
    eyebrow: 'Curva S acumulada',
    html: `${sectionHead('A trajetória acumulada do período', curveReading(insights))}
    ${panel(apexCurveChart(points, { width: 1180, height: 505, palette: P }), apexLegend(curveLegend(P)))}
    <div class="read">
      <span><em>Receita acumulada</em><strong>${esc(formatInvestorCurrency(metrics.revenueTotalCents, true))}</strong></span>
      <span><em>Folha acumulada</em><strong>${esc(formatInvestorCurrency(metrics.payrollTotalCents, true))}</strong></span>
      <span><em>Saldo no fecho</em><strong style="color:${insights.closingBalanceCents >= 0 ? P.positive : P.negative}">${esc(formatInvestorCurrency(insights.closingBalanceCents, true))}</strong></span>
      ${insights.firstCumulativeDeficit ? `<span><em>Acumulado negativo desde</em><strong style="color:${P.negative}">${esc(insights.firstCumulativeDeficit.label)}</strong></span>` : ''}
    </div>`,
  });

  /* 05 — Saldo mensal e acumulado */
  pages.push({
    eyebrow: 'Saldo mensal e acumulado',
    html: `${sectionHead(
      'Onde o período gera e onde consome resultado',
      insights.deficitMonths.length
        ? `${insights.deficitMonths.length} competência(s) com saldo mensal negativo: ${insights.deficitMonths.map((m) => m.label).join(', ')}.`
        : 'Nenhuma competência do recorte fecha com saldo mensal negativo.',
    )}
    ${panel(apexBalanceChart(points, { width: 1180, height: 475, palette: P }), apexLegend(balanceLegend(P)), 'Colunas: saldo do mês (eixo esquerdo). Linha: saldo acumulado (eixo direito).')}
    <div class="read">
      ${insights.bestBalance ? `<span><em>Melhor mês</em><strong style="color:${P.positive}">${esc(insights.bestBalance.label)} · ${esc(formatInvestorCurrency(insights.bestBalance.valueCents, true))}</strong></span>` : ''}
      ${insights.worstBalance ? `<span><em>Pior mês</em><strong style="color:${insights.worstBalance.valueCents < 0 ? P.negative : P.body}">${esc(insights.worstBalance.label)} · ${esc(formatInvestorCurrency(insights.worstBalance.valueCents, true))}</strong></span>` : ''}
      <span><em>Competências no recorte</em><strong>${points.length}</strong></span>
    </div>`,
  });

  /* Último gráfico — projeção por cliente */
  if (pack.narrative.clientForecasts.length) {
    const clientIds = [...new Map(pack.narrative.clientForecasts.map((item) => [item.clientId, item.client])).entries()];
    pages.push({
      eyebrow: 'Projeção por cliente',
      html: `${sectionHead('Quem compõe o faturamento projetado', APEX_CLIENT_FORECAST_DESCRIPTION)}
      ${panel(
        apexClientForecastChart(pack.narrative.clientForecasts, points.map((point) => point.period), { width: 1180, height: 525, palette: P }),
        apexLegend(clientIds.map(([clientId, client], index) => ({ label: client, color: clientForecastColor(clientId, index, P) }))),
      )}`,
    });
  }

  /* 06+ — Base mensal informada (paginada) */
  const tablePages = Math.max(1, Math.ceil(points.length / TABLE_ROWS_PER_PAGE));
  for (let i = 0; i < tablePages; i += 1) {
    const from = i * TABLE_ROWS_PER_PAGE;
    pages.push({
      eyebrow: 'Base mensal informada',
      html: `${i === 0 ? sectionHead('Todos os valores por trás dos gráficos', `${APEX_SOURCE}. As competências projetadas seguem na sequência cronológica, destacadas em cor.`) : ''}
      ${monthlyTableChunk(points, snapshot, from, i === tablePages - 1, P)}`,
    });
  }

  if (pack.narrative.portfolio.length) {
    const portfolioPages = Math.ceil(pack.narrative.portfolio.length / PORTFOLIO_ROWS_PER_PAGE);
    for (let i = 0; i < portfolioPages; i += 1) {
      pages.push({
        eyebrow: 'Carteira e recebíveis',
        html: `${sectionHead(
          i === 0 ? 'Backlog que sustenta a projeção' : 'Carteira e recebíveis — continuação',
          i === 0 ? 'Saldo a receber conforme informado na planilha de carteira; não equivale necessariamente a caixa recebido.' : undefined,
        )}
        ${portfolioTableChunk(pack, i * PORTFOLIO_ROWS_PER_PAGE)}`,
      });
    }
  }

  /* Último — Fecho */
  pages.push({
    eyebrow: 'Perspectiva e próximos passos',
    html: `<div class="closing">
      ${sectionHead(APEX_CLOSING_TITLE)}
      <blockquote>${esc(investorClosingMessage(pack.narrative.closingMessage))}</blockquote>
      <div class="sign">
        <span><em>Preparado por</em><strong>${esc(pack.authorName || 'Financeiro')}</strong></span>
        <span><em>Data-base</em><strong>${esc(pack.referenceDate)}</strong></span>
        <span><em>Classificação</em><strong>${esc(confidential)}</strong></span>
      </div>
      <p class="fine">${esc(APEX_SOURCE)}. Valores em BRL. Este documento reflete o recorte de período selecionado na Projeção Financeira no momento da geração.</p>
    </div>`,
  });

  return pages;
}

function documentCss(P: ApexPalette): string {
  const backdrop = apexBackdrop({ intensity: 0.85, palette: P });
  const light = P.mode === 'light';
  /**
   * Superfície de cartão/painel: no escuro é vidro translúcido (deixa a malha do
   * fundo aparecer); no claro é papel opaco levemente tingido.
   */
  const surface = (from = 0.92, to = 0.55) => light
    ? `linear-gradient(160deg, ${P.panelTop} 0%, ${P.panelBottom} 100%)`
    : `linear-gradient(160deg, rgba(12, 28, 36, ${from}), rgba(6, 18, 26, ${to}))`;
  return `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: ${P.void}; color: ${P.ink};
    font-family: ${APEX_FONT}; font-size: 13.5px; line-height: 1.5;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  .page { position: relative; display: flex; flex-direction: column; gap: 10px;
    height: 186mm; overflow: hidden; padding: 0;
    background-color: ${P.void}; background-image: ${backdrop.image}; background-size: ${backdrop.size}; }
  .page-break { page-break-before: always; }
  .page::before { content: ''; position: absolute; inset: 0; border: 1px solid ${P.lineSoft};
    border-radius: 14px; pointer-events: none; }
  .page-inner { position: relative; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column;
    gap: 8px; padding: 8mm 8mm 0; }

  .phead { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; }
  .eyebrow { font-size: 9px; font-weight: 700; letter-spacing: .2em; text-transform: uppercase; color: ${P.revenue}; }
  .phead .no { font-size: 9px; letter-spacing: .16em; color: ${P.subtle}; font-variant-numeric: tabular-nums; }
  .pfoot { display: flex; justify-content: space-between; align-items: center; gap: 14px;
    margin: 0 8mm; padding: 4px 0 5mm; border-top: 1px solid ${P.lineSoft};
    font-size: 8.5px; color: ${P.subtle}; }
  .pfoot b { color: ${P.muted}; font-weight: 600; }
  .pf-brand { display: inline-flex; align-items: center; gap: 7px; }
  .pf-logo { display: inline-block; width: 79px; height: 10px; flex: 0 0 auto;
    background: url('${APEX_LOGO_SMALL_DATA_URI}') left center / contain no-repeat; }

  .sec h2 { margin: 0; font-size: 19px; font-weight: 700; letter-spacing: -.02em; color: ${P.ink}; max-width: 62ch; }
  .sec-sub { margin: 3px 0 0; font-size: 11px; color: ${P.muted}; max-width: 96ch; }
  .copy { margin: 0 0 9px; font-size: 12px; line-height: 1.55; color: ${P.body}; max-width: 60ch; }
  .empty { font-size: 11px; color: ${P.subtle}; font-style: italic; margin: 0; }

  /* Capa */
  .cover { flex: 1 1 auto; display: flex; flex-direction: column; padding: 12mm 12mm 0; }
  .cover-top { display: flex; justify-content: space-between; align-items: center; }
  .cover-logo { display: block; height: 15mm; width: 118mm;
    background: url('${APEX_LOGO_DATA_URI}') left center / contain no-repeat; }
  .cover-kicker { display: block; margin-bottom: 7px; font-size: 10px; font-weight: 700; letter-spacing: .2em;
    text-transform: uppercase; color: ${P.revenue}; }
  .brand { display: inline-flex; align-items: center; gap: 7px; font-size: 10px; font-weight: 700;
    letter-spacing: .2em; text-transform: uppercase; color: ${P.muted}; }
  .brand-dot { width: 7px; height: 7px; border-radius: 50%; background: ${P.revenue};
    box-shadow: 0 0 0 3px rgba(53, 230, 187, .16); }
  .conf { font-size: 9.5px; font-weight: 700; letter-spacing: .18em; color: ${P.revenue};
    border: 1px solid ${P.line}; border-radius: 999px; padding: 3px 11px; }
  .cover-mid { margin-top: auto; }
  .cover h1 { margin: 0; font-size: 45px; line-height: .98; letter-spacing: -.045em; max-width: 22ch; }
  .cover-company { margin: 10px 0 0; font-size: 15.5px; color: ${P.muted}; }
  .cover-verdict { display: inline-flex; align-items: center; gap: 12px; margin-top: 18px;
    padding: 8px 16px; border-radius: 12px; border: 1px solid var(--accent);
    background: ${light ? P.panelTop : 'linear-gradient(135deg, rgba(255, 255, 255, .05), transparent)'}; }
  .cover-verdict b { font-size: 32px; letter-spacing: -.04em; color: var(--accent); font-variant-numeric: tabular-nums; }
  .cover-verdict span { display: flex; flex-direction: column; font-size: 12px; font-weight: 600; color: ${P.ink}; }
  .cover-verdict em { font-style: normal; font-size: 9px; letter-spacing: .14em; text-transform: uppercase; color: ${P.subtle}; }
  .cover-tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 22px; }
  .cover-meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 26px; margin: 18px 0 4mm; }
  .cover-meta span { display: flex; flex-direction: column; gap: 2px; }
  .cover-meta em { font-style: normal; font-size: 8.5px; letter-spacing: .15em; text-transform: uppercase; color: ${P.subtle}; }
  .cover-meta strong { font-size: 12px; font-weight: 600; color: ${P.body}; }

  /* Cartões de valor */
  .tiles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .tiles.four { grid-template-columns: repeat(4, 1fr); }
  .tile { position: relative; padding: 9px 11px 8px; border-radius: 10px; border: 1px solid ${P.lineSoft};
    background: ${surface()}; overflow: hidden; }
  .tile::before { content: ''; position: absolute; inset: 0 0 auto 0; height: 2px; background: var(--accent); }
  .tile-l { display: block; font-size: 8.5px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: ${P.subtle}; }
  .tile-v { display: block; margin-top: 4px; font-size: 18px; letter-spacing: -.03em; color: var(--accent);
    font-variant-numeric: tabular-nums; }
  .tile-h { display: block; margin-top: 3px; font-size: 9px; color: ${P.subtle}; }

  /* Síntese */
  .exec { flex: 1 1 auto; display: grid; grid-template-columns: 1.5fr .5fr; gap: 18px; align-items: center; }
  .dial { display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .apex-dial { width: 100%; max-width: 190px; height: auto; }
  .dial-label { margin: 0; font-size: 9px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase;
    color: ${P.muted}; text-align: center; }
  .dial-note { margin: 3px 0 0; font-size: 9px; line-height: 1.4; color: ${P.subtle}; text-align: center; max-width: 34ch; }

  .ins-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: auto; }
  .ins { padding: 9px 11px; border-radius: 11px; border: 1px solid ${P.lineSoft}; border-left: 2px solid var(--accent);
    background: ${surface(0.92, 0.5)}; }
  .ins-k { font-size: 8px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--accent); }
  .ins-v { display: block; margin: 4px 0 1px; font-size: 16px; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
  .ins-l { display: block; font-size: 9px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: ${P.muted}; }
  .ins-d { margin: 5px 0 0; font-size: 9.5px; line-height: 1.4; color: ${P.subtle}; }

  /* Painéis de gráfico */
  .panel { border: 1px solid ${P.lineSoft}; border-radius: 14px; padding: 9px 11px 8px;
    background: ${surface(0.7, 0.4)}; }
  .panel-cap { margin: 6px 0 0; font-size: 9px; color: ${P.subtle}; }
  .read { display: flex; flex-wrap: wrap; gap: 6px 28px; margin-top: auto; padding-top: 6px;
    border-top: 1px solid ${P.lineSoft}; }
  .read span { display: flex; flex-direction: column; gap: 1px; }
  .read em { font-style: normal; font-size: 8.5px; letter-spacing: .14em; text-transform: uppercase; color: ${P.subtle}; }
  .read strong { font-size: 12.5px; font-weight: 700; color: ${P.ink}; font-variant-numeric: tabular-nums; }

  /* Tabela */
  table.data { width: 100%; border-collapse: collapse; font-size: 10.5px; font-variant-numeric: tabular-nums; }
  table.data thead th { text-align: left; padding: 7px 8px; font-size: 8.5px; font-weight: 700;
    letter-spacing: .1em; text-transform: uppercase; color: ${P.muted};
    background: ${P.raised}; border-bottom: 1px solid ${P.line}; }
  table.data thead th.num { text-align: right; }
  table.data tbody td { padding: 6px 8px; border-bottom: 1px solid ${P.lineSoft}; color: ${P.body}; }
  table.data tbody td.num { text-align: right; }
  table.data tbody td.fc { color: ${P.revenueForecast}; }
  table.data tbody tr:nth-child(even) td { background: ${light ? 'rgba(11, 26, 32, .02)' : 'rgba(255, 255, 255, .018)'}; }
  table.data td.note { color: ${P.subtle}; font-size: 9.5px; max-width: 46mm; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; }
  table.data tfoot td { padding: 7px 8px; border-top: 1px solid ${P.line}; font-weight: 700; color: ${P.ink};
    background: ${P.raised}; }
  table.data tfoot td.num { text-align: right; }
  table.data tfoot tr.sub td { font-weight: 600; color: ${P.muted}; background: transparent;
    border-top: 1px solid ${P.lineSoft}; }
  /* Base mensal: menos colunas, então a competência ganha respiro. */
  table.data.wide tbody td, table.data.wide tfoot td { padding-top: 7px; padding-bottom: 7px; }
  /* Densidade compacta para a carteira caber inteira em uma página. */
  table.data.dense tbody td { padding: 4px 7px; font-size: 10px; }

  /* Linhas de projeção: mesma sequência cronológica, cor distinta. */
  table.data tbody tr.fr td, table.data tfoot tr.fr td { color: ${P.revenueForecast}; }
  table.data tbody tr.split td { padding: 7px 8px 4px; border-bottom: 1px solid ${P.revenueForecast};
    background: transparent !important; color: ${P.revenueForecast};
    font-size: 8.5px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
  .cont-note { margin: 0 0 4px; font-size: 8.5px; letter-spacing: .1em; text-transform: uppercase; color: ${P.subtle}; }

  /* Colunas de premissas */
  .cols { flex: 1 1 auto; display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; align-content: center; }
  .col { border-top: 2px solid var(--accent); padding-top: 9px; }
  .col h3 { margin: 0 0 7px; font-size: 10px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--accent); }
  .col .cont { font-weight: 400; letter-spacing: .06em; color: ${P.subtle}; }
  .col ul { margin: 0; padding-left: 15px; }
  .col li { font-size: 11.5px; line-height: 1.45; color: ${P.body}; margin-bottom: 6px; }
  .dq { margin-top: auto; border-radius: 12px; padding: 9px 13px; border: 1px solid; }
  .dq.warn { border-color: rgba(255, 183, 77, .38); background: rgba(255, 183, 77, .07); }
  .dq.ok { border-color: rgba(53, 230, 187, .32); background: rgba(53, 230, 187, .06); }
  .dq b { font-size: 9px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
  .dq.warn b { color: ${P.attention}; }
  .dq.ok b { color: ${P.revenue}; }
  .dq ul { margin: 5px 0 0; padding-left: 15px; }
  .dq li { font-size: 11px; color: ${P.body}; margin-bottom: 3px; }

  /* Fecho */
  .closing { flex: 1 1 auto; display: flex; flex-direction: column; justify-content: center; }
  .closing blockquote { margin: 18px 0 0; padding-left: 18px; border-left: 2px solid ${P.revenue};
    font-size: 21px; line-height: 1.35; color: ${P.quote}; max-width: 44ch; }
  .sign { display: flex; flex-wrap: wrap; gap: 10px 34px; margin-top: 28px; }
  .sign span { display: flex; flex-direction: column; gap: 2px; }
  .sign em { font-style: normal; font-size: 8.5px; letter-spacing: .15em; text-transform: uppercase; color: ${P.subtle}; }
  .sign strong { font-size: 12.5px; font-weight: 600; color: ${P.body}; }
  .fine { margin: 26px 0 0; font-size: 9px; color: ${P.subtle}; max-width: 100ch; }

${apexChartCss(P)}
${apexLegendCss(P)}
  .panel .apex-chart { height: auto; }

  /* Barra de ação (só em tela) */
  .toolbar { position: fixed; bottom: 16px; right: 16px; z-index: 30; display: flex; flex-direction: column; gap: 7px;
    max-width: 330px; padding: 10px 12px; border: 1px solid ${P.line}; border-radius: 12px;
    background: ${light ? 'rgba(255, 255, 255, .97)' : 'rgba(6, 16, 22, .95)'};
    box-shadow: 0 18px 40px rgba(0, 0, 0, ${light ? '.2' : '.5'}); }
  .toolbar-row { display: flex; gap: 8px; }
  .toolbar button { flex: 1 1 auto; padding: 7px 12px; border: 0; border-radius: 8px; cursor: pointer;
    font-family: inherit; font-size: 11px; font-weight: 700; color: ${light ? '#FFFFFF' : P.void}; background: ${P.revenue}; }
  .toolbar button.alt { color: ${P.body}; background: transparent; border: 1px solid ${P.line}; }
  .toolbar-hint { font-size: 9px; line-height: 1.45; color: ${P.muted}; }
  .toolbar-hint b { color: ${P.ink}; }

  @media screen {
    body { background: ${light ? '#E7EDF0' : '#02060A'}; padding: 18px 0; }
    .page { width: 297mm; margin: 0 auto 18px; border-radius: 10px;
      box-shadow: 0 24px 60px rgba(0, 0, 0, ${light ? '.18' : '.6'}); }
  }
  @media print { .no-print { display: none !important; } .page { margin: 0; border-radius: 0; } }
`;
}

export interface InvestorPackPdfOptions {
  /** Tema do documento. Omitido = escuro. */
  theme?: ApexThemeMode;
}

export function buildInvestorPackPdfHtml(pack: InvestorPack, options?: InvestorPackPdfOptions): string {
  const mode: ApexThemeMode = options?.theme ?? 'dark';
  const P = apexPalette(mode);
  const snapshot = calculateInvestorPack(pack);
  const insights = buildApexInsights(snapshot);
  const pages = buildPages(pack, snapshot, insights, P);
  const total = pages.length;
  const fileName = buildReportFileName({
    module: 'financeiro',
    context: `${REPORT_FILE_SLUG}-v${pack.version}`,
  });
  const confidential = confidentialityLabel(pack.confidentiality);

  const pagesHtml = pages.map((page, index) => `
  <section class="page${index > 0 ? ' page-break' : ''}">
    <div class="page-inner">
      ${page.cover ? '' : `<div class="phead"><span class="eyebrow">${esc(page.eyebrow)}</span><span class="no">${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span></div>`}
      ${page.html}
    </div>
    <div class="pfoot">
      <span class="pf-brand">
        <span class="pf-logo" role="img" aria-label="${esc(APEX_LOGO_ALT)}"></span>
        <span>${esc(REPORT_NAME)} · v${pack.version} · ${esc(confidential)}</span>
      </span>
      <span>${esc(APEX_SOURCE)}</span>
      <span>Página ${index + 1} de ${total}</span>
    </div>
  </section>`).join('');

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" />
<meta name="color-scheme" content="${mode}" />
<title>${esc(fileName)}</title>
<style>
${buildGilroyFontFaceCss()}
  @page { size: A4 landscape; margin: 0; }
${documentCss(P)}
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
          pages[i].style.outline = '2px dashed ${P.negative}';
          console.warn('[apex] Página ' + (i + 1) + ' excede a altura útil.');
        }
      }
    });
  </script>
</body></html>`;
}

export function openInvestorPackPdf(pack: InvestorPack, options?: InvestorPackPdfOptions): ReportExportResult {
  try {
    return openReport(buildInvestorPackPdfHtml(pack, options), { width: 1320, height: 900 });
  } catch (error) {
    return {
      ok: false,
      reason: 'error',
      message: error instanceof Error ? error.message : 'Falha ao gerar o relatório.',
    };
  }
}
