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
  MONTHLY_LINE_LEGEND,
  apexBalanceChart,
  apexClientForecastChart,
  apexCoverageDial,
  apexCurveChart,
  apexLegend,
  apexMonthlyChart,
  apexMonthlyLineChart,
  clientForecastColor,
} from './apex-charts';
import {
  buildApexInsights,
  curveReading,
  monthlyReading,
  type ApexInsights,
} from './apex-insights';
import { APEX_LOGO_ALT, APEX_LOGO_DATA_URI, APEX_LOGO_SMALL_DATA_URI } from './apex-logo';
import {
  APEX,
  APEX_CLIENT_FORECAST_DESCRIPTION,
  APEX_FONT,
  APEX_PREPARED_BY,
  APEX_SOURCE,
  REPORT_FILE_SLUG,
  REPORT_NAME,
  REPORT_NAME_SHORT,
  apexAgenda,
  apexBackdrop,
  confidentialityLabel,
  dashIfZero,
  investorCoverTitle,
  investorExecutiveSummary,
} from './apex-theme';
import { calculateInvestorPack, formatInvestorCurrency, formatInvestorDate, formatInvestorPeriod } from './calculations';
import type { InvestorPack, InvestorPackSnapshot } from './types';

/**
 * Faixa executiva — a mesma anatomia do PDF (padrão HudKpiStrip / Executive
 * Band): um contêiner de vidro com trilhos nas bordas agrupando células de gap
 * mínimo, em vez de cartões soltos. É a linguagem que o app já usa no topo de
 * todo módulo, então o deck lê como o mesmo produto.
 */
function band(cells: string, columns = 4): string {
  return `<div class="band"><div class="band-grid" style="--cols:${columns}">${cells}</div></div>`;
}

/** Célula da faixa: ponto de acento + rótulo, valor tabular, sublinha discreta. */
function kpiTile(label: string, value: string, accent: string, helper?: string): string {
  return `<div class="cell" style="--accent:${accent}">
    <span class="cell-top"><i class="cell-dot"></i><span class="cell-l">${esc(label)}</span></span>
    <b class="cell-v">${esc(value)}</b>
    ${helper ? `<span class="cell-h">${esc(helper)}</span>` : ''}
  </div>`;
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
  const title = investorCoverTitle(pack.title);
  // Título canônico não entra no nome do arquivo: repetiria o próprio slug.
  if (title === REPORT_NAME) return `${REPORT_FILE_SLUG}-${pack.referenceDate}`;
  const slug = title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
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
      <h1>${esc(investorCoverTitle(pack.title))}</h1>
      <div class="meta">
        <span><em>Período</em><strong>${esc(period)}</strong></span>
        <span><em>Data</em><strong>${esc(formatInvestorDate(pack.referenceDate))}</strong></span>
        <span><em>Preparado por</em><strong>${esc(APEX_PREPARED_BY)}</strong></span>
      </div>
    </div>`,
  });

  /* 02 — Roteiro */
  slides.push({
    nav: 'Roteiro',
    eyebrow: 'Roteiro da apresentação',
    html: `<div class="stack">
      <h2>O que esta leitura cobre</h2>
      <ol class="agenda">${apexAgenda({
        clientForecasts: pack.narrative.clientForecasts.length > 0,
        portfolio: pack.narrative.portfolio.length > 0,
      }).map((item) => `<li><b>${esc(item.title)}</b><span>${esc(item.sub)}</span></li>`).join('')}</ol>
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
          <p class="copy">${esc(investorExecutiveSummary(pack.narrative.executiveSummary))}</p>
          ${band(
            `${kpiTile('Faturamento realizado', formatInvestorCurrency(metrics.revenueActualCents, true), APEX.revenue, `${insights.realizedMonths} competência(s)`)}
            ${kpiTile('Faturamento previsto', formatInvestorCurrency(metrics.revenueForecastCents, true), APEX.revenueForecast, insights.forecastShare == null ? undefined : `${(insights.forecastShare * 100).toFixed(0)}% da receita`)}
            ${kpiTile('Folha total', formatInvestorCurrency(metrics.payrollTotalCents, true), APEX.payrollForecast, 'fechada + projetada')}
            ${kpiTile('Saldo acumulado', formatInvestorCurrency(insights.closingBalanceCents, true), insights.closingBalanceCents >= 0 ? APEX.positive : APEX.negative, 'no fecho do recorte')}`,
            4,
          )}
        </div>
        <div class="dial-wrap">
          ${apexCoverageDial(metrics.coverageRatio, { size: 280, animate: true })}
          <p class="dial-label">Cobertura receita / folha</p>
          <p class="dial-note">Marca central do arco = ponto de equilíbrio (1,00x). ${insights.coverageMarginPct == null ? 'Sem folha informada no recorte.' : `${insights.coverageMarginPct >= 0 ? '+' : ''}${insights.coverageMarginPct.toFixed(0)} p.p. em relação ao equilíbrio.`}</p>
        </div>
      </div>
    </div>`,
  });

  /* 04 — Evolução mensal */
  slides.push({
    nav: 'Mensal',
    eyebrow: 'Evolução mensal',
    html: `<div class="stack">
      <h2>Receita e folha, competência a competência</h2>
      <p class="sub">${esc(monthlyReading(insights))}</p>
      <div class="panel">${apexMonthlyChart(points, { animate: true, width: 1180, height: 426 })}${apexLegend(MONTHLY_LEGEND)}</div>
    </div>`,
  });

  /* 07 — Curva mensal */
  slides.push({
    nav: 'Curva mensal',
    eyebrow: 'Curva mensal',
    html: `<div class="stack">
      <h2>Valores de cada competência, sem acumulação</h2>
      <p class="sub">A leitura mês a mês da receita e da folha: traço contínuo para o que está fechado, tracejado para a projeção, ancorada na última competência realizada.</p>
      <div class="panel">${apexMonthlyLineChart(points, { animate: true, width: 1180, height: 426 })}${apexLegend(MONTHLY_LINE_LEGEND)}</div>
    </div>`,
  });

  /* 08 — Curva S */
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

  /* Último — Fecho institucional (só a marca, centralizada, igual ao PDF) */
  slides.push({
    nav: 'Fecho',
    eyebrow: '',
    html: `<div class="closing">
      <span class="closing-logo" role="img" aria-label="${esc(APEX_LOGO_ALT)}"></span>
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
  const coverTitle = investorCoverTitle(pack.title);
  const documentTitle = coverTitle === REPORT_NAME ? REPORT_NAME : `${REPORT_NAME} · ${coverTitle}`;

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
<title>${esc(documentTitle)} · v${pack.version}</title>
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

.deck{position:relative;z-index:1;height:100%;display:flex;transition:transform .72s cubic-bezier(.76,0,.24,1);will-change:transform}
.slide{position:relative;min-width:100vw;height:100vh;padding:clamp(26px,3.4vw,54px) clamp(28px,4vw,72px) clamp(40px,4vw,64px);
  display:grid;grid-template-rows:auto 1fr auto;gap:clamp(16px,2vw,28px);overflow:hidden}
/* Profundidade na troca: o slide que sai recua e desfoca, o que entra volta ao plano. */
.slide{--enter-x:34px;opacity:.16;transform:scale(.94);filter:blur(7px);
  transition:opacity .5s ease,transform .62s cubic-bezier(.22,1,.36,1),filter .5s ease}
.slide.is-active{opacity:1;transform:none;filter:none}
.deck[data-dir="back"] .slide{--enter-x:-34px}
/* Entrada em cascata: cabeçalho, conteúdo e rodapé chegam em sequência, não em bloco. */
@keyframes apexEnter{from{opacity:0;transform:translate3d(var(--enter-x),14px,0)}to{opacity:1;transform:none}}
.slide.is-active .slide-head,
.slide.is-active .slide-foot,
.slide.is-active .hero>*,
.slide.is-active .stack>*,
.slide.is-active .closing>*{animation:apexEnter .62s cubic-bezier(.22,1,.36,1) both}
.slide.is-active .slide-head{animation-delay:.04s}
.slide.is-active .hero>*:nth-child(1),.slide.is-active .stack>*:nth-child(1),.slide.is-active .closing>*{animation-delay:.1s}
.slide.is-active .hero>*:nth-child(2),.slide.is-active .stack>*:nth-child(2){animation-delay:.17s}
.slide.is-active .hero>*:nth-child(3),.slide.is-active .stack>*:nth-child(3){animation-delay:.24s}
.slide.is-active .hero>*:nth-child(4),.slide.is-active .stack>*:nth-child(4){animation-delay:.31s}
.slide.is-active .slide-foot{animation-delay:.36s}
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
.foot-logo{display:inline-block;width:90px;height:12px;flex:0 0 auto;opacity:.9;
  background:url('${APEX_LOGO_SMALL_DATA_URI}') left center/contain no-repeat}

h1{font-size:clamp(44px,6.4vw,90px);line-height:.94;letter-spacing:-.05em;margin:0;max-width:16ch}
h2{font-size:clamp(28px,3.4vw,52px);line-height:1.06;letter-spacing:-.035em;margin:0;max-width:26ch}
h3{font-size:clamp(15px,1.3vw,20px);margin:0 0 12px;letter-spacing:.01em;color:var(--ink)}
.sub{font-size:clamp(13px,1.15vw,17px);line-height:1.5;color:var(--muted);margin:10px 0 0;max-width:78ch}
.copy{font-size:clamp(15px,1.3vw,21px);line-height:1.55;color:var(--body);margin:0 0 26px;max-width:52ch}
.muted{color:var(--subtle)}
.stack{display:flex;flex-direction:column;gap:clamp(12px,1.4vw,20px)}

/* Capa */
.hero-logo{display:block;height:clamp(30px,3.2vw,46px);width:clamp(226px,24vw,347px);
  background:url('${APEX_LOGO_DATA_URI}') left center/contain no-repeat;margin-bottom:clamp(18px,2.2vw,30px)}
.meta{display:flex;gap:34px;flex-wrap:wrap;margin-top:34px}
.meta span{display:flex;flex-direction:column;gap:3px}
.meta em{font-style:normal;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--subtle)}
.meta strong{font-size:15px;font-weight:600;color:var(--ink)}
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

/* Faixa executiva (padrão HudKpiStrip / Executive Band) */
.band{position:relative;overflow:hidden;border-radius:20px;padding:5px;
  border:1px solid rgba(53,230,187,.18);
  background:linear-gradient(180deg,var(--panel-top) 0%,var(--panel-bottom) 100%);
  box-shadow:0 22px 60px rgba(0,0,0,.38),inset 0 0 0 1px rgba(53,230,187,.06)}
/* Trilhos de borda — a assinatura contida da Executive Band. */
.band::before,.band::after{content:"";position:absolute;top:12px;bottom:12px;width:1px}
.band::before{left:11px;background:var(--revenue)}
.band::after{right:11px;background:var(--line)}
.band-grid{position:relative;display:grid;grid-template-columns:repeat(var(--cols,4),1fr);gap:5px}
.cell{position:relative;overflow:hidden;padding:13px 15px 14px;border-radius:15px;border:1px solid var(--line-soft);
  background:linear-gradient(160deg,rgba(12,28,36,.88),rgba(6,18,26,.42));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05)}
/* Fio de acento no topo, esmaecido nas pontas (não a barra sólida de borda). */
.cell::before{content:"";position:absolute;top:0;left:24%;right:24%;height:1px;
  background:linear-gradient(90deg,transparent,var(--accent),transparent)}
.cell-top{display:flex;align-items:flex-start;gap:7px}
.cell-dot{width:6px;height:6px;border-radius:50%;background:var(--accent);flex:0 0 auto;margin-top:4px;
  box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 16%,transparent)}
/* Duas linhas reservadas: o rótulo quebra em vez de truncar (reticências viram dúvida
   em projeção) e os valores da faixa seguem alinhados entre si. */
.cell-l{flex:1 1 auto;min-height:2.7em;font-size:9.5px;line-height:1.35;font-weight:700;letter-spacing:.13em;
  text-transform:uppercase;color:var(--muted)}
.cell-v{display:block;margin-top:7px;font-size:clamp(19px,2vw,30px);font-weight:700;letter-spacing:-.035em;
  color:var(--accent);font-variant-numeric:tabular-nums}
.cell-h{display:block;margin-top:5px;font-size:10.5px;color:var(--subtle)}
.dial-wrap{display:flex;flex-direction:column;align-items:center;gap:4px}
.apex-dial{width:100%;max-width:300px;height:auto}
.dial-label{margin:0;font-size:10.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);text-align:center}
.dial-note{font-size:11px;color:var(--subtle);text-align:center;margin:4px 0 0;max-width:30ch;line-height:1.45}

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

/* Fecho institucional — apenas a marca centralizada */
.closing{display:flex;justify-content:center;align-items:center}
.closing-logo{display:block;width:min(52vw,620px);height:clamp(52px,7vw,104px);
  background:url('${APEX_LOGO_DATA_URI}') center center/contain no-repeat}

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
  .split,.columns,.agenda{grid-template-columns:1fr;gap:16px}
  .band-grid{grid-template-columns:1fr 1fr}
  .meta{gap:18px}
  .panel .apex-chart{height:38vh}
  .dots{display:none}
  .slide-foot{font-size:9px}
  .slide-foot span:first-child{max-width:100%}
  .foot-logo{width:75px;height:10px}
  .slide-foot span:last-child{display:none}
  .hud{left:22px;right:22px;justify-content:center}
}
/* Janela baixa (pré-visualização em painel lateral, não projeção): o gráfico e os
   títulos encolhem para o corpo do slide não invadir o cabeçalho e o rodapé. */
@media (max-height:660px){
  .slide{padding:16px 20px 88px;gap:10px}
  h1{font-size:clamp(26px,7vw,42px)}
  h2{font-size:clamp(18px,3.4vw,26px)}
  .sub{font-size:12.5px;margin-top:6px}
  .copy{font-size:13px;margin-bottom:14px}
  .panel{padding:10px 13px 8px}
  .panel .apex-chart{height:min(36vh,250px)}
  .table-wrap{max-height:42vh}
  .cell-v{font-size:17px}
  .cell-l{min-height:0}
  .apex-dial{max-width:150px}
  /* Duas colunas voltam: numa janela baixa a altura é o recurso escasso, não a largura. */
  .agenda{grid-template-columns:1fr 1fr;gap:0 20px}
  .agenda li{padding:6px 0}
  .agenda b{font-size:13.5px}
  .agenda span{font-size:10.5px}
  .split{grid-template-columns:1.35fr .65fr;gap:18px}
  .meta{gap:16px;margin-top:18px}
  .dial-note{display:none}
}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation:none!important;transition:none!important}
  /* Sem movimento, o slide inativo não pode ficar apagado: só a rolagem muda. */
  .slide{opacity:1;transform:none;filter:none}
}
@media print{
  html,body{overflow:visible;height:auto}
  body::after{display:none}
  .deck{display:block;transform:none!important}
  .slide{page-break-after:always;width:100%;height:100vh;
    opacity:1!important;transform:none!important;filter:none!important;animation:none!important}
  .slide *{animation:none!important}
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
  <h4>${esc(documentTitle)}</h4>
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
  var sections = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  var index = 0, startX = 0, startY = 0;

  function pad(n){ return n < 10 ? '0' + n : '' + n; }

  // As marcas dos gráficos reanimam a cada chegada: o slide se desenha na frente
  // de quem assiste, em vez de já estar pronto desde o carregamento.
  function replayCharts(slide){
    var marks = slide.querySelectorAll('.apex-rise, .apex-draw');
    for (var i = 0; i < marks.length; i++) {
      marks[i].style.animation = 'none';
      void marks[i].offsetWidth;
      marks[i].style.animation = '';
    }
  }

  function show(next){
    var target = Math.max(0, Math.min(total - 1, next));
    deck.setAttribute('data-dir', target < index ? 'back' : 'fwd');
    index = target;
    deck.style.transform = 'translate3d(-' + (index * 100) + 'vw, 0, 0)';
    count.textContent = pad(index + 1) + ' / ' + pad(total);
    rail.style.width = (((index + 1) / total) * 100) + '%';
    dots.forEach(function(dot, i){ dot.className = i === index ? 'on' : ''; });
    sections.forEach(function(slide, i){ slide.classList.toggle('is-active', i === index); });
    replayCharts(sections[index]);
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
