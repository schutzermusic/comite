/**
 * PowerPoint de Pessoas & Custos — geração no servidor.
 *
 * ─── Por que `pptxgenjs` e não o gerador da Projeção Financeira ────────────
 *
 * A Projeção Financeira monta o deck com `@oai/artifact-tool`, um runtime que
 * NÃO está instalado neste projeto (`node_modules/@oai` não existe) e depende
 * de um caminho de cache local. Um botão que só funciona na máquina de quem
 * escreveu não é uma funcionalidade. `pptxgenjs` é dependência declarada,
 * resolve na Vercel e produz o arquivo de fato.
 *
 * ─── Server-only ──────────────────────────────────────────────────────────
 *
 * Importar isto no cliente arrastaria ~1 MB de gerador OOXML para o bundle da
 * página. A guarda no topo transforma esse engano em erro imediato.
 *
 * ─── Um slide, uma ideia ──────────────────────────────────────────────────
 *
 * Os gráficos são os MESMOS SVGs do PDF e do deck, embutidos como imagem
 * vetorial — o que mantém os três destinos idênticos e os slides com texto
 * selecionável e escalável.
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
 * bytes trocados por um PNG real, rasterizado com `sharp` a 2× do tamanho de
 * colocação. O SVG continua no pacote, então não se perde nitidez no 365.
 *
 * O patch mexe em campos internos do `pptxgenjs` (`pres.slides`,
 * `slide._relsMedia`). Por isso ele é totalmente defensivo: qualquer mudança de
 * formato numa atualização faz a função não encontrar nada para corrigir e o
 * documento sai como saía antes — nunca quebra a geração.
 */

import {
  wfDonut,
  wfGauge,
  wfGroupedBars,
  wfLineChart,
  wfParetoChart,
  wfStackedBars,
} from './charts';
import { buildWorkforceInsights, type WorkforceInsightCard } from './insights';
import { measuredText } from './format';
import { fitLogoBox } from '@/lib/reports/report-branding';
import {
  REPORT_NAME,
  UNMEASURED_DASH,
  WF_DARK,
  WF_SOURCE,
  wfAgenda,
  wfCompactCurrency,
  wfCurrency,
  wfInt,
  type WorkforcePalette,
} from './theme';
import type { WorkforceOverviewModel } from '../types';

if (typeof window !== 'undefined') {
  throw new Error(
    'pptx-server é server-only: importá-lo no cliente traria o gerador OOXML para o bundle.',
  );
}

const P: WorkforcePalette = WF_DARK;

/** 16:9 em polegadas — a mesma proporção do deck HTML. */
const W = 13.333;
const H = 7.5;
const MARGIN = 0.62;

/** pptxgenjs quer hex sem `#`. */
const hex = (color: string) => color.replace('#', '').toUpperCase();

const FONT = 'Gilroy';

function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf-8').toString('base64')}`;
}

// O pptxgenjs não publica tipos utilizáveis para slide/apresentação; `any`
// aqui é fronteira com biblioteca não tipada, não desleixo.
type AnySlide = any;
type AnyPres = any;

/* ─── Primitivas de slide ────────────────────────────────────────────────── */

function slideChrome(slide: AnySlide, model: WorkforceOverviewModel, index: number, total: number) {
  slide.background = { color: hex(P.void) };

  slide.addShape('rect', {
    x: 0,
    y: H - 0.42,
    w: W,
    h: 0.012,
    fill: { color: hex(P.line) },
    line: { color: hex(P.line) },
  });

  // Marca no rodapé de todo slide (menos a capa, que traz a versão grande).
  const footLogo = fitLogoBox(model.meta.branding, { maxWidth: 1.05, maxHeight: 0.19 });
  slide.addImage({
    data: model.meta.branding.logoSmallDataUri,
    x: MARGIN,
    y: H - 0.4,
    w: footLogo.width,
    h: footLogo.height,
    altText: model.meta.branding.logoAlt,
  });
  slide.addText(`${model.meta.branding.companyName} · ${REPORT_NAME}`, {
    x: MARGIN + footLogo.width + 0.14,
    y: H - 0.36,
    w: 5.2,
    h: 0.26,
    fontFace: FONT,
    fontSize: 9,
    color: hex(P.subtle),
  });
  slide.addText(`${model.meta.periodLabel} · ${model.meta.filtersLabel}`, {
    x: MARGIN + 5.7,
    y: H - 0.36,
    w: 5.2,
    h: 0.26,
    fontFace: FONT,
    fontSize: 9,
    color: hex(P.subtle),
    align: 'center',
  });
  slide.addText(`${index} / ${total}`, {
    x: W - MARGIN - 1.2,
    y: H - 0.36,
    w: 1.2,
    h: 0.26,
    fontFace: FONT,
    fontSize: 9,
    bold: true,
    color: hex(P.muted),
    align: 'right',
  });
}

function slideTitle(slide: AnySlide, title: string, sub?: string) {
  slide.addText(title, {
    x: MARGIN,
    y: 0.42,
    w: W - MARGIN * 2,
    h: 0.6,
    fontFace: FONT,
    fontSize: 28,
    bold: true,
    color: hex(P.ink),
  });
  if (sub) {
    slide.addText(sub, {
      x: MARGIN,
      y: 1.0,
      w: W - MARGIN * 2,
      h: 0.34,
      fontFace: FONT,
      fontSize: 12,
      color: hex(P.muted),
    });
  }
}

function chartImage(slide: AnySlide, svg: string, box: { x: number; y: number; w: number; h: number }) {
  slide.addImage({ data: svgToDataUri(svg), ...box });
}

/* ─── Slides ─────────────────────────────────────────────────────────────── */

function addCover(slide: AnySlide, model: WorkforceOverviewModel, headline: string) {
  slide.background = { color: hex(P.void) };
  const branding = model.meta.branding;

  // `fitLogoBox` calcula a maior caixa que cabe SEM distorcer — o PowerPoint
  // posiciona imagem por coordenada, então a proporção tem de vir pronta.
  const coverLogo = fitLogoBox(branding, { maxWidth: 4.6, maxHeight: 0.86 });
  slide.addImage({
    data: branding.logoDataUri,
    x: MARGIN,
    y: 1.5 - coverLogo.height / 2,
    w: coverLogo.width,
    h: coverLogo.height,
    altText: branding.logoAlt,
  });
  slide.addText('Cockpit Executivo\nde Pessoas & Custos', {
    x: MARGIN,
    y: 1.9,
    w: W - MARGIN * 2,
    h: 1.6,
    fontFace: FONT,
    fontSize: 44,
    bold: true,
    color: hex(P.ink),
    lineSpacingMultiple: 1.02,
  });
  slide.addText(headline, {
    x: MARGIN,
    y: 3.62,
    w: W * 0.72,
    h: 0.6,
    fontFace: FONT,
    fontSize: 15,
    color: hex(P.body),
  });

  slide.addShape('rect', {
    x: MARGIN,
    y: 4.55,
    w: W - MARGIN * 2,
    h: 0.012,
    fill: { color: hex(P.line) },
    line: { color: hex(P.line) },
  });

  const meta: [string, string][] = [
    ['PERÍODO', model.meta.periodLabel],
    ['RECORTE', model.meta.filtersLabel],
    ['FONTE', WF_SOURCE],
  ];
  meta.forEach(([label, value], i) => {
    const x = MARGIN + i * 4.05;
    slide.addText(label, {
      x,
      y: 4.78,
      w: 3.8,
      h: 0.22,
      fontFace: FONT,
      fontSize: 8.5,
      bold: true,
      charSpacing: 1.8,
      color: hex(P.subtle),
    });
    slide.addText(value, {
      x,
      y: 5.0,
      w: 3.8,
      h: 0.5,
      fontFace: FONT,
      fontSize: 11.5,
      color: hex(P.body),
    });
  });
}

function addKpiBand(slide: AnySlide, model: WorkforceOverviewModel) {
  const kpis = model.executive.kpis
    .filter((k) => k.group === 'custo' || k.group === 'volume' || k.group === 'eficiencia')
    .slice(0, 8);

  const cols = 4;
  const gap = 0.22;
  const tileW = (W - MARGIN * 2 - gap * (cols - 1)) / cols;
  const tileH = 1.16;

  kpis.forEach((k, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = MARGIN + col * (tileW + gap);
    const y = 1.62 + row * (tileH + gap);
    const isMeasured = k.display ? k.display.measured : k.value.measured;

    slide.addShape('roundRect', {
      x,
      y,
      w: tileW,
      h: tileH,
      rectRadius: 0.08,
      fill: { color: hex(P.panelTop) },
      line: { color: hex(P.line), width: 0.75 },
    });
    slide.addText(k.label.toUpperCase(), {
      x: x + 0.16,
      y: y + 0.12,
      w: tileW - 0.32,
      h: 0.24,
      fontFace: FONT,
      fontSize: 7.5,
      bold: true,
      charSpacing: 1.2,
      color: hex(P.subtle),
    });
    slide.addText(measuredText(k.value, k.format, k.display), {
      x: x + 0.16,
      y: y + 0.36,
      w: tileW - 0.32,
      h: 0.44,
      fontFace: FONT,
      fontSize: 20,
      bold: isMeasured,
      color: hex(isMeasured ? P.ink : P.unmeasured),
    });
    slide.addText(isMeasured ? (k.helper ?? '') : 'não apurado no período', {
      x: x + 0.16,
      y: y + 0.82,
      w: tileW - 0.32,
      h: 0.24,
      fontFace: FONT,
      fontSize: 8.5,
      color: hex(P.muted),
    });
  });
}

function addInsightCards(
  slide: AnySlide,
  cards: WorkforceInsightCard[],
  box: { x: number; y: number; w: number; h: number },
) {
  const gap = 0.16;
  const cardH = (box.h - gap * (Math.ceil(cards.length / 2) - 1)) / Math.ceil(cards.length / 2);
  const cardW = (box.w - gap) / 2;

  cards.forEach((c, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = box.x + col * (cardW + gap);
    const y = box.y + row * (cardH + gap);
    const color = c.kind === 'alert' ? P.negative : c.kind === 'watch' ? P.attention : P.positive;
    const kind = c.kind === 'alert' ? 'ALERTA' : c.kind === 'watch' ? 'OBSERVAR' : 'SINAL';

    slide.addShape('roundRect', {
      x,
      y,
      w: cardW,
      h: cardH,
      rectRadius: 0.07,
      fill: { color: hex(P.panelTop) },
      line: { color: hex(P.line), width: 0.75 },
    });
    // Faixa lateral: a mesma marcação de severidade do PDF e do deck.
    slide.addShape('rect', {
      x,
      y,
      w: 0.045,
      h: cardH,
      fill: { color: hex(color) },
      line: { color: hex(color) },
    });
    slide.addText(kind, {
      x: x + 0.18,
      y: y + 0.1,
      w: cardW * 0.5,
      h: 0.2,
      fontFace: FONT,
      fontSize: 7.5,
      bold: true,
      charSpacing: 1.2,
      color: hex(color),
    });
    if (c.value) {
      slide.addText(c.value, {
        x: x + cardW * 0.5,
        y: y + 0.08,
        w: cardW * 0.5 - 0.18,
        h: 0.24,
        fontFace: FONT,
        fontSize: 11,
        bold: true,
        color: hex(P.ink),
        align: 'right',
      });
    }
    slide.addText(c.title, {
      x: x + 0.18,
      y: y + 0.32,
      w: cardW - 0.36,
      h: 0.28,
      fontFace: FONT,
      fontSize: 11.5,
      bold: true,
      color: hex(P.ink),
    });
    slide.addText(c.detail, {
      x: x + 0.18,
      y: y + 0.6,
      w: cardW - 0.36,
      h: cardH - 0.7,
      fontFace: FONT,
      fontSize: 9,
      color: hex(P.muted),
      valign: 'top',
    });
  });
}

/* ─── Deck ───────────────────────────────────────────────────────────────── */

export function buildWorkforceOverviewDeck(pres: AnyPres, model: WorkforceOverviewModel): void {
  const insights = buildWorkforceInsights(model);
  const { executive, efficiency, dynamics, costStructure, concentration, compliance } = model;

  const agenda = wfAgenda({
    hasEfficiency: efficiency.series.length > 0,
    hasDynamics: dynamics.movement.length > 0 || dynamics.turnover.length > 0,
    hasCostStructure: costStructure.composition.length > 0,
    hasConcentration: concentration.data.costCenters.length > 0,
  });

  // A contagem sai do próprio array de construtores — um slide novo não tem
  // como sair do rodapé, que é a falha clássica de contador manual.
  const builders: ((slide: AnySlide) => void)[] = [];

  builders.push((s) => addCover(s, model, insights.headline));

  builders.push((s) => {
    slideTitle(s, 'Roteiro');
    agenda.forEach((a, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = MARGIN + col * ((W - MARGIN * 2) / 2 + 0.2);
      const y = 1.7 + row * 0.78;
      s.addText(String(i + 1).padStart(2, '0'), {
        x,
        y,
        w: 0.5,
        h: 0.3,
        fontFace: FONT,
        fontSize: 12,
        bold: true,
        color: hex(P.accent),
      });
      s.addText(a.title, {
        x: x + 0.5,
        y,
        w: 4.6,
        h: 0.3,
        fontFace: FONT,
        fontSize: 14,
        bold: true,
        color: hex(P.ink),
      });
      s.addText(a.sub, {
        x: x + 0.5,
        y: y + 0.29,
        w: 4.6,
        h: 0.3,
        fontFace: FONT,
        fontSize: 9.5,
        color: hex(P.muted),
      });
    });
  });

  builders.push((s) => {
    slideTitle(s, 'Resumo executivo', `${model.meta.periodLabel} · ${model.meta.filtersLabel}`);
    addKpiBand(s, model);
    s.addShape('roundRect', {
      x: MARGIN,
      y: 5.5,
      w: W - MARGIN * 2,
      h: 0.72,
      rectRadius: 0.06,
      fill: { color: hex(P.panelTop) },
      line: { color: hex(P.accent), width: 1 },
    });
    s.addText(insights.verdict, {
      x: MARGIN + 0.24,
      y: 5.62,
      w: W - MARGIN * 2 - 0.48,
      h: 0.5,
      fontFace: FONT,
      fontSize: 13,
      bold: true,
      color: hex(P.ink),
    });
  });

  if (insights.cards.length > 0) {
    builders.push((s) => {
      slideTitle(s, 'Sinais do período');
      chartImage(
        s,
        wfGauge(executive.risk.score.measured ? executive.risk.score.value : null, {
          palette: P,
          width: 545,
          height: 300,
          label: 'Saúde da folha (100 = melhor)',
          valueText: executive.risk.score.measured ? `${executive.risk.score.value}/100` : undefined,
          // Escala "higher = healthier": 100 é o melhor resultado.
          bands: [
            [0, 40, P.negative],
            [40, 70, P.attention],
            [70, 100, P.positive],
          ],
        }),
        { x: MARGIN, y: 1.7, w: 5.6, h: 3.08 },
      );
      s.addText(executive.risk.message, {
        x: MARGIN,
        y: 4.9,
        w: 5.6,
        h: 0.8,
        fontFace: FONT,
        fontSize: 10,
        color: hex(P.muted),
      });
      addInsightCards(s, insights.cards.slice(0, 4), {
        x: MARGIN + 5.95,
        y: 1.7,
        w: W - MARGIN * 2 - 5.95,
        h: 4,
      });
    });
  }

  if (efficiency.series.length > 0) {
    builders.push((s) => {
      slideTitle(
        s,
        'Eficiência & produtividade',
        'Quanto cada pessoa produz e que parcela da receita a folha consome',
      );
      chartImage(
        s,
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
          { palette: P, width: 1120, height: 400, caption: 'Receita e custo por colaborador' },
        ),
        { x: MARGIN, y: 1.62, w: W - MARGIN * 2, h: 4.3 },
      );
    });
  }

  if (dynamics.movement.length > 0) {
    builders.push((s) => {
      slideTitle(s, 'Dinâmica do quadro', 'Movimentação declarada no eSocial');
      chartImage(
        s,
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
            width: 1120,
            height: 400,
            fmt: (v) => wfInt(v),
            caption: 'Admissões × Desligamentos',
          },
        ),
        { x: MARGIN, y: 1.62, w: W - MARGIN * 2, h: 4.3 },
      );
    });
  }

  if (costStructure.composition.length > 0) {
    builders.push((s) => {
      slideTitle(s, 'Estrutura de custo', 'De que a folha é feita, competência a competência');
      chartImage(
        s,
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
          { palette: P, width: 700, height: 400, caption: 'Composição da folha' },
        ),
        { x: MARGIN, y: 1.62, w: 7.1, h: 4.06 },
      );
      chartImage(
        s,
        wfDonut(benefitSlices(model), {
          palette: P,
          width: 470,
          height: 400,
          centerLabel: 'Benefícios',
          centerValue: costStructure.benefitsTotal.measured
            ? wfCompactCurrency(costStructure.benefitsTotal.value)
            : UNMEASURED_DASH,
        }),
        { x: MARGIN + 7.3, y: 1.62, w: W - MARGIN * 2 - 7.3, h: 4.06 },
      );
    });
  }

  if (concentration.data.costCenters.length > 0) {
    builders.push((s) => {
      slideTitle(
        s,
        'Risco & concentração',
        `Dependência dos maiores centros — total de ${wfCurrency(concentration.data.totalPayroll)}`,
      );
      chartImage(
        s,
        wfParetoChart(
          [...concentration.data.costCenters]
            .sort((a, b) => b.payrollValue - a.payrollValue)
            .map((c) => ({ label: c.name, value: c.payrollValue, highlight: c.isAbnormal })),
          { palette: P, width: 1120, height: 420, caption: 'Folha por centro de custo, com acumulado' },
        ),
        { x: MARGIN, y: 1.62, w: W - MARGIN * 2, h: 4.3 },
      );
    });
  }

  builders.push((s) => {
    slideTitle(
      s,
      'Conformidade',
      `Ciclo folha → eSocial → guias em ${compliance.currentCompetenceLabel}`,
    );
    chartImage(
      s,
      wfGauge(compliance.snapshot.score, {
        palette: P,
        width: 545,
        height: 300,
        label: 'Conformidade da competência',
        valueText: `${compliance.snapshot.score}/100`,
        bands: [
          [0, 60, P.negative],
          [60, 85, P.attention],
          [85, 100, P.positive],
        ],
      }),
      { x: MARGIN, y: 1.7, w: 5.6, h: 3.08 },
    );

    const rows = [
      [
        { text: 'Obrigação', options: { bold: true, color: hex(P.subtle), fontSize: 9 } },
        { text: 'Vencimento', options: { bold: true, color: hex(P.subtle), fontSize: 9 } },
        { text: 'Situação', options: { bold: true, color: hex(P.subtle), fontSize: 9 } },
      ],
      ...compliance.snapshot.obligations.slice(0, 8).map((o) => [
        { text: `${o.code} · ${o.label}`, options: { color: hex(P.body), fontSize: 9 } },
        { text: o.dueDate, options: { color: hex(P.body), fontSize: 9 } },
        { text: o.status, options: { color: hex(P.body), fontSize: 9 } },
      ]),
    ];
    s.addTable(rows, {
      x: MARGIN + 5.95,
      y: 1.7,
      w: W - MARGIN * 2 - 5.95,
      colW: [3.2, 1.4, 1.5],
      border: { type: 'solid', color: hex(P.lineSoft), pt: 0.5 },
      fontFace: FONT,
      valign: 'middle',
      rowH: 0.34,
    });
  });

  builders.push((s) => {
    slideTitle(s, 'Procedência & método', 'De onde vem cada número e o que este material NÃO afirma');
    const halfW = (W - MARGIN * 2 - 0.35) / 2;

    s.addText('Fontes', {
      x: MARGIN,
      y: 1.7,
      w: halfW,
      h: 0.3,
      fontFace: FONT,
      fontSize: 13,
      bold: true,
      color: hex(P.ink),
    });
    s.addText(
      [
        { text: 'Folha — lotes de fechamento aprovados, com rateio por centro de custo.\n', options: { bullet: true } },
        { text: 'Quadro e movimentação — eventos apurados do eSocial.\n', options: { bullet: true } },
        { text: 'Composição — classificação de verbas pela tabela de rubricas (S-1010).\n', options: { bullet: true } },
        { text: 'Receita — títulos do contas a receber, por competência.', options: { bullet: true } },
      ],
      {
        x: MARGIN,
        y: 2.05,
        w: halfW,
        h: 2.4,
        fontFace: FONT,
        fontSize: 10.5,
        color: hex(P.muted),
        valign: 'top',
      },
    );

    s.addText('O que não foi apurado', {
      x: MARGIN + halfW + 0.35,
      y: 1.7,
      w: halfW,
      h: 0.3,
      fontFace: FONT,
      fontSize: 13,
      bold: true,
      color: hex(P.ink),
    });
    s.addText(
      insights.gaps.length > 0
        ? insights.gaps.slice(0, 5).map((g) => ({ text: `${g}\n`, options: { bullet: true } }))
        : [{ text: 'Todos os indicadores do escopo foram apurados.' }],
      {
        x: MARGIN + halfW + 0.35,
        y: 2.05,
        w: halfW,
        h: 2.9,
        fontFace: FONT,
        fontSize: 10,
        color: hex(P.muted),
        valign: 'top',
      },
    );

    s.addText(
      `Somente dado apurado. Onde a fonte não respondeu, o indicador aparece como “${UNMEASURED_DASH}” — nunca como zero.`,
      {
        x: MARGIN,
        y: 5.6,
        w: W - MARGIN * 2,
        h: 0.5,
        fontFace: FONT,
        fontSize: 10,
        italic: true,
        color: hex(P.subtle),
      },
    );
  });

  const total = builders.length;
  builders.forEach((build, i) => {
    const slide = pres.addSlide();
    build(slide);
    // A capa não leva rodapé.
    if (i > 0) slideChrome(slide, model, i + 1, total);
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
    const media: { isSvgPng?: boolean; data?: string; svgSize?: { w: number; h: number } }[] =
      Array.isArray(slide?._relsMedia) ? slide._relsMedia : [];

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
  pres.subject = 'Cockpit Executivo de Pessoas & Custos';

  buildWorkforceOverviewDeck(pres, model);

  // Precisa rodar DEPOIS de montar os slides e ANTES de escrever: é entre os
  // dois que as entradas de mídia existem e ainda são editáveis.
  await rasterizeSvgFallbacks(pres);

  const buffer = (await pres.write({ outputType: 'nodebuffer' })) as Buffer;
  return new Uint8Array(buffer);
}
