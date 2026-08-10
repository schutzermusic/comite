/**
 * Apex PPTX — Relatório de Faturamento vs Folha de Pagamento em PowerPoint
 * (execução no servidor).
 *
 * Mesmo material do PDF e do deck HTML: mesma sequência de seções, mesmos
 * títulos (de `apex-insights`), mesma paleta e a MESMA anatomia visual — capa
 * sem cartões, faixa executiva no padrão Executive Band, mostrador radial de
 * cobertura, faixa de leitura sob cada gráfico e fecho só com a marca.
 *
 * Os gráficos são os mesmos SVGs de `apex-charts` que o PDF imprime, embutidos
 * como imagem vetorial. Antes eram objetos de gráfico nativos do PowerPoint —
 * editáveis, mas com outro desenho (sem hachura de previsão, sem eixo de tempo
 * em dois níveis, sem zona de projeção), o que fazia o mesmo relatório chegar
 * ao board com duas caras. A identidade visual venceu a edição do gráfico; a
 * base numérica continua no arquivo, na seção "Base mensal informada".
 *
 * Camada de apresentação apenas: os números vêm de `calculateInvestorPack`.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildApexInsights,
  curveReading,
  monthlyReading,
  type ApexInsightCard,
  type ApexInsights,
} from './apex-insights';
import { APEX_LOGO_ALT, APEX_LOGO_ASPECT, APEX_LOGO_DATA_URI, APEX_LOGO_SMALL_DATA_URI } from './apex-logo';
import {
  apexBalanceChart,
  apexClientForecastChart,
  apexCoverageDial,
  apexCurveChart,
  apexMonthlyChart,
  apexMonthlyLineChart,
  balanceLegend,
  clientForecastColor,
  curveLegend,
  monthlyLegend,
  monthlyLineLegend,
  type ApexLegendItem,
} from './apex-charts';
import {
  APEX_CLIENT_FORECAST_DESCRIPTION,
  APEX_PREPARED_BY,
  APEX_SOURCE,
  REPORT_NAME_SHORT,
  apexAgenda,
  confidentialityLabel,
  dashIfZero,
  formatInvestorRatio,
  investorClosingMessage,
  investorCoverTitle,
  investorExecutiveSummary,
  apexPalette,
  type ApexPalette,
  type ApexThemeMode,
} from './apex-theme';
import { calculateInvestorPack, formatInvestorCurrency, formatInvestorDate, formatInvestorPeriod } from './calculations';
import type { InvestorPack, InvestorPackCurvePoint, InvestorPackSnapshot, InvestorPortfolioClient } from './types';

if (typeof window !== 'undefined') {
  throw new Error('pptx-server só pode ser carregado no servidor.');
}

type ArtifactModule = {
  Presentation: { create: (options: unknown) => any };
  PresentationFile: { exportPptx: (presentation: unknown) => Promise<{ save: (filePath: string) => Promise<void> }> };
};

async function loadArtifactTool(): Promise<ArtifactModule> {
  const moduleName = '@oai/artifact-tool';
  try {
    return await import(/* webpackIgnore: true */ moduleName) as ArtifactModule;
  } catch {
    const configured = process.env.OAI_ARTIFACT_TOOL_PATH;
    const runtimeFallback = path.join(
      os.homedir(),
      '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs',
    );
    const candidate = configured || runtimeFallback;
    try {
      return await import(/* webpackIgnore: true */ pathToFileURL(candidate).href) as ArtifactModule;
    } catch {
      throw new Error('Gerador PowerPoint indisponível. Configure OAI_ARTIFACT_TOOL_PATH para o módulo @oai/artifact-tool.');
    }
  }
}

/* ── Grade do slide (1280×720) ───────────────────────────────── */
const W = 1280;
const H = 720;
const M = 64;            // margem lateral
const CONTENT_W = W - M * 2;
const HEAD_Y = 44;       // sobrelinha
const TITLE_Y = 84;      // título da seção
const FOOT_Y = 664;      // rodapé
/** Base do corpo em slides de conteúdo (abaixo do título + sublinha). */
const BODY_Y = 172;
const FONT = 'Aptos';

type Pos = { left: number; top: number; width: number; height: number };

/* ── Primitivas ──────────────────────────────────────────────── */

function addText(slide: any, P: ApexPalette, text: string, position: Pos, style: Record<string, unknown> = {}) {
  const shape = slide.shapes.add({
    geometry: 'textbox',
    position,
    fill: 'none',
    line: { style: 'solid', fill: 'none', width: 0 },
  });
  shape.text = text;
  shape.text.style = {
    fontFamily: FONT,
    fontSize: 18,
    color: P.ink,
    autoFit: 'shrinkText',
    verticalAlignment: 'top',
    ...style,
  };
  return shape;
}

function addRect(slide: any, position: Pos, fill: string, opts?: { radius?: boolean; stroke?: string; strokeWidth?: number }) {
  return slide.shapes.add({
    geometry: opts?.radius ? 'roundRect' : 'rect',
    position,
    fill: fill === 'none' ? 'none' : fill,
    line: opts?.stroke
      ? { style: 'solid', fill: opts.stroke, width: opts?.strokeWidth ?? 1 }
      : { style: 'solid', fill: 'none', width: 0 },
    ...(opts?.radius ? { borderRadius: 'rounded-xl' } : {}),
  });
}

/**
 * Superfície de vidro dos painéis, equivalente ao gradiente do PDF e do deck.
 *
 * `offset` é a chave que o gerador converte no atributo `pos` da parada de
 * gradiente, e `pos` é obrigatório em OOXML: com qualquer outro nome o XML sai
 * sem ele e o PowerPoint abre o arquivo pedindo reparo. A escala é a do formato
 * (0 a 100000 = 0% a 100%). O ângulo não tem equivalente na API, então a
 * transição sai reta — entre dois tons vizinhos, imperceptível.
 */
const GRADIENT_END = 100_000;

function addGlass(slide: any, P: ApexPalette, position: Pos, opts?: { stroke?: string; from?: string; to?: string }) {
  return slide.shapes.add({
    geometry: 'roundRect',
    position,
    borderRadius: 'rounded-xl',
    fill: {
      type: 'gradient',
      stops: [
        { offset: 0, color: opts?.from ?? P.panelTop },
        { offset: GRADIENT_END, color: opts?.to ?? P.panelBottom },
      ],
    },
    line: { style: 'solid', fill: opts?.stroke ?? P.lineSoft, width: 1 },
  });
}

function addDot(slide: any, left: number, top: number, size: number, color: string) {
  return slide.shapes.add({
    geometry: 'ellipse',
    position: { left, top, width: size, height: size },
    fill: color,
    line: { style: 'solid', fill: 'none', width: 0 },
  });
}

function channels(color: string): [number, number, number] {
  const hex = color.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((part) => part + part).join('') : hex;
  return [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16)) as [number, number, number];
}

/**
 * `rgba()` não vale como atributo de apresentação em SVG e o rasterizador do
 * gerador de PPTX também ignora `*-opacity` — a grade sairia em traço cheio, o
 * que no tema claro vira uma pauta preta sobre o papel. A saída é achatar a
 * transparência contra o fundo do painel e entregar uma cor sólida já mesclada.
 */
function alphaAttrs(value: string, prop: 'stroke' | 'fill', background: string): Record<string, string> {
  const match = /rgba?\(([^)]+)\)/.exec(value);
  if (!match) return { [prop]: value };
  const parts = match[1].split(',').map((part) => part.trim());
  const alpha = Number(parts[3] ?? '1');
  const [br, bg, bb] = channels(background);
  const blended = [Number(parts[0]), Number(parts[1]), Number(parts[2])]
    .map((channel, index) => Math.round(channel * alpha + [br, bg, bb][index] * (1 - alpha)))
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('');
  return { [prop]: `#${blended}` };
}

/**
 * O rasterizador de SVG do gerador de PPTX ignora `<style>`: o que o PDF
 * resolve por classe (`apex-axis`, `apex-grid`…) precisa virar atributo no
 * próprio elemento. Os valores abaixo são a transcrição literal de
 * `apexChartCss` — é o mesmo desenho, escrito de outro jeito.
 */
function chartClassAttrs(P: ApexPalette): Record<string, Record<string, string>> {
  return {
    'apex-grid': { ...alphaAttrs(P.grid, 'stroke', P.panelTop), 'stroke-dasharray': '3 7' },
    'apex-axisline': alphaAttrs(P.axisLine, 'stroke', P.panelTop),
    'apex-axis': {
      fill: P.muted,
      'font-family': `${FONT}, Arial, Helvetica, sans-serif`,
      'font-size': '14',
      'letter-spacing': '.02em',
    },
    'apex-axis-month': { 'font-size': '11', 'letter-spacing': '0' },
    'apex-axis-year': { 'font-size': '14', 'font-weight': '700', 'letter-spacing': '.18em', fill: P.ink },
    'apex-axis-forecast': { fill: P.revenueForecast },
  };
}

/**
 * Aplica as classes em cascata, elemento a elemento. O que o elemento já traz
 * escrito à mão vence a classe (é assim que o `fill` da "Zona de previsão"
 * sobrepõe a cor de eixo) — e, sobretudo, atributo repetido é XML inválido: o
 * rasterizador descarta o gráfico inteiro e devolve um retângulo branco.
 */
function inlineChartStyles(svg: string, P: ApexPalette): string {
  return svg.replace(/<[a-zA-Z][^>]*>/g, (tag) => {
    const classMatch = / class="([^"]*)"/.exec(tag);
    if (!classMatch) return tag;
    const attrs: Record<string, string> = {};
    const definitions = chartClassAttrs(P);
    classMatch[1].split(/\s+/).forEach((name) => Object.assign(attrs, definitions[name] ?? {}));
    const rest = tag.replace(/ class="[^"]*"/, '');
    const existing = new Set([...rest.matchAll(/[\s]([a-zA-Z-]+)=/g)].map((entry) => entry[1]));
    const additions = Object.entries(attrs).filter(([key]) => !existing.has(key));
    if (!additions.length) return rest;
    const close = rest.endsWith('/>') ? '/>' : '>';
    return `${rest.slice(0, rest.length - close.length).trimEnd()} ${additions.map(([key, value]) => `${key}="${value}"`).join(' ')}${close}`;
  });
}

/** SVG do `apex-charts` embutido como imagem vetorial do slide. */
function addSvg(slide: any, P: ApexPalette, svg: string, position: Pos, alt: string) {
  const open = svg.indexOf('>');
  const doc = `${svg.slice(0, open)} xmlns="http://www.w3.org/2000/svg">${inlineChartStyles(svg.slice(open + 1), P)}`;
  slide.images.add({
    dataUrl: `data:image/svg+xml;base64,${Buffer.from(doc, 'utf8').toString('base64')}`,
    position,
    fit: 'contain',
    alt,
  });
}

/** Logo Insight Energy — a marca institucional de todo slide. */
function addLogo(slide: any, position: { left: number; top: number; height: number; small?: boolean }) {
  slide.images.add({
    // Rodapé usa a variante leve: a imagem é embutida uma vez por slide.
    dataUrl: position.small ? APEX_LOGO_SMALL_DATA_URI : APEX_LOGO_DATA_URI,
    position: {
      left: position.left,
      top: position.top,
      width: position.height * APEX_LOGO_ASPECT,
      height: position.height,
    },
    fit: 'contain',
    alt: APEX_LOGO_ALT,
  });
}

/* ── Faixa executiva (padrão HudKpiStrip / Executive Band) ────── */

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
}

/**
 * Contêiner de vidro com trilhos nas bordas agrupando células de gap mínimo —
 * a mesma anatomia do PDF e do deck, e não cartões soltos.
 */
function addBand(slide: any, P: ApexPalette, position: Pos, cells: BandCell[], opts?: { valueSize?: number }) {
  addGlass(slide, P, position, { stroke: P.line });
  // Trilhos: acento à esquerda, linha neutra à direita.
  addRect(slide, { left: position.left + 9, top: position.top + 9, width: 1, height: position.height - 18 }, P.revenue);
  addRect(slide, { left: position.left + position.width - 10, top: position.top + 9, width: 1, height: position.height - 18 }, P.line);

  const pad = 5;
  const gap = 5;
  const inner = position.width - pad * 2;
  const cellW = (inner - gap * (cells.length - 1)) / cells.length;
  const cellH = position.height - pad * 2;

  cells.forEach((cell, index) => {
    const left = position.left + pad + index * (cellW + gap);
    const top = position.top + pad;
    addGlass(slide, P, { left, top, width: cellW, height: cellH }, { stroke: P.lineSoft, from: P.panelTop, to: P.void });
    // Fio de acento no topo da célula (o equivalente ao gradiente do CSS).
    addRect(slide, { left: left + cellW * 0.26, top, width: cellW * 0.48, height: 1 }, cell.accent);

    addDot(slide, left + 14, top + 17, 5, cell.accent);
    addText(slide, P, cell.label.toUpperCase(), { left: left + 25, top: top + 11, width: cellW - 39 - (cell.tag ? 82 : 0), height: 32 },
      { fontSize: 11, bold: true, color: P.muted, autoFit: 'none' });
    if (cell.tag) {
      addRect(slide, { left: left + cellW - 92, top: top + 11, width: 78, height: 18 }, 'none',
        { radius: true, stroke: cell.accent, strokeWidth: 1 });
      addText(slide, P, cell.tag.toUpperCase(), { left: left + cellW - 92, top: top + 12, width: 78, height: 18 },
        { fontSize: 9, bold: true, color: cell.accent, alignment: 'center', autoFit: 'none' });
    }
    addText(slide, P, cell.value, { left: left + 14, top: top + 44, width: cellW - 28, height: 38 },
      { fontSize: opts?.valueSize ?? 26, bold: true, color: cell.accent });
    if (cell.helper) {
      addText(slide, P, cell.helper, { left: left + 14, top: top + 84, width: cellW - 28, height: 24 },
        { fontSize: 11.5, color: P.subtle, autoFit: 'none' });
    }
    if (cell.detail) {
      addText(slide, P, cell.detail, { left: left + 14, top: top + 86, width: cellW - 28, height: cellH - 96 },
        { fontSize: 12, color: P.subtle });
    }
  });
}

function insightCell(card: ApexInsightCard, P: ApexPalette): BandCell {
  const accent = card.kind === 'alert' ? P.negative : card.kind === 'watch' ? P.attention : P.revenue;
  const tag = card.kind === 'alert' ? 'Atenção' : card.kind === 'watch' ? 'Monitorar' : 'Sinal';
  return { label: card.label, value: card.value, accent, detail: card.detail, tag };
}

/**
 * Faixa de leitura do pé do slide — os mesmos pares rótulo/valor que fecham as
 * páginas de gráfico do PDF.
 */
function addReadStrip(slide: any, P: ApexPalette, items: Array<{ label: string; value: string; color?: string }>, top: number) {
  if (!items.length) return;
  addRect(slide, { left: M, top, width: CONTENT_W, height: 1 }, P.lineSoft);
  const colW = CONTENT_W / items.length;
  items.forEach((item, index) => {
    const left = M + index * colW;
    addText(slide, P, item.label.toUpperCase(), { left, top: top + 10, width: colW - 20, height: 20 },
      { fontSize: 11, bold: true, color: P.subtle, autoFit: 'none' });
    addText(slide, P, item.value, { left, top: top + 30, width: colW - 20, height: 28 },
      { fontSize: 18, bold: true, color: item.color ?? P.ink, autoFit: 'none' });
  });
}

/* ── Legenda (as mesmas marcas do PDF, em formas nativas) ─────── */

/** Largura estimada de um item (marca + rótulo + respiro), em px de slide. */
const LEGEND_ROW_H = 22;
function legendItemWidth(item: ApexLegendItem): number {
  return 27 + item.label.length * 7.6 + 34;
}

/** Quantas linhas a legenda ocupa na largura disponível. */
function legendRows(items: ApexLegendItem[], maxWidth: number): number {
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

function addLegend(slide: any, P: ApexPalette, items: ApexLegendItem[], left: number, top: number, maxWidth: number) {
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
    } else if (shape === 'hatch') {
      // Sem hachura confiável em OOXML: a marca vazada distingue o previsto.
      addRect(slide, { left: x, top: y + 4, width: 18, height: 10 }, 'none', { radius: true, stroke: item.color, strokeWidth: 1.5 });
    } else {
      addRect(slide, { left: x, top: y + 4, width: 18, height: 10 }, item.color, { radius: true });
    }
    addText(slide, P, item.label, { left: x + 25, top: y, width: width - 25, height: 20 },
      { fontSize: 13, color: P.muted, autoFit: 'none' });
    x += width;
  });
}

/* ── Tabelas (formas: o objeto de tabela não aceita a nossa grade) ─ */

type TableAlign = 'left' | 'right';
interface TableColumn {
  label: string;
  width: number;
  align: TableAlign;
}
interface TableRow {
  kind: 'data' | 'split' | 'sub' | 'total';
  cells: Array<{ text: string; color?: string }>;
  /** Faixa zebrada — só linhas de dado. */
  zebra?: boolean;
}

function addTable(slide: any, P: ApexPalette, columns: TableColumn[], rows: TableRow[], top: number, rowH: number, fontSize: number) {
  addRect(slide, { left: M, top, width: CONTENT_W, height: rowH }, P.panelTop);
  addRect(slide, { left: M, top: top + rowH - 1, width: CONTENT_W, height: 1 }, P.line);
  let x = M;
  columns.forEach((column) => {
    addText(slide, P, column.label.toUpperCase(), { left: x + 9, top: top + (rowH - 20) / 2, width: column.width - 18, height: 20 },
      { fontSize: 11, bold: true, color: P.muted, alignment: column.align, autoFit: 'none' });
    x += column.width;
  });

  rows.forEach((row, index) => {
    const y = top + rowH + index * rowH;
    if (row.kind === 'split') {
      addText(slide, P, row.cells[0].text.toUpperCase(), { left: M + 9, top: y + (rowH - 20) / 2, width: CONTENT_W - 18, height: 20 },
        { fontSize: 11, bold: true, color: P.revenueForecast, autoFit: 'none' });
      addRect(slide, { left: M, top: y + rowH - 1, width: CONTENT_W, height: 1 }, P.revenueForecast);
      return;
    }
    if (row.kind === 'total') {
      addRect(slide, { left: M, top: y, width: CONTENT_W, height: rowH }, P.panelTop);
      addRect(slide, { left: M, top: y, width: CONTENT_W, height: 1 }, P.line);
    } else if (row.kind === 'sub') {
      addRect(slide, { left: M, top: y, width: CONTENT_W, height: 1 }, P.lineSoft);
    } else {
      if (row.zebra) addRect(slide, { left: M, top: y, width: CONTENT_W, height: rowH }, P.panelBottom);
      addRect(slide, { left: M, top: y + rowH - 1, width: CONTENT_W, height: 1 }, P.lineSoft);
    }
    let cx = M;
    row.cells.forEach((cell, cellIndex) => {
      const column = columns[cellIndex];
      addText(slide, P, cell.text, { left: cx + 9, top: y + (rowH - 22) / 2, width: column.width - 18, height: 22 }, {
        fontSize,
        autoFit: 'none',
        bold: row.kind !== 'data',
        color: cell.color ?? (row.kind === 'total' ? P.ink : row.kind === 'sub' ? P.muted : P.body),
        alignment: column.align,
      });
      cx += column.width;
    });
  });
}

/** Competência ainda não fechada — vira linha de projeção na base mensal. */
function isForecastPoint(point: InvestorPackCurvePoint): boolean {
  return point.revenueForecastCents > 0 || point.payrollForecastCents > 0;
}

const BASE_COLUMNS: TableColumn[] = [
  { label: 'Competência', width: 224, align: 'left' },
  { label: 'Faturamento', width: 248, align: 'right' },
  { label: 'Folha + encargos', width: 248, align: 'right' },
  { label: 'Saldo', width: 216, align: 'right' },
  { label: 'Acumulado', width: 216, align: 'right' },
];

const PORTFOLIO_COLUMNS: TableColumn[] = [
  { label: 'Cliente', width: 152, align: 'left' },
  { label: 'Status', width: 112, align: 'left' },
  { label: 'Carteira', width: 148, align: 'right' },
  { label: 'Faturado', width: 148, align: 'right' },
  { label: 'Backlog', width: 148, align: 'right' },
  { label: 'A receber', width: 148, align: 'right' },
  { label: 'Até 2028', width: 148, align: 'right' },
  { label: 'Pós-2028', width: 148, align: 'right' },
];

/**
 * Base mensal em uma única linha do tempo: a projeção entra na sequência
 * cronológica, aberta por uma faixa de corte e destacada por cor — a mesma
 * leitura do PDF, e não duas tabelas sobrepostas.
 */
function baseTableRows(snapshot: InvestorPackSnapshot, P: ApexPalette): TableRow[] {
  const rows: TableRow[] = [];
  let zebra = false;
  snapshot.points.forEach((point, index) => {
    const forecast = isForecastPoint(point);
    if (forecast && (index === 0 || !isForecastPoint(snapshot.points[index - 1]))) {
      rows.push({ kind: 'split', cells: [{ text: 'Projeção — competências ainda não fechadas' }] });
    }
    const fc = forecast ? P.revenueForecast : undefined;
    rows.push({
      kind: 'data',
      zebra,
      cells: [
        { text: formatInvestorPeriod(point.period) },
        { text: dashIfZero(point.revenueTotalCents, formatInvestorCurrency(point.revenueTotalCents)), color: fc },
        { text: dashIfZero(point.payrollTotalCents, formatInvestorCurrency(point.payrollTotalCents)), color: fc },
        { text: formatInvestorCurrency(point.balanceCents), color: point.balanceCents < 0 ? P.negative : P.positive },
        { text: formatInvestorCurrency(point.balanceCumulativeCents) },
      ],
    });
    zebra = !zebra;
  });

  const m = snapshot.metrics;
  const last = snapshot.points.length ? snapshot.points[snapshot.points.length - 1].balanceCumulativeCents : 0;
  rows.push({
    kind: 'sub',
    cells: [
      { text: 'Subtotal realizado' },
      { text: formatInvestorCurrency(m.revenueActualCents) },
      { text: formatInvestorCurrency(m.payrollActualCents) },
      { text: formatInvestorCurrency(m.revenueActualCents - m.payrollActualCents) },
      { text: '—' },
    ],
  });
  rows.push({
    kind: 'sub',
    cells: [
      { text: 'Subtotal projetado' },
      { text: formatInvestorCurrency(m.revenueForecastCents), color: P.revenueForecast },
      { text: formatInvestorCurrency(m.payrollForecastCents), color: P.revenueForecast },
      { text: formatInvestorCurrency(m.revenueForecastCents - m.payrollForecastCents) },
      { text: '—' },
    ],
  });
  rows.push({
    kind: 'total',
    cells: [
      { text: 'Total do recorte' },
      { text: formatInvestorCurrency(m.revenueTotalCents) },
      { text: formatInvestorCurrency(m.payrollTotalCents) },
      { text: formatInvestorCurrency(m.balanceCents) },
      { text: formatInvestorCurrency(last) },
    ],
  });
  return rows;
}

function portfolioTableRows(clients: InvestorPortfolioClient[], all: InvestorPortfolioClient[], isLast: boolean, offset: number, P: ApexPalette): TableRow[] {
  const rows: TableRow[] = clients.map((client, index) => ({
    kind: 'data' as const,
    zebra: (offset + index) % 2 === 1,
    cells: [
      { text: client.client },
      { text: client.status },
      { text: formatInvestorCurrency(client.portfolioCents) },
      { text: formatInvestorCurrency(client.billedCents) },
      { text: formatInvestorCurrency(client.backlogCents), color: P.revenueForecast },
      { text: formatInvestorCurrency(client.receivableCents) },
      { text: formatInvestorCurrency(client.projectedThrough2028Cents) },
      { text: formatInvestorCurrency(client.remainingAfter2028Cents) },
    ],
  }));
  if (!isLast) return rows;
  const sum = (pick: (client: InvestorPortfolioClient) => number) => all.reduce((total, client) => total + pick(client), 0);
  rows.push({
    kind: 'total',
    cells: [
      { text: 'Total da carteira' },
      { text: `${all.length} cliente(s)` },
      { text: formatInvestorCurrency(sum((c) => c.portfolioCents)) },
      { text: formatInvestorCurrency(sum((c) => c.billedCents)) },
      { text: formatInvestorCurrency(sum((c) => c.backlogCents)), color: P.revenueForecast },
      { text: formatInvestorCurrency(sum((c) => c.receivableCents)) },
      { text: formatInvestorCurrency(sum((c) => c.projectedThrough2028Cents)) },
      { text: formatInvestorCurrency(sum((c) => c.remainingAfter2028Cents)) },
    ],
  });
  return rows;
}

/** Reparte N itens em folhas de no máximo `max` linhas, com folhas iguais. */
function chunkEvenly<T>(items: T[], max: number): T[][] {
  const slices = Math.max(1, Math.ceil(items.length / max));
  const size = Math.ceil(items.length / slices);
  const out: T[][] = [];
  for (let i = 0; i < slices; i += 1) out.push(items.slice(i * size, (i + 1) * size));
  return out;
}

/* ── Chrome do slide ─────────────────────────────────────────── */

interface DeckContext {
  /** Paleta do material — escura (projeção) ou clara (impressão/anexo). */
  palette: ApexPalette;
  footer: string;
  /** Contadores "NN / TT": o total só é conhecido quando o deck termina. */
  counters: any[];
}

/** Base de todo slide: fundo, moldura, sobrelinha, fonte do dado e paginação. */
function baseSlide(presentation: any, ctx: DeckContext, eyebrow: string, notes?: string, opts?: { counter?: boolean }) {
  const P = ctx.palette;
  const slide = presentation.slides.add();
  slide.background.fill = P.void;

  // Moldura de cockpit + acento superior esquerdo.
  addRect(slide, { left: 22, top: 22, width: W - 44, height: H - 44 }, 'none', {
    radius: true, stroke: P.lineSoft, strokeWidth: 1,
  });
  addRect(slide, { left: 40, top: 40, width: 92, height: 2 }, P.revenue);

  if (eyebrow) {
    addText(slide, P, eyebrow.toUpperCase(), { left: M, top: HEAD_Y, width: 760, height: 24 },
      { fontSize: 13, bold: true, color: P.revenue, autoFit: 'none' });
  }
  if (opts?.counter !== false) {
    ctx.counters.push(addText(slide, P, '', { left: W - M - 120, top: HEAD_Y, width: 120, height: 24 },
      { fontSize: 12, color: P.subtle, alignment: 'right' }));
  }

  // Rodapé: marca + fonte do dado à esquerda, identificação do material à direita.
  addRect(slide, { left: M, top: FOOT_Y - 10, width: CONTENT_W, height: 1 }, P.lineSoft);
  addLogo(slide, { left: M, top: FOOT_Y + 1, height: 13, small: true });
  addText(slide, P, APEX_SOURCE, { left: M + 118, top: FOOT_Y, width: 520, height: 22 }, { fontSize: 10.5, color: P.subtle, autoFit: 'none' });
  addText(slide, P, ctx.footer, { left: W - M - 560, top: FOOT_Y, width: 560, height: 22 },
    { fontSize: 10.5, color: P.subtle, alignment: 'right', autoFit: 'none' });

  slide.speakerNotes.textFrame.setText(
    `[Fonte]\n- ${APEX_SOURCE}.\n${notes ? `\n[Leitura]\n- ${notes}\n` : ''}`,
  );
  return slide;
}

function addSectionTitle(slide: any, P: ApexPalette, title: string, sub?: string) {
  addText(slide, P, title, { left: M, top: TITLE_Y, width: CONTENT_W, height: 52 },
    { fontSize: 34, bold: true, color: P.ink });
  if (sub) {
    addText(slide, P, sub, { left: M, top: TITLE_Y + 50, width: CONTENT_W - 40, height: 40 },
      { fontSize: 15, color: P.muted });
  }
}

/**
 * Fator de desenho do gráfico dentro do quadro. Abaixo de 1 tudo — marcas,
 * eixos, meses e anos — chega maior no slide, que é lido a metros de distância
 * e não a um palmo, como a folha impressa.
 */
const CHART_SCALE = 0.78;

/** Painel de gráfico: vidro + SVG do PDF + legenda + nota opcional. */
function addChartPanel(
  slide: any,
  P: ApexPalette,
  svg: (opts: { width: number; height: number; palette: ApexPalette }) => string,
  legend: ApexLegendItem[],
  panel: Pos,
  caption?: string,
) {
  addGlass(slide, P, panel, { stroke: P.lineSoft });
  const legendWidth = panel.width - 32;
  const legendHeight = legendRows(legend, legendWidth) * LEGEND_ROW_H;
  const footer = legendHeight + 14 + (caption ? 24 : 0);
  const chart = {
    left: panel.left + 14,
    top: panel.top + 12,
    width: panel.width - 28,
    height: panel.height - 12 - footer,
  };
  // O SVG é desenhado numa viewBox menor que o quadro e sobe ao ocupá-lo: é o
  // que aumenta a fonte de eixo, mês e ano na projeção sem mexer no motor de
  // gráficos (que dimensiona rótulos a partir da própria largura, e por isso
  // não aceita só um "aumente a fonte" — as marcas do eixo colidiriam).
  addSvg(
    slide,
    P,
    svg({
      width: Math.round(chart.width * CHART_SCALE),
      height: Math.round(chart.height * CHART_SCALE),
      palette: P,
    }),
    chart,
    'Gráfico do relatório',
  );
  addLegend(slide, P, legend, panel.left + 16, chart.top + chart.height + 6, legendWidth);
  if (caption) {
    addText(slide, P, caption, { left: panel.left + 16, top: panel.top + panel.height - 28, width: panel.width - 32, height: 22 },
      { fontSize: 11.5, color: P.subtle, autoFit: 'none' });
  }
}

/* ── Deck ────────────────────────────────────────────────────── */

/** Linhas de tabela por slide (altura útil do corpo na densidade padrão). */
const BASE_ROWS_PER_SLIDE = 13;
const PORTFOLIO_ROWS_PER_SLIDE = 11;

export interface InvestorPackPptxOptions {
  /** Tema do deck. Omitido = escuro, o mesmo padrão do PDF e da apresentação. */
  theme?: ApexThemeMode;
}

/**
 * Monta o deck no objeto `Presentation` recebido. Exportado para o harness de
 * pré-visualização, que renderiza slide a slide sem escrever o .pptx.
 */
export function buildInvestorPackDeck(presentation: any, pack: InvestorPack, options?: InvestorPackPptxOptions): void {
  const P = apexPalette(options?.theme ?? 'dark');
  const snapshot = calculateInvestorPack(pack);
  const insights = buildApexInsights(snapshot);
  const { metrics, points } = snapshot;
  const period = `${formatInvestorPeriod(pack.periodStart)} — ${formatInvestorPeriod(pack.periodEnd)}`;
  const confidential = confidentialityLabel(pack.confidentiality);
  const coverTitle = investorCoverTitle(pack.title);

  const ctx: DeckContext = {
    palette: P,
    footer: `${REPORT_NAME_SHORT} · v${pack.version} · ${confidential}`,
    counters: [],
  };

  /* 01 — Capa */
  {
    const slide = baseSlide(presentation, ctx, '', insights.verdictHeadline, { counter: false });
    addLogo(slide, { left: M, top: 72, height: 46 });
    addRect(slide, { left: W - M - 196, top: 80, width: 196, height: 30 }, 'none',
      { radius: true, stroke: P.line, strokeWidth: 1 });
    addText(slide, P, confidential, { left: W - M - 196, top: 87, width: 196, height: 20 },
      { fontSize: 12, bold: true, color: P.revenue, alignment: 'center' });

    // Sem sobrelinha repetindo o nome do relatório: o título da capa já é o nome.
    addText(slide, P, coverTitle, { left: M, top: 396, width: 1000, height: 150 },
      { fontSize: 52, bold: true, color: P.ink });

    const meta: Array<[string, string]> = [
      ['Período', period],
      ['Data', formatInvestorDate(pack.referenceDate)],
      ['Preparado por', APEX_PREPARED_BY],
    ];
    meta.forEach(([label, value], index) => {
      const left = M + index * 384;
      addText(slide, P, label.toUpperCase(), { left, top: 566, width: 360, height: 20 },
        { fontSize: 11, bold: true, color: P.subtle, autoFit: 'none' });
      addText(slide, P, value, { left, top: 590, width: 360, height: 26 },
        { fontSize: 17, bold: true, color: P.body });
    });
  }

  /* 02 — Roteiro */
  {
    const slide = baseSlide(presentation, ctx, 'Roteiro da apresentação',
      'Use o roteiro para combinar o tempo de cada bloco antes de entrar nos números.');
    addSectionTitle(slide, P, 'O que esta leitura cobre');
    const agenda = apexAgenda({
      clientForecasts: pack.narrative.clientForecasts.length > 0,
      portfolio: pack.narrative.portfolio.length > 0,
    });
    const rows = Math.ceil(agenda.length / 2);
    const colW = CONTENT_W / 2 - 16;
    // Bloco centrado no corpo do slide, como o roteiro do PDF.
    const areaFrom = TITLE_Y + 74;
    const areaTo = FOOT_Y - 26;
    const rowH = Math.min(96, (areaTo - areaFrom) / rows);
    const areaTop = areaFrom + (areaTo - areaFrom - rowH * rows) / 2;
    agenda.forEach((item, index) => {
      const left = M + (index % 2) * (CONTENT_W / 2 + 16);
      const top = areaTop + Math.floor(index / 2) * rowH;
      addRect(slide, { left, top, width: colW, height: 1 }, P.lineSoft);
      addText(slide, P, String(index + 1).padStart(2, '0'), { left, top: top + 14, width: 40, height: 24 },
        { fontSize: 13, bold: true, color: P.revenue, autoFit: 'none' });
      addText(slide, P, item.title, { left: left + 42, top: top + 12, width: colW - 52, height: 28 },
        { fontSize: 19, bold: true, color: P.ink });
      addText(slide, P, item.sub, { left: left + 42, top: top + 42, width: colW - 52, height: 36 },
        { fontSize: 13.5, color: P.subtle });
    });
  }

  /* 03 — Síntese executiva */
  {
    const slide = baseSlide(presentation, ctx, 'Síntese executiva', insights.verdictHeadline);
    addText(slide, P, insights.verdictHeadline, { left: M, top: TITLE_Y, width: 792, height: 84 },
      { fontSize: 32, bold: true, color: P.ink });
    addText(slide, P, investorExecutiveSummary(pack.narrative.executiveSummary),
      { left: M, top: 182, width: 760, height: 76 }, { fontSize: 16, color: P.body });

    addBand(slide, P, { left: M, top: 262, width: 792, height: 146 }, [
      {
        label: 'Faturamento realizado',
        value: formatInvestorCurrency(metrics.revenueActualCents, true),
        accent: P.revenue,
        helper: `${insights.realizedMonths} competência(s)`,
      },
      {
        label: 'Faturamento previsto',
        value: formatInvestorCurrency(metrics.revenueForecastCents, true),
        accent: P.revenueForecast,
        helper: insights.forecastShare == null ? undefined : `${(insights.forecastShare * 100).toFixed(0)}% da receita`,
      },
      {
        label: 'Folha total',
        value: formatInvestorCurrency(metrics.payrollTotalCents, true),
        accent: P.payrollForecast,
        helper: 'fechada + projetada',
      },
      {
        label: 'Saldo acumulado',
        value: formatInvestorCurrency(insights.closingBalanceCents, true),
        accent: insights.closingBalanceCents >= 0 ? P.positive : P.negative,
        helper: 'no fecho do recorte',
      },
    ]);

    // Mostrador radial — o mesmo SVG do PDF e do deck.
    addSvg(slide, P, apexCoverageDial(metrics.coverageRatio, { size: 240, palette: P }),
      { left: 916, top: 150, width: 240, height: 240 }, 'Cobertura receita sobre folha');
    addText(slide, P, 'COBERTURA RECEITA / FOLHA', { left: 880, top: 392, width: 312, height: 24 },
      { fontSize: 11, bold: true, color: P.muted, alignment: 'center', autoFit: 'none' });
    addText(slide, P,
      `Marca central do arco = ponto de equilíbrio (1,00x). ${insights.coverageMarginPct == null
        ? 'Sem folha informada no recorte.'
        : `${insights.coverageMarginPct >= 0 ? '+' : ''}${insights.coverageMarginPct.toFixed(0)} p.p. em relação ao equilíbrio.`}`,
      { left: 880, top: 414, width: 312, height: 48 }, { fontSize: 12, color: P.subtle, alignment: 'center' });

    addBand(slide, P, { left: M, top: 464, width: CONTENT_W, height: 176 },
      insights.cards.slice(0, 4).map((card) => insightCell(card, P)), { valueSize: 19 });
  }

  /* 04 — Evolução mensal */
  {
    const slide = baseSlide(presentation, ctx, 'Evolução mensal', monthlyReading(insights));
    addSectionTitle(slide, P, 'Receita e folha, competência a competência', monthlyReading(insights));
    addChartPanel(slide, P, (opts) => apexMonthlyChart(points, opts), monthlyLegend(P),
      { left: M, top: BODY_Y, width: CONTENT_W, height: 372 });
    addReadStrip(slide, P, [
      ...(insights.peakRevenue && insights.peakRevenue.valueCents > 0
        ? [{ label: 'Pico de receita', value: `${insights.peakRevenue.label} · ${formatInvestorCurrency(insights.peakRevenue.valueCents, true)}` }] : []),
      ...(insights.peakPayroll && insights.peakPayroll.valueCents > 0
        ? [{ label: 'Pico de folha', value: `${insights.peakPayroll.label} · ${formatInvestorCurrency(insights.peakPayroll.valueCents, true)}` }] : []),
      ...(insights.tightestCoverage
        ? [{ label: 'Mês mais apertado', value: `${insights.tightestCoverage.label} · ${formatInvestorRatio(insights.tightestCoverage.ratio)}` }] : []),
      ...(insights.averageBalanceCents == null
        ? [] : [{ label: 'Saldo mensal médio', value: formatInvestorCurrency(insights.averageBalanceCents, true) }]),
    ], 566);
  }

  /* 05 — Curva mensal */
  {
    const slide = baseSlide(presentation, ctx, 'Curva mensal',
      'Traço contínuo: valores fechados. Traço tracejado: projeção ancorada na última competência realizada.');
    addSectionTitle(slide, P, 'Valores de cada competência, sem acumulação',
      'A leitura mês a mês da receita e da folha: onde cada uma sobe, onde recua e a partir de quando passam a ser projeção.');
    addChartPanel(slide, P, (opts) => apexMonthlyLineChart(points, opts), monthlyLineLegend(P),
      { left: M, top: BODY_Y, width: CONTENT_W, height: 372 },
      'Traço contínuo: valores fechados. Traço tracejado: projeção, ancorada na última competência realizada.');
    addReadStrip(slide, P, [
      ...(insights.peakRevenue && insights.peakRevenue.valueCents > 0
        ? [{ label: 'Pico de receita', value: `${insights.peakRevenue.label} · ${formatInvestorCurrency(insights.peakRevenue.valueCents, true)}` }] : []),
      ...(insights.peakPayroll && insights.peakPayroll.valueCents > 0
        ? [{ label: 'Pico de folha', value: `${insights.peakPayroll.label} · ${formatInvestorCurrency(insights.peakPayroll.valueCents, true)}` }] : []),
      { label: 'Competências realizadas', value: String(insights.realizedMonths) },
      { label: 'Competências projetadas', value: String(insights.forecastMonths) },
    ], 566);
  }

  /* 06 — Curva S */
  {
    const slide = baseSlide(presentation, ctx, 'Curva S acumulada', curveReading(insights));
    addSectionTitle(slide, P, 'A trajetória acumulada do período', curveReading(insights));
    addChartPanel(slide, P, (opts) => apexCurveChart(points, opts), curveLegend(P),
      { left: M, top: BODY_Y, width: CONTENT_W, height: 372 });
    addReadStrip(slide, P, [
      { label: 'Receita acumulada', value: formatInvestorCurrency(metrics.revenueTotalCents, true) },
      { label: 'Folha acumulada', value: formatInvestorCurrency(metrics.payrollTotalCents, true) },
      {
        label: 'Saldo no fecho',
        value: formatInvestorCurrency(insights.closingBalanceCents, true),
        color: insights.closingBalanceCents >= 0 ? P.positive : P.negative,
      },
      ...(insights.firstCumulativeDeficit
        ? [{ label: 'Acumulado negativo desde', value: insights.firstCumulativeDeficit.label, color: P.negative }] : []),
    ], 566);
  }

  /* 07 — Saldo mensal e acumulado */
  {
    const sub = insights.deficitMonths.length
      ? `${insights.deficitMonths.length} competência(s) com saldo mensal negativo: ${insights.deficitMonths.map((m) => m.label).join(', ')}.`
      : 'Nenhuma competência do recorte fecha com saldo mensal negativo.';
    const slide = baseSlide(presentation, ctx, 'Saldo mensal e acumulado', sub);
    addSectionTitle(slide, P, 'Onde o período gera e onde consome resultado', sub);
    addChartPanel(slide, P, (opts) => apexBalanceChart(points, opts), balanceLegend(P),
      { left: M, top: BODY_Y, width: CONTENT_W, height: 372 },
      'Colunas: saldo do mês (eixo esquerdo). Linha: saldo acumulado (eixo direito).');
    addReadStrip(slide, P, [
      ...(insights.bestBalance
        ? [{ label: 'Melhor mês', value: `${insights.bestBalance.label} · ${formatInvestorCurrency(insights.bestBalance.valueCents, true)}`, color: P.positive }] : []),
      ...(insights.worstBalance
        ? [{
          label: 'Pior mês',
          value: `${insights.worstBalance.label} · ${formatInvestorCurrency(insights.worstBalance.valueCents, true)}`,
          color: insights.worstBalance.valueCents < 0 ? P.negative : P.body,
        }] : []),
      { label: 'Competências no recorte', value: String(points.length) },
    ], 566);
  }

  /* 08 — Projeção por cliente */
  if (pack.narrative.clientForecasts.length) {
    const slide = baseSlide(presentation, ctx, 'Projeção por cliente',
      'Cada série identifica o cliente que compõe o faturamento previsto.');
    addSectionTitle(slide, P, 'Quem compõe o faturamento projetado', APEX_CLIENT_FORECAST_DESCRIPTION);
    const clientIds = [...new Map(pack.narrative.clientForecasts.map((item) => [item.clientId, item.client])).entries()];
    addChartPanel(
      slide,
      P,
      (opts) => apexClientForecastChart(pack.narrative.clientForecasts, points.map((point) => point.period), opts),
      clientIds.map(([clientId, client], index) => ({ label: client, color: clientForecastColor(clientId, index, P) })),
      { left: M, top: BODY_Y, width: CONTENT_W, height: 468 },
    );
  }

  /* 09+ — Base mensal informada */
  {
    const slices = chunkEvenly(baseTableRows(snapshot, P), BASE_ROWS_PER_SLIDE);
    slices.forEach((rows, index) => {
      const slide = baseSlide(presentation, ctx, 'Base mensal informada',
        'Todos os valores que sustentam os gráficos anteriores.');
      addSectionTitle(
        slide,
        P,
        index === 0 ? 'Todos os valores por trás dos gráficos' : 'Base mensal informada — continuação',
        index === 0
          ? `${APEX_SOURCE}. As competências projetadas seguem na sequência cronológica, destacadas em cor.`
          : `Continuação da base: folha ${index + 1} de ${slices.length}.`,
      );
      addTable(slide, P, BASE_COLUMNS, rows, BODY_Y + 4, 33, 14);
    });
  }

  /* 10+ — Carteira e recebíveis */
  if (pack.narrative.portfolio.length) {
    const slices = chunkEvenly(pack.narrative.portfolio, PORTFOLIO_ROWS_PER_SLIDE);
    slices.forEach((clients, index) => {
      const isLast = index === slices.length - 1;
      const slide = baseSlide(presentation, ctx, 'Carteira e recebíveis',
        'Base contratual usada para limitar e distribuir a projeção.');
      addSectionTitle(
        slide,
        P,
        index === 0 ? 'Backlog que sustenta a projeção' : 'Carteira e recebíveis — continuação',
        'Saldo a receber conforme informado na carteira; não equivale necessariamente a caixa recebido.',
      );
      addTable(
        slide,
        P,
        PORTFOLIO_COLUMNS,
        portfolioTableRows(clients, pack.narrative.portfolio, isLast, index * PORTFOLIO_ROWS_PER_SLIDE, P),
        BODY_Y + 4,
        36,
        12.5,
      );
    });
  }

  /* Último — Fecho institucional (só a marca centralizada, igual ao PDF) */
  {
    const slide = baseSlide(presentation, ctx, '', investorClosingMessage(pack.narrative.closingMessage));
    addLogo(slide, { left: (W - 620) / 2, top: (H - 620 / APEX_LOGO_ASPECT) / 2, height: 620 / APEX_LOGO_ASPECT });
  }

  const total = ctx.counters.length + 1; // a capa não numera, mas conta no total
  ctx.counters.forEach((shape, index) => {
    shape.text = `${String(index + 2).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
    shape.text.style = { fontFamily: FONT, fontSize: 12, color: P.subtle, alignment: 'right', autoFit: 'shrinkText' };
  });
}

export async function generateInvestorPackPptx(pack: InvestorPack, options?: InvestorPackPptxOptions): Promise<Uint8Array> {
  const { Presentation, PresentationFile } = await loadArtifactTool();
  const presentation = Presentation.create({ slideSize: { width: W, height: H } });
  buildInvestorPackDeck(presentation, pack, options);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'financial-projection-'));
  const output = path.join(tempDir, 'projecao-financeira.pptx');
  try {
    const pptx = await PresentationFile.exportPptx(presentation);
    await pptx.save(output);
    return new Uint8Array(await fs.readFile(output));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
