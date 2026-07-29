import { calculateInvestorPack, formatInvestorCurrency, formatInvestorPeriod } from './calculations';
import type { InvestorPack, InvestorPackSnapshot } from './types';

const SOURCE = 'Dados informados manualmente na Projeção Financeira';

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function list(items: string[], empty: string): string {
  const values = items.map((item) => item.trim()).filter(Boolean);
  if (!values.length) return `<li class="muted">${esc(empty)}</li>`;
  return values.map((item) => `<li>${esc(item)}</li>`).join('');
}

function monthlyChart(snapshot: InvestorPackSnapshot): string {
  const points = snapshot.points;
  if (!points.length) {
    return emptyChart('Inclua ao menos uma competência para visualizar o gráfico mensal.');
  }

  const width = 1080;
  const height = 360;
  const pad = { left: 64, right: 24, top: 28, bottom: 52 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...points.flatMap((point) => [
    point.revenueActualCents,
    point.revenueForecastCents,
    point.payrollActualCents,
    point.payrollForecastCents,
  ]));
  const groupW = innerW / Math.max(points.length, 1);
  const barW = Math.max(5, Math.min(18, groupW / 5));
  const colors = ['#35e6bb', '#51a8ff', '#ff647c', '#ffbd59'];
  const series = points.map((point) => [
    point.revenueActualCents,
    point.revenueForecastCents,
    point.payrollActualCents,
    point.payrollForecastCents,
  ]);
  const grid = Array.from({ length: 5 }, (_, index) => {
    const y = pad.top + (innerH / 4) * index;
    const value = max - (max / 4) * index;
    return `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y}" y2="${y}" class="grid"/>
      <text x="${pad.left - 10}" y="${y + 4}" text-anchor="end" class="axis">${esc(formatInvestorCurrency(value, true).replace('R$', ''))}</text>`;
  }).join('');
  const bars = series.map((values, pointIndex) => {
    const center = pad.left + groupW * pointIndex + groupW / 2;
    return values.map((value, seriesIndex) => {
      const barHeight = (value / max) * innerH;
      const x = center + (seriesIndex - 1.5) * (barW + 2) - barW / 2;
      const y = pad.top + innerH - barHeight;
      const dashed = seriesIndex === 1 || seriesIndex === 3 ? ' forecast-bar' : '';
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, barHeight).toFixed(1)}" rx="3" fill="${colors[seriesIndex]}" class="chart-bar${dashed}">
        <title>${esc(formatInvestorPeriod(points[pointIndex].period))} - ${esc(formatInvestorCurrency(value))}</title>
      </rect>`;
    }).join('');
  }).join('');
  const labels = points.map((point, index) => {
    const x = pad.left + groupW * index + groupW / 2;
    return `<text x="${x.toFixed(1)}" y="${height - 20}" text-anchor="middle" class="axis">${esc(formatInvestorPeriod(point.period))}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" class="chart-svg" role="img" aria-label="Receita e folha por mês">${grid}${bars}${labels}</svg>`;
}

function curveChart(snapshot: InvestorPackSnapshot): string {
  const points = snapshot.points;
  if (!points.length) {
    return emptyChart('Inclua ao menos uma competência para visualizar a Curva S.');
  }

  const width = 1080;
  const height = 360;
  const pad = { left: 70, right: 30, top: 30, bottom: 52 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const cumulative = (values: number[]) => {
    let total = 0;
    return values.map((value) => {
      total += value;
      return total;
    });
  };
  const revenueProjected = points.map((point) => point.revenueCumulativeCents);
  const revenueActual = cumulative(points.map((point) => point.revenueActualCents));
  const payrollProjected = points.map((point) => point.payrollCumulativeCents);
  const payrollActual = cumulative(points.map((point) => point.payrollActualCents));
  const max = Math.max(1, ...revenueProjected, ...revenueActual, ...payrollProjected, ...payrollActual);
  const x = (index: number) => pad.left + (index / Math.max(1, points.length - 1)) * innerW;
  const y = (value: number) => pad.top + innerH - (value / max) * innerH;
  const path = (values: number[]) =>
    values.map((value, index) => `${index ? 'L' : 'M'} ${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(' ');
  const grid = Array.from({ length: 5 }, (_, index) => {
    const gy = pad.top + (innerH / 4) * index;
    const value = max - (max / 4) * index;
    return `<line x1="${pad.left}" x2="${width - pad.right}" y1="${gy}" y2="${gy}" class="grid"/>
      <text x="${pad.left - 10}" y="${gy + 4}" text-anchor="end" class="axis">${esc(formatInvestorCurrency(value, true).replace('R$', ''))}</text>`;
  }).join('');
  const labels = points.map((point, index) =>
    `<text x="${x(index).toFixed(1)}" y="${height - 20}" text-anchor="middle" class="axis">${esc(formatInvestorPeriod(point.period))}</text>`,
  ).join('');
  const revenueDots = revenueProjected.map((value, index) => `<circle cx="${x(index)}" cy="${y(value)}" r="4" fill="#35e6bb"><title>${esc(formatInvestorCurrency(value))}</title></circle>`).join('');
  const payrollDots = payrollProjected.map((value, index) => `<circle cx="${x(index)}" cy="${y(value)}" r="3" fill="#ffbd59"><title>${esc(formatInvestorCurrency(value))}</title></circle>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" class="chart-svg" role="img" aria-label="Curva S acumulada">
    <defs><linearGradient id="revenueArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#35e6bb" stop-opacity=".22"/><stop offset="1" stop-color="#35e6bb" stop-opacity="0"/></linearGradient></defs>
    ${grid}
    <path d="${path(revenueProjected)} L ${x(points.length - 1)} ${pad.top + innerH} L ${x(0)} ${pad.top + innerH} Z" fill="url(#revenueArea)"/>
    <path d="${path(revenueProjected)}" fill="none" stroke="#35e6bb" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${path(revenueActual)}" fill="none" stroke="#51a8ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${path(payrollProjected)}" fill="none" stroke="#ffbd59" stroke-width="4" stroke-dasharray="10 8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${path(payrollActual)}" fill="none" stroke="#ff647c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    ${revenueDots}${payrollDots}${labels}
  </svg>`;
}

function emptyChart(message: string): string {
  return `<svg viewBox="0 0 1080 360" class="chart-svg" role="img" aria-label="${esc(message)}">
    <rect x="1" y="1" width="1078" height="358" rx="24" fill="rgba(6,16,33,.48)" stroke="rgba(255,255,255,.12)"/>
    <text x="540" y="184" text-anchor="middle" fill="#9fb2c9" font-size="24">${esc(message)}</text>
  </svg>`;
}

export function investorPackFileStem(pack: InvestorPack): string {
  const slug = pack.title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  return `projecao-financeira-${slug || 'relatorio'}-${pack.referenceDate}`;
}

export function buildInvestorPackPresentationHtml(pack: InvestorPack): string {
  const snapshot = calculateInvestorPack(pack);
  const { metrics } = snapshot;
  const confidentiality = {
    confidential: 'CONFIDENCIAL',
    restricted: 'USO RESTRITO',
    public: 'PÚBLICO',
  }[pack.confidentiality];
  const period = `${formatInvestorPeriod(pack.periodStart)} - ${formatInvestorPeriod(pack.periodEnd)}`;
  const coverage = metrics.coverageRatio == null ? 'N/D' : `${metrics.coverageRatio.toFixed(2)}x`;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>${esc(pack.title)} - v${pack.version}</title>
<style>
:root{--bg:#071014;--panel:rgba(15,32,39,.78);--line:rgba(137,224,211,.18);--text:#f4fbfa;--muted:#91aaa8;--mint:#35e6bb;--blue:#51a8ff;--amber:#ffbd59;--red:#ff647c}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body:before{content:"";position:fixed;inset:0;background:radial-gradient(circle at 80% 10%,rgba(53,230,187,.14),transparent 32%),radial-gradient(circle at 10% 90%,rgba(81,168,255,.12),transparent 34%),linear-gradient(rgba(255,255,255,.018) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.018) 1px,transparent 1px);background-size:auto,auto,36px 36px,36px 36px;pointer-events:none}
.deck{height:100%;display:flex;transition:transform .7s cubic-bezier(.22,1,.36,1)}
.slide{position:relative;min-width:100vw;height:100vh;padding:clamp(28px,5vw,76px);display:grid;grid-template-rows:auto 1fr auto;gap:28px;overflow:hidden}
.slide:after{content:"";position:absolute;inset:18px;border:1px solid var(--line);border-radius:28px;pointer-events:none}
.eyebrow,.source,.page{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--mint)}
h1{font-size:clamp(48px,7vw,94px);line-height:.95;letter-spacing:-.055em;max-width:1000px;margin:0}
h2{font-size:clamp(34px,4vw,62px);line-height:1.04;letter-spacing:-.04em;margin:0;max-width:1050px}
h3{font-size:clamp(20px,2vw,30px);margin:0 0 12px}.lede{font-size:clamp(18px,2vw,28px);line-height:1.45;color:var(--muted);max-width:900px}
.hero{align-self:center}.meta{display:flex;gap:26px;flex-wrap:wrap;margin-top:30px;color:var(--muted)}.meta strong{color:var(--text)}
.footer{display:flex;justify-content:space-between;gap:20px;color:var(--muted);font-size:12px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;align-self:center}.kpi{border-top:2px solid var(--mint);padding-top:18px}.kpi:nth-child(2){border-color:var(--blue)}.kpi:nth-child(3){border-color:var(--amber)}.kpi:nth-child(4){border-color:var(--red)}.kpi b{display:block;font-size:clamp(28px,3.4vw,54px);letter-spacing:-.04em}.kpi span{color:var(--muted);font-size:14px}
.summary-grid{display:grid;grid-template-columns:1.25fr .75fr;gap:48px;align-self:center}.summary-copy{font-size:clamp(18px,1.8vw,26px);line-height:1.5}.signal{font-size:clamp(48px,7vw,92px);color:var(--mint);font-weight:750;letter-spacing:-.06em}.signal small{display:block;font-size:14px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase}
.chart-wrap{align-self:center;border:1px solid var(--line);background:linear-gradient(145deg,rgba(20,44,51,.8),rgba(6,18,23,.72));border-radius:24px;padding:18px 24px;box-shadow:0 28px 80px rgba(0,0,0,.28),inset 0 1px rgba(255,255,255,.04)}.chart-svg{display:block;width:100%;height:min(48vh,430px)}.grid{stroke:rgba(180,230,222,.12);stroke-dasharray:4 6}.axis{fill:var(--muted);font-size:12px}.chart-bar{filter:drop-shadow(0 0 8px rgba(53,230,187,.12));transform-origin:bottom;animation:rise .8s both}.forecast-bar{opacity:.72;stroke:rgba(255,255,255,.45);stroke-width:1;stroke-dasharray:3 2}
.legend{display:flex;gap:22px;flex-wrap:wrap;margin-top:8px;font-size:13px;color:var(--muted)}.dot{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:7px}
.columns{display:grid;grid-template-columns:repeat(3,1fr);gap:36px;align-self:center}.columns section{border-top:1px solid var(--line);padding-top:18px}.columns ul{padding-left:20px;color:var(--muted);font-size:clamp(15px,1.45vw,21px);line-height:1.55}.columns li+li{margin-top:10px}.muted{color:var(--muted)}
.closing{align-self:center;max-width:1000px}.closing blockquote{margin:28px 0 0;border-left:3px solid var(--mint);padding-left:26px;font-size:clamp(21px,2.6vw,38px);line-height:1.35;color:#dff9f3}
.controls{position:fixed;right:26px;bottom:24px;z-index:10;display:flex;align-items:center;gap:8px}.controls button{border:1px solid var(--line);background:rgba(9,24,29,.88);color:var(--text);width:42px;height:42px;border-radius:12px;font-size:18px;cursor:pointer}.controls button:hover{border-color:var(--mint);color:var(--mint)}.progress{position:fixed;left:0;bottom:0;height:3px;background:linear-gradient(90deg,var(--mint),var(--blue));transition:width .5s}.counter{font-size:12px;color:var(--muted);min-width:42px;text-align:center}
@keyframes rise{from{transform:scaleY(0);opacity:0}}@media(max-width:800px){.slide{padding:42px 28px 72px}.kpis{grid-template-columns:1fr 1fr}.summary-grid,.columns{grid-template-columns:1fr;gap:18px}.columns section{font-size:14px}.chart-svg{height:42vh}.footer .source{max-width:70%}}@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important}}
@media print{body{overflow:visible}.deck{display:block;transform:none!important}.slide{page-break-after:always;width:100vw;height:100vh}.controls,.progress{display:none}}
</style>
</head>
<body>
<main class="deck" id="deck">
  <section class="slide">
    <div class="eyebrow">Insight Apex · Projeção Financeira · ${esc(confidentiality)}</div>
    <div class="hero"><h1>${esc(pack.title)}</h1><p class="lede">${esc(pack.company || 'Visão financeira executiva')}</p><div class="meta"><span>Período<br><strong>${esc(period)}</strong></span><span>Data-base<br><strong>${esc(pack.referenceDate)}</strong></span><span>Destinatário<br><strong>${esc(pack.recipient || 'Investidor')}</strong></span><span>Versão<br><strong>${pack.version}</strong></span></div></div>
    <div class="footer"><span class="source">${SOURCE}</span><span class="page">01</span></div>
  </section>
  <section class="slide">
    <div><div class="eyebrow">Síntese executiva</div><h2>A receita projetada cobre ${esc(coverage)} do custo de folha informado</h2></div>
    <div class="summary-grid"><div><p class="summary-copy">${esc(pack.narrative.executiveSummary || 'Preencha o resumo executivo para contextualizar a trajetória financeira apresentada.')}</p><div class="kpis"><div class="kpi"><b>${esc(formatInvestorCurrency(metrics.revenueActualCents, true))}</b><span>Receita realizada</span></div><div class="kpi"><b>${esc(formatInvestorCurrency(metrics.revenueForecastCents, true))}</b><span>Receita prevista</span></div><div class="kpi"><b>${esc(formatInvestorCurrency(metrics.payrollTotalCents, true))}</b><span>Folha total</span></div><div class="kpi"><b>${esc(formatInvestorCurrency(metrics.balanceCents, true))}</b><span>Diferença acumulada</span></div></div></div><div class="signal">${esc(coverage)}<small>cobertura receita / folha</small></div></div>
    <div class="footer"><span class="source">${SOURCE}</span><span class="page">02</span></div>
  </section>
  <section class="slide">
    <div><div class="eyebrow">Evolução mensal</div><h2>Realizado e previsto permanecem visivelmente separados</h2></div>
    <div class="chart-wrap">${monthlyChart(snapshot)}<div class="legend"><span><i class="dot" style="background:#35e6bb"></i>Receita realizada</span><span><i class="dot" style="background:#51a8ff"></i>Receita prevista</span><span><i class="dot" style="background:#ff647c"></i>Folha realizada</span><span><i class="dot" style="background:#ffbd59"></i>Folha prevista</span></div></div>
    <div class="footer"><span class="source">${SOURCE}</span><span class="page">03</span></div>
  </section>
  <section class="slide">
    <div><div class="eyebrow">Curva S</div><h2>A trajetória acumulada evidencia a cobertura financeira do período</h2></div>
    <div class="chart-wrap">${curveChart(snapshot)}<div class="legend"><span><i class="dot" style="background:#35e6bb"></i>Projeção receita</span><span><i class="dot" style="background:#51a8ff"></i>Receita já faturada</span><span><i class="dot" style="background:#ffbd59"></i>Projeção folha</span><span><i class="dot" style="background:#ff647c"></i>Folha já fechada</span></div></div>
    <div class="footer"><span class="source">${SOURCE}</span><span class="page">04</span></div>
  </section>
  <section class="slide">
    <div><div class="eyebrow">Premissas e leitura de risco</div><h2>O que sustenta a projeção e merece acompanhamento</h2></div>
    <div class="columns"><section><h3>Destaques</h3><ul>${list(pack.narrative.highlights, 'Nenhum destaque informado.')}</ul></section><section><h3>Riscos</h3><ul>${list(pack.narrative.risks, 'Nenhum risco informado.')}</ul></section><section><h3>Premissas</h3><ul>${list(pack.narrative.assumptions, 'Nenhuma premissa informada.')}</ul></section></div>
    <div class="footer"><span class="source">${SOURCE}</span><span class="page">05</span></div>
  </section>
  <section class="slide">
    <div class="eyebrow">Perspectiva e próximos passos</div>
    <div class="closing"><h2>A disciplina de atualização transforma projeção em confiança</h2><blockquote>${esc(pack.narrative.closingMessage || 'Atualizar as premissas e os valores mensais à medida que novas informações forem consolidadas.')}</blockquote></div>
    <div class="footer"><span class="source">${SOURCE} · ${esc(confidentiality)}</span><span class="page">06</span></div>
  </section>
</main>
<div class="controls"><button id="prev" aria-label="Slide anterior">←</button><span class="counter" id="counter">1 / 6</span><button id="next" aria-label="Próximo slide">→</button><button id="full" aria-label="Tela cheia">⛶</button></div><div class="progress" id="progress"></div>
<script>
(()=>{const deck=document.getElementById('deck'),counter=document.getElementById('counter'),progress=document.getElementById('progress');const total=6;let index=0,startX=0;function show(next){index=Math.max(0,Math.min(total-1,next));deck.style.transform='translateX(-'+(index*100)+'vw)';counter.textContent=(index+1)+' / '+total;progress.style.width=((index+1)/total*100)+'%'}document.getElementById('prev').onclick=()=>show(index-1);document.getElementById('next').onclick=()=>show(index+1);document.getElementById('full').onclick=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();addEventListener('keydown',e=>{if(['ArrowRight','PageDown',' '].includes(e.key))show(index+1);if(['ArrowLeft','PageUp'].includes(e.key))show(index-1);if(e.key==='Home')show(0);if(e.key==='End')show(total-1)});addEventListener('touchstart',e=>startX=e.changedTouches[0].clientX,{passive:true});addEventListener('touchend',e=>{const d=e.changedTouches[0].clientX-startX;if(Math.abs(d)>55)show(index+(d<0?1:-1))},{passive:true});show(0)})();
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
