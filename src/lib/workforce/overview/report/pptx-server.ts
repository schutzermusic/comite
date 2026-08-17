/**
 * PowerPoint de Pessoas & Custos — geração no servidor.
 *
 * ─── Mesma anatomia da Projeção Financeira ─────────────────────────────────
 *
 * A grade, a moldura, a faixa executiva com trilhos, a faixa de leitura no pé
 * e o fecho só com a marca são a transcrição do deck de `investor-pack/
 * pptx-server.ts`. Tudo aqui é posicionado na MESMA grade de 1280×720 px do
 * Apex e convertido para polegadas na borda (`inch`) e para pontos na
 * tipografia (`pt`) — assim uma medida copiada de lá cai exatamente no mesmo
 * lugar aqui, sem recalcular nada à mão.
 *
 * ─── Por que `pptxgenjs` e não o gerador da Projeção Financeira ────────────
 *
 * A Projeção Financeira monta o deck com `@oai/artifact-tool`, um runtime que
 * NÃO está instalado neste projeto (`node_modules/@oai` não existe) e depende
 * de um caminho de cache local. Um botão que só funciona na máquina de quem
 * escreveu não é uma funcionalidade. `pptxgenjs` é dependência declarada,
 * resolve na Vercel e produz o arquivo de fato.
 *
 * A consequência é que o MOTOR difere, mas o DESENHO não: é por isso que a
 * grade acima é copiada em px em vez de reinventada em polegadas.
 *
 * ─── Server-only ──────────────────────────────────────────────────────────
 *
 * Importar isto no cliente arrastaria ~1 MB de gerador OOXML para o bundle da
 * página. A guarda no topo transforma esse engano em erro imediato.
 *
 * ─── Vetor no 365, PNG de verdade em todo o resto ─────────────────────────
 *
 * O OOXML embute imagem vetorial como um PAR: `<a:blip>` aponta para um PNG de
 * fallback e a extensão `asvg:svgBlip` aponta para o SVG. O `pptxgenjs` monta
 * essa estrutura corretamente, mas grava os MESMOS bytes SVG dentro do arquivo
 * `.png` — ele não rasteriza fora do navegador. O resultado é um fallback
 * inválido: PowerPoint 365 renderiza (usa o SVG), enquanto Google Slides,
 * Keynote e versões antigas mostram imagem quebrada.
 *
 * `rasterizeSvgFallbacks()` conserta exatamente esse ponto: depois de montar os
 * slides e antes de escrever o arquivo, cada entrada marcada `isSvgPng` tem os
 * bytes trocados por um PNG real, rasterizado com `sharp`.
 *
 * O patch mexe em campos internos do `pptxgenjs` (`pres.slides`,
 * `slide._relsMedia`). Por isso ele é totalmente defensivo: qualquer mudança de
 * formato numa atualização faz a função não encontrar nada para corrigir e o
 * documento sai como saía antes — nunca quebra a geração.
 */

import {
  isEmptyChart,
  wfDonut,
  wfGauge,
  wfGroupedBars,
  wfLineChart,
  wfParetoChart,
  wfSCurve,
  wfStackedBars,
  type WfLegendItem,
} from './charts';
import { buildWorkforceInsights, type WorkforceInsightCard } from './insights';
import { OBLIGATION_STATUS_META } from '@/lib/workforce/compliance';
import { measuredText } from './format';
import { fitLogoBox } from '@/lib/reports/report-branding';
import {
  REPORT_NAME,
  REPORT_NAME_SHORT,
  UNMEASURED_DASH,
  WF_DARK,
  WF_SOURCE,
  wfAgenda,
  wfCompactCurrency,
  wfCurrency,
  wfDueDate,
  wfInt,
  wfPct,
  type WorkforcePalette,
} from './theme';
import type { Measured, WorkforceOverviewModel } from '../types';

if (typeof window !== 'undefined') {
  throw new Error(
    'pptx-server é server-only: importá-lo no cliente traria o gerador OOXML para o bundle.',
  );
}

const P: WorkforcePalette = WF_DARK;

/* ═══════════════════════════════════════════════════════════════════════════
   Grade do slide — 1280×720 px, exatamente como o Apex
   ═══════════════════════════════════════════════════════════════════════════ */

const W_PX = 1280;
const H_PX = 720;
/** Margem lateral. */
const M = 64;
const CONTENT_W = W_PX - M * 2;
/** Sobrelinha. */
const HEAD_Y = 44;
/** Título da seção. */
const TITLE_Y = 84;
/** Rodapé. */
const FOOT_Y = 664;
/** Base do corpo em slides de conteúdo (abaixo do título + sublinha). */
const BODY_Y = 172;

/** px da grade → polegada (a unidade do pptxgenjs). */
const inch = (px: number) => px / 96;
/** px da grade → ponto tipográfico (1280px = 13,333in = 960pt). */
const pt = (px: number) => px * 0.75;

const W = inch(W_PX);
const H = inch(H_PX);

/** pptxgenjs quer hex sem `#`. */
const hex = (color: string) => color.replace('#', '').toUpperCase();

const FONT = 'Gilroy';

/** Caixa em px da grade. */
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Converte a caixa da grade para o formato do pptxgenjs. */
const box = (b: Box) => ({
  x: inch(b.left),
  y: inch(b.top),
  w: inch(b.width),
  h: inch(b.height),
});

function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf-8').toString('base64')}`;
}

// O pptxgenjs não publica tipos utilizáveis para slide/apresentação; `any`
// aqui é fronteira com biblioteca não tipada, não desleixo.
type AnySlide = any;
type AnyPres = any;

/* ─── Primitivas ─────────────────────────────────────────────────────────── */

/**
 * Texto sem recuo interno.
 *
 * `margin: 0` é obrigatório: o pptxgenjs aplica ~0,05in de inset por padrão, e
 * com ele toda coordenada copiada da grade do Apex chegaria deslocada.
 */
type RichText = string | { text: string; options?: Record<string, unknown> }[];

function addText(
  slide: AnySlide,
  content: RichText,
  b: Box,
  style: Record<string, unknown> = {},
): void {
  slide.addText(content, {
    ...box(b),
    fontFace: FONT,
    fontSize: pt(18),
    color: hex(P.ink),
    margin: 0,
    valign: 'top',
    ...style,
  });
}

function addRect(
  slide: AnySlide,
  b: Box,
  fill: string | null,
  opts?: { radius?: boolean; stroke?: string; strokeWidth?: number },
): void {
  slide.addShape(opts?.radius ? 'roundRect' : 'rect', {
    ...box(b),
    ...(opts?.radius ? { rectRadius: 0.06 } : {}),
    fill: fill ? { color: hex(fill) } : { type: 'none' },
    line: opts?.stroke
      ? { color: hex(opts.stroke), width: opts.strokeWidth ?? 1 }
      : { type: 'none' },
  });
}

function addDot(slide: AnySlide, left: number, top: number, size: number, color: string): void {
  slide.addShape('ellipse', {
    ...box({ left, top, width: size, height: size }),
    fill: { color: hex(color) },
    line: { type: 'none' },
  });
}

/**
 * Superfície de vidro dos painéis.
 *
 * O gradiente do CSS não tem equivalente confiável no pptxgenjs, então o painel
 * sai no tom de topo — entre `panelTop` e `panelBottom` a diferença é de dois
 * pontos de luminosidade, imperceptível numa projeção.
 */
function addGlass(slide: AnySlide, b: Box, stroke = P.lineSoft): void {
  addRect(slide, b, P.panelTop, { radius: true, stroke, strokeWidth: 1 });
}

/** SVG do motor de gráficos embutido como imagem vetorial do slide. */
function addSvg(slide: AnySlide, svg: string, b: Box, alt: string): void {
  slide.addImage({ data: svgToDataUri(svg), ...box(b), altText: alt });
}

function addLogo(
  slide: AnySlide,
  model: WorkforceOverviewModel,
  opts: { left: number; top: number; height: number; maxWidth: number; small?: boolean },
): { width: number; height: number } {
  const branding = model.meta.branding;
  // `fitLogoBox` calcula a maior caixa que cabe SEM distorcer — o PowerPoint
  // posiciona imagem por coordenada, então a proporção tem de vir pronta.
  const fit = fitLogoBox(branding, { maxWidth: opts.maxWidth, maxHeight: opts.height });
  slide.addImage({
    data: opts.small ? branding.logoSmallDataUri : branding.logoDataUri,
    ...box({ left: opts.left, top: opts.top, width: fit.width, height: fit.height }),
    altText: branding.logoAlt,
  });
  return fit;
}

/* ─── Faixa executiva (padrão HudKpiStrip / Executive Band) ──────────────── */

interface BandCell {
  label: string;
  value: string;
  accent: string;
  /** Linha de apoio sob o valor (faixa de KPI). */
  helper?: string;
  /** Parágrafo de leitura (cartões de sinal). */
  detail?: string;
  /** Etiqueta no canto do cartão ("Sinal", "Monitorar", "Atenção"). */
  tag?: string;
  /** Falso pinta o valor no tom neutro: um traço colorido lê como número. */
  measured?: boolean;
}

/**
 * Contêiner de vidro com trilhos nas bordas agrupando células de gap mínimo —
 * a mesma anatomia do PDF e do deck, e não cartões soltos.
 */
function addBand(slide: AnySlide, b: Box, cells: BandCell[], opts?: { valueSize?: number }): void {
  if (cells.length === 0) return;
  addGlass(slide, b, P.line);
  // Trilhos: acento à esquerda, linha neutra à direita.
  addRect(slide, { left: b.left + 9, top: b.top + 9, width: 1, height: b.height - 18 }, P.accent);
  addRect(
    slide,
    { left: b.left + b.width - 10, top: b.top + 9, width: 1, height: b.height - 18 },
    P.line,
  );

  const pad = 5;
  const gap = 5;
  const inner = b.width - pad * 2;
  const cellW = (inner - gap * (cells.length - 1)) / cells.length;
  const cellH = b.height - pad * 2;

  cells.forEach((c, index) => {
    const left = b.left + pad + index * (cellW + gap);
    const top = b.top + pad;
    addRect(slide, { left, top, width: cellW, height: cellH }, P.void, {
      radius: true,
      stroke: P.lineSoft,
      strokeWidth: 1,
    });
    // Fio de acento no topo da célula (o equivalente ao gradiente do CSS).
    addRect(slide, { left: left + cellW * 0.26, top, width: cellW * 0.48, height: 1 }, c.accent);

    addDot(slide, left + 14, top + 17, 5, c.accent);
    addText(
      slide,
      c.label.toUpperCase(),
      { left: left + 25, top: top + 11, width: cellW - 39 - (c.tag ? 82 : 0), height: 32 },
      { fontSize: pt(11), bold: true, color: hex(P.muted), charSpacing: 1 },
    );
    if (c.tag) {
      addRect(slide, { left: left + cellW - 92, top: top + 11, width: 78, height: 18 }, null, {
        radius: true,
        stroke: c.accent,
        strokeWidth: 1,
      });
      addText(
        slide,
        c.tag.toUpperCase(),
        { left: left + cellW - 92, top: top + 13, width: 78, height: 18 },
        { fontSize: pt(9), bold: true, color: hex(c.accent), align: 'center', charSpacing: 1 },
      );
    }
    const unmeasured = c.measured === false;
    addText(
      slide,
      c.value,
      { left: left + 14, top: top + 44, width: cellW - 28, height: 38 },
      {
        fontSize: opts?.valueSize ?? pt(26),
        bold: !unmeasured,
        color: hex(unmeasured ? P.unmeasured : c.accent),
      },
    );
    if (c.helper) {
      addText(
        slide,
        c.helper,
        { left: left + 14, top: top + 84, width: cellW - 28, height: 24 },
        { fontSize: pt(11.5), color: hex(P.subtle) },
      );
    }
    if (c.detail) {
      addText(
        slide,
        c.detail,
        { left: left + 14, top: top + 86, width: cellW - 28, height: cellH - 96 },
        { fontSize: pt(12), color: hex(P.subtle) },
      );
    }
  });
}

function insightBandCell(card: WorkforceInsightCard): BandCell {
  const accent = card.kind === 'alert' ? P.negative : card.kind === 'watch' ? P.attention : P.accent;
  const tag = card.kind === 'alert' ? 'Atenção' : card.kind === 'watch' ? 'Monitorar' : 'Sinal';
  return { label: card.title, value: card.value ?? UNMEASURED_DASH, accent, detail: card.detail, tag };
}

/**
 * Faixa de leitura do pé do slide — os mesmos pares rótulo/valor que fecham as
 * páginas de gráfico do PDF.
 */
function addReadStrip(
  slide: AnySlide,
  items: { label: string; value: string; color?: string }[],
  top: number,
): void {
  const usable = items.filter((i) => i.value.length > 0);
  if (usable.length === 0) return;
  addRect(slide, { left: M, top, width: CONTENT_W, height: 1 }, P.lineSoft);
  const colW = CONTENT_W / usable.length;
  usable.forEach((item, index) => {
    const left = M + index * colW;
    addText(
      slide,
      item.label.toUpperCase(),
      { left, top: top + 10, width: colW - 20, height: 20 },
      { fontSize: pt(11), bold: true, color: hex(P.subtle), charSpacing: 1 },
    );
    addText(
      slide,
      item.value,
      { left, top: top + 30, width: colW - 20, height: 28 },
      { fontSize: pt(18), bold: true, color: hex(item.color ?? P.ink) },
    );
  });
}

/* ─── Legenda (as mesmas marcas do PDF, em formas nativas) ───────────────── */

const LEGEND_ROW_H = 22;

/** Largura estimada de um item (marca + rótulo + respiro), em px de slide. */
function legendItemWidth(item: WfLegendItem): number {
  return 27 + item.label.length * 7.6 + 34;
}

/** Quantas linhas a legenda ocupa na largura disponível. */
function legendRows(items: WfLegendItem[], maxWidth: number): number {
  let rows = 1;
  let x = 0;
  items.forEach((item) => {
    const width = legendItemWidth(item);
    if (x > 0 && x + width > maxWidth) {
      rows += 1;
      x = 0;
    }
    x += width;
  });
  return rows;
}

function addLegend(
  slide: AnySlide,
  items: WfLegendItem[],
  left: number,
  top: number,
  maxWidth: number,
): void {
  let x = left;
  let y = top;
  items.forEach((item) => {
    const width = legendItemWidth(item);
    if (x > left && x + width > left + maxWidth) {
      x = left;
      y += LEGEND_ROW_H;
    }
    const shape = item.shape ?? 'solid';
    if (shape === 'line') {
      addRect(slide, { left: x, top: y + 8, width: 18, height: 3 }, item.color, { radius: true });
    } else if (shape === 'dash') {
      addRect(slide, { left: x, top: y + 8, width: 7, height: 3 }, item.color);
      addRect(slide, { left: x + 11, top: y + 8, width: 7, height: 3 }, item.color);
    } else if (shape === 'hollow') {
      addRect(slide, { left: x, top: y + 4, width: 18, height: 10 }, null, {
        radius: true,
        stroke: item.color,
        strokeWidth: 1.5,
      });
    } else {
      addRect(slide, { left: x, top: y + 4, width: 18, height: 10 }, item.color, { radius: true });
    }
    addText(
      slide,
      item.label,
      { left: x + 25, top: y, width: width - 25, height: 20 },
      { fontSize: pt(13), color: hex(P.muted) },
    );
    x += width;
  });
}

/**
 * Fator de desenho do gráfico dentro do quadro.
 *
 * Abaixo de 1 tudo — marcas, eixos, competências e valores — chega maior no
 * slide, que é lido a metros de distância e não a um palmo, como a folha
 * impressa. É o mesmo truque de `apex/pptx-server.ts`.
 */
const CHART_SCALE = 0.78;

/** Painel de gráfico: vidro + SVG + legenda + nota opcional. */
function addChartPanel(
  slide: AnySlide,
  svg: (size: { width: number; height: number }) => string,
  legend: WfLegendItem[],
  panel: Box,
  caption?: string,
): void {
  addGlass(slide, panel);
  const legendWidth = panel.width - 32;
  const legendHeight = legend.length ? legendRows(legend, legendWidth) * LEGEND_ROW_H : 0;
  const footer = legendHeight + 14 + (caption ? 24 : 0);
  const chart: Box = {
    left: panel.left + 14,
    top: panel.top + 12,
    width: panel.width - 28,
    height: panel.height - 12 - footer,
  };
  const rendered = svg({
    width: Math.round(chart.width * CHART_SCALE),
    height: Math.round(chart.height * CHART_SCALE),
  });
  addSvg(slide, rendered, chart, 'Gráfico do relatório');
  // Legenda de série num quadro de "não apurado" sugere série que não existe.
  if (legend.length && !isEmptyChart(rendered)) {
    addLegend(slide, legend, panel.left + 16, chart.top + chart.height + 6, legendWidth);
  }
  if (caption) {
    addText(
      slide,
      caption,
      { left: panel.left + 16, top: panel.top + panel.height - 28, width: panel.width - 32, height: 22 },
      { fontSize: pt(11.5), color: hex(P.subtle) },
    );
  }
}

/* ─── Chrome do slide ────────────────────────────────────────────────────── */

interface DeckContext {
  model: WorkforceOverviewModel;
  footer: string;
  /** Contadores "NN / TT": o total só é conhecido quando o deck termina. */
  counters: { slide: AnySlide; b: Box }[];
}

/** Base de todo slide: fundo, moldura, sobrelinha, fonte do dado e paginação. */
function baseSlide(
  pres: AnyPres,
  ctx: DeckContext,
  eyebrow: string,
  opts?: { counter?: boolean; notes?: string },
): AnySlide {
  const slide = pres.addSlide();
  slide.background = { color: hex(P.void) };

  // Moldura de cockpit + acento superior esquerdo.
  addRect(slide, { left: 22, top: 22, width: W_PX - 44, height: H_PX - 44 }, null, {
    radius: true,
    stroke: P.lineSoft,
    strokeWidth: 1,
  });
  addRect(slide, { left: 40, top: 40, width: 92, height: 2 }, P.accent);

  if (eyebrow) {
    addText(
      slide,
      eyebrow.toUpperCase(),
      { left: M, top: HEAD_Y, width: 760, height: 24 },
      { fontSize: pt(13), bold: true, color: hex(P.accent), charSpacing: 1.6 },
    );
  }
  if (opts?.counter !== false) {
    // O texto entra depois: o total só existe quando o deck termina.
    ctx.counters.push({ slide, b: { left: W_PX - M - 120, top: HEAD_Y, width: 120, height: 24 } });
  }

  // Rodapé: marca + fonte do dado à esquerda, identificação do material à direita.
  addRect(slide, { left: M, top: FOOT_Y - 10, width: CONTENT_W, height: 1 }, P.lineSoft);
  const logo = addLogo(slide, ctx.model, { left: M, top: FOOT_Y + 1, height: 13, maxWidth: 104, small: true });
  addText(
    slide,
    WF_SOURCE,
    { left: M + logo.width + 14, top: FOOT_Y, width: 520, height: 22 },
    { fontSize: pt(10.5), color: hex(P.subtle) },
  );
  addText(
    slide,
    ctx.footer,
    { left: W_PX - M - 560, top: FOOT_Y, width: 560, height: 22 },
    { fontSize: pt(10.5), color: hex(P.subtle), align: 'right' },
  );

  if (opts?.notes) slide.addNotes(`[Fonte]\n- ${WF_SOURCE}.\n\n[Leitura]\n- ${opts.notes}\n`);
  return slide;
}

function addSectionTitle(slide: AnySlide, title: string, sub?: string): void {
  addText(
    slide,
    title,
    { left: M, top: TITLE_Y, width: CONTENT_W, height: 52 },
    { fontSize: pt(34), bold: true, color: hex(P.ink) },
  );
  if (sub) {
    addText(
      slide,
      sub,
      { left: M, top: TITLE_Y + 50, width: CONTENT_W - 40, height: 40 },
      { fontSize: pt(15), color: hex(P.muted) },
    );
  }
}

/** Valor apurado, ou o traço. Nunca zero por descuido. */
function show(m: Measured<number>, fmt: (v: number) => string): string {
  return m.measured ? fmt(m.value) : UNMEASURED_DASH;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Deck
   ═══════════════════════════════════════════════════════════════════════════ */

export function buildWorkforceOverviewDeck(pres: AnyPres, model: WorkforceOverviewModel): void {
  const insights = buildWorkforceInsights(model);
  const { meta, executive, efficiency, dynamics, costStructure, concentration, compliance } = model;

  const agenda = wfAgenda({
    hasEfficiency: efficiency.series.length > 0,
    hasDynamics: dynamics.movement.length > 0 || dynamics.turnover.length > 0,
    hasCostStructure: costStructure.composition.length > 0 || costStructure.scurve.length > 0,
    hasConcentration: concentration.data.costCenters.length > 0,
  });

  const ctx: DeckContext = {
    model,
    footer: `${REPORT_NAME_SHORT} · ${meta.periodLabel}`,
    counters: [],
  };

  const headlineKpis = executive.kpis.filter(
    (k) => k.group === 'custo' || k.group === 'volume' || k.group === 'eficiencia',
  );
  const kpiCell = (k: (typeof headlineKpis)[number]): BandCell => {
    const isMeasured = k.display ? k.display.measured : k.value.measured;
    const d = k.delta.measured ? k.delta.value : null;
    return {
      label: k.label,
      value: measuredText(k.value, k.format, k.display),
      measured: isMeasured,
      accent: !isMeasured
        ? P.unmeasured
        : k.tone === 'danger'
          ? P.negative
          : k.tone === 'warning'
            ? P.attention
            : k.tone === 'success'
              ? P.positive
              : P.accent,
      helper: d
        ? `${d.pct > 0 ? '+' : ''}${d.pct.toFixed(1).replace('.', ',')}% ${d.label}`
        : isMeasured
          ? k.helper
          : 'não apurado no período',
    };
  };

  /* 01 — Capa
   *
   * Bloco único centrado no eixo do slide — a mesma capa do PDF e do deck
   * HTML: marca, título, leitura de abertura, fio de acento e a linha de meta.
   * O PowerPoint posiciona por coordenada, então "centrado" aqui é aritmética
   * explícita: caixa da largura útil inteira + `align: 'center'`. */
  {
    const slide = baseSlide(pres, ctx, '', { counter: false, notes: insights.verdict });

    const logo = fitLogoBox(model.meta.branding, { maxWidth: 470, maxHeight: 58 });
    addLogo(slide, model, {
      left: (W_PX - logo.width) / 2,
      top: 170,
      height: 58,
      maxWidth: 470,
    });

    addText(
      slide,
      REPORT_NAME,
      { left: M, top: 268, width: CONTENT_W, height: 130 },
      {
        fontSize: pt(54),
        bold: true,
        color: hex(P.ink),
        align: 'center',
        lineSpacingMultiple: 0.96,
      },
    );

    addText(
      slide,
      insights.headline,
      { left: (W_PX - 780) / 2, top: 400, width: 780, height: 54 },
      { fontSize: pt(15), color: hex(P.body), align: 'center' },
    );

    addRect(slide, { left: (W_PX - 96) / 2, top: 484, width: 96, height: 2 }, P.accent);

    const cover: [string, string][] = [
      ['Período', meta.periodLabel],
      ['Recorte', meta.filtersLabel],
      [
        'Comparação',
        meta.comparison.label.measured ? meta.comparison.label.value : 'sem base no período',
      ],
    ];
    const colW = 300;
    const metaLeft = (W_PX - colW * cover.length) / 2;
    cover.forEach(([label, value], index) => {
      const left = metaLeft + index * colW;
      addText(
        slide,
        label.toUpperCase(),
        { left, top: 520, width: colW, height: 20 },
        {
          fontSize: pt(11),
          bold: true,
          color: hex(P.subtle),
          charSpacing: 1.4,
          align: 'center',
        },
      );
      addText(
        slide,
        value,
        { left, top: 544, width: colW, height: 44 },
        { fontSize: pt(16), bold: true, color: hex(P.body), align: 'center' },
      );
    });
  }

  /* 02 — Roteiro */
  {
    const slide = baseSlide(pres, ctx, 'Roteiro da apresentação', {
      notes: 'Use o roteiro para combinar o tempo de cada bloco antes de entrar nos números.',
    });
    addSectionTitle(slide, 'O que esta leitura cobre');
    const rows = Math.ceil(agenda.length / 2);
    const colW = CONTENT_W / 2 - 16;
    // Bloco centrado no corpo do slide, como o roteiro do PDF.
    const blockH = rows * 62;
    const top0 = BODY_Y + Math.max(0, (FOOT_Y - 40 - BODY_Y - blockH) / 2);
    agenda.forEach((item, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const left = M + col * (colW + 32);
      const top = top0 + row * 62;
      addRect(slide, { left, top, width: colW, height: 1 }, P.lineSoft);
      addText(
        slide,
        String(index + 1).padStart(2, '0'),
        { left, top: top + 12, width: 34, height: 22 },
        { fontSize: pt(11.5), bold: true, color: hex(P.accent), charSpacing: 1 },
      );
      addText(
        slide,
        item.title,
        { left: left + 40, top: top + 9, width: colW - 40, height: 26 },
        { fontSize: pt(16.5), bold: true, color: hex(P.ink) },
      );
      addText(
        slide,
        item.sub,
        { left: left + 40, top: top + 33, width: colW - 40, height: 22 },
        { fontSize: pt(12), color: hex(P.subtle) },
      );
    });
  }

  /* 03 — Síntese executiva */
  {
    const slide = baseSlide(pres, ctx, 'Síntese executiva', { notes: insights.verdict });
    addSectionTitle(slide, insights.verdict, `${meta.periodLabel} · ${meta.filtersLabel}`);

    addText(
      slide,
      insights.headline,
      { left: M, top: BODY_Y + 4, width: 720, height: 76 },
      { fontSize: pt(15), color: hex(P.body) },
    );

    addBand(slide, { left: M, top: BODY_Y + 92, width: 720, height: 128 }, headlineKpis.slice(0, 4).map(kpiCell), {
      valueSize: pt(21),
    });

    // Mostrador à direita, alinhado ao bloco de KPI — o mesmo par texto/dial da
    // síntese do PDF.
    const dialW = CONTENT_W - 720 - 32;
    addChartPanel(
      slide,
      (size) =>
        wfGauge(executive.risk.score.measured ? executive.risk.score.value : null, {
          palette: P,
          width: size.width,
          height: size.height,
          valueText: executive.risk.score.measured
            ? `${executive.risk.score.value}/100`
            : undefined,
          // Escala documentada como "higher = healthier": 100 é o melhor.
          bands: [
            [0, 40, P.negative],
            [40, 70, P.attention],
            [70, 100, P.positive],
          ],
        }),
      [],
      { left: M + 752, top: BODY_Y + 4, width: dialW, height: 216 },
      'Saúde da folha (100 = melhor)',
    );

    addBand(
      slide,
      { left: M, top: 396, width: CONTENT_W, height: 180 },
      insights.cards.slice(0, 4).map(insightBandCell),
      { valueSize: pt(18.5) },
    );
  }

  /* 04 — Painel completo de indicadores
   *
   * A síntese cabe em quatro células — é o que a faixa executiva comporta sem
   * apertar numa projeção. Os demais indicadores ganham o próprio slide, em
   * faixas de quatro. */
  const restKpis = [
    ...headlineKpis.slice(4),
    ...executive.kpis.filter((k) => k.group === 'conformidade'),
  ];
  if (restKpis.length > 0) {
    const slide = baseSlide(pres, ctx, 'Indicadores do período', {
      notes: 'Todos os indicadores apurados no recorte, com a variação sobre a linha de base.',
    });
    addSectionTitle(
      slide,
      'Todos os indicadores apurados no recorte',
      `${meta.periodLabel} · ${meta.filtersLabel}`,
    );
    const rows = Math.ceil(restKpis.length / 4);
    const rowH = Math.min(150, (FOOT_Y - 40 - BODY_Y - (rows - 1) * 14) / rows);
    for (let i = 0; i < rows; i += 1) {
      addBand(
        slide,
        { left: M, top: BODY_Y + i * (rowH + 14), width: CONTENT_W, height: rowH },
        restKpis.slice(i * 4, i * 4 + 4).map(kpiCell),
        { valueSize: pt(21) },
      );
    }
  }

  /* 05 — Eficiência */
  if (efficiency.series.length > 0) {
    const slide = baseSlide(pres, ctx, 'Eficiência & produtividade', {
      notes: 'Receita e custo por colaborador, e a parcela da receita consumida pela folha.',
    });
    addSectionTitle(
      slide,
      'Quanto cada pessoa produz e quanto a folha consome',
      `Limite de política em ${efficiency.threshold}% da receita.`,
    );
    addChartPanel(
      slide,
      (size) =>
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
            width: size.width,
            height: size.height,
            emptyTitle: 'Receita não lançada',
            emptyReason:
              'A produtividade por colaborador precisa da receita do contas a receber nas competências do período.',
          },
        ),
      [
        { label: 'Receita por colaborador', color: P.success },
        { label: 'Custo por colaborador', color: P.info, shape: 'line' },
      ],
      { left: M, top: BODY_Y, width: CONTENT_W, height: 344 },
    );
    addReadStrip(
      slide,
      [
        { label: 'Receita por colaborador', value: show(efficiency.revenuePerEmployee, wfCurrency) },
        { label: 'Custo por colaborador', value: show(efficiency.costPerEmployee, wfCurrency) },
        {
          label: 'Folha sobre receita',
          value: show(efficiency.payrollAsRevenuePct, (v) => wfPct(v)),
          color: efficiency.payrollAsRevenuePct.measured
            ? efficiency.payrollAsRevenuePct.value >= efficiency.threshold
              ? P.negative
              : P.positive
            : undefined,
        },
        { label: 'Limite de política', value: `${efficiency.threshold}%` },
      ],
      544,
    );
  }

  /* 05 — Dinâmica do quadro */
  if (dynamics.movement.length > 0 || dynamics.turnover.length > 0) {
    const net = dynamics.movement.reduce((sum, d) => sum + d.net, 0);
    const slide = baseSlide(pres, ctx, 'Dinâmica do quadro', {
      notes: 'Movimentação declarada no eSocial, rotatividade e pressão de horas extras.',
    });
    addSectionTitle(
      slide,
      'Movimentação declarada e rotatividade',
      'Admissões e desligamentos vêm dos eventos S-2200 e S-2299 do eSocial.',
    );
    addChartPanel(
      slide,
      (size) =>
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
            width: size.width,
            height: size.height,
            fmt: (v) => wfInt(v),
            emptyTitle: 'Movimentação não apurada',
            emptyReason:
              'Admissões e desligamentos vêm dos eventos do eSocial; nenhuma competência do período os trouxe.',
          },
        ),
      [
        { label: 'Admissões', color: P.success },
        { label: 'Desligamentos', color: P.danger },
      ],
      { left: M, top: BODY_Y, width: CONTENT_W, height: 344 },
    );
    addReadStrip(
      slide,
      [
        {
          label: 'Saldo do quadro',
          value: dynamics.movement.length
            ? `${net > 0 ? '+' : ''}${wfInt(net)}`
            : UNMEASURED_DASH,
          color: net > 0 ? P.positive : net < 0 ? P.negative : undefined,
        },
        {
          label: 'Turnover da competência',
          value: show(dynamics.latestTurnoverPct, (v) => wfPct(v, 2)),
        },
        { label: 'Horas extras', value: show(dynamics.latestOvertimePct, (v) => wfPct(v)) },
        { label: 'Absenteísmo máximo', value: show(dynamics.maxAbsenteeismPct, (v) => wfPct(v)) },
      ],
      544,
    );
  }

  /* 06 — Estrutura de custo */
  if (costStructure.composition.length > 0 || costStructure.scurve.length > 0) {
    const slide = baseSlide(pres, ctx, 'Estrutura de custo', {
      notes: 'Composição da folha por competência e a trajetória acumulada do período.',
    });
    addSectionTitle(
      slide,
      'De que a folha é feita',
      'A separação entre salário, benefícios e encargos depende da tabela de rubricas (S-1010).',
    );
    const halfW = (CONTENT_W - 24) / 2;
    addChartPanel(
      slide,
      (size) =>
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
            width: size.width,
            height: size.height,
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
      { left: M, top: BODY_Y, width: halfW, height: 344 },
    );
    addChartPanel(
      slide,
      (size) =>
        wfDonut(benefitSlices(model), {
          palette: P,
          width: size.width,
          height: size.height,
          centerLabel: 'Benefícios',
          centerValue: costStructure.benefitsTotal.measured
            ? wfCompactCurrency(costStructure.benefitsTotal.value)
            : UNMEASURED_DASH,
          emptyTitle: 'Benefícios não classificados',
          emptyReason: 'A abertura por natureza exige rubricas de benefício declaradas no S-1010.',
        }),
      [],
      { left: M + halfW + 24, top: BODY_Y, width: halfW, height: 344 },
      'Benefícios acumulados por natureza',
    );
    addReadStrip(
      slide,
      [
        { label: 'Folha acumulada', value: wfCurrency(costStructure.totalPayrollAccum) },
        { label: 'Benefícios', value: show(costStructure.benefitsTotal, wfCurrency) },
        { label: 'Encargos', value: show(costStructure.chargesTotal, wfCurrency) },
        { label: 'Salário direto', value: show(costStructure.directPct, (v) => wfPct(v)) },
      ],
      544,
    );
  }

  /* 07 — Curva S */
  if (costStructure.scurve.length > 0) {
    const slide = baseSlide(pres, ctx, 'Estrutura de custo', {
      notes: 'Trajetória acumulada da folha, contra a mesma janela do período anterior.',
    });
    addSectionTitle(
      slide,
      'A trajetória acumulada do período',
      'A curva do período anterior é a referência: onde ela se distancia, o custo mudou de patamar.',
    );
    addChartPanel(
      slide,
      (size) =>
        wfSCurve(
          costStructure.scurve.map((d) => d.period),
          costStructure.scurve.map((d) => d.cumulative),
          costStructure.scurve.map((d) => d.cumulativePrev ?? 0),
          { palette: P, width: size.width, height: size.height },
        ),
      [
        { label: 'Período atual', color: P.accent, shape: 'line' },
        { label: 'Período anterior', color: P.info, shape: 'dash' },
      ],
      { left: M, top: BODY_Y, width: CONTENT_W, height: 344 },
    );
    addReadStrip(
      slide,
      [
        { label: 'Folha acumulada', value: wfCurrency(costStructure.totalPayrollAccum) },
        { label: 'Competências', value: wfInt(costStructure.scurve.length) },
        {
          label: 'Comparação',
          value: meta.comparison.windowLabel.measured
            ? meta.comparison.windowLabel.value
            : UNMEASURED_DASH,
        },
      ],
      544,
    );
  }

  /* 08 — Risco & concentração */
  if (concentration.data.costCenters.length > 0) {
    const sorted = [...concentration.data.costCenters].sort(
      (a, b) => b.payrollValue - a.payrollValue,
    );
    const slide = baseSlide(pres, ctx, 'Risco & concentração', {
      notes: 'Dependência dos maiores centros de custo e variações fora do padrão.',
    });
    addSectionTitle(
      slide,
      'Dependência dos maiores centros de custo',
      `Total de ${wfCurrency(concentration.data.totalPayroll)} rateados no período.`,
    );
    addChartPanel(
      slide,
      (size) =>
        wfParetoChart(
          sorted.map((c) => ({ label: c.name, value: c.payrollValue, highlight: c.isAbnormal })),
          { palette: P, width: size.width, height: size.height },
        ),
      [
        { label: 'Folha do centro', color: P.accent },
        { label: 'Variação atípica', color: P.danger },
        { label: 'Acumulado (eixo direito)', color: P.warning, shape: 'line' },
      ],
      { left: M, top: BODY_Y, width: CONTENT_W, height: 344 },
    );
    addReadStrip(
      slide,
      [
        { label: 'Top 3 da folha', value: show(concentration.top3, (v) => wfPct(v)) },
        { label: 'Maior centro', value: sorted[0]?.name ?? UNMEASURED_DASH },
        { label: 'Centros no recorte', value: wfInt(sorted.length) },
        {
          label: 'Variações atípicas',
          value: wfInt(concentration.abnormal.length),
          color: concentration.abnormal.length > 0 ? P.attention : undefined,
        },
      ],
      544,
    );
  }

  /* 09 — Conformidade */
  {
    const slide = baseSlide(pres, ctx, 'Conformidade', {
      notes: `Ciclo folha → eSocial → guias em ${compliance.currentCompetenceLabel}.`,
    });
    addSectionTitle(
      slide,
      'Ciclo folha → eSocial → guias',
      `Situação das obrigações de ${compliance.currentCompetenceLabel}.`,
    );

    const dialW = 400;
    addChartPanel(
      slide,
      (size) =>
        wfGauge(compliance.snapshot.score, {
          palette: P,
          width: size.width,
          height: size.height,
          valueText: `${compliance.snapshot.score}/100`,
          bands: [
            [0, 60, P.negative],
            [60, 85, P.attention],
            [85, 100, P.positive],
          ],
        }),
      [],
      { left: M, top: BODY_Y, width: dialW, height: 300 },
      'Conformidade da competência',
    );
    addText(
      slide,
      compliance.snapshot.nextDue
        ? `Próxima obrigação: ${compliance.snapshot.nextDue.label}, vencimento em ${wfDueDate(compliance.snapshot.nextDue.dueDate)}.`
        : 'Nenhuma obrigação pendente na competência.',
      { left: M, top: BODY_Y + 312, width: dialW, height: 56 },
      { fontSize: pt(12), color: hex(P.muted) },
    );

    const tableLeft = M + dialW + 32;
    const tableW = CONTENT_W - dialW - 32;
    const rows = [
      [
        { text: 'Obrigação', options: { bold: true, color: hex(P.muted), fontSize: pt(11.5) } },
        { text: 'Vencimento', options: { bold: true, color: hex(P.muted), fontSize: pt(11.5) } },
        { text: 'Situação', options: { bold: true, color: hex(P.muted), fontSize: pt(11.5) } },
      ],
      ...compliance.snapshot.obligations.slice(0, 9).map((o) => [
        { text: `${o.code} · ${o.label}`, options: { color: hex(P.body), fontSize: pt(12) } },
        { text: wfDueDate(o.dueDate), options: { color: hex(P.body), fontSize: pt(12) } },
        {
          text: OBLIGATION_STATUS_META[o.status].label,
          options: { color: hex(P.body), fontSize: pt(12) },
        },
      ]),
    ];
    slide.addTable(rows, {
      ...box({ left: tableLeft, top: BODY_Y, width: tableW, height: 368 }),
      colW: [inch(tableW * 0.5), inch(tableW * 0.25), inch(tableW * 0.25)],
      border: { type: 'solid', color: hex(P.lineSoft), pt: 0.5 },
      fontFace: FONT,
      valign: 'middle',
      rowH: inch(36),
    });
  }

  /* 10 — Procedência & método */
  {
    const slide = baseSlide(pres, ctx, 'Procedência & método', {
      notes: 'De onde vem cada número e o que este material NÃO afirma.',
    });
    addSectionTitle(
      slide,
      'De onde vem cada número',
      'Somente dado apurado: onde a fonte não respondeu, o indicador aparece como traço.',
    );

    const colW = (CONTENT_W - 64) / 3;
    const columns: { title: string; accent: string; items: string[] }[] = [
      {
        title: 'Fontes',
        accent: P.accent,
        items: [
          'Folha — lotes de fechamento aprovados, com rateio por centro de custo.',
          'Quadro e movimentação — eventos apurados do eSocial.',
          'Composição — classificação de verbas pela tabela de rubricas (S-1010).',
          'Receita — títulos do contas a receber, por competência.',
        ],
      },
      {
        title: 'Recorte',
        accent: P.info,
        items: [
          `Período — ${meta.periodLabel}`,
          `Unidades — ${meta.filtersLabel}`,
          `Competências — ${wfInt(meta.monthsInRange)} no recorte`,
          `Comparação — ${
            meta.comparison.windowLabel.measured
              ? meta.comparison.windowLabel.value
              : 'sem linha de base na série apurada'
          }`,
        ],
      },
      {
        title: 'O que não foi apurado',
        accent: P.attention,
        items:
          insights.gaps.length > 0
            ? insights.gaps.slice(0, 4)
            : ['Todos os indicadores do escopo foram apurados.'],
      },
    ];

    columns.forEach((column, index) => {
      const left = M + index * (colW + 32);
      addRect(slide, { left, top: BODY_Y, width: colW, height: 2 }, column.accent);
      addText(
        slide,
        column.title.toUpperCase(),
        { left, top: BODY_Y + 12, width: colW, height: 22 },
        { fontSize: pt(11), bold: true, color: hex(column.accent), charSpacing: 1.4 },
      );
      addText(
        slide,
        column.items.map((text) => ({ text: `${text}\n`, options: { bullet: true } })),
        { left, top: BODY_Y + 40, width: colW, height: 300 },
        { fontSize: pt(13), color: hex(P.body) },
      );
    });

    addRect(slide, { left: M, top: 544, width: CONTENT_W, height: 1 }, P.lineSoft);
    addText(
      slide,
      `Somente dado apurado. Onde a fonte não respondeu, o indicador aparece como “${UNMEASURED_DASH}” — nunca como zero, e nunca como valor estimado.`,
      { left: M, top: 558, width: CONTENT_W, height: 40 },
      { fontSize: pt(13), italic: true, color: hex(P.subtle) },
    );
  }

  /* 11 — Fecho institucional (só a marca centralizada, igual ao PDF) */
  {
    const slide = baseSlide(pres, ctx, '', { counter: false });
    const fit = fitLogoBox(model.meta.branding, { maxWidth: 620, maxHeight: 200 });
    addLogo(slide, model, {
      left: (W_PX - fit.width) / 2,
      top: (H_PX - fit.height) / 2,
      height: 200,
      maxWidth: 620,
    });
  }

  // O total conta a capa e o fecho, que não numeram — é o que faz "08 / 11"
  // bater com a posição real do slide no arquivo.
  const total = pres.slides.length;
  ctx.counters.forEach((entry, index) => {
    addText(entry.slide, `${String(index + 2).padStart(2, '0')} / ${String(total).padStart(2, '0')}`, entry.b, {
      fontSize: pt(12),
      color: hex(P.subtle),
      align: 'right',
      charSpacing: 1.2,
    });
  });
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

/* ═══════════════════════════════════════════════════════════════════════════
   Escrita
   ═══════════════════════════════════════════════════════════════════════════ */

/** Largura mínima do PNG de fallback — 2× a colocação típica num slide 16:9. */
const FALLBACK_PNG_WIDTH = 2000;

/**
 * Troca os fallbacks `.png` inválidos do pptxgenjs por PNGs reais.
 *
 * Devolve quantas imagens foram convertidas — zero significa que não havia
 * nada a corrigir OU que a estrutura interna mudou; nos dois casos o documento
 * segue válido, apenas sem fallback rasterizado.
 */
async function rasterizeSvgFallbacks(pres: AnyPres): Promise<number> {
  let converted = 0;

  const slides: AnySlide[] = Array.isArray(pres?.slides) ? pres.slides : [];
  if (slides.length === 0) return 0;

  // Import dinâmico: `sharp` é nativo e só precisa existir quando um PPTX é
  // de fato gerado.
  let sharp: typeof import('sharp');
  try {
    sharp = (await import('sharp')).default;
  } catch {
    // Sem rasterizador, o PPTX continua correto para PowerPoint 365.
    return 0;
  }

  for (const slide of slides) {
    const media: { isSvgPng?: boolean; data?: string }[] = Array.isArray(slide?._relsMedia)
      ? slide._relsMedia
      : [];

    for (const rel of media) {
      if (!rel?.isSvgPng || typeof rel.data !== 'string') continue;

      const base64 = rel.data.split(',').pop();
      if (!base64) continue;

      try {
        const svg = Buffer.from(base64, 'base64');
        // `density` alto evita texto serrilhado quando o SVG é ampliado.
        const png = await sharp(svg, { density: 220 })
          .resize({ width: FALLBACK_PNG_WIDTH, fit: 'inside', withoutEnlargement: false })
          .png({ compressionLevel: 9 })
          .toBuffer();

        // O pptxgenjs espera `<mime>;base64,<dados>` neste campo.
        rel.data = `image/png;base64,${png.toString('base64')}`;
        converted += 1;
      } catch {
        // Uma imagem que falha não pode derrubar o deck inteiro: ela mantém o
        // comportamento anterior e as outras seguem convertidas.
      }
    }
  }

  return converted;
}

export async function generateWorkforceOverviewPptx(
  model: WorkforceOverviewModel,
): Promise<Uint8Array> {
  // Import dinâmico: mantém o gerador fora do grafo de módulos até a rota ser
  // de fato chamada.
  const mod = await import('pptxgenjs');
  const PptxGenJS = (mod as unknown as { default?: unknown }).default ?? mod;
  const pres = new (PptxGenJS as new () => AnyPres)();

  pres.defineLayout({ name: 'WF16x9', width: W, height: H });
  pres.layout = 'WF16x9';
  pres.author = model.meta.branding.companyName;
  pres.company = model.meta.branding.companyName;
  pres.title = `${REPORT_NAME} — ${model.meta.periodLabel}`;
  pres.subject = REPORT_NAME_SHORT;

  buildWorkforceOverviewDeck(pres, model);

  // Precisa rodar DEPOIS de montar os slides e ANTES de escrever: é entre os
  // dois que as entradas de mídia existem e ainda são editáveis.
  await rasterizeSvgFallbacks(pres);

  const buffer = (await pres.write({ outputType: 'nodebuffer' })) as Buffer;
  return new Uint8Array(buffer);
}
