import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { calculateInvestorPack, centsToReais, formatInvestorCurrency, formatInvestorPeriod } from './calculations';
import type { InvestorPack } from './types';

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

const W = 1280;
const H = 720;
const C = {
  bg: '#071014',
  panel: '#10252B',
  text: '#F4FBFA',
  muted: '#91AAA8',
  mint: '#35E6BB',
  blue: '#51A8FF',
  amber: '#FFBD59',
  red: '#FF647C',
  line: '#29454A',
};

function addText(slide: any, text: string, position: { left: number; top: number; width: number; height: number }, style: Record<string, unknown> = {}) {
  const shape = slide.shapes.add({
    geometry: 'textbox',
    position,
    fill: 'none',
    line: { style: 'solid', fill: 'none', width: 0 },
  });
  shape.text = text;
  shape.text.style = {
    fontFamily: 'Aptos',
    fontSize: 20,
    color: C.text,
    autoFit: 'shrinkText',
    verticalAlignment: 'middle',
    ...style,
  };
  return shape;
}

function addRule(slide: any, left: number, top: number, width: number, color = C.mint) {
  slide.shapes.add({
    geometry: 'rect',
    position: { left, top, width, height: 3 },
    fill: color,
    line: { style: 'solid', fill: color, width: 0 },
  });
}

function baseSlide(presentation: any, section: string, number: number) {
  const slide = presentation.slides.add();
  slide.background.fill = C.bg;
  slide.shapes.add({
    geometry: 'roundRect',
    position: { left: 24, top: 24, width: W - 48, height: H - 48 },
    fill: 'none',
    line: { style: 'solid', fill: C.line, width: 1 },
    borderRadius: 'rounded-2xl',
  });
  addText(slide, String(number).padStart(2, '0'), { left: 1160, top: 656, width: 54, height: 24 }, { fontSize: 12, color: C.muted, alignment: 'right' });
  addText(slide, 'Dados informados manualmente na Projeção Financeira', { left: 64, top: 656, width: 620, height: 24 }, { fontSize: 10, color: C.muted });
  slide.speakerNotes.textFrame.setText('[Sources]\n- Dados informados manualmente na Projeção Financeira.');
  return slide;
}

function addEyebrow(slide: any, section: string) {
  addText(slide, `INSIGHT APEX · ${section.toUpperCase()}`, { left: 72, top: 44, width: 700, height: 26 }, { fontSize: 12, bold: true, color: C.mint });
}

function addTitle(slide: any, title: string, subtitle?: string) {
  addText(slide, title, { left: 64, top: 86, width: 1120, height: 94 }, { fontSize: 38, bold: true, color: C.text });
  if (subtitle) addText(slide, subtitle, { left: 66, top: 174, width: 1050, height: 44 }, { fontSize: 18, color: C.muted });
}

function bulletText(items: string[], fallback: string): string {
  const values = items.map((item) => item.trim()).filter(Boolean);
  return (values.length ? values : [fallback]).map((item) => `• ${item}`).join('\n');
}

function cumulative(values: number[]): number[] {
  let total = 0;
  return values.map((value) => {
    total += value;
    return total;
  });
}

export async function generateInvestorPackPptx(pack: InvestorPack): Promise<Uint8Array> {
  const { Presentation, PresentationFile } = await loadArtifactTool();
  const presentation = Presentation.create({ slideSize: { width: W, height: H } });
  const snapshot = calculateInvestorPack(pack);
  const { metrics, points } = snapshot;
  const labels = points.map((point) => formatInvestorPeriod(point.period));
  const coverage = metrics.coverageRatio == null ? 'N/D' : `${metrics.coverageRatio.toFixed(2)}x`;
  const period = `${formatInvestorPeriod(pack.periodStart)} - ${formatInvestorPeriod(pack.periodEnd)}`;

  {
    const slide = baseSlide(presentation, 'Projeção Financeira', 1);
    addRule(slide, 66, 142, 170);
    addText(slide, pack.title, { left: 64, top: 180, width: 980, height: 190 }, { fontSize: 58, bold: true, color: C.text });
    addText(slide, pack.company || 'Visão financeira executiva', { left: 68, top: 382, width: 800, height: 52 }, { fontSize: 25, color: C.muted });
    addText(slide, `Período  ${period}\nData-base  ${pack.referenceDate}\nDestinatário  ${pack.recipient || 'Investidor'}\nVersão  ${pack.version}`, { left: 68, top: 470, width: 610, height: 140 }, { fontSize: 18, color: C.text });
    addText(slide, pack.confidentiality === 'confidential' ? 'CONFIDENCIAL' : pack.confidentiality === 'restricted' ? 'USO RESTRITO' : 'PÚBLICO', { left: 928, top: 554, width: 250, height: 44 }, { fontSize: 15, bold: true, color: C.mint, alignment: 'right' });
    addEyebrow(slide, 'Projeção Financeira');
  }

  {
    const slide = baseSlide(presentation, 'Síntese executiva', 2);
    addTitle(slide, `A receita projetada cobre ${coverage} do custo de folha informado`, pack.narrative.executiveSummary || 'Visão consolidada do período informado.');
    const cards = [
      ['Receita realizada', formatInvestorCurrency(metrics.revenueActualCents, true), C.mint],
      ['Receita prevista', formatInvestorCurrency(metrics.revenueForecastCents, true), C.blue],
      ['Folha total', formatInvestorCurrency(metrics.payrollTotalCents, true), C.amber],
      ['Diferença acumulada', formatInvestorCurrency(metrics.balanceCents, true), metrics.balanceCents >= 0 ? C.mint : C.red],
    ];
    cards.forEach(([label, value, color], index) => {
      const left = 64 + index * 288;
      addRule(slide, left, 320, 232, String(color));
      addText(slide, String(value), { left, top: 340, width: 245, height: 76 }, { fontSize: 30, bold: true, color: String(color) });
      addText(slide, String(label), { left, top: 416, width: 245, height: 38 }, { fontSize: 16, color: C.muted });
    });
    addText(slide, `${coverage}\nCOBERTURA RECEITA / FOLHA`, { left: 850, top: 480, width: 330, height: 96 }, { fontSize: 30, bold: true, color: C.mint, alignment: 'right' });
    addEyebrow(slide, 'Síntese executiva');
  }

  {
    const slide = baseSlide(presentation, 'Evolução mensal', 3);
    addTitle(slide, 'Realizado e previsto permanecem visivelmente separados');
    slide.charts.add('bar', {
      position: { left: 70, top: 210, width: 1135, height: 400 },
      categories: labels,
      series: [
        { name: 'Receita realizada', values: points.map((point) => centsToReais(point.revenueActualCents)), fill: C.mint },
        { name: 'Receita prevista', values: points.map((point) => centsToReais(point.revenueForecastCents)), fill: C.blue },
        { name: 'Folha realizada', values: points.map((point) => centsToReais(point.payrollActualCents)), fill: C.red },
        { name: 'Folha prevista', values: points.map((point) => centsToReais(point.payrollForecastCents)), fill: C.amber },
      ],
      barOptions: { direction: 'column', grouping: 'clustered', gapWidth: 48 },
      legend: { position: 'bottom', overlay: false, textStyle: { fill: C.muted, fontSize: 12 } },
      xAxis: { textStyle: { fill: C.muted, fontSize: 11 }, line: { style: 'solid', fill: C.line, width: 1 } },
      yAxis: { numberFormatCode: 'R$ #,##0,," mi"', textStyle: { fill: C.muted, fontSize: 11 }, majorGridlines: { style: 'solid', fill: C.line, width: 1 } },
      chartFill: C.bg,
      chartLine: { style: 'solid', fill: C.bg, width: 0 },
      plotAreaFill: { type: 'none' },
    });
    addEyebrow(slide, 'Evolução mensal');
  }

  {
    const slide = baseSlide(presentation, 'Curva S', 4);
    addTitle(slide, 'A trajetória acumulada evidencia a cobertura financeira do período');
    slide.charts.add('line', {
      position: { left: 70, top: 250, width: 1135, height: 360 },
      categories: labels,
      series: [
        { name: 'Projeção receita', values: points.map((point) => centsToReais(point.revenueCumulativeCents)), line: { style: 'solid', fill: C.mint, width: 4 } },
        { name: 'Receita já faturada', values: cumulative(points.map((point) => centsToReais(point.revenueActualCents))), line: { style: 'solid', fill: C.blue, width: 3 } },
        { name: 'Projeção folha', values: points.map((point) => centsToReais(point.payrollCumulativeCents)), line: { style: 'dash', fill: C.amber, width: 3 } },
        { name: 'Folha já fechada', values: cumulative(points.map((point) => centsToReais(point.payrollActualCents))), line: { style: 'solid', fill: C.red, width: 2 } },
      ],
      legend: { position: 'bottom', overlay: false, textStyle: { fill: C.muted, fontSize: 12 } },
      xAxis: { textStyle: { fill: C.muted, fontSize: 11 }, line: { style: 'solid', fill: C.line, width: 1 } },
      yAxis: { numberFormatCode: 'R$ #,##0,," mi"', textStyle: { fill: C.muted, fontSize: 11 }, majorGridlines: { style: 'solid', fill: C.line, width: 1 } },
      chartFill: C.bg,
      chartLine: { style: 'solid', fill: C.bg, width: 0 },
      plotAreaFill: { type: 'none' },
    });
    addEyebrow(slide, 'Curva S');
  }

  {
    const slide = baseSlide(presentation, 'Premissas e riscos', 5);
    addTitle(slide, 'O que sustenta a projeção e merece acompanhamento');
    const columns = [
      ['Destaques', bulletText(pack.narrative.highlights, 'Nenhum destaque informado.'), C.mint],
      ['Riscos', bulletText(pack.narrative.risks, 'Nenhum risco informado.'), C.red],
      ['Premissas', bulletText(pack.narrative.assumptions, 'Nenhuma premissa informada.'), C.blue],
    ];
    columns.forEach(([title, body, color], index) => {
      const left = 64 + index * 382;
      addRule(slide, left, 246, 320, String(color));
      addText(slide, String(title), { left, top: 265, width: 320, height: 44 }, { fontSize: 24, bold: true, color: String(color) });
      addText(slide, String(body), { left, top: 318, width: 330, height: 270 }, { fontSize: 17, color: C.muted, verticalAlignment: 'top' });
    });
    addEyebrow(slide, 'Premissas e riscos');
  }

  {
    const slide = baseSlide(presentation, 'Próximos passos', 6);
    addRule(slide, 66, 150, 180);
    addText(slide, 'A disciplina de atualização transforma projeção em confiança', { left: 64, top: 190, width: 1030, height: 170 }, { fontSize: 46, bold: true, color: C.text });
    addText(slide, pack.narrative.closingMessage || 'Atualizar os valores e premissas à medida que novas informações forem consolidadas.', { left: 72, top: 400, width: 950, height: 120 }, { fontSize: 26, color: C.muted });
    addText(slide, pack.recipient || 'Investidor', { left: 70, top: 560, width: 560, height: 44 }, { fontSize: 16, color: C.mint });
    addEyebrow(slide, 'Próximos passos');
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
