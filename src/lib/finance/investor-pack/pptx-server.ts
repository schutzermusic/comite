/**
 * Apex PPTX — Relatório de Faturamento vs Folha de Pagamento em PowerPoint
 * (execução no servidor).
 *
 * Mesma direção visual e mesma narrativa do deck HTML e do PDF (tokens de
 * `apex-theme`, leitura de `apex-insights`), com uma diferença deliberada: os
 * gráficos são objetos de gráfico nativos do PowerPoint, editáveis por quem
 * recebe o arquivo — é isso que um material de board precisa.
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
import { clientForecastColor } from './apex-charts';
import {
  APEX,
  APEX_CLIENT_FORECAST_DESCRIPTION,
  APEX_CLOSING_TITLE,
  APEX_SOURCE,
  REPORT_NAME,
  REPORT_NAME_SHORT,
  SERIES_LABEL,
  confidentialityLabel,
  investorClosingMessage,
} from './apex-theme';
import { calculateInvestorPack, centsToReais, formatInvestorCurrency, formatInvestorPeriod } from './calculations';
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
const TITLE_Y = 88;      // título da seção
const BODY_Y = 190;      // início do corpo
const FOOT_Y = 664;      // rodapé
const FONT = 'Aptos';

type Pos = { left: number; top: number; width: number; height: number };

function addText(slide: any, text: string, position: Pos, style: Record<string, unknown> = {}) {
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
    color: APEX.ink,
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

/** Painel de vidro: retângulo tintado com contorno sutil + faixa de acento. */
function addPanel(slide: any, position: Pos, accent?: string) {
  addRect(slide, position, APEX.panelTop, { radius: true, stroke: APEX.line, strokeWidth: 1 });
  if (accent) {
    addRect(slide, { left: position.left, top: position.top, width: position.width, height: 3 }, accent);
  }
}

/** Base de todo slide: fundo, moldura, sobrelinha, fonte do dado e paginação. */
function baseSlide(presentation: any, ctx: DeckContext, eyebrow: string, notes?: string) {
  const slide = presentation.slides.add();
  slide.background.fill = APEX.void;

  // Moldura de cockpit + acento superior esquerdo.
  addRect(slide, { left: 22, top: 22, width: W - 44, height: H - 44 }, 'none', {
    radius: true, stroke: APEX.lineSoft, strokeWidth: 1,
  });
  addRect(slide, { left: 40, top: 40, width: 92, height: 2 }, APEX.revenue);

  ctx.number += 1;
  if (eyebrow) {
    addText(slide, eyebrow.toUpperCase(), { left: M, top: HEAD_Y, width: 760, height: 24 },
      { fontSize: 11, bold: true, color: APEX.revenue });
  }
  addText(slide, `${String(ctx.number).padStart(2, '0')} / ${String(ctx.total).padStart(2, '0')}`,
    { left: W - M - 120, top: HEAD_Y, width: 120, height: 24 },
    { fontSize: 11, color: APEX.subtle, alignment: 'right' });

  // Rodapé: marca + fonte do dado à esquerda, identificação do material à direita.
  addRect(slide, { left: M, top: FOOT_Y - 10, width: CONTENT_W, height: 1 }, APEX.lineSoft);
  addLogo(slide, { left: M, top: FOOT_Y + 1, height: 13, small: true });
  addText(slide, APEX_SOURCE, { left: M + 118, top: FOOT_Y, width: 520, height: 22 }, { fontSize: 9, color: APEX.subtle });
  addText(slide, ctx.footer, { left: W - M - 560, top: FOOT_Y, width: 560, height: 22 },
    { fontSize: 9, color: APEX.subtle, alignment: 'right' });

  slide.speakerNotes.textFrame.setText(
    `[Fonte]\n- ${APEX_SOURCE}.\n${notes ? `\n[Leitura]\n- ${notes}\n` : ''}`,
  );
  return slide;
}

function addSectionTitle(slide: any, title: string, sub?: string) {
  addText(slide, title, { left: M, top: TITLE_Y, width: CONTENT_W, height: 76 },
    { fontSize: 34, bold: true, color: APEX.ink });
  if (sub) {
    addText(slide, sub, { left: M, top: TITLE_Y + 74, width: CONTENT_W - 40, height: 40 },
      { fontSize: 14, color: APEX.muted });
  }
}

/** Cartão de valor (KPI) — acento no topo, valor colorido, rótulo em caixa alta. */
function addTile(slide: any, position: Pos, label: string, value: string, accent: string, helper?: string) {
  addPanel(slide, position, accent);
  addText(slide, label.toUpperCase(), { left: position.left + 14, top: position.top + 14, width: position.width - 28, height: 20 },
    { fontSize: 9, bold: true, color: APEX.subtle });
  addText(slide, value, { left: position.left + 14, top: position.top + 36, width: position.width - 28, height: 40 },
    { fontSize: 24, bold: true, color: accent });
  if (helper) {
    addText(slide, helper, { left: position.left + 14, top: position.top + 78, width: position.width - 28, height: 20 },
      { fontSize: 9, color: APEX.subtle });
  }
}

/** Medidor linear de cobertura (o equivalente PPTX do mostrador radial). */
function addCoverageMeter(slide: any, position: Pos, insights: ApexInsights, ratio: number | null) {
  const accent = ratio == null ? APEX.muted : ratio >= 1.15 ? APEX.positive : ratio >= 1 ? APEX.attention : APEX.negative;
  addPanel(slide, position, accent);

  addText(slide, 'COBERTURA RECEITA / FOLHA', { left: position.left + 18, top: position.top + 16, width: position.width - 36, height: 20 },
    { fontSize: 9, bold: true, color: APEX.subtle });
  addText(slide, insights.coverageLabel, { left: position.left + 18, top: position.top + 38, width: position.width - 36, height: 60 },
    { fontSize: 44, bold: true, color: accent });
  addText(slide, insights.verdictLabel, { left: position.left + 18, top: position.top + 100, width: position.width - 36, height: 24 },
    { fontSize: 12, bold: true, color: APEX.body });

  // Trilha 0–2,00x com marca do ponto de equilíbrio (1,00x) no meio.
  const trackY = position.top + 138;
  const trackW = position.width - 36;
  addRect(slide, { left: position.left + 18, top: trackY, width: trackW, height: 8 }, APEX.lineSoft, { radius: true });
  const fill = ratio == null ? 0 : Math.max(0, Math.min(1, ratio / 2));
  if (fill > 0) {
    addRect(slide, { left: position.left + 18, top: trackY, width: Math.max(6, trackW * fill), height: 8 }, accent, { radius: true });
  }
  addRect(slide, { left: position.left + 18 + trackW / 2 - 1, top: trackY - 5, width: 2, height: 18 }, APEX.ink);
  addText(slide, 'escala 0 — 2,00x · marca central = ponto de equilíbrio (1,00x)',
    { left: position.left + 18, top: trackY + 18, width: trackW, height: 30 },
    { fontSize: 9, color: APEX.subtle });
}

function addInsightCard(slide: any, position: Pos, card: ApexInsightCard) {
  const accent = card.kind === 'alert' ? APEX.negative : card.kind === 'watch' ? APEX.attention : APEX.revenue;
  const kindLabel = card.kind === 'alert' ? 'ATENÇÃO' : card.kind === 'watch' ? 'MONITORAR' : 'SINAL';
  addPanel(slide, position, accent);
  addText(slide, kindLabel, { left: position.left + 14, top: position.top + 14, width: position.width - 28, height: 18 },
    { fontSize: 8, bold: true, color: accent });
  addText(slide, card.value, { left: position.left + 14, top: position.top + 34, width: position.width - 28, height: 42 },
    { fontSize: 21, bold: true, color: APEX.ink });
  addText(slide, card.label.toUpperCase(), { left: position.left + 14, top: position.top + 76, width: position.width - 28, height: 22 },
    { fontSize: 9, bold: true, color: APEX.muted });
  addText(slide, card.detail, { left: position.left + 14, top: position.top + 100, width: position.width - 28, height: 76 },
    { fontSize: 10, color: APEX.subtle });
}

/** Estilo comum dos eixos/legenda para os gráficos nativos. */
function chartChrome() {
  return {
    legend: { position: 'bottom', overlay: false, textStyle: { fill: APEX.muted, fontSize: 12 } },
    xAxis: { textStyle: { fill: APEX.muted, fontSize: 11 }, line: { style: 'solid', fill: APEX.line, width: 1 } },
    yAxis: {
      numberFormatCode: 'R$ #,##0,," mi"',
      textStyle: { fill: APEX.muted, fontSize: 11 },
      majorGridlines: { style: 'solid', fill: APEX.lineSoft, width: 1 },
    },
    chartFill: APEX.void,
    chartLine: { style: 'solid', fill: APEX.void, width: 0 },
    plotAreaFill: { type: 'none' },
  };
}

/** Tabela leve construída com formas — o artifact-tool não tem objeto de tabela. */
function addBaseTable(slide: any, points: InvestorPackCurvePoint[], top: number) {
  const cols = [
    { label: 'Competência', width: 150, align: 'left' as const },
    { label: 'Fat. realizado', width: 175, align: 'right' as const },
    { label: 'Fat. previsto', width: 175, align: 'right' as const },
    { label: 'Folha + encargos', width: 175, align: 'right' as const },
    { label: 'Folha projetada', width: 175, align: 'right' as const },
    { label: 'Saldo', width: 160, align: 'right' as const },
    { label: 'Acumulado', width: 142, align: 'right' as const },
  ];
  const rowH = 30;

  addRect(slide, { left: M, top, width: CONTENT_W, height: rowH }, APEX.panelTop, { stroke: APEX.line, strokeWidth: 1 });
  let x = M;
  cols.forEach((col) => {
    addText(slide, col.label.toUpperCase(), { left: x + 8, top: top + 8, width: col.width - 16, height: 18 },
      { fontSize: 8, bold: true, color: APEX.muted, alignment: col.align });
    x += col.width;
  });

  points.forEach((point, index) => {
    const rowY = top + rowH + index * rowH;
    if (index % 2 === 1) {
      addRect(slide, { left: M, top: rowY, width: CONTENT_W, height: rowH }, APEX.panelBottom);
    }
    const cells: Array<[string, string]> = [
      [formatInvestorPeriod(point.period), APEX.ink],
      [formatInvestorCurrency(point.revenueActualCents), APEX.body],
      [formatInvestorCurrency(point.revenueForecastCents), APEX.revenueForecast],
      [formatInvestorCurrency(point.payrollActualCents), APEX.body],
      [formatInvestorCurrency(point.payrollForecastCents), APEX.payrollForecast],
      [formatInvestorCurrency(point.balanceCents), point.balanceCents >= 0 ? APEX.positive : APEX.negative],
      [formatInvestorCurrency(point.balanceCumulativeCents), APEX.body],
    ];
    let cx = M;
    cells.forEach(([value, color], cellIndex) => {
      const col = cols[cellIndex];
      addText(slide, value, { left: cx + 8, top: rowY + 7, width: col.width - 16, height: 18 },
        { fontSize: 10, color, alignment: col.align });
      cx += col.width;
    });
  });
}

function addPortfolioTable(slide: any, clients: InvestorPortfolioClient[], top: number) {
  const cols = [
    { label: 'Cliente', width: 150, align: 'left' as const },
    { label: 'Status', width: 180, align: 'left' as const },
    { label: 'Carteira', width: 135, align: 'right' as const },
    { label: 'Faturado', width: 135, align: 'right' as const },
    { label: 'Backlog', width: 135, align: 'right' as const },
    { label: 'A receber', width: 135, align: 'right' as const },
    { label: 'Até 2028', width: 135, align: 'right' as const },
    { label: 'Pós-2028', width: 147, align: 'right' as const },
  ];
  const rowH = 32;
  addRect(slide, { left: M, top, width: CONTENT_W, height: rowH }, APEX.panelTop, { stroke: APEX.line, strokeWidth: 1 });
  let x = M;
  cols.forEach((col) => {
    addText(slide, col.label.toUpperCase(), { left: x + 6, top: top + 9, width: col.width - 12, height: 18 },
      { fontSize: 7.5, bold: true, color: APEX.muted, alignment: col.align });
    x += col.width;
  });
  clients.forEach((client, index) => {
    const rowY = top + rowH + index * rowH;
    if (index % 2 === 1) addRect(slide, { left: M, top: rowY, width: CONTENT_W, height: rowH }, APEX.panelBottom);
    const values = [
      client.client,
      client.status,
      formatInvestorCurrency(client.portfolioCents, true),
      formatInvestorCurrency(client.billedCents, true),
      formatInvestorCurrency(client.backlogCents, true),
      formatInvestorCurrency(client.receivableCents, true),
      formatInvestorCurrency(client.projectedThrough2028Cents, true),
      formatInvestorCurrency(client.remainingAfter2028Cents, true),
    ];
    let cx = M;
    values.forEach((value, cellIndex) => {
      const col = cols[cellIndex];
      addText(slide, value, { left: cx + 6, top: rowY + 8, width: col.width - 12, height: 18 },
        { fontSize: 8.5, color: cellIndex === 4 ? APEX.revenueForecast : APEX.body, alignment: col.align });
      cx += col.width;
    });
  });
}

interface DeckContext {
  number: number;
  total: number;
  footer: string;
}

/** Linhas da base por slide — acima disso a tabela continua no slide seguinte. */
const TABLE_ROWS_PER_SLIDE = 12;

function countSlides(snapshot: InvestorPackSnapshot): number {
  const tableSlides = Math.max(1, Math.ceil(snapshot.points.length / TABLE_ROWS_PER_SLIDE));
  const clientSlide = snapshot.pack.narrative.clientForecasts.length ? 1 : 0;
  const portfolioSlides = Math.ceil(snapshot.pack.narrative.portfolio.length / 10);
  // capa + roteiro + síntese + leitura + mensal + curva S + saldo + base(n) + fecho
  return 8 + tableSlides + clientSlide + portfolioSlides;
}

export async function generateInvestorPackPptx(pack: InvestorPack): Promise<Uint8Array> {
  const { Presentation, PresentationFile } = await loadArtifactTool();
  const presentation = Presentation.create({ slideSize: { width: W, height: H } });

  const snapshot = calculateInvestorPack(pack);
  const insights = buildApexInsights(snapshot);
  const { metrics, points } = snapshot;
  const labels = points.map((point) => formatInvestorPeriod(point.period));
  const period = `${formatInvestorPeriod(pack.periodStart)} — ${formatInvestorPeriod(pack.periodEnd)}`;
  const confidential = confidentialityLabel(pack.confidentiality);
  const verdictAccent = insights.verdict === 'deficit'
    ? APEX.negative
    : insights.verdict === 'balanced' ? APEX.attention : APEX.revenue;

  const ctx: DeckContext = {
    number: 0,
    total: countSlides(snapshot),
    footer: `${REPORT_NAME_SHORT} · ${pack.title} · v${pack.version} · ${confidential}`,
  };

  /* 01 — Capa */
  {
    const slide = baseSlide(presentation, ctx, '', insights.verdictHeadline);
    addLogo(slide, { left: M, top: HEAD_Y - 8, height: 40 });
    addText(slide, confidential, { left: W - M - 260, top: HEAD_Y - 2, width: 260, height: 26 },
      { fontSize: 10, bold: true, color: APEX.revenue, alignment: 'right' });

    addRect(slide, { left: M + 2, top: 168, width: 150, height: 3 }, APEX.revenue);
    addText(slide, REPORT_NAME.toUpperCase(), { left: M, top: 180, width: 900, height: 22 },
      { fontSize: 11, bold: true, color: APEX.revenue });
    addText(slide, pack.title, { left: M, top: 206, width: 900, height: 136 },
      { fontSize: 48, bold: true, color: APEX.ink });
    addText(slide, pack.company || 'Visão financeira executiva', { left: M + 2, top: 340, width: 800, height: 44 },
      { fontSize: 22, color: APEX.muted });

    // Bloco de veredito: o número que resume o material.
    addPanel(slide, { left: M, top: 400, width: 360, height: 108 }, verdictAccent);
    addText(slide, insights.coverageLabel, { left: M + 20, top: 416, width: 200, height: 60 },
      { fontSize: 40, bold: true, color: verdictAccent });
    addText(slide, `${insights.verdictLabel}\nCOBERTURA RECEITA / FOLHA`, { left: M + 190, top: 424, width: 158, height: 66 },
      { fontSize: 10, bold: true, color: APEX.body });

    const tileW = 176;
    const tiles: Array<[string, string, string]> = [
      ['Fat. realizado', formatInvestorCurrency(metrics.revenueActualCents, true), APEX.revenue],
      ['Fat. previsto', formatInvestorCurrency(metrics.revenueForecastCents, true), APEX.revenueForecast],
      ['Folha total', formatInvestorCurrency(metrics.payrollTotalCents, true), APEX.payrollForecast],
      ['Saldo acumulado', formatInvestorCurrency(insights.closingBalanceCents, true), insights.closingBalanceCents >= 0 ? APEX.positive : APEX.negative],
    ];
    tiles.forEach(([label, value, accent], index) => {
      addTile(slide, { left: 464 + index * (tileW + 12), top: 400, width: tileW, height: 108 }, label, value, accent);
    });

    const meta: Array<[string, string]> = [
      ['Período', period],
      ['Data-base', pack.referenceDate],
      ['Versão', `${pack.version} · ${pack.status === 'published' ? 'Publicado' : pack.status === 'archived' ? 'Arquivado' : 'Rascunho'}`],
      ['Preparado por', pack.authorName || 'Financeiro'],
      ['Competências', String(points.length)],
    ];
    meta.forEach(([label, value], index) => {
      const left = M + (index % 3) * 384;
      const top = 546 + Math.floor(index / 3) * 46;
      addText(slide, label.toUpperCase(), { left, top, width: 360, height: 16 }, { fontSize: 8, bold: true, color: APEX.subtle });
      addText(slide, value, { left, top: top + 16, width: 360, height: 24 }, { fontSize: 12, bold: true, color: APEX.body });
    });
  }

  /* 02 — Roteiro */
  {
    const slide = baseSlide(presentation, ctx, 'Roteiro', 'Use o roteiro para combinar o tempo de cada bloco antes de entrar nos números.');
    addSectionTitle(slide, 'O que esta leitura cobre');
    const agenda: Array<[string, string]> = [
      ['Síntese executiva', 'Cobertura, saldo e o número que resume o período'],
      ['Leitura do período', 'Sinais, pontos de atenção e concentrações'],
      ['Evolução mensal', 'Receita e folha competência a competência'],
      ['Curva S acumulada', 'Trajetória e zona de previsão'],
      ['Saldo e acumulado', 'Onde o período gera e onde consome resultado'],
      ['Projeção por cliente', 'Composição do faturamento projetado'],
      ['Base informada', 'Todos os valores que sustentam os gráficos'],
      ['Perspectiva', 'Mensagem de fecho e próximos passos'],
    ];
    agenda.forEach(([title, sub], index) => {
      const left = M + (index % 2) * (CONTENT_W / 2 + 12);
      const top = BODY_Y + Math.floor(index / 2) * 96;
      addRect(slide, { left, top, width: CONTENT_W / 2 - 12, height: 1 }, APEX.lineSoft);
      addText(slide, String(index + 1).padStart(2, '0'), { left, top: top + 14, width: 40, height: 24 },
        { fontSize: 11, bold: true, color: APEX.revenue });
      addText(slide, title, { left: left + 44, top: top + 12, width: CONTENT_W / 2 - 70, height: 28 },
        { fontSize: 17, bold: true, color: APEX.ink });
      addText(slide, sub, { left: left + 44, top: top + 40, width: CONTENT_W / 2 - 70, height: 34 },
        { fontSize: 11, color: APEX.subtle });
    });
  }

  /* 03 — Síntese executiva */
  {
    const slide = baseSlide(presentation, ctx, 'Síntese executiva', insights.verdictHeadline);
    addSectionTitle(slide, insights.verdictHeadline);
    addText(slide, pack.narrative.executiveSummary || 'Resumo executivo não informado.',
      { left: M, top: BODY_Y + 6, width: 700, height: 120 }, { fontSize: 14, color: APEX.body });

    const tileW = 168;
    const tiles: Array<[string, string, string, string | undefined]> = [
      ['Fat. realizado', formatInvestorCurrency(metrics.revenueActualCents, true), APEX.revenue, `${insights.realizedMonths} competência(s)`],
      ['Fat. previsto', formatInvestorCurrency(metrics.revenueForecastCents, true), APEX.revenueForecast,
        insights.forecastShare == null ? undefined : `${(insights.forecastShare * 100).toFixed(0)}% da receita`],
      ['Folha total', formatInvestorCurrency(metrics.payrollTotalCents, true), APEX.payrollForecast, 'fechada + projetada'],
      ['Saldo acumulado', formatInvestorCurrency(insights.closingBalanceCents, true),
        insights.closingBalanceCents >= 0 ? APEX.positive : APEX.negative, 'no fecho do recorte'],
    ];
    tiles.forEach(([label, value, accent, helper], index) => {
      addTile(slide, { left: M + index * (tileW + 12), top: 356, width: tileW, height: 116 }, label, value, accent, helper);
    });

    addCoverageMeter(slide, { left: 792, top: BODY_Y + 6, width: 424, height: 260 }, insights, metrics.coverageRatio);
    addText(slide,
      insights.coverageMarginPct == null
        ? 'Sem folha informada no recorte.'
        : `${insights.coverageMarginPct >= 0 ? '+' : ''}${insights.coverageMarginPct.toFixed(0)} p.p. em relação ao ponto de equilíbrio.`,
      { left: 792, top: 480, width: 424, height: 40 }, { fontSize: 11, color: APEX.muted });
  }

  /* 04 — Leitura do período */
  {
    const slide = baseSlide(presentation, ctx, 'Leitura do período', 'Cada cartão é leitura direta dos valores informados — nada é estimado.');
    addSectionTitle(slide, 'Os sinais que sustentam a conversa');
    const cards = insights.cards.slice(0, 4);
    const cardW = (CONTENT_W - 3 * 14) / 4;
    cards.forEach((card, index) => {
      addInsightCard(slide, { left: M + index * (cardW + 14), top: BODY_Y + 20, width: cardW, height: 216 }, card);
    });
    if (insights.cards.length > 4) {
      const extra = insights.cards.slice(4, 6);
      extra.forEach((card, index) => {
        addInsightCard(slide, { left: M + index * (cardW * 2 + 14), top: BODY_Y + 252, width: cardW * 2, height: 148 }, card);
      });
    }
  }

  /* 06 — Evolução mensal */
  {
    const slide = baseSlide(presentation, ctx, 'Evolução mensal', monthlyReading(insights));
    addSectionTitle(slide, 'Receita e folha, competência a competência', monthlyReading(insights));
    slide.charts.add('bar', {
      position: { left: M, top: BODY_Y + 56, width: CONTENT_W, height: 372 },
      categories: labels,
      series: [
        { name: SERIES_LABEL.revenueActual, values: points.map((p) => centsToReais(p.revenueActualCents)), fill: APEX.revenue },
        { name: SERIES_LABEL.revenueForecast, values: points.map((p) => centsToReais(p.revenueForecastCents)), fill: APEX.revenueForecast },
        { name: SERIES_LABEL.payrollActual, values: points.map((p) => centsToReais(p.payrollActualCents)), fill: APEX.payroll },
        { name: SERIES_LABEL.payrollForecast, values: points.map((p) => centsToReais(p.payrollForecastCents)), fill: APEX.payrollForecast },
      ],
      barOptions: { direction: 'column', grouping: 'clustered', gapWidth: 42 },
      ...chartChrome(),
    });
  }

  /* 06 — Curva S */
  {
    const slide = baseSlide(presentation, ctx, 'Curva S acumulada', curveReading(insights));
    addSectionTitle(slide, 'A trajetória acumulada do período', curveReading(insights));
    slide.charts.add('line', {
      position: { left: M, top: BODY_Y + 56, width: CONTENT_W, height: 372 },
      categories: labels,
      series: [
        {
          name: SERIES_LABEL.revenueCumulative,
          values: points.map((p) => centsToReais(p.revenueCumulativeCents)),
          line: { style: 'solid', fill: APEX.revenue, width: 4 },
        },
        {
          name: SERIES_LABEL.payrollCumulative,
          values: points.map((p) => centsToReais(p.payrollCumulativeCents)),
          line: { style: 'solid', fill: APEX.payroll, width: 3 },
        },
        {
          name: SERIES_LABEL.balanceCumulative,
          values: points.map((p) => centsToReais(p.balanceCumulativeCents)),
          line: { style: 'dash', fill: APEX.balance, width: 3 },
        },
      ],
      ...chartChrome(),
    });
  }

  /* 07 — Saldo mensal */
  {
    const slide = baseSlide(presentation, ctx, 'Saldo mensal', 'Colunas acima de zero geram resultado; abaixo, consomem.');
    const sub = insights.deficitMonths.length
      ? `${insights.deficitMonths.length} competência(s) com saldo mensal negativo: ${insights.deficitMonths.map((m) => m.label).join(', ')}.`
      : 'Nenhuma competência do recorte fecha com saldo mensal negativo.';
    addSectionTitle(slide, 'Onde o período gera e onde consome resultado', sub);
    slide.charts.add('bar', {
      position: { left: M, top: BODY_Y + 56, width: 840, height: 340 },
      categories: labels,
      series: [
        { name: SERIES_LABEL.balance, values: points.map((p) => centsToReais(p.balanceCents)), fill: APEX.balance },
      ],
      barOptions: { direction: 'column', grouping: 'clustered', gapWidth: 60 },
      ...chartChrome(),
    });

    const reads: Array<[string, string, string]> = [];
    if (insights.bestBalance) {
      reads.push(['Melhor mês', `${insights.bestBalance.label} · ${formatInvestorCurrency(insights.bestBalance.valueCents, true)}`, APEX.positive]);
    }
    if (insights.worstBalance) {
      reads.push(['Pior mês', `${insights.worstBalance.label} · ${formatInvestorCurrency(insights.worstBalance.valueCents, true)}`,
        insights.worstBalance.valueCents < 0 ? APEX.negative : APEX.body]);
    }
    reads.push(['Saldo acumulado no fecho', formatInvestorCurrency(insights.closingBalanceCents, true),
      insights.closingBalanceCents >= 0 ? APEX.positive : APEX.negative]);
    if (insights.averageBalanceCents != null) {
      reads.push(['Saldo mensal médio', formatInvestorCurrency(insights.averageBalanceCents, true), APEX.body]);
    }
    reads.slice(0, 4).forEach(([label, value, color], index) => {
      const top = BODY_Y + 56 + index * 86;
      addPanel(slide, { left: 940, top, width: 276, height: 74 }, color);
      addText(slide, label.toUpperCase(), { left: 956, top: top + 14, width: 244, height: 18 },
        { fontSize: 8, bold: true, color: APEX.subtle });
      addText(slide, value, { left: 956, top: top + 34, width: 244, height: 28 },
        { fontSize: 15, bold: true, color });
    });
  }

  /* Último gráfico — projeção por cliente */
  if (pack.narrative.clientForecasts.length) {
    const slide = baseSlide(presentation, ctx, 'Projeção por cliente', 'Cada série identifica o cliente que compõe o faturamento previsto.');
    addSectionTitle(slide, 'Quem compõe o faturamento projetado', APEX_CLIENT_FORECAST_DESCRIPTION);
    const forecastPeriods = points.filter((point) => point.period >= '2026-07').map((point) => point.period);
    const clients = [...new Map(pack.narrative.clientForecasts.map((item) => [item.clientId, item.client])).entries()]
      .filter(([id]) => pack.narrative.clientForecasts.some((item) => item.clientId === id && forecastPeriods.includes(item.period)));
    slide.charts.add('bar', {
      position: { left: M, top: BODY_Y + 50, width: CONTENT_W, height: 378 },
      categories: forecastPeriods.map(formatInvestorPeriod),
      series: clients.map(([clientId, client], index) => ({
        name: client,
        values: forecastPeriods.map((period) => centsToReais(
          pack.narrative.clientForecasts
            .filter((item) => item.clientId === clientId && item.period === period)
            .reduce((sum, item) => sum + item.amountCents, 0),
        )),
        fill: clientForecastColor(clientId, index, APEX),
      })),
      barOptions: { direction: 'column', grouping: 'stacked', gapWidth: 34 },
      ...chartChrome(),
    });
  }

  /* 08+ — Base mensal informada */
  {
    const slices = Math.max(1, Math.ceil(points.length / TABLE_ROWS_PER_SLIDE));
    for (let i = 0; i < slices; i += 1) {
      const slice = points.slice(i * TABLE_ROWS_PER_SLIDE, (i + 1) * TABLE_ROWS_PER_SLIDE);
      const slide = baseSlide(presentation, ctx, 'Base mensal informada', 'Todos os valores que sustentam os gráficos anteriores.');
      addSectionTitle(
        slide,
        i === 0 ? 'Todos os valores por trás dos gráficos' : 'Base mensal informada (continuação)',
        i === 0
          ? 'Previsões destacadas em azul e âmbar. Valores em BRL.'
          : `Competências ${i * TABLE_ROWS_PER_SLIDE + 1} a ${i * TABLE_ROWS_PER_SLIDE + slice.length} de ${points.length}.`,
      );
      addBaseTable(slide, slice, BODY_Y + 56);
    }
  }

  /* 09 — Premissas, riscos e destaques */
  if (pack.narrative.portfolio.length) {
    const slices = Math.ceil(pack.narrative.portfolio.length / 10);
    for (let index = 0; index < slices; index += 1) {
      const slice = pack.narrative.portfolio.slice(index * 10, (index + 1) * 10);
      const slide = baseSlide(presentation, ctx, 'Carteira e recebíveis', 'Base contratual usada para limitar e distribuir a projeção.');
      addSectionTitle(
        slide,
        index === 0 ? 'Backlog que sustenta a projeção' : 'Carteira e recebíveis (continuação)',
        'Saldo a receber conforme informado na carteira; não equivale necessariamente a caixa recebido.',
      );
      addPortfolioTable(slide, slice, BODY_Y + 52);
    }
  }

  /* 10 — Fecho */
  {
    const slide = baseSlide(presentation, ctx, 'Perspectiva', investorClosingMessage(pack.narrative.closingMessage));
    addRect(slide, { left: M + 2, top: 168, width: 160, height: 3 }, APEX.revenue);
    addText(slide, APEX_CLOSING_TITLE,
      { left: M, top: 192, width: 940, height: 140 }, { fontSize: 40, bold: true, color: APEX.ink });
    addRect(slide, { left: M, top: 360, width: 2, height: 120 }, APEX.revenue);
    addText(slide,
      investorClosingMessage(pack.narrative.closingMessage),
      { left: M + 22, top: 360, width: 880, height: 124 }, { fontSize: 20, color: APEX.body });

    const sign: Array<[string, string]> = [
      ['Preparado por', pack.authorName || 'Financeiro'],
      ['Data-base', pack.referenceDate],
      ['Classificação', confidential],
    ];
    sign.forEach(([label, value], index) => {
      const left = M + index * 288;
      addText(slide, label.toUpperCase(), { left, top: 528, width: 270, height: 16 },
        { fontSize: 8, bold: true, color: APEX.subtle });
      addText(slide, value, { left, top: 546, width: 270, height: 24 },
        { fontSize: 13, bold: true, color: APEX.body });
    });
  }

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
