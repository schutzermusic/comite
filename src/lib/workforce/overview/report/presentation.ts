/**
 * Apresentação HTML de Pessoas & Custos — deck executivo autônomo.
 *
 * Um único arquivo, sem CDN, sem autenticação e sem identificadores internos:
 * pode ser enviado por e-mail, aberto offline e projetado em reunião.
 *
 * ─── Mesmo deck da Projeção Financeira ─────────────────────────────────────
 *
 * O shell aqui é a transcrição de `html-presentation.ts` do investor pack:
 * mesma tira de filme horizontal com `translate3d`, mesma troca com
 * profundidade (o slide que sai recua e desfoca, o que entra volta ao plano),
 * mesma entrada em cascata do cabeçalho/corpo/rodapé, mesma moldura de cockpit
 * com o traço de acento, mesma vinheta, mesmo trilho de progresso, mesmos
 * pontos, mesmo HUD de navegação e mesmo índice em cartões.
 *
 * E, sobretudo, o mesmo `replayCharts`: as marcas dos gráficos reanimam a cada
 * chegada, então o slide se desenha na frente de quem assiste em vez de já
 * estar pronto desde o carregamento. É o efeito que separa uma apresentação de
 * um PDF rolável.
 *
 * Camada de apresentação apenas: os números vêm do `WorkforceOverviewModel` e a
 * leitura editorial de `buildWorkforceInsights` — os mesmos que alimentam o PDF
 * e o PowerPoint.
 *
 * Sempre no tema escuro — apresentação é projeção, e o claro existe para o
 * papel.
 */

import { buildGilroyFontFaceCss } from '@/lib/fonts';
import { esc } from '@/lib/reports/report-formatters';

import {
  WF_CHART_ANIM_CSS,
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
import { OBLIGATION_STATUS_META } from '@/lib/workforce/compliance';
import { measuredText } from './format';
import { logoBackgroundCss, type ReportBranding } from '@/lib/reports/report-branding';
import {
  REPORT_FILE_SLUG,
  REPORT_NAME,
  REPORT_NAME_SHORT,
  UNMEASURED_DASH,
  WF_DARK,
  WF_FONT,
  WF_SOURCE,
  wfAgenda,
  wfBackdrop,
  wfCompactCurrency,
  wfCurrency,
  wfDueDate,
  wfInt,
  wfPct,
  type WorkforcePalette,
} from './theme';
import type { Measured, WorkforceOverviewModel } from '../types';

const P: WorkforcePalette = WF_DARK;

/** 16:9 — a grade do slide, em px. */
const SLIDE_W = 1280;
const SLIDE_H = 720;
/**
 * Caixas de gráfico do deck.
 *
 * O SVG escala pela LARGURA (`height:auto`), então a proporção da viewBox é o
 * que define a altura no slide: 1180×400 rende ~372px na largura útil, que é o
 * que sobra abaixo do título e da sublinha sem invadir o rodapé.
 */
const CHART_W = 1180;
const CHART_H = 400;
const CHART_W_HALF = 560;
const CHART_H_HALF = 340;

interface Slide {
  /** Rótulo curto usado no índice e no trilho de progresso. */
  nav: string;
  /** Sobrelinha da seção. */
  eyebrow: string;
  html: string;
}

/* ─── Primitivas ─────────────────────────────────────────────────────────── */

/**
 * Faixa executiva — a mesma anatomia do PDF (padrão HudKpiStrip / Executive
 * Band): um contêiner de vidro com trilhos nas bordas agrupando células de gap
 * mínimo, em vez de cartões soltos.
 */
function band(cells: string, columns = 4): string {
  return `<div class="band"><div class="band-grid" style="--cols:${columns}">${cells}</div></div>`;
}

/** Célula da faixa: ponto de acento + rótulo, valor tabular, sublinha discreta. */
function cell(args: {
  label: string;
  value: string;
  accent: string;
  helper?: string;
  detail?: string;
  tag?: string;
  measured?: boolean;
}): string {
  const unmeasured = args.measured === false;
  return `<div class="cell" style="--accent:${args.accent}">
    <span class="cell-top">
      <i class="cell-dot"></i><span class="cell-l">${esc(args.label)}</span>
      ${args.tag ? `<span class="cell-tag">${esc(args.tag)}</span>` : ''}
    </span>
    <b class="cell-v"${unmeasured ? ' data-unmeasured' : ''}>${esc(args.value)}</b>
    ${args.helper ? `<span class="cell-h">${esc(args.helper)}</span>` : ''}
    ${args.detail ? `<p class="cell-d">${esc(args.detail)}</p>` : ''}
  </div>`;
}

function insightCell(card: WorkforceInsightCard): string {
  const accent = card.kind === 'alert' ? P.negative : card.kind === 'watch' ? P.attention : P.accent;
  const tag = card.kind === 'alert' ? 'Atenção' : card.kind === 'watch' ? 'Monitorar' : 'Sinal';
  return cell({
    label: card.title,
    value: card.value ?? UNMEASURED_DASH,
    accent,
    tag,
    detail: card.detail,
  });
}

/**
 * Painel de gráfico.
 *
 * A legenda é suprimida quando o gráfico é o quadro do "não apurado": listar
 * "Salário · Benefícios · Encargos" sob um painel que acabou de declarar que as
 * rubricas não foram classificadas sugere séries que não existem.
 */
function panel(chartSvg: string, legend?: WfLegendItem[], caption?: string): string {
  const showLegend = legend && legend.length > 0 && !isEmptyChart(chartSvg);
  return `<div class="panel">${chartSvg}${showLegend ? wfLegend(legend) : ''}${
    caption ? `<p class="panel-cap">${esc(caption)}</p>` : ''
  }</div>`;
}

/** Valor apurado, ou o traço. Nunca zero por descuido. */
function show(m: Measured<number>, fmt: (v: number) => string): string {
  return m.measured ? fmt(m.value) : UNMEASURED_DASH;
}

/**
 * Junta só os trechos apurados numa frase.
 *
 * Sem isto, a sublinha do slide vira sopa de traços — "R$ 6,2 mi acumulados —
 * – em salário direto, – em benefícios e – em encargos" — que é pior do que
 * não dizer nada: parece defeito de geração, não ausência de fonte.
 */
function sentence(parts: (string | null)[], fallback: string): string {
  const usable = parts.filter((s): s is string => s !== null);
  if (usable.length === 0) return fallback;
  if (usable.length === 1) return `${usable[0]}.`;
  return `${usable.slice(0, -1).join(', ')} e ${usable[usable.length - 1]}.`;
}

/** O trecho, ou `null` quando a fonte não respondeu. */
function part(m: Measured<number>, render: (v: number) => string): string | null {
  return m.measured ? render(m.value) : null;
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

  /* 01 — Capa
   *
   * Bloco único centrado nos dois eixos, idêntico à capa do PDF: marca,
   * título, leitura de abertura, fio de acento e a linha de meta. */
  slides.push({
    nav: 'Capa',
    eyebrow: REPORT_NAME_SHORT,
    html: `<div class="hero">
      <span class="hero-logo" role="img" aria-label="${esc(branding.logoAlt)}"></span>
      <h1>${esc(REPORT_NAME)}</h1>
      <p class="hero-sub">${esc(insights.headline)}</p>
      <span class="hero-rule"></span>
      <div class="meta">
        <span><em>Período</em><strong>${esc(meta.periodLabel)}</strong></span>
        <span><em>Recorte</em><strong>${esc(meta.filtersLabel)}</strong></span>
        <span><em>Comparação</em><strong>${esc(
          meta.comparison.label.measured ? meta.comparison.label.value : 'sem base no período',
        )}</strong></span>
      </div>
    </div>`,
  });

  /* 02 — Roteiro */
  slides.push({
    nav: 'Roteiro',
    eyebrow: 'Roteiro da apresentação',
    html: `<div class="stack">
      <h2>O que esta leitura cobre</h2>
      <ol class="agenda">${agenda
        .map((item) => `<li><b>${esc(item.title)}</b><span>${esc(item.sub)}</span></li>`)
        .join('')}</ol>
    </div>`,
  });

  /* 03 — Síntese executiva */
  const headlineKpis = executive.kpis.filter(
    (k) => k.group === 'custo' || k.group === 'volume' || k.group === 'eficiencia',
  );
  const kpiCell = (k: (typeof headlineKpis)[number]) => {
    const isMeasured = k.display ? k.display.measured : k.value.measured;
    const d = k.delta.measured ? k.delta.value : null;
    const accent = !isMeasured
      ? P.unmeasured
      : k.tone === 'danger'
        ? P.negative
        : k.tone === 'warning'
          ? P.attention
          : k.tone === 'success'
            ? P.positive
            : P.accent;
    return cell({
      label: k.label,
      value: measuredText(k.value, k.format, k.display),
      accent,
      measured: isMeasured,
      helper: d
        ? `${d.pct > 0 ? '+' : ''}${d.pct.toFixed(1).replace('.', ',')}% ${d.label}`
        : isMeasured
          ? k.helper
          : 'não apurado no período',
    });
  };
  const kpiCells = headlineKpis.slice(0, 4).map(kpiCell);

  slides.push({
    nav: 'Síntese',
    eyebrow: 'Síntese executiva',
    html: `<div class="stack">
      <h2>${esc(insights.verdict)}</h2>
      <div class="split">
        <div>
          <p class="copy">${esc(insights.headline)}</p>
          ${band(kpiCells.join(''), Math.max(1, kpiCells.length))}
        </div>
        <div class="dial-wrap">
          ${wfGauge(executive.risk.score.measured ? executive.risk.score.value : null, {
            palette: P,
            width: 300,
            height: 190,
            animate: true,
            valueText: executive.risk.score.measured
              ? `${executive.risk.score.value}/100`
              : undefined,
            // Escala documentada como "higher = healthier": 100 é o melhor.
            bands: [
              [0, 40, P.negative],
              [40, 70, P.attention],
              [70, 100, P.positive],
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
    </div>`,
  });

  /* 04 — Painel completo de indicadores
   *
   * A síntese cabe em quatro células — é o que a faixa executiva comporta sem
   * apertar numa projeção. Os demais indicadores ganham o próprio slide, em
   * faixas de quatro, para que a leitura de cada linha continue horizontal. */
  const restKpis = [
    ...headlineKpis.slice(4),
    ...executive.kpis.filter((k) => k.group === 'conformidade'),
  ];
  if (restKpis.length > 0) {
    const rows: string[] = [];
    for (let i = 0; i < restKpis.length; i += 4) {
      rows.push(band(restKpis.slice(i, i + 4).map(kpiCell).join(''), 4));
    }
    slides.push({
      nav: 'Indicadores',
      eyebrow: 'Indicadores do período',
      html: `<div class="stack">
        <h2>Todos os indicadores apurados no recorte</h2>
        <p class="sub">${esc(
          `${meta.periodLabel} · ${meta.filtersLabel}. ` +
            (meta.comparison.label.measured
              ? `A variação de cada indicador compara ${meta.comparison.label.value}.`
              : 'O período não tem janela anterior na série apurada, então as variações não são calculáveis.'),
        )}</p>
        <div class="kpi-stack">${rows.join('')}</div>
      </div>`,
    });
  }

  /* 05 — Sinais */
  if (insights.cards.length > 0) {
    slides.push({
      nav: 'Sinais',
      eyebrow: 'Sinais do período',
      html: `<div class="stack">
        <h2>O que pede decisão nesta competência</h2>
        <p class="sub">Ordenados por severidade: alerta antes de observação, observação antes de sinal.</p>
        ${band(
          insights.cards
            .slice(0, 4)
            .map(insightCell)
            .join(''),
          Math.max(1, Math.min(4, insights.cards.length)),
        )}
      </div>`,
    });
  }

  /* 05 — Eficiência */
  if (efficiency.series.length > 0) {
    slides.push({
      nav: 'Eficiência',
      eyebrow: 'Eficiência & produtividade',
      html: `<div class="stack">
        <h2>Quanto cada pessoa produz e quanto a folha consome</h2>
        <p class="sub">${esc(
          sentence(
            [
              part(efficiency.revenuePerEmployee, (v) => `Receita por colaborador em ${wfCurrency(v)}`),
              part(efficiency.costPerEmployee, (v) => `custo por colaborador em ${wfCurrency(v)}`),
              part(
                efficiency.payrollAsRevenuePct,
                (v) => `${wfPct(v)} da receita comprometida com a folha`,
              ),
            ],
            'A produtividade por colaborador precisa da receita do contas a receber nas competências do período.',
          ) + ` Limite de política: ${efficiency.threshold}% da receita.`,
        )}</p>
        ${panel(
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
            {
              palette: P,
              width: CHART_W,
              height: CHART_H,
              animate: true,
              caption: 'Receita e custo por colaborador',
              emptyTitle: 'Receita não lançada',
              emptyReason:
                'A produtividade por colaborador precisa da receita do contas a receber nas competências do período.',
            },
          ),
          [
            { label: 'Receita por colaborador', color: P.success },
            { label: 'Custo por colaborador', color: P.info, shape: 'line' },
          ],
        )}
      </div>`,
    });
  }

  /* 06 — Dinâmica */
  if (dynamics.movement.length > 0 || dynamics.turnover.length > 0) {
    const net = dynamics.movement.reduce((sum, d) => sum + d.net, 0);
    slides.push({
      nav: 'Quadro',
      eyebrow: 'Dinâmica do quadro',
      html: `<div class="stack">
        <h2>Movimentação declarada e rotatividade</h2>
        <p class="sub">${esc(
          `Saldo de ${net > 0 ? '+' : ''}${wfInt(net)} colaborador(es) no período. ` +
            sentence(
              [
                part(dynamics.latestTurnoverPct, (v) => `turnover da competência em ${wfPct(v, 2)}`),
                part(dynamics.latestOvertimePct, (v) => `horas extras em ${wfPct(v)} da massa`),
              ],
              'Turnover e horas extras dependem de eventos do eSocial que esta competência não trouxe.',
            ),
        )}</p>
        ${panel(
          wfGroupedBars(
            dynamics.movement.map((d) => d.period),
            [
              {
                name: 'Admissões',
                values: dynamics.movement.map((d) => d.admissions),
                color: P.success,
              },
              {
                name: 'Desligamentos',
                values: dynamics.movement.map((d) => d.dismissals),
                color: P.danger,
              },
            ],
            {
              palette: P,
              width: CHART_W,
              height: CHART_H,
              animate: true,
              fmt: (v) => wfInt(v),
              caption: 'Admissões × Desligamentos (S-2200 / S-2299)',
              emptyTitle: 'Movimentação não apurada',
              emptyReason:
                'Admissões e desligamentos vêm dos eventos do eSocial; nenhuma competência do período os trouxe.',
            },
          ),
          [
            { label: 'Admissões', color: P.success },
            { label: 'Desligamentos', color: P.danger },
          ],
        )}
      </div>`,
    });
  }

  /* 07 — Estrutura de custo */
  if (costStructure.composition.length > 0 || costStructure.scurve.length > 0) {
    slides.push({
      nav: 'Custo',
      eyebrow: 'Estrutura de custo',
      html: `<div class="stack">
        <h2>De que a folha é feita</h2>
        <p class="sub">${esc(
          `${wfCurrency(costStructure.totalPayrollAccum)} acumulados no período. ` +
            sentence(
              [
                part(costStructure.directPct, (v) => `${wfPct(v)} em salário direto`),
                part(costStructure.benefitsTotal, (v) => `${wfCompactCurrency(v)} em benefícios`),
                part(costStructure.chargesTotal, (v) => `${wfCompactCurrency(v)} em encargos`),
              ],
              'A abertura por natureza depende das rubricas classificadas no S-1010, que esta competência não trouxe.',
            ),
        )}</p>
        <div class="cols-2">
          ${panel(
            wfStackedBars(
              costStructure.composition.map((d) => d.period),
              [
                {
                  name: 'Salário',
                  values: costStructure.composition.map((d) => d.salary),
                  color: P.accent,
                },
                {
                  name: 'Benefícios',
                  values: costStructure.composition.map((d) => d.benefits),
                  color: P.success,
                },
                {
                  name: 'Encargos',
                  values: costStructure.composition.map((d) => d.charges),
                  color: P.warning,
                },
              ],
              {
                palette: P,
                width: CHART_W_HALF,
                height: CHART_H_HALF,
                animate: true,
                caption: 'Composição da folha',
                emptyTitle: 'Rubricas não classificadas',
                emptyReason:
                  'Separar salário, benefícios e encargos depende da tabela de rubricas do eSocial (S-1010).',
              },
            ),
            [
              { label: 'Salário', color: P.accent },
              { label: 'Benefícios', color: P.success },
              { label: 'Encargos', color: P.warning },
            ],
          )}
          ${panel(
            wfSCurve(
              costStructure.scurve.map((d) => d.period),
              costStructure.scurve.map((d) => d.cumulative),
              costStructure.scurve.map((d) => d.cumulativePrev ?? 0),
              {
                palette: P,
                width: CHART_W_HALF,
                height: CHART_H_HALF,
                animate: true,
                caption: 'Curva S acumulada',
              },
            ),
            [
              { label: 'Período atual', color: P.accent, shape: 'line' },
              { label: 'Período anterior', color: P.info, shape: 'dash' },
            ],
          )}
        </div>
      </div>`,
    });

    /* 08 — Benefícios */
    const slices = benefitSlices(model);
    if (slices.length > 0) {
      slides.push({
        nav: 'Benefícios',
        eyebrow: 'Estrutura de custo',
        html: `<div class="stack">
          <h2>Onde os benefícios se concentram</h2>
          <p class="sub">A abertura por natureza vem das rubricas de benefício declaradas no S-1010.</p>
          ${panel(
            wfDonut(slices, {
              palette: P,
              width: 900,
              height: 400,
              centerLabel: 'Benefícios',
              centerValue: costStructure.benefitsTotal.measured
                ? wfCompactCurrency(costStructure.benefitsTotal.value)
                : UNMEASURED_DASH,
              emptyTitle: 'Benefícios não classificados',
              emptyReason:
                'A abertura por natureza exige rubricas de benefício declaradas no S-1010.',
            }),
          )}
        </div>`,
      });
    }
  }

  /* 09 — Concentração */
  if (concentration.data.costCenters.length > 0) {
    const sorted = [...concentration.data.costCenters].sort(
      (a, b) => b.payrollValue - a.payrollValue,
    );
    slides.push({
      nav: 'Concentração',
      eyebrow: 'Risco & concentração',
      html: `<div class="stack">
        <h2>Dependência dos maiores centros de custo</h2>
        <p class="sub">${esc(
          `Total de ${wfCurrency(concentration.data.totalPayroll)} rateados no período. ` +
            sentence(
              [
                part(
                  concentration.top3,
                  (v) => `os três maiores centros respondem por ${wfPct(v)} da folha`,
                ),
                concentration.abnormal.length > 0
                  ? `${wfInt(concentration.abnormal.length)} centro(s) apresentam variação atípica`
                  : null,
              ],
              'Nenhum centro de custo apresentou variação fora do padrão no recorte.',
            ),
        )}</p>
        ${panel(
          wfParetoChart(
            sorted.map((c) => ({
              label: c.name,
              value: c.payrollValue,
              highlight: c.isAbnormal,
            })),
            { palette: P, width: CHART_W, height: CHART_H, animate: true },
          ),
          [
            { label: 'Folha do centro', color: P.accent },
            { label: 'Variação atípica', color: P.danger },
            { label: 'Acumulado (eixo direito)', color: P.warning, shape: 'line' },
          ],
        )}
      </div>`,
    });
  }

  /* 10 — Conformidade */
  slides.push({
    nav: 'Conformidade',
    eyebrow: 'Conformidade',
    html: `<div class="stack">
      <h2>Ciclo folha → eSocial → guias</h2>
      <p class="sub">Situação das obrigações de ${esc(compliance.currentCompetenceLabel)}.</p>
      <div class="split">
        <div class="table-wrap"><table class="deck-table">
          <thead><tr><th>Obrigação</th><th>Vencimento</th><th>Situação</th></tr></thead>
          <tbody>${compliance.snapshot.obligations
            .slice(0, 9)
            .map(
              (o) =>
                `<tr><td>${esc(o.code)} · ${esc(o.label)}</td><td>${esc(wfDueDate(o.dueDate))}</td>` +
                `<td>${esc(OBLIGATION_STATUS_META[o.status].label)}</td></tr>`,
            )
            .join('')}</tbody>
        </table></div>
        <div class="dial-wrap">
          ${wfGauge(compliance.snapshot.score, {
            palette: P,
            width: 300,
            height: 190,
            animate: true,
            valueText: `${compliance.snapshot.score}/100`,
            bands: [
              [0, 60, P.negative],
              [60, 85, P.attention],
              [85, 100, P.positive],
            ],
          })}
          <p class="dial-label">Conformidade da competência</p>
          <p class="dial-note">${esc(
            compliance.snapshot.nextDue
              ? `Próxima obrigação: ${compliance.snapshot.nextDue.label}, vencimento em ${wfDueDate(compliance.snapshot.nextDue.dueDate)}.`
              : 'Nenhuma obrigação pendente na competência.',
          )}</p>
        </div>
      </div>
    </div>`,
  });

  /* 11 — Procedência & método */
  slides.push({
    nav: 'Método',
    eyebrow: 'Procedência & método',
    html: `<div class="stack">
      <h2>De onde vem cada número</h2>
      <p class="sub">E o que esta apresentação deliberadamente NÃO afirma.</p>
      <div class="columns">
        <section style="--accent:${P.accent}">
          <h3>Fontes</h3>
          <ul>
            <li><b>Folha</b> — lotes de fechamento aprovados, com rateio por centro de custo.</li>
            <li><b>Quadro e movimentação</b> — eventos apurados do eSocial.</li>
            <li><b>Composição</b> — classificação de verbas pela tabela de rubricas (S-1010).</li>
            <li><b>Receita</b> — títulos do contas a receber, por competência.</li>
          </ul>
        </section>
        <section style="--accent:${P.info}">
          <h3>Recorte</h3>
          <ul>
            <li><b>Período</b> — ${esc(meta.periodLabel)}</li>
            <li><b>Unidades</b> — ${esc(meta.filtersLabel)}</li>
            <li><b>Competências</b> — ${esc(wfInt(meta.monthsInRange))} no recorte</li>
          </ul>
        </section>
        <section style="--accent:${P.attention}">
          <h3>O que não foi apurado</h3>
          ${
            insights.gaps.length > 0
              ? `<ul>${insights.gaps
                  .slice(0, 5)
                  .map((g) => `<li>${esc(g)}</li>`)
                  .join('')}</ul>`
              : `<ul><li>Todos os indicadores do escopo foram apurados.</li></ul>`
          }
        </section>
      </div>
      <div class="dq">
        <b>Regra do material</b>
        <ul><li>Onde a fonte não respondeu, o indicador aparece como “${UNMEASURED_DASH}” — nunca como zero, e nunca como valor estimado.</li></ul>
      </div>
    </div>`,
  });

  /* 12 — Fecho institucional (só a marca, centralizada, igual ao PDF) */
  slides.push({
    nav: 'Fecho',
    eyebrow: '',
    html: `<div class="closing">
      <span class="closing-logo" role="img" aria-label="${esc(branding.logoAlt)}"></span>
    </div>`,
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
  const backdrop = wfBackdrop(P);
  const heroLogoW = Math.min(360, 46 * branding.logoAspect);
  const footLogoW = Math.min(120, 13 * branding.logoAspect);
  const closingLogoW = Math.min(620, 104 * branding.logoAspect);
  return `
:root{
  --void:${P.void};--panel-top:${P.panelTop};--panel-bottom:${P.panelBottom};
  --line:${P.line};--line-soft:${P.lineSoft};
  --ink:${P.ink};--body:${P.body};--muted:${P.muted};--subtle:${P.subtle};
  --accent:${P.accent};--info:${P.info};--warning:${P.warning};--danger:${P.danger};
  --unmeasured:${P.unmeasured};
}
*{box-sizing:border-box}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:var(--void);color:var(--ink);
  font-family:${WF_FONT};font-synthesis:none;-webkit-font-smoothing:antialiased}
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
@keyframes wfEnter{from{opacity:0;transform:translate3d(var(--enter-x),14px,0)}to{opacity:1;transform:none}}
.slide.is-active .slide-head,
.slide.is-active .slide-foot,
.slide.is-active .hero>*,
.slide.is-active .stack>*,
.slide.is-active .closing>*{animation:wfEnter .62s cubic-bezier(.22,1,.36,1) both}
.slide.is-active .slide-head{animation-delay:.04s}
.slide.is-active .hero>*:nth-child(1),.slide.is-active .stack>*:nth-child(1),.slide.is-active .closing>*{animation-delay:.1s}
.slide.is-active .hero>*:nth-child(2),.slide.is-active .stack>*:nth-child(2){animation-delay:.17s}
.slide.is-active .hero>*:nth-child(3),.slide.is-active .stack>*:nth-child(3){animation-delay:.24s}
.slide.is-active .hero>*:nth-child(4),.slide.is-active .stack>*:nth-child(4){animation-delay:.31s}
/* A capa tem cinco peças (marca, título, leitura, fio, meta): sem este degrau
   a última chegaria junto com o cabeçalho, quebrando a cascata. */
.slide.is-active .hero>*:nth-child(5){animation-delay:.38s}
.slide.is-active .slide-foot{animation-delay:.44s}
.slide::before{content:"";position:absolute;inset:clamp(14px,1.5vw,22px);border:1px solid var(--line-soft);border-radius:26px;pointer-events:none}
.slide::after{content:"";position:absolute;left:clamp(14px,1.5vw,22px);top:clamp(14px,1.5vw,22px);width:96px;height:2px;
  background:linear-gradient(90deg,var(--accent),transparent);border-radius:2px}

.slide-head{display:flex;align-items:baseline;justify-content:space-between;gap:18px;position:relative;z-index:2}
.eyebrow{font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--accent)}
.slide-no{font-size:11px;letter-spacing:.16em;color:var(--subtle);font-variant-numeric:tabular-nums}
.slide-body{position:relative;z-index:2;min-height:0;display:flex;align-items:center}
.slide-body>*{width:100%}
.slide-foot{display:flex;justify-content:space-between;gap:20px;font-size:10.5px;color:var(--subtle);position:relative;z-index:2}
/* Reserva a faixa inferior direita para o HUD de navegação (posição fixa). */
.slide-foot span:last-child{padding-right:230px;text-align:right}
.foot-brand{display:inline-flex;align-items:center;gap:9px}
.foot-logo{${logoBackgroundCss(branding.logoSmallDataUri, {
    height: '13px',
    maxWidth: `${footLogoW}px`,
  })}display:inline-block;flex:0 0 auto;opacity:.9}

h1{font-size:clamp(44px,6.4vw,90px);line-height:.94;letter-spacing:-.05em;margin:0;max-width:16ch}
h2{font-size:clamp(28px,3.4vw,52px);line-height:1.06;letter-spacing:-.035em;margin:0;max-width:26ch}
h3{font-size:clamp(15px,1.3vw,20px);margin:0 0 12px;letter-spacing:.01em;color:var(--ink)}
.sub{font-size:clamp(13px,1.15vw,17px);line-height:1.5;color:var(--muted);margin:10px 0 0;max-width:78ch}
.copy{font-size:clamp(15px,1.3vw,21px);line-height:1.55;color:var(--body);margin:0 0 26px;max-width:52ch}
.stack{display:flex;flex-direction:column;gap:clamp(12px,1.4vw,20px)}

/* Capa — bloco único, centrado nos dois eixos (o mesmo desenho do PDF) */
.hero{display:flex;flex-direction:column;align-items:center;text-align:center}
.hero-logo{${logoBackgroundCss(branding.logoDataUri, {
    height: 'clamp(34px,3.6vw,52px)',
    maxWidth: `clamp(${Math.round(heroLogoW * 0.65)}px,26vw,${Math.round(heroLogoW * 1.13)}px)`,
    align: 'center',
  })}margin-bottom:clamp(22px,2.8vw,38px)}
.hero h1{max-width:19ch}
.hero-sub{font-size:clamp(14px,1.2vw,19px);line-height:1.55;color:var(--body);margin:clamp(16px,1.8vw,26px) 0 0;max-width:62ch}
/* Fio de acento esmaecido nas pontas — a mesma assinatura do traço do slide. */
.hero-rule{display:block;width:96px;height:2px;border-radius:2px;margin:clamp(22px,2.6vw,34px) 0 clamp(18px,2.2vw,28px);
  background:linear-gradient(90deg,transparent,var(--accent),transparent)}
.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:10px 40px;width:100%;max-width:860px}
.meta span{display:flex;flex-direction:column;align-items:center;gap:4px}
.meta em{font-style:normal;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--subtle)}
.meta strong{font-size:15px;font-weight:600;color:var(--ink)}

/* Roteiro */
.agenda{list-style:none;counter-reset:ag;margin:8px 0 0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:12px 40px}
.agenda li{counter-increment:ag;display:grid;grid-template-columns:auto 1fr;gap:14px;align-items:baseline;
  padding:12px 0;border-top:1px solid var(--line-soft)}
.agenda li::before{content:counter(ag,decimal-leading-zero);font-size:12px;font-variant-numeric:tabular-nums;
  color:var(--accent);letter-spacing:.08em}
.agenda b{font-size:clamp(15px,1.3vw,19px);font-weight:650;grid-column:2}
.agenda span{grid-column:2;font-size:12.5px;color:var(--subtle);margin-top:2px}

/* Síntese */
.split{display:grid;grid-template-columns:1.35fr .65fr;gap:clamp(22px,3vw,54px);align-items:center}

/* Faixa executiva (padrão HudKpiStrip / Executive Band) */
.band{position:relative;overflow:hidden;border-radius:20px;padding:5px;
  border:1px solid color-mix(in srgb,var(--accent) 18%,transparent);
  background:linear-gradient(180deg,var(--panel-top) 0%,var(--panel-bottom) 100%);
  box-shadow:0 22px 60px rgba(0,0,0,.38),inset 0 0 0 1px color-mix(in srgb,var(--accent) 6%,transparent)}
/* Trilhos de borda — a assinatura contida da Executive Band. */
.band::before,.band::after{content:"";position:absolute;top:12px;bottom:12px;width:1px}
.band::before{left:11px;background:var(--accent)}
.band::after{right:11px;background:var(--line)}
.band-grid{position:relative;display:grid;grid-template-columns:repeat(var(--cols,4),1fr);gap:5px}
.cell{position:relative;overflow:hidden;padding:13px 15px 14px;border-radius:15px;border:1px solid var(--line-soft);
  background:linear-gradient(160deg,rgba(13,26,36,.88),rgba(7,18,26,.42));
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
.cell-tag{margin-left:auto;flex:0 0 auto;padding:2px 7px;border:1px solid var(--accent);border-radius:999px;
  font-size:8.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--accent)}
.cell-v{display:block;margin-top:7px;font-size:clamp(19px,2vw,30px);font-weight:700;letter-spacing:-.035em;
  color:var(--accent);font-variant-numeric:tabular-nums}
/* Um traço pintado com a cor de acento lê como número: o não apurado é neutro. */
.cell-v[data-unmeasured]{color:var(--unmeasured);font-weight:400}
.cell-h{display:block;margin-top:5px;font-size:10.5px;color:var(--subtle)}
.cell-d{margin:6px 0 0;font-size:11.5px;line-height:1.45;color:var(--subtle)}

/* Faixas de indicador empilhadas, centradas no corpo do slide. */
.kpi-stack{display:flex;flex-direction:column;gap:12px}

.dial-wrap{display:flex;flex-direction:column;align-items:center;gap:4px}
.dial-wrap svg{width:100%;max-width:300px;height:auto;display:block}
.dial-label{margin:0;font-size:10.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);text-align:center}
.dial-note{font-size:11px;color:var(--subtle);text-align:center;margin:4px 0 0;max-width:34ch;line-height:1.45}

/* Painéis de gráfico */
.panel{border:1px solid var(--line-soft);border-radius:20px;padding:16px 20px 14px;
  background:linear-gradient(160deg,rgba(13,26,36,.72),rgba(7,18,26,.42));
  box-shadow:0 26px 70px rgba(0,0,0,.42),inset 0 1px 0 rgba(255,255,255,.05)}
/* O SVG escala pela largura: altura fixa letterboxaria a viewBox e abriria uma
   faixa morta dentro do painel. */
.panel svg{display:block;width:100%;height:auto;max-height:min(52vh,430px)}
.panel-cap{margin:8px 0 0;font-size:11px;color:var(--subtle)}
.cols-2{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start}
.cols-2 .panel svg{max-height:min(38vh,330px)}

/* Tabela */
.table-wrap{overflow:auto;border:1px solid var(--line-soft);border-radius:18px;
  background:linear-gradient(160deg,rgba(13,26,36,.72),rgba(7,18,26,.42));max-height:min(54vh,480px)}
.deck-table{width:100%;border-collapse:collapse;font-size:clamp(11px,1vw,13.5px);font-variant-numeric:tabular-nums}
.deck-table th,.deck-table td{padding:9px 14px;text-align:left;white-space:nowrap}
.deck-table thead th{position:sticky;top:0;background:rgba(7,18,26,.96);font-size:9.5px;font-weight:700;
  letter-spacing:.1em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--line)}
.deck-table tbody td{border-bottom:1px solid var(--line-soft);color:var(--body)}
.deck-table tbody tr:nth-child(even) td{background:rgba(255,255,255,.016)}

/* Método */
.columns{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(18px,2.4vw,40px)}
.columns section{border-top:2px solid var(--accent);padding-top:16px}
.columns h3{color:var(--accent);font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}
.columns ul{margin:0;padding-left:18px;color:var(--body);font-size:clamp(12px,1.05vw,15px);line-height:1.5}
.columns li+li{margin-top:9px}
.columns b{color:var(--ink)}
.dq{margin-top:4px;border:1px solid color-mix(in srgb,var(--warning) 34%,transparent);border-radius:14px;
  padding:12px 16px;background:color-mix(in srgb,var(--warning) 8%,transparent)}
.dq b{font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--warning)}
.dq ul{margin:6px 0 0;padding-left:18px;font-size:12.5px;color:var(--body)}

/* Fecho institucional — apenas a marca centralizada */
.closing{display:flex;justify-content:center;align-items:center}
.closing-logo{${logoBackgroundCss(branding.logoDataUri, {
    height: 'clamp(52px,7vw,104px)',
    maxWidth: `min(52vw,${Math.round(closingLogoW)}px)`,
    align: 'center',
  })}}

${wfLegendCss(P)}
${WF_CHART_ANIM_CSS}

/* Controles */
.rail{position:fixed;left:0;right:0;bottom:0;height:2px;background:rgba(255,255,255,.06);z-index:12}
.rail-fill{height:100%;width:0;background:linear-gradient(90deg,var(--accent),var(--info));transition:width .5s cubic-bezier(.22,1,.36,1)}
.hud{position:fixed;right:22px;bottom:20px;z-index:14;display:flex;align-items:center;gap:6px;padding:6px;
  border:1px solid var(--line);border-radius:14px;background:rgba(7,16,22,.9);backdrop-filter:blur(10px)}
.hud button{width:38px;height:38px;border:1px solid transparent;border-radius:10px;background:transparent;color:var(--body);
  font-size:16px;cursor:pointer;font-family:inherit;transition:.16s;display:inline-flex;align-items:center;justify-content:center}
.hud button:hover{border-color:var(--line);color:var(--accent);background:color-mix(in srgb,var(--accent) 8%,transparent)}
.hud .count{min-width:56px;text-align:center;font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.dots{position:fixed;left:22px;bottom:22px;z-index:14;display:flex;gap:6px}
.dots i{width:22px;height:3px;border-radius:2px;background:rgba(255,255,255,.14);transition:.25s;cursor:pointer}
.dots i.on{background:var(--accent);box-shadow:0 0 10px color-mix(in srgb,var(--accent) 50%,transparent)}

.index{position:fixed;inset:0;z-index:20;display:none;padding:clamp(28px,5vw,70px);overflow:auto;
  background:rgba(5,11,18,.96);backdrop-filter:blur(14px)}
.index.on{display:block}
.index h4{margin:0 0 22px;font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--accent)}
.idx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px}
.idx-item{text-align:left;padding:16px;border:1px solid var(--line-soft);border-radius:14px;cursor:pointer;
  background:linear-gradient(160deg,rgba(13,26,36,.8),rgba(7,18,26,.4));color:var(--ink);
  font-family:inherit;display:flex;flex-direction:column;gap:4px;transition:.16s}
.idx-item:hover{border-color:var(--accent);transform:translateY(-2px)}
.idx-n{font-size:10px;letter-spacing:.14em;color:var(--accent);font-variant-numeric:tabular-nums}
.idx-t{font-size:15px;font-weight:650}
.idx-s{font-size:10.5px;color:var(--subtle)}

@media (max-width:900px){
  /* Espaço inferior extra: o rodapé precisa ficar acima do HUD fixo. */
  .slide{padding:24px 22px 104px;gap:14px}
  h1{font-size:clamp(32px,9vw,50px)}
  h2{font-size:clamp(22px,6vw,32px)}
  .split,.columns,.agenda,.cols-2{grid-template-columns:1fr;gap:16px}
  .band-grid,.meta{grid-template-columns:1fr 1fr}
  .meta{gap:14px 24px}
  .panel svg{max-height:40vh}
  .dots{display:none}
  .slide-foot{font-size:9px}
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
  .panel svg{max-height:min(38vh,260px)}
  .cols-2 .panel svg{max-height:min(30vh,210px)}
  .table-wrap{max-height:42vh}
  .cell-v{font-size:17px}
  .cell-l{min-height:0}
  .cell-d{font-size:10.5px}
  .dial-wrap svg{max-width:150px}
  /* Duas colunas voltam: numa janela baixa a altura é o recurso escasso, não a largura. */
  .agenda{grid-template-columns:1fr 1fr;gap:0 20px}
  .agenda li{padding:6px 0}
  .agenda b{font-size:13.5px}
  .agenda span{font-size:10.5px}
  .split{grid-template-columns:1.35fr .65fr;gap:18px}
  .meta{gap:8px 24px}
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
`;
}

export function buildWorkforceOverviewPresentationHtml(model: WorkforceOverviewModel): string {
  const slides = buildSlides(model);
  const total = slides.length;
  const documentTitle = `${REPORT_NAME} — ${model.meta.periodLabel}`;
  const branding = model.meta.branding;

  const slidesHtml = slides
    .map(
      (slide, index) => `
  <section class="slide" aria-label="${esc(`${index + 1} de ${total} — ${slide.nav}`)}">
    <header class="slide-head">
      <span class="eyebrow">${esc(slide.eyebrow)}</span>
      <span class="slide-no">${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span>
    </header>
    <div class="slide-body">${slide.html}</div>
    <footer class="slide-foot">
      <span class="foot-brand">
        <span class="foot-logo" role="img" aria-label="${esc(branding.logoAlt)}"></span>
        ${esc(WF_SOURCE)}
      </span>
      <span>${esc(REPORT_NAME_SHORT)} · ${esc(model.meta.periodLabel)}</span>
    </footer>
  </section>`,
    )
    .join('');

  const indexHtml = slides
    .map(
      (slide, index) => `
    <button type="button" class="idx-item" data-goto="${index}">
      <span class="idx-n">${String(index + 1).padStart(2, '0')}</span>
      <span class="idx-t">${esc(slide.nav)}</span>
      <span class="idx-s">${esc(slide.eyebrow)}</span>
    </button>`,
    )
    .join('');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>${esc(documentTitle)}</title>
<style>
${buildGilroyFontFaceCss()}
${deckCss(branding)}
</style>
</head>
<body>
<main class="deck" id="deck">${slidesHtml}</main>

<div class="dots" id="dots">${slides.map((_, i) => `<i data-goto="${i}"></i>`).join('')}</div>
<div class="hud">
  <button type="button" id="idx" title="Índice (I)" aria-label="Abrir índice">☰</button>
  <button type="button" id="prev" title="Anterior (←)" aria-label="Slide anterior">←</button>
  <span class="count" id="counter">01 / ${String(total).padStart(2, '0')}</span>
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
  var count = document.getElementById('counter');
  var rail = document.getElementById('rail');
  var overlay = document.getElementById('overlay');
  var dots = Array.prototype.slice.call(document.querySelectorAll('#dots i'));
  var sections = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  var index = 0, startX = 0, startY = 0;

  function pad(n){ return n < 10 ? '0' + n : '' + n; }

  // As marcas dos gráficos reanimam a cada chegada: o slide se desenha na frente
  // de quem assiste, em vez de já estar pronto desde o carregamento.
  function replayCharts(slide){
    var marks = slide.querySelectorAll('.wf-rise, .wf-draw');
    for (var i = 0; i < marks.length; i++) {
      marks[i].style.animation = 'none';
      void marks[i].getBoundingClientRect();
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
