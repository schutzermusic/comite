/**
 * Apresentação HTML de Pessoas & Custos — arquivo único, para projetar.
 *
 * Um `.html` autocontido: sem CDN, sem autenticação, sem servidor. Abre no
 * navegador de quem receber, roda offline num notebook de sala de reunião e
 * sobrevive a anexo de e-mail. Navegação por teclado, gesto e índice.
 *
 * Mesmo roteiro, mesmos números e mesma narrativa do PDF, porque os três
 * destinos leem o mesmo `WorkforceOverviewModel` e o mesmo `buildWorkforceInsights`.
 * O que muda é o formato: aqui cada seção é um slide 16:9, não uma folha A4.
 *
 * Sempre no tema escuro — apresentação é projeção, e o claro existe para o
 * papel.
 */

import { buildGilroyFontFaceCss } from '@/lib/fonts';
import { esc } from '@/lib/reports/report-formatters';

import {
  wfDonut,
  wfGauge,
  wfGroupedBars,
  wfLineChart,
  wfParetoChart,
  wfStackedBars,
  wfLegend,
  wfLegendCss,
} from './charts';
import { buildWorkforceInsights, type WorkforceInsightCard } from './insights';
import { measuredText } from './format';
import { logoBackgroundCss, type ReportBranding } from '@/lib/reports/report-branding';
import {
  REPORT_FILE_SLUG,
  REPORT_NAME,
  UNMEASURED_DASH,
  WF_DARK,
  WF_FONT,
  WF_SOURCE,
  wfAgenda,
  wfCompactCurrency,
  wfCurrency,
  wfInt,
  wfPct,
  type WorkforcePalette,
} from './theme';
import type { WorkforceOverviewModel } from '../types';

const P: WorkforcePalette = WF_DARK;

/** 16:9 — a grade do slide, em px. */
const SLIDE_W = 1280;
const SLIDE_H = 720;
const CHART_W = 1120;
const CHART_W_HALF = 545;

interface Slide {
  id: string;
  title: string;
  html: string;
  cover?: boolean;
}

/* ─── Primitivas ─────────────────────────────────────────────────────────── */

function kpiTile(args: {
  label: string;
  value: string;
  helper?: string;
  delta?: { text: string; color: string };
  measured: boolean;
}): string {
  return (
    `<div class="tile">` +
    `<span class="t-label">${esc(args.label)}</span>` +
    `<span class="t-value"${args.measured ? '' : ' data-unmeasured'}>${esc(args.value)}</span>` +
    (args.delta
      ? `<span class="t-delta" style="color:${args.delta.color}">${esc(args.delta.text)}</span>`
      : '') +
    (args.helper ? `<span class="t-helper">${esc(args.helper)}</span>` : '') +
    `</div>`
  );
}

function insightCard(c: WorkforceInsightCard): string {
  const color = c.kind === 'alert' ? P.negative : c.kind === 'watch' ? P.attention : P.positive;
  const kind = c.kind === 'alert' ? 'Alerta' : c.kind === 'watch' ? 'Observar' : 'Sinal';
  return (
    `<div class="ins" style="border-left-color:${color}">` +
    `<div class="ins-top"><span class="ins-kind" style="color:${color}">${kind}</span>` +
    (c.value ? `<span class="ins-value">${esc(c.value)}</span>` : '') +
    `</div><h4>${esc(c.title)}</h4><p>${esc(c.detail)}</p></div>`
  );
}

function panel(inner: string, cls = ''): string {
  return `<div class="panel ${cls}">${inner}</div>`;
}

/* ─── Slides ─────────────────────────────────────────────────────────────── */

function buildSlides(model: WorkforceOverviewModel): Slide[] {
  const insights = buildWorkforceInsights(model);
  const { meta, executive, efficiency, dynamics, costStructure, concentration, compliance } = model;
  const branding = meta.branding;

  const agenda = wfAgenda({
    hasEfficiency: efficiency.series.length > 0,
    hasDynamics: dynamics.movement.length > 0 || dynamics.turnover.length > 0,
    hasCostStructure: costStructure.composition.length > 0 || costStructure.scurve.length > 0,
    hasConcentration: concentration.data.costCenters.length > 0,
  });

  const slides: Slide[] = [];

  /* Capa */
  slides.push({
    id: 'capa',
    title: 'Capa',
    cover: true,
    html:
      `<div class="cover">` +
      `<span class="cover-logo" role="img" aria-label="${esc(model.meta.branding.logoAlt)}"></span>` +
      `<h1>Cockpit Executivo<br/>de Pessoas &amp; Custos</h1>` +
      `<p class="cover-sub">${esc(insights.headline)}</p>` +
      `<div class="cover-meta">` +
      `<span><b>Período</b>${esc(meta.periodLabel)}</span>` +
      `<span><b>Recorte</b>${esc(meta.filtersLabel)}</span>` +
      `<span><b>Fonte</b>${esc(WF_SOURCE)}</span>` +
      `</div></div>`,
  });

  /* Roteiro */
  slides.push({
    id: 'roteiro',
    title: 'Roteiro',
    html:
      `<h2 class="s-title">Roteiro</h2>` +
      `<ol class="agenda">` +
      agenda
        .map((a) => `<li><b>${esc(a.title)}</b><span>${esc(a.sub)}</span></li>`)
        .join('') +
      `</ol>`,
  });

  /* Resumo executivo */
  const kpis = executive.kpis
    .filter((k) => k.group === 'custo' || k.group === 'volume' || k.group === 'eficiencia')
    .slice(0, 8)
    .map((k) => {
      const isMeasured = k.display ? k.display.measured : k.value.measured;
      const d = k.delta.measured ? k.delta.value : null;
      return kpiTile({
        label: k.label,
        value: measuredText(k.value, k.format, k.display),
        helper: isMeasured ? k.helper : 'não apurado no período',
        measured: isMeasured,
        delta: d
          ? {
              text: `${d.pct > 0 ? '+' : ''}${d.pct.toFixed(1).replace('.', ',')}% ${d.label}`,
              color: d.pct === 0 ? P.muted : d.pct > 0 === d.upIsGood ? P.positive : P.negative,
            }
          : undefined,
      });
    });

  slides.push({
    id: 'resumo',
    title: 'Resumo executivo',
    html:
      `<h2 class="s-title">Resumo executivo</h2>` +
      `<p class="s-sub">${esc(meta.periodLabel)} · ${esc(meta.filtersLabel)}</p>` +
      `<div class="band">${kpis.join('')}</div>` +
      `<div class="verdict">${esc(insights.verdict)}</div>`,
  });

  /* Sinais */
  if (insights.cards.length > 0) {
    slides.push({
      id: 'sinais',
      title: 'Sinais do período',
      html:
        `<h2 class="s-title">Sinais do período</h2>` +
        `<div class="cols-2">` +
        panel(
          wfGauge(executive.risk.score.measured ? executive.risk.score.value : null, {
            palette: P,
            width: CHART_W_HALF,
            height: 260,
            label: 'Saúde da folha (100 = melhor)',
            valueText: executive.risk.score.measured
              ? `${executive.risk.score.value}/100`
              : undefined,
            // Escala documentada como "higher = healthier": 100 é o melhor.
            bands: [
              [0, 40, P.negative],
              [40, 70, P.attention],
              [70, 100, P.positive],
            ],
          }) + `<p class="p-note">${esc(executive.risk.message)}</p>`,
        ) +
        `<div class="ins-grid">${insights.cards.slice(0, 4).map(insightCard).join('')}</div>` +
        `</div>`,
    });
  }

  /* Eficiência */
  if (efficiency.series.length > 0) {
    slides.push({
      id: 'eficiencia',
      title: 'Eficiência & produtividade',
      html:
        `<h2 class="s-title">Eficiência &amp; produtividade</h2>` +
        `<p class="s-sub">Quanto cada pessoa produz e que parcela da receita a folha consome</p>` +
        panel(
          wfLineChart(
            efficiency.series.map((d) => d.period),
            [
              {
                name: 'Receita por colaborador',
                values: efficiency.series.map((d) => d.revenuePerEmployee),
                color: P.success,
                area: true,
              },
              {
                name: 'Custo por colaborador',
                values: efficiency.series.map((d) => d.costPerEmployee),
                color: P.info,
              },
            ],
            { palette: P, width: CHART_W, height: 380, caption: 'Receita e custo por colaborador' },
          ) +
            wfLegend([
              { label: 'Receita por colaborador', color: P.success },
              { label: 'Custo por colaborador', color: P.info },
            ]),
        ),
    });
  }

  /* Dinâmica */
  if (dynamics.movement.length > 0 || dynamics.turnover.length > 0) {
    slides.push({
      id: 'dinamica',
      title: 'Dinâmica do quadro',
      html:
        `<h2 class="s-title">Dinâmica do quadro</h2>` +
        `<p class="s-sub">Movimentação declarada e rotatividade</p>` +
        panel(
          wfGroupedBars(
            dynamics.movement.map((d) => d.period),
            [
              { name: 'Admissões', values: dynamics.movement.map((d) => d.admissions), color: P.success },
              { name: 'Desligamentos', values: dynamics.movement.map((d) => d.dismissals), color: P.danger },
            ],
            {
              palette: P,
              width: CHART_W,
              height: 380,
              fmt: (v) => wfInt(v),
              caption: 'Admissões × Desligamentos',
            },
          ) +
            wfLegend([
              { label: 'Admissões', color: P.success },
              { label: 'Desligamentos', color: P.danger },
            ]),
        ),
    });
  }

  /* Estrutura de custo */
  if (costStructure.composition.length > 0) {
    slides.push({
      id: 'custo',
      title: 'Estrutura de custo',
      html:
        `<h2 class="s-title">Estrutura de custo</h2>` +
        `<p class="s-sub">De que a folha é feita, competência a competência</p>` +
        `<div class="cols-2">` +
        panel(
          wfStackedBars(
            costStructure.composition.map((d) => d.period),
            [
              { name: 'Salário', values: costStructure.composition.map((d) => d.salary), color: P.accent },
              { name: 'Benefícios', values: costStructure.composition.map((d) => d.benefits), color: P.success },
              { name: 'Encargos', values: costStructure.composition.map((d) => d.charges), color: P.warning },
            ],
            { palette: P, width: CHART_W_HALF, height: 330, caption: 'Composição da folha' },
          ) +
            wfLegend([
              { label: 'Salário', color: P.accent },
              { label: 'Benefícios', color: P.success },
              { label: 'Encargos', color: P.warning },
            ]),
        ) +
        panel(
          wfDonut(benefitSlices(model), {
            palette: P,
            width: CHART_W_HALF,
            height: 330,
            centerLabel: 'Benefícios',
            centerValue: costStructure.benefitsTotal.measured
              ? wfCompactCurrency(costStructure.benefitsTotal.value)
              : UNMEASURED_DASH,
          }),
        ) +
        `</div>`,
    });
  }

  /* Concentração */
  if (concentration.data.costCenters.length > 0) {
    slides.push({
      id: 'concentracao',
      title: 'Risco & concentração',
      html:
        `<h2 class="s-title">Risco &amp; concentração</h2>` +
        `<p class="s-sub">Dependência dos maiores centros — total de ${esc(wfCurrency(concentration.data.totalPayroll))}</p>` +
        panel(
          wfParetoChart(
            [...concentration.data.costCenters]
              .sort((a, b) => b.payrollValue - a.payrollValue)
              .map((c) => ({ label: c.name, value: c.payrollValue, highlight: c.isAbnormal })),
            { palette: P, width: CHART_W, height: 400, caption: 'Folha por centro de custo, com acumulado' },
          ),
        ),
    });
  }

  /* Conformidade */
  slides.push({
    id: 'conformidade',
    title: 'Conformidade',
    html:
      `<h2 class="s-title">Conformidade da competência</h2>` +
      `<p class="s-sub">Ciclo folha → eSocial → guias em ${esc(compliance.currentCompetenceLabel)}</p>` +
      `<div class="cols-2">` +
      panel(
        wfGauge(compliance.snapshot.score, {
          palette: P,
          width: CHART_W_HALF,
          height: 280,
          label: 'Conformidade da competência',
          valueText: `${compliance.snapshot.score}/100`,
          bands: [
            [0, 60, P.negative],
            [60, 85, P.attention],
            [85, 100, P.positive],
          ],
        }),
      ) +
      panel(
        `<table class="dt"><thead><tr><th>Obrigação</th><th>Vencimento</th><th>Situação</th></tr></thead><tbody>` +
          compliance.snapshot.obligations
            .slice(0, 9)
            .map(
              (o) =>
                `<tr><td>${esc(o.code)} · ${esc(o.label)}</td><td>${esc(o.dueDate)}</td><td>${esc(o.status)}</td></tr>`,
            )
            .join('') +
          `</tbody></table>`,
      ) +
      `</div>`,
  });

  /* Método */
  slides.push({
    id: 'metodologia',
    title: 'Procedência & método',
    html:
      `<h2 class="s-title">Procedência &amp; método</h2>` +
      `<p class="s-sub">De onde vem cada número e o que esta apresentação NÃO afirma</p>` +
      `<div class="cols-2">` +
      panel(
        `<h3>Fontes</h3><ul class="meth">` +
          `<li><b>Folha</b> — lotes de fechamento aprovados, com rateio por centro de custo.</li>` +
          `<li><b>Quadro e movimentação</b> — eventos apurados do eSocial.</li>` +
          `<li><b>Composição</b> — classificação de verbas pela tabela de rubricas (S-1010).</li>` +
          `<li><b>Receita</b> — títulos do contas a receber, por competência.</li>` +
          `</ul>`,
      ) +
      panel(
        `<h3>O que não foi apurado</h3>` +
          (insights.gaps.length > 0
            ? `<ul class="meth gaps">${insights.gaps.slice(0, 6).map((g) => `<li>${esc(g)}</li>`).join('')}</ul>`
            : `<p class="p-note">Todos os indicadores do escopo foram apurados.</p>`) +
          `<p class="disclaimer">Somente dado apurado. Onde a fonte não respondeu, o indicador aparece como “${UNMEASURED_DASH}” — nunca como zero.</p>`,
      ) +
      `</div>`,
  });

  return slides;
}

function benefitSlices(model: WorkforceOverviewModel) {
  const { benefits } = model.costStructure;
  const spec: [keyof (typeof benefits)[number], string, string][] = [
    ['va', 'Vale-alimentação', P.accent],
    ['vr', 'Vale-refeição', P.success],
    ['health', 'Saúde', P.info],
    ['dental', 'Odontológico', P.budget],
    ['transport', 'Transporte', P.warning],
    ['other', 'Outros', P.danger],
  ];
  return spec
    .map(([key, name, color]) => ({
      name,
      value: benefits.reduce((s, b) => s + (b[key] as number), 0),
      color,
    }))
    .filter((s) => s.value > 0);
}

/* ─── Documento ──────────────────────────────────────────────────────────── */

function deckCss(branding: ReportBranding): string {
  return `
*{box-sizing:border-box;margin:0;padding:0;}
html,body{height:100%;background:${P.void};font-family:${WF_FONT};color:${P.body};overflow:hidden;}
#deck{position:relative;width:100vw;height:100vh;}
.slide{position:absolute;inset:0;display:none;flex-direction:column;gap:18px;
  padding:56px 64px 72px;opacity:0;transition:opacity .28s ease;}
.slide.active{display:flex;opacity:1;}
.slide::before{content:'';position:absolute;inset:0;z-index:-1;
  background-image:linear-gradient(${P.grid} 1px,transparent 1px),linear-gradient(90deg,${P.grid} 1px,transparent 1px);
  background-size:44px 44px;}

.s-title{font-size:38px;font-weight:800;letter-spacing:-.02em;color:${P.ink};}
.s-sub{margin-top:-12px;font-size:15px;color:${P.muted};}

.cover{flex:1;display:flex;flex-direction:column;justify-content:center;gap:22px;}
.cover-logo{${logoBackgroundCss(branding.logoDataUri, {
  height: '58px',
  maxWidth: `${Math.min(360, 58 * branding.logoAspect)}px`,
})}margin-bottom:6px;}
.cover h1{font-size:64px;line-height:1.06;font-weight:800;letter-spacing:-.03em;color:${P.ink};}
.cover-sub{font-size:19px;line-height:1.5;color:${P.body};max-width:72%;}
.cover-meta{display:flex;gap:44px;margin-top:14px;padding-top:22px;border-top:1px solid ${P.line};}
.cover-meta span{display:flex;flex-direction:column;gap:4px;font-size:14px;color:${P.body};}
.cover-meta b{font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:${P.subtle};}

.agenda{list-style:none;counter-reset:ag;display:grid;grid-template-columns:1fr 1fr;gap:16px 40px;margin-top:8px;}
.agenda li{counter-increment:ag;display:flex;flex-direction:column;gap:2px;padding:14px 0 14px 46px;
  position:relative;border-top:1px solid ${P.lineSoft};}
.agenda li::before{content:counter(ag,decimal-leading-zero);position:absolute;left:0;top:14px;
  font-size:15px;font-weight:800;color:${P.accent};}
.agenda b{font-size:17px;color:${P.ink};}
.agenda span{font-size:13px;color:${P.muted};}

.band{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;}
.tile{display:flex;flex-direction:column;gap:3px;padding:16px 18px;border:1px solid ${P.line};border-radius:14px;
  background:linear-gradient(150deg,${P.panelTop},${P.panelBottom});}
.t-label{font-size:10.5px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:${P.subtle};}
.t-value{font-size:30px;line-height:1.1;font-weight:800;color:${P.ink};font-variant-numeric:tabular-nums;}
.t-value[data-unmeasured]{font-weight:400;color:${P.unmeasured};}
.t-delta{font-size:12px;font-weight:700;}
.t-helper{font-size:11.5px;color:${P.muted};}

.verdict{margin-top:auto;padding:16px 20px;border-left:3px solid ${P.accent};background:${P.raised};
  border-radius:0 12px 12px 0;font-size:16px;font-weight:600;color:${P.ink};}

.panel{border:1px solid ${P.line};border-radius:16px;padding:16px;
  background:linear-gradient(160deg,${P.panelTop},${P.panelBottom});}
.panel svg{display:block;width:100%;height:auto;}
.panel h3{font-size:15px;font-weight:800;color:${P.ink};margin-bottom:10px;}
.p-note{margin-top:12px;font-size:13px;line-height:1.55;color:${P.muted};}
.cols-2{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start;}

.ins-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-content:start;}
.ins{border:1px solid ${P.line};border-left-width:3px;border-radius:12px;padding:14px;background:${P.raised};}
.ins-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px;}
.ins-kind{font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;}
.ins-value{font-size:15px;font-weight:800;color:${P.ink};font-variant-numeric:tabular-nums;}
.ins h4{margin-top:4px;font-size:14.5px;font-weight:700;color:${P.ink};}
.ins p{margin-top:3px;font-size:12px;line-height:1.5;color:${P.muted};}

.dt{width:100%;border-collapse:collapse;font-size:13px;}
.dt th{text-align:left;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;
  color:${P.subtle};padding:8px;border-bottom:1px solid ${P.line};}
.dt td{padding:7px 8px;color:${P.body};border-bottom:1px solid ${P.lineSoft};}
.dt tbody tr:nth-child(even){background:${P.raised};}

.meth{list-style:none;display:flex;flex-direction:column;gap:9px;}
.meth li{position:relative;padding-left:18px;font-size:13px;line-height:1.5;color:${P.muted};}
.meth li::before{content:'';position:absolute;left:0;top:7px;width:6px;height:6px;border-radius:2px;background:${P.accent};}
.meth.gaps li::before{background:${P.attention};}
.meth b{color:${P.ink};}
.disclaimer{margin-top:16px;padding-top:12px;border-top:1px solid ${P.lineSoft};font-size:12px;line-height:1.55;color:${P.subtle};}

${wfLegendCss(P)}

/* Cromo da apresentação */
.chrome{position:fixed;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:space-between;
  padding:14px 28px;font-size:11.5px;color:${P.subtle};pointer-events:none;}
.chrome b{color:${P.muted};}
.chrome-brand{display:inline-flex;align-items:center;gap:9px;}
.chrome-logo{${logoBackgroundCss(branding.logoSmallDataUri, {
  height: '16px',
  maxWidth: `${Math.min(120, 16 * branding.logoAspect)}px`,
})}flex:0 0 auto;}
.progress{position:fixed;left:0;top:0;height:2px;background:${P.accent};transition:width .3s ease;z-index:20;}
.nav{position:fixed;right:24px;bottom:44px;display:flex;gap:8px;z-index:20;}
.nav button{width:36px;height:36px;border-radius:10px;border:1px solid ${P.line};cursor:pointer;
  background:${P.panelTop};color:${P.body};font-size:15px;font-family:inherit;}
.nav button:hover{color:${P.ink};border-color:${P.accent};}

/* Índice */
#index{position:fixed;inset:0;z-index:40;display:none;padding:64px;background:rgba(5,11,18,.97);}
#index.open{display:block;}
#index h2{font-size:26px;font-weight:800;color:${P.ink};margin-bottom:24px;}
.idx-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}
.idx-grid button{text-align:left;padding:16px 18px;border:1px solid ${P.line};border-radius:12px;cursor:pointer;
  background:${P.panelTop};color:${P.ink};font-family:inherit;font-size:14.5px;font-weight:600;}
.idx-grid button:hover{border-color:${P.accent};}
.idx-grid span{display:block;margin-top:3px;font-size:11px;font-weight:500;color:${P.subtle};}
`;
}

export function buildWorkforceOverviewPresentationHtml(model: WorkforceOverviewModel): string {
  const slides = buildSlides(model);
  const total = slides.length;
  const title = `${REPORT_NAME} — ${model.meta.periodLabel}`;

  const slidesHtml = slides
    .map(
      (s, i) =>
        `<section class="slide${i === 0 ? ' active' : ''}" data-i="${i}" id="s-${s.id}">${s.html}</section>`,
    )
    .join('');

  const indexHtml = slides
    .map(
      (s, i) =>
        `<button type="button" data-go="${i}">${String(i + 1).padStart(2, '0')}. ${esc(s.title)}<span>${esc(s.id)}</span></button>`,
    )
    .join('');

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="dark"/>
<title>${esc(title)}</title>
<style>
${buildGilroyFontFaceCss()}
${deckCss(model.meta.branding)}
</style></head>
<body>
<div class="progress" id="progress"></div>
<div id="deck">${slidesHtml}</div>

<div id="index">
  <h2>Roteiro</h2>
  <div class="idx-grid">${indexHtml}</div>
</div>

<div class="chrome">
  <span class="chrome-brand">
    <i class="chrome-logo" role="img" aria-label="${esc(model.meta.branding.logoAlt)}"></i>
    <b>${esc(model.meta.branding.companyName)}</b> · ${esc(REPORT_NAME)}
  </span>
  <span>${esc(model.meta.periodLabel)} · ${esc(model.meta.filtersLabel)}</span>
  <span><b id="counter">1 / ${total}</b></span>
</div>

<div class="nav">
  <button type="button" id="btn-index" title="Índice (I)">☰</button>
  <button type="button" id="btn-prev" title="Anterior (←)">‹</button>
  <button type="button" id="btn-next" title="Próximo (→)">›</button>
  <button type="button" id="btn-full" title="Tela cheia (F)">⛶</button>
</div>

<script>
(function () {
  var total = ${total};
  var i = 0;
  var slides = document.querySelectorAll('.slide');
  var counter = document.getElementById('counter');
  var progress = document.getElementById('progress');
  var index = document.getElementById('index');

  function go(n) {
    i = Math.max(0, Math.min(total - 1, n));
    for (var k = 0; k < slides.length; k++) slides[k].classList.toggle('active', k === i);
    counter.textContent = (i + 1) + ' / ' + total;
    progress.style.width = (((i + 1) / total) * 100) + '%';
    // O deck também roda dentro de um <iframe srcdoc> (pré-visualização na
    // própria página), onde o documento é 'about:srcdoc' e replaceState lança
    // SecurityError. A âncora é conveniência, não requisito: se falhar, a
    // navegação continua — o que não pode acontecer é encher o console de erro
    // durante uma apresentação.
    try {
      if (location.hash !== '#' + i) history.replaceState(null, '', '#' + i);
    } catch (e) { /* about:srcdoc não aceita replaceState */ }
  }

  document.getElementById('btn-next').onclick = function () { go(i + 1); };
  document.getElementById('btn-prev').onclick = function () { go(i - 1); };
  document.getElementById('btn-index').onclick = function () { index.classList.toggle('open'); };
  document.getElementById('btn-full').onclick = function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  };
  index.addEventListener('click', function (e) {
    var t = e.target.closest('[data-go]');
    if (t) { go(parseInt(t.getAttribute('data-go'), 10)); index.classList.remove('open'); }
    else if (e.target === index) index.classList.remove('open');
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); go(i + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(i - 1); }
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(total - 1);
    else if (e.key === 'i' || e.key === 'I') index.classList.toggle('open');
    else if (e.key === 'f' || e.key === 'F') document.getElementById('btn-full').click();
    else if (e.key === 'Escape') index.classList.remove('open');
  });

  // Gesto horizontal — apresentar de tablet sem teclado.
  var x0 = null;
  document.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 60) go(dx < 0 ? i + 1 : i - 1);
    x0 = null;
  }, { passive: true });

  go(parseInt((location.hash || '#0').slice(1), 10) || 0);
})();
</script>
</body></html>`;
}

/** Nome de arquivo estável, compartilhado pelo download e pelo PowerPoint. */
export function workforceOverviewFileStem(model: WorkforceOverviewModel): string {
  const period = model.meta.periodLabel
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return `${REPORT_FILE_SLUG}-${period || 'periodo'}`;
}

/** Baixa o deck como arquivo único. Só no navegador. */
export function downloadWorkforceOverviewHtml(model: WorkforceOverviewModel): void {
  const html = buildWorkforceOverviewPresentationHtml(model);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${workforceOverviewFileStem(model)}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const WORKFORCE_DECK_SLIDE_SIZE = { width: SLIDE_W, height: SLIDE_H };
