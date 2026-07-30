/**
 * Apresentação HTML do Relatório de Faturamento vs Folha de Pagamento — deck
 * executivo autônomo.
 *
 * Um único arquivo, sem CDN, sem autenticação e sem identificadores internos:
 * pode ser enviado por e-mail, aberto offline e projetado em reunião. Navegação
 * por teclado, gesto, índice visual e tela cheia.
 *
 * Camada de apresentação apenas: números vêm de `calculateInvestorPack` e a
 * leitura editorial vem de `buildApexInsights` — nenhuma regra financeira aqui.
 */

import { esc } from '@/lib/reports/report-formatters';
import {
  APEX_CHART_ANIM_CSS,
  APEX_CHART_CSS,
  APEX_LEGEND_CSS,
  BALANCE_LEGEND,
  CURVE_LEGEND,
  MONTHLY_LEGEND,
  apexBalanceChart,
  apexClientForecastChart,
  apexCoverageDial,
  apexCurveChart,
  apexLegend,
  apexMonthlyChart,
  clientForecastColor,
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
  APEX,
  APEX_CLIENT_FORECAST_DESCRIPTION,
  APEX_CLOSING_TITLE,
  APEX_FONT,
  APEX_SOURCE,
  REPORT_FILE_SLUG,
  REPORT_NAME,
  REPORT_NAME_SHORT,
  apexBackdrop,
  confidentialityLabel,
  dashIfZero,
  investorClosingMessage,
} from './apex-theme';
import { calculateInvestorPack, formatInvestorCurrency, formatInvestorPeriod } from './calculations';
import type { InvestorPack, InvestorPackSnapshot } from './types';

function kpiTile(label: string, value: string, accent: string, helper?: string): string {
  return `<div class="tile" style="--accent:${accent}">
    <span class="tile-l">${esc(label)}</span>
    <b class="tile-v">${esc(value)}</b>
    ${helper ? `<span class="tile-h">${esc(helper)}</span>` : ''}
  </div>`;
}

function insightCard(card: ApexInsightCard): string {
  const accent = card.kind === 'alert' ? APEX.negative : card.kind === 'watch' ? APEX.attention : APEX.revenue;
  const kindLabel = card.kind === 'alert' ? 'Atenção' : card.kind === 'watch' ? 'Monitorar' : 'Sinal';
  return `<article class="ins" style="--accent:${accent}">
    <span class="ins-k">${esc(kindLabel)}</span>
    <b class="ins-v">${esc(card.value)}</b>
    <span class="ins-l">${esc(card.label)}</span>
    <p class="ins-d">${esc(card.detail)}</p>
  </article>`;
}

function monthlyTable(snapshot: InvestorPackSnapshot): string {
  const rows = snapshot.points.map((point) => `<tr>
    <td>${esc(formatInvestorPeriod(point.period))}</td>
    <td class="num">${esc(dashIfZero(point.revenueActualCents, formatInvestorCurrency(point.revenueActualCents)))}</td>
    <td class="num fc">${esc(dashIfZero(point.revenueForecastCents, formatInvestorCurrency(point.revenueForecastCents)))}</td>
    <td class="num">${esc(dashIfZero(point.payrollActualCents, formatInvestorCurrency(point.payrollActualCents)))}</td>
    <td class="num fc">${esc(dashIfZero(point.payrollForecastCents, formatInvestorCurrency(point.payrollForecastCents)))}</td>
    <td class="num" style="color:${point.balanceCents >= 0 ? APEX.positive : APEX.negative}">${esc(formatInvestorCurrency(point.balanceCents))}</td>
    <td class="num">${esc(formatInvestorCurrency(point.balanceCumulativeCents))}</td>
  </tr>`).join('');
  const m = snapshot.metrics;
  return `<div class="table-wrap"><table class="deck-table">
    <thead><tr>
      <th>Competência</th><th class="num">Fat. realizado</th><th class="num">Fat. previsto</th>
      <th class="num">Folha + encargos</th><th class="num">Folha projetada</th><th class="num">Saldo</th><th class="num">Acumulado</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr>
      <td>Total do recorte</td>
      <td class="num">${esc(formatInvestorCurrency(m.revenueActualCents))}</td>
      <td class="num">${esc(formatInvestorCurrency(m.revenueForecastCents))}</td>
      <td class="num">${esc(formatInvestorCurrency(m.payrollActualCents))}</td>
      <td class="num">${esc(formatInvestorCurrency(m.payrollForecastCents))}</td>
      <td class="num">${esc(formatInvestorCurrency(m.balanceCents))}</td>
      <td class="num">${esc(formatInvestorCurrency(snapshot.points.length ? snapshot.points[snapshot.points.length - 1].balanceCumulativeCents : 0))}</td>
    </tr></tfoot>
  </table></div>`;
}

function portfolioTable(pack: InvestorPack): string {
  const rows = pack.narrative.portfolio.map((client) => `<tr>
    <td>${esc(client.client)}</td><td>${esc(client.status)}</td>
    <td class="num">${esc(formatInvestorCurrency(client.portfolioCents))}</td>
    <td class="num">${esc(formatInvestorCurrency(client.billedCents))}</td>
    <td class="num fc">${esc(formatInvestorCurrency(client.backlogCents))}</td>
    <td class="num">${esc(formatInvestorCurrency(client.receivableCents))}</td>
    <td class="num">${esc(formatInvestorCurrency(client.projectedThrough2028Cents))}</td>
    <td class="num">${esc(formatInvestorCurrency(client.remainingAfter2028Cents))}</td>
  </tr>`).join('');
  return `<div class="table-wrap"><table class="deck-table">
    <thead><tr><th>Cliente</th><th>Status</th><th class="num">Carteira</th><th class="num">Faturado</th>
      <th class="num">Backlog</th><th class="num">Saldo a receber</th><th class="num">Até 2028</th><th class="num">Pós-2028</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

export function investorPackFileStem(pack: InvestorPack): string {
  const slug = pack.title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  return `${REPORT_FILE_SLUG}-${slug || 'relatorio'}-${pack.referenceDate}`;
}

interface Slide {
  /** Rótulo curto usado no índice e no trilho de progresso. */
  nav: string;
  /** Sobrelinha da seção. */
  eyebrow: string;
  html: string;
}

function buildSlides(pack: InvestorPack, snapshot: InvestorPackSnapshot, insights: ApexInsights): Slide[] {
  const { metrics, points } = snapshot;
  const period = `${formatInvestorPeriod(pack.periodStart)} — ${formatInvestorPeriod(pack.periodEnd)}`;
  const confidential = confidentialityLabel(pack.confidentiality);
  const slides: Slide[] = [];

  /* 01 — Capa */
  slides.push({
    nav: 'Capa',
    eyebrow: `${REPORT_NAME_SHORT} · ${confidential}`,
    html: `<div class="hero">
      <span class="hero-logo" role="img" aria-label="${esc(APEX_LOGO_ALT)}"></span>
      ${pack.title.trim().toLowerCase() === REPORT_NAME.toLowerCase()
        ? ''
        : `<div class="hero-mark"><span class="hero-dot"></span>${esc(REPORT_NAME)}</div>`}
      <h1>${esc(pack.title)}</h1>
      <p class="lede">${esc(pack.company || 'Visão financeira executiva')}</p>
      <div class="meta">
        <span><em>Período</em><strong>${esc(period)}</strong></span>
        <span><em>Data-base</em><strong>${esc(pack.referenceDate)}</strong></span>
        <span><em>Versão</em><strong>${pack.version}</strong></span>
      </div>
      <div class="hero-verdict" style="--accent:${insights.verdict === 'deficit' ? APEX.negative : insights.verdict === 'balanced' ? APEX.attention : APEX.revenue}">
        <b>${esc(insights.coverageLabel)}</b>
        <span>${esc(insights.verdictLabel)} · cobertura receita / folha</span>
      </div>
    </div>`,
  });

  /* 02 — Roteiro */
  slides.push({
    nav: 'Roteiro',
    eyebrow: 'Roteiro da apresentação',
    html: `<div class="stack">
      <h2>O que esta leitura cobre</h2>
      <ol class="agenda">
        <li><b>Síntese executiva</b><span>Cobertura, saldo e o número que resume o período</span></li>
        <li><b>Leitura do período</b><span>Sinais, pontos de atenção e concentrações</span></li>
        <li><b>Evolução mensal</b><span>Receita e folha competência a competência</span></li>
        <li><b>Curva S acumulada</b><span>Trajetória e zona de previsão</span></li>
        <li><b>Saldo e acumulado</b><span>Onde o período gera e onde consome resultado</span></li>
        <li><b>Projeção por cliente</b><span>Composição do faturamento projetado</span></li>
        <li><b>Base informada</b><span>Todos os valores que sustentam os gráficos</span></li>
      </ol>
    </div>`,
  });

  /* 03 — Síntese executiva */
  slides.push({
    nav: 'Síntese',
    eyebrow: 'Síntese executiva',
    html: `<div class="stack">
      <h2>${esc(insights.verdictHeadline)}</h2>
      <div class="split">
        <div>
          <p class="copy">${esc(pack.narrative.executiveSummary || 'Preencha o resumo executivo para contextualizar a trajetória financeira apresentada.')}</p>
          <div class="tiles">
            ${kpiTile('Faturamento realizado', formatInvestorCurrency(metrics.revenueActualCents, true), APEX.revenue, `${insights.realizedMonths} competência(s)`)}
            ${kpiTile('Faturamento previsto', formatInvestorCurrency(metrics.revenueForecastCents, true), APEX.revenueForecast, insights.forecastShare == null ? undefined : `${(insights.forecastShare * 100).toFixed(0)}% da receita`)}
            ${kpiTile('Folha total', formatInvestorCurrency(metrics.payrollTotalCents, true), APEX.payrollForecast, 'fechada + projetada')}
            ${kpiTile('Saldo acumulado', formatInvestorCurrency(insights.closingBalanceCents, true), insights.closingBalanceCents >= 0 ? APEX.positive : APEX.negative, 'no fecho do recorte')}
          </div>
        </div>
        <div class="dial-wrap">
          ${apexCoverageDial(metrics.coverageRatio, { size: 280, animate: true })}
          <p class="dial-label">Cobertura receita / folha</p>
          <p class="dial-note">Marca central do arco = ponto de equilíbrio (1,00x). ${insights.coverageMarginPct == null ? 'Sem folha informada no recorte.' : `${insights.coverageMarginPct >= 0 ? '+' : ''}${insights.coverageMarginPct.toFixed(0)} p.p. em relação ao equilíbrio.`}</p>
        </div>
      </div>
    </div>`,
  });

  /* 04 — Leitura do período */
  slides.push({
    nav: 'Leitura',
    eyebrow: 'Leitura do período',
    html: `<div class="stack">
      <h2>Os sinais que sustentam a conversa</h2>
      <div class="ins-grid">${insights.cards.slice(0, 6).map(insightCard).join('')}</div>
    </div>`,
  });

  /* 06 — Evolução mensal */
  slides.push({
    nav: 'Mensal',
    eyebrow: 'Evolução mensal',
    html: `<div class="stack">
      <h2>Receita e folha, competência a competência</h2>
      <p class="sub">${esc(monthlyReading(insights))}</p>
      <div class="panel">${apexMonthlyChart(points, { animate: true, width: 1180, height: 426 })}${apexLegend(MONTHLY_LEGEND)}</div>
    </div>`,
  });

  /* 06 — Curva S */
  slides.push({
    nav: 'Curva S',
    eyebrow: 'Curva S acumulada',
    html: `<div class="stack">
      <h2>A trajetória acumulada do período</h2>
      <p class="sub">${esc(curveReading(insights))}</p>
      <div class="panel">${apexCurveChart(points, { animate: true, width: 1180, height: 426 })}${apexLegend(CURVE_LEGEND)}</div>
    </div>`,
  });

  /* 07 — Saldo */
  slides.push({
    nav: 'Saldo',
    eyebrow: 'Saldo mensal e acumulado',
    html: `<div class="stack">
      <h2>Onde o período gera e onde consome resultado</h2>
      <p class="sub">${insights.deficitMonths.length
        ? esc(`${insights.deficitMonths.length} competência(s) com saldo mensal negativo: ${insights.deficitMonths.map((m) => m.label).join(', ')}.`)
        : 'Nenhuma competência do recorte fecha com saldo mensal negativo.'}</p>
      <div class="panel">${apexBalanceChart(points, { animate: true, width: 1180, height: 366 })}${apexLegend(BALANCE_LEGEND)}</div>
    </div>`,
  });

  /* Último gráfico — projeção por cliente */
  if (pack.narrative.clientForecasts.length) {
    const clientIds = [...new Map(pack.narrative.clientForecasts.map((item) => [item.clientId, item.client])).entries()];
    slides.push({
      nav: 'Clientes',
      eyebrow: 'Projeção por cliente',
      html: `<div class="stack">
        <h2>Quem compõe o faturamento projetado</h2>
        <p class="sub">${esc(APEX_CLIENT_FORECAST_DESCRIPTION)}</p>
        <div class="panel">${apexClientForecastChart(pack.narrative.clientForecasts, points.map((point) => point.period), { animate: true, width: 1180, height: 426 })}
          ${apexLegend(clientIds.map(([clientId, client], index) => ({ label: client, color: clientForecastColor(clientId, index) })))}
        </div>
      </div>`,
    });
  }

  /* 08 — Base informada */
  slides.push({
    nav: 'Base',
    eyebrow: 'Base mensal informada',
    html: `<div class="stack">
      <h2>Todos os valores por trás dos gráficos</h2>
      <p class="sub">${esc(APEX_SOURCE)}. Colunas de previsão destacadas em azul.</p>
      ${monthlyTable(snapshot)}
    </div>`,
  });

  if (pack.narrative.portfolio.length) {
    slides.push({
      nav: 'Carteira',
      eyebrow: 'Carteira e recebíveis',
      html: `<div class="stack">
        <h2>Backlog que sustenta a projeção</h2>
        <p class="sub">Carteira, faturamento, backlog, saldo a receber e parcela projetada até 2028 por cliente.</p>
        ${portfolioTable(pack)}
      </div>`,
    });
  }

  /* 10 — Fecho */
  slides.push({
    nav: 'Fecho',
    eyebrow: 'Perspectiva e próximos passos',
    html: `<div class="closing">
      <h2>${esc(APEX_CLOSING_TITLE)}</h2>
      <blockquote>${esc(investorClosingMessage(pack.narrative.closingMessage))}</blockquote>
      <div class="sign">
        <span><em>Preparado por</em><strong>${esc(pack.authorName || 'Financeiro')}</strong></span>
        <span><em>Classificação</em><strong>${esc(confidential)}</strong></span>
      </div>
    </div>`,
  });

  return slides;
}

export function buildInvestorPackPresentationHtml(pack: InvestorPack): string {
  const snapshot = calculateInvestorPack(pack);
  const insights = buildApexInsights(snapshot);
  const slides = buildSlides(pack, snapshot, insights);
  const total = slides.length;
  const backdrop = apexBackdrop();
  const confidential = confidentialityLabel(pack.confidentiality);

  const slidesHtml = slides.map((slide, index) => `
  <section class="slide" aria-label="${esc(`${index + 1} de ${total} — ${slide.nav}`)}">
    <header class="slide-head">
      <span class="eyebrow">${esc(slide.eyebrow)}</span>
      <span class="slide-no">${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span>
    </header>
    <div class="slide-body">${slide.html}</div>
    <footer class="slide-foot">
      <span class="foot-brand">
        <span class="foot-logo" role="img" aria-label="${esc(APEX_LOGO_ALT)}"></span>
        ${esc(APEX_SOURCE)}
      </span>
      <span>${esc(REPORT_NAME_SHORT)} · v${pack.version} · ${esc(confidential)}</span>
    </footer>
  </section>`).join('');

  const indexHtml = slides.map((slide, index) => `
    <button type="button" class="idx-item" data-goto="${index}">
      <span class="idx-n">${String(index + 1).padStart(2, '0')}</span>
      <span class="idx-t">${esc(slide.nav)}</span>
      <span class="idx-s">${esc(slide.eyebrow)}</span>
    </button>`).join('');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>${esc(REPORT_NAME)} · ${esc(pack.title)} · v${pack.version}</title>
<style>
:root{
  --void:${APEX.void};--panel-top:${APEX.panelTop};--panel-bottom:${APEX.panelBottom};
  --line:${APEX.line};--line-soft:${APEX.lineSoft};
  --ink:${APEX.ink};--body:${APEX.body};--muted:${APEX.muted};--subtle:${APEX.subtle};
  --revenue:${APEX.revenue};--forecast:${APEX.revenueForecast};--payroll:${APEX.payroll};
  --payroll-forecast:${APEX.payrollForecast};--balance:${APEX.balance};
}
*{box-sizing:border-box}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:var(--void);color:var(--ink);
  font-family:${APEX_FONT};font-synthesis:none;-webkit-font-smoothing:antialiased}
body::before{content:"";position:fixed;inset:0;background-image:${backdrop.image};background-size:${backdrop.size};pointer-events:none;z-index:0}
body::after{content:"";position:fixed;inset:0;pointer-events:none;z-index:3;
  background:radial-gradient(120% 90% at 50% 50%,transparent 55%,rgba(0,0,0,.42) 100%)}

.deck{position:relative;z-index:1;height:100%;display:flex;transition:transform .68s cubic-bezier(.22,1,.36,1);will-change:transform}
.slide{position:relative;min-width:100vw;height:100vh;padding:clamp(26px,3.4vw,54px) clamp(28px,4vw,72px) clamp(40px,4vw,64px);
  display:grid;grid-template-rows:auto 1fr auto;gap:clamp(16px,2vw,28px);overflow:hidden}
.slide::before{content:"";position:absolute;inset:clamp(14px,1.5vw,22px);border:1px solid var(--line-soft);border-radius:26px;pointer-events:none}
.slide::after{content:"";position:absolute;left:clamp(14px,1.5vw,22px);top:clamp(14px,1.5vw,22px);width:96px;height:2px;
  background:linear-gradient(90deg,var(--revenue),transparent);border-radius:2px}

.slide-head{display:flex;align-items:baseline;justify-content:space-between;gap:18px;position:relative;z-index:2}
.eyebrow{font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--revenue)}
.slide-no{font-size:11px;letter-spacing:.16em;color:var(--subtle);font-variant-numeric:tabular-nums}
.slide-body{position:relative;z-index:2;min-height:0;display:flex;align-items:center}
.slide-body>*{width:100%}
.slide-foot{display:flex;justify-content:space-between;gap:20px;font-size:10.5px;color:var(--subtle);position:relative;z-index:2}
/* Reserva a faixa inferior direita para o HUD de navegação (posição fixa). */
.slide-foot span:last-child{padding-right:230px;text-align:right}
.foot-brand{display:inline-flex;align-items:center;gap:9px}
.foot-logo{display:inline-block;width:95px;height:12px;flex:0 0 auto;opacity:.9;
  background:url('${APEX_LOGO_SMALL_DATA_URI}') left center/contain no-repeat}

h1{font-size:clamp(44px,6.4vw,90px);line-height:.94;letter-spacing:-.05em;margin:0;max-width:16ch}
h2{font-size:clamp(28px,3.4vw,52px);line-height:1.06;letter-spacing:-.035em;margin:0;max-width:26ch}
h3{font-size:clamp(15px,1.3vw,20px);margin:0 0 12px;letter-spacing:.01em;color:var(--ink)}
.lede{font-size:clamp(16px,1.7vw,25px);line-height:1.4;color:var(--muted);margin:18px 0 0;max-width:44ch}
.sub{font-size:clamp(13px,1.15vw,17px);line-height:1.5;color:var(--muted);margin:10px 0 0;max-width:78ch}
.copy{font-size:clamp(15px,1.3vw,21px);line-height:1.55;color:var(--body);margin:0 0 26px;max-width:52ch}
.muted{color:var(--subtle)}
.stack{display:flex;flex-direction:column;gap:clamp(12px,1.4vw,20px)}

/* Capa */
.hero-logo{display:block;height:clamp(30px,3.2vw,46px);width:clamp(237px,25vw,364px);
  background:url('${APEX_LOGO_DATA_URI}') left center/contain no-repeat;margin-bottom:clamp(18px,2.2vw,30px)}
.hero-mark{display:inline-flex;align-items:center;gap:9px;font-size:11px;font-weight:700;letter-spacing:.2em;
  text-transform:uppercase;color:var(--muted);margin-bottom:18px}
.hero-dot{width:8px;height:8px;border-radius:50%;background:var(--revenue);box-shadow:0 0 0 4px rgba(53,230,187,.16)}
.meta{display:flex;gap:34px;flex-wrap:wrap;margin-top:34px}
.meta span{display:flex;flex-direction:column;gap:3px}
.meta em{font-style:normal;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--subtle)}
.meta strong{font-size:15px;font-weight:600;color:var(--ink)}
.hero-verdict{display:inline-flex;align-items:baseline;gap:14px;margin-top:32px;padding:12px 20px;border-radius:14px;
  border:1px solid color-mix(in srgb,var(--accent) 38%,transparent);
  background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 14%,transparent),transparent)}
.hero-verdict b{font-size:clamp(30px,3vw,46px);letter-spacing:-.04em;color:var(--accent);font-variant-numeric:tabular-nums}
.hero-verdict span{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}

/* Roteiro */
.agenda{list-style:none;counter-reset:ag;margin:8px 0 0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:12px 40px}
.agenda li{counter-increment:ag;display:grid;grid-template-columns:auto 1fr;gap:14px;align-items:baseline;
  padding:12px 0;border-top:1px solid var(--line-soft)}
.agenda li::before{content:counter(ag,decimal-leading-zero);font-size:12px;font-variant-numeric:tabular-nums;
  color:var(--revenue);letter-spacing:.08em}
.agenda b{font-size:clamp(15px,1.3vw,19px);font-weight:650;grid-column:2}
.agenda span{grid-column:2;font-size:12.5px;color:var(--subtle);margin-top:2px}

/* Síntese */
.split{display:grid;grid-template-columns:1.35fr .65fr;gap:clamp(22px,3vw,54px);align-items:center}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.tile{position:relative;padding:14px 14px 13px;border-radius:14px;border:1px solid var(--line-soft);
  background:linear-gradient(160deg,rgba(12,28,36,.9),rgba(6,18,26,.55));overflow:hidden}
.tile::before{content:"";position:absolute;inset:0 0 auto 0;height:2px;background:var(--accent)}
.tile-l{display:block;font-size:9.5px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:var(--subtle)}
.tile-v{display:block;margin-top:7px;font-size:clamp(19px,2vw,30px);letter-spacing:-.035em;color:var(--accent);font-variant-numeric:tabular-nums}
.tile-h{display:block;margin-top:5px;font-size:10.5px;color:var(--subtle)}
.dial-wrap{display:flex;flex-direction:column;align-items:center;gap:4px}
.apex-dial{width:100%;max-width:300px;height:auto}
.dial-label{margin:0;font-size:10.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);text-align:center}
.dial-note{font-size:11px;color:var(--subtle);text-align:center;margin:4px 0 0;max-width:30ch;line-height:1.45}

/* Leitura */
.ins-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
/* Evita cartão órfão na última linha: o último item ocupa a sobra da grade. */
.ins-grid>:last-child:nth-child(3n+1){grid-column:span 3}
.ins-grid>:last-child:nth-child(3n+2){grid-column:span 2}
.ins{position:relative;padding:16px 18px;border-radius:16px;border:1px solid var(--line-soft);border-left:2px solid var(--accent);
  background:linear-gradient(150deg,rgba(12,28,36,.92),rgba(6,18,26,.5))}
.ins-k{font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
.ins-v{display:block;margin:8px 0 2px;font-size:clamp(20px,1.9vw,28px);letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.ins-l{display:block;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.ins-d{margin:9px 0 0;font-size:12px;line-height:1.45;color:var(--subtle)}

/* Painéis de gráfico */
.panel{border:1px solid var(--line-soft);border-radius:20px;padding:16px 20px 14px;
  background:linear-gradient(160deg,rgba(12,28,36,.72),rgba(6,18,26,.42));
  box-shadow:0 26px 70px rgba(0,0,0,.42),inset 0 1px 0 rgba(255,255,255,.05)}
.panel .apex-chart{height:min(46vh,420px)}

/* Tabela */
.table-wrap{overflow:auto;border:1px solid var(--line-soft);border-radius:18px;
  background:linear-gradient(160deg,rgba(12,28,36,.72),rgba(6,18,26,.42));max-height:min(54vh,480px)}
.deck-table{width:100%;border-collapse:collapse;font-size:clamp(11px,1vw,13.5px);font-variant-numeric:tabular-nums}
.deck-table th,.deck-table td{padding:9px 14px;text-align:left;white-space:nowrap}
.deck-table thead th{position:sticky;top:0;background:rgba(6,18,26,.96);font-size:9.5px;font-weight:700;
  letter-spacing:.1em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--line)}
.deck-table tbody td{border-bottom:1px solid var(--line-soft);color:var(--body)}
.deck-table tbody tr:nth-child(even) td{background:rgba(255,255,255,.016)}
.deck-table .num{text-align:right}
.deck-table .fc{color:var(--forecast)}
/* Totais fixos no rodapé da rolagem: em apresentação, o total nunca deve exigir scroll. */
.deck-table tfoot td{position:sticky;bottom:0;padding:11px 14px;border-top:1px solid var(--line);
  font-weight:700;color:var(--ink);background:#0A1A22}

/* Premissas */
.columns{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(18px,2.4vw,40px)}
.columns section{border-top:2px solid var(--accent);padding-top:16px}
.columns h3{color:var(--accent);font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}
.columns ul{margin:0;padding-left:18px;color:var(--body);font-size:clamp(13px,1.15vw,17px);line-height:1.5}
.columns li+li{margin-top:9px}
.dq{margin-top:4px;border:1px solid color-mix(in srgb,${APEX.attention} 34%,transparent);border-radius:14px;
  padding:12px 16px;background:color-mix(in srgb,${APEX.attention} 8%,transparent)}
.dq b{font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${APEX.attention}}
.dq ul{margin:6px 0 0;padding-left:18px;font-size:12.5px;color:var(--body)}

/* Fecho */
.closing blockquote{margin:26px 0 0;border-left:2px solid var(--revenue);padding-left:26px;
  font-size:clamp(18px,2.2vw,34px);line-height:1.34;color:#DFF9F3;max-width:34ch}
.sign{display:flex;gap:40px;flex-wrap:wrap;margin-top:44px}
.sign span{display:flex;flex-direction:column;gap:3px}
.sign em{font-style:normal;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--subtle)}
.sign strong{font-size:14px;font-weight:600}

${APEX_CHART_CSS}
${APEX_LEGEND_CSS}
${APEX_CHART_ANIM_CSS}

/* Controles */
.rail{position:fixed;left:0;right:0;bottom:0;height:2px;background:rgba(255,255,255,.06);z-index:12}
.rail-fill{height:100%;width:0;background:linear-gradient(90deg,var(--revenue),var(--forecast));transition:width .5s cubic-bezier(.22,1,.36,1)}
.hud{position:fixed;right:22px;bottom:20px;z-index:14;display:flex;align-items:center;gap:6px;padding:6px;
  border:1px solid var(--line);border-radius:14px;background:rgba(6,16,22,.9);backdrop-filter:blur(10px)}
.hud button{width:38px;height:38px;border:1px solid transparent;border-radius:10px;background:transparent;color:var(--body);
  font-size:16px;cursor:pointer;transition:.16s;display:inline-flex;align-items:center;justify-content:center}
.hud button:hover{border-color:var(--line);color:var(--revenue);background:rgba(53,230,187,.08)}
.hud .count{min-width:56px;text-align:center;font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.dots{position:fixed;left:22px;bottom:22px;z-index:14;display:flex;gap:6px}
.dots i{width:22px;height:3px;border-radius:2px;background:rgba(255,255,255,.14);transition:.25s;cursor:pointer}
.dots i.on{background:var(--revenue);box-shadow:0 0 10px rgba(53,230,187,.5)}

.index{position:fixed;inset:0;z-index:20;display:none;padding:clamp(28px,5vw,70px);overflow:auto;
  background:rgba(4,10,16,.96);backdrop-filter:blur(14px)}
.index.on{display:block}
.index h4{margin:0 0 22px;font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--revenue)}
.idx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px}
.idx-item{text-align:left;padding:16px;border:1px solid var(--line-soft);border-radius:14px;cursor:pointer;
  background:linear-gradient(160deg,rgba(12,28,36,.8),rgba(6,18,26,.4));color:var(--ink);
  font-family:inherit;display:flex;flex-direction:column;gap:4px;transition:.16s}
.idx-item:hover{border-color:var(--revenue);transform:translateY(-2px)}
.idx-n{font-size:10px;letter-spacing:.14em;color:var(--revenue);font-variant-numeric:tabular-nums}
.idx-t{font-size:15px;font-weight:650}
.idx-s{font-size:10.5px;color:var(--subtle)}

@media (max-width:900px){
  /* Espaço inferior extra: o rodapé precisa ficar acima do HUD fixo. */
  .slide{padding:24px 22px 104px;gap:14px}
  h1{font-size:clamp(32px,9vw,50px)}
  h2{font-size:clamp(22px,6vw,32px)}
  .split,.columns,.ins-grid,.agenda{grid-template-columns:1fr;gap:16px}
  .tiles{grid-template-columns:1fr 1fr}
  .meta,.sign{gap:18px}
  .panel .apex-chart{height:38vh}
  .dots{display:none}
  .slide-foot{font-size:9px}
  .slide-foot span:first-child{max-width:100%}
  .foot-logo{width:79px;height:10px}
  .slide-foot span:last-child{display:none}
  .hud{left:22px;right:22px;justify-content:center}
}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation:none!important;transition:none!important}
}
@media print{
  html,body{overflow:visible;height:auto}
  body::after{display:none}
  .deck{display:block;transform:none!important}
  .slide{page-break-after:always;width:100%;height:100vh}
  .hud,.rail,.dots,.index{display:none!important}
}
</style>
</head>
<body>
<main class="deck" id="deck">${slidesHtml}</main>

<div class="dots" id="dots">${slides.map((_, i) => `<i data-goto="${i}"></i>`).join('')}</div>
<div class="hud">
  <button type="button" id="idx" title="Índice (I)" aria-label="Abrir índice">☰</button>
  <button type="button" id="prev" title="Anterior (←)" aria-label="Slide anterior">←</button>
  <span class="count" id="count">01 / ${String(total).padStart(2, '0')}</span>
  <button type="button" id="next" title="Próximo (→)" aria-label="Próximo slide">→</button>
  <button type="button" id="full" title="Tela cheia (F)" aria-label="Tela cheia">⛶</button>
</div>
<div class="rail"><div class="rail-fill" id="rail"></div></div>

<div class="index" id="overlay" role="dialog" aria-label="Índice da apresentação">
  <h4>${esc(REPORT_NAME)} · ${esc(pack.title)}</h4>
  <div class="idx-grid">${indexHtml}</div>
</div>

<script>
(function(){
  var total = ${total};
  var deck = document.getElementById('deck');
  var count = document.getElementById('count');
  var rail = document.getElementById('rail');
  var overlay = document.getElementById('overlay');
  var dots = Array.prototype.slice.call(document.querySelectorAll('#dots i'));
  var index = 0, startX = 0, startY = 0;

  function pad(n){ return n < 10 ? '0' + n : '' + n; }

  function show(next){
    index = Math.max(0, Math.min(total - 1, next));
    deck.style.transform = 'translateX(-' + (index * 100) + 'vw)';
    count.textContent = pad(index + 1) + ' / ' + pad(total);
    rail.style.width = (((index + 1) / total) * 100) + '%';
    dots.forEach(function(dot, i){ dot.className = i === index ? 'on' : ''; });
  }

  function toggleIndex(force){
    var open = force != null ? force : !overlay.classList.contains('on');
    overlay.classList.toggle('on', open);
  }

  document.getElementById('prev').onclick = function(){ show(index - 1); };
  document.getElementById('next').onclick = function(){ show(index + 1); };
  document.getElementById('idx').onclick = function(){ toggleIndex(); };
  document.getElementById('full').onclick = function(){
    if (document.fullscreenElement) { document.exitFullscreen(); }
    else if (document.documentElement.requestFullscreen) { document.documentElement.requestFullscreen(); }
  };

  document.querySelectorAll('[data-goto]').forEach(function(el){
    el.addEventListener('click', function(){
      show(parseInt(el.getAttribute('data-goto'), 10) || 0);
      toggleIndex(false);
    });
  });

  window.addEventListener('keydown', function(e){
    if (e.key === 'Escape') { toggleIndex(false); return; }
    if (e.key === 'i' || e.key === 'I') { toggleIndex(); return; }
    if (e.key === 'f' || e.key === 'F') { document.getElementById('full').click(); return; }
    if (['ArrowRight','PageDown',' ','Enter'].indexOf(e.key) >= 0) { e.preventDefault(); show(index + 1); }
    if (['ArrowLeft','PageUp','Backspace'].indexOf(e.key) >= 0) { e.preventDefault(); show(index - 1); }
    if (e.key === 'Home') show(0);
    if (e.key === 'End') show(total - 1);
  });

  window.addEventListener('touchstart', function(e){
    startX = e.changedTouches[0].clientX;
    startY = e.changedTouches[0].clientY;
  }, { passive: true });
  window.addEventListener('touchend', function(e){
    var dx = e.changedTouches[0].clientX - startX;
    var dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy)) show(index + (dx < 0 ? 1 : -1));
  }, { passive: true });

  show(0);
})();
</script>
</body></html>`;
}

export function downloadInvestorPackHtml(pack: InvestorPack): void {
  const html = buildInvestorPackPresentationHtml(pack);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${investorPackFileStem(pack)}.html`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
