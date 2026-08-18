/**
 * Motor de gráficos dos documentos de Pessoas & Custos.
 *
 * SVG puro, em string, sem dependência de runtime — é o que permite ao mesmo
 * código servir o PDF (HTML impresso), o deck HTML e o PowerPoint (que embute
 * o SVG como imagem vetorial), e rodar em Node para a rota da API e o harness
 * de QA.
 *
 * ─── Sem React, sem DOM ────────────────────────────────────────────────────
 *
 * Nada aqui pode tocar `document`, `window` ou JSX. A tela desenha a mesma
 * série com o kit de `FuturisticCharts.tsx`; este módulo é o gêmeo dele para
 * papel e slide, e usa os MESMOS hex por meio de `theme.ts`.
 *
 * ─── O vazio também é desenho ──────────────────────────────────────────────
 *
 * Toda função devolve `wfEmptyChart(...)` quando a série está vazia. Nenhuma
 * devolve string vazia, e nenhuma desenha eixo sem série: um quadro em branco
 * no meio de um relatório de board lê como falha de geração, e um eixo sozinho
 * lê como zero.
 */

import { esc } from '@/lib/reports/report-formatters';
import {
  UNMEASURED_DASH,
  WF_FONT,
  wfCompactCurrency,
  wfPct,
  type WorkforcePalette,
} from './theme';

export interface WfChartOptions {
  width?: number;
  height?: number;
  palette: WorkforcePalette;
  /** Formatador do eixo de valor. */
  fmt?: (v: number) => string;
  /** Título curto impresso dentro do quadro. */
  caption?: string;
  /**
   * Anima as marcas na entrada (barras sobem, linhas se desenham).
   *
   * Só a apresentação HTML liga isto. No PDF e no PowerPoint a marca precisa
   * existir no primeiro quadro renderizado — animação em documento estático
   * significa gráfico em branco na impressão.
   */
  animate?: boolean;
}

const DEFAULT_W = 980;
const DEFAULT_H = 380;

/**
 * Escala tipográfica dos gráficos — os mesmos degraus de `apexChartCss`.
 *
 * O material é lido a metros de distância numa projeção e a um palmo no papel;
 * a Projeção Financeira resolveu isso subindo o eixo para 14px e ancorando os
 * demais nele. Repetir os valores aqui é o que impede um gráfico de Pessoas &
 * Custos de chegar à mesma reunião com rótulo menor que o do outro relatório.
 */
const AXIS = {
  /** Rótulo do eixo de valor. */
  value: 13,
  /** Rótulo de competência / categoria. */
  category: 11.5,
  /** Título dentro do quadro. */
  caption: 13.5,
  /** Rótulo de valor sobre a marca. */
  mark: 10,
} as const;

/**
 * Recuo do eixo de valor.
 *
 * Sobe junto com `AXIS.value`: com rótulo a 13px, `R$ 1,2 mi` ocupa ~62px e o
 * recuo antigo (78) encostava o texto na primeira grade.
 */
const PAD_L = 92;

/** Teto de caracteres do rótulo girado do Pareto — define também o padding. */
const LABEL_MAX_CHARS = 22;

/* ─── Animação ───────────────────────────────────────────────────────────── */

/** Classe de entrada de uma marca sólida (barra, fatia). */
const RISE = 'wf-rise';
/** Classe de entrada de um traço (linha, arco). */
const DRAW = 'wf-draw';

const riseAttr = (on?: boolean) => (on ? ` class="wf-bar ${RISE}"` : '');
const drawAttr = (on?: boolean) => (on ? ` class="${DRAW}"` : '');

/**
 * CSS das animações — só o deck HTML injeta.
 *
 * Transcrição de `APEX_CHART_ANIM_CSS`: mesmas curvas, mesmas durações. É o que
 * faz os dois materiais se desenharem no mesmo ritmo quando projetados em
 * sequência.
 */
export const WF_CHART_ANIM_CSS = `
  @keyframes wfRise { from { transform: scaleY(.02); opacity: 0 } to { transform: scaleY(1); opacity: 1 } }
  @keyframes wfDraw { from { stroke-dasharray: 1 2400; } to { stroke-dasharray: 2400 0; } }
  .wf-bar { transform-origin: center bottom; }
  .${RISE} { animation: wfRise .85s cubic-bezier(.22, 1, .36, 1) both; }
  .${DRAW} { animation: wfDraw 1.5s ease-out both; }
  @media (prefers-reduced-motion: reduce) {
    .${RISE}, .${DRAW} { animation: none !important; }
  }
`;

/* ─── Primitivas ─────────────────────────────────────────────────────────── */

function niceTicks(min: number, max: number, count = 4): number[] {
  if (max === min) return [min, min + 1];
  const span = max - min;
  const step = Math.pow(10, Math.floor(Math.log10(span / count)));
  const err = (span / count) / step;
  const mult = err >= 7.5 ? 10 : err >= 3 ? 5 : err >= 1.5 ? 2 : 1;
  const nice = step * mult;
  const lo = Math.floor(min / nice) * nice;
  const hi = Math.ceil(max / nice) * nice;
  const out: number[] = [];
  for (let v = lo; v <= hi + nice / 2; v += nice) out.push(Number(v.toFixed(6)));
  return out;
}

function text(
  x: number,
  y: number,
  content: string,
  opts: { fill: string; size?: number; anchor?: string; weight?: number; opacity?: number },
): string {
  return (
    `<text x="${x}" y="${y}" fill="${opts.fill}" font-family="${WF_FONT}" ` +
    `font-size="${opts.size ?? 11}" font-weight="${opts.weight ?? 500}" ` +
    `text-anchor="${opts.anchor ?? 'start'}"${opts.opacity !== undefined ? ` opacity="${opts.opacity}"` : ''}>` +
    `${esc(content)}</text>`
  );
}

/**
 * O gráfico NÃO desenha moldura própria.
 *
 * Todo destino já embrulha o SVG num painel de vidro (`.panel` no PDF e no
 * deck, `addGlass` no PowerPoint), exatamente como a Projeção Financeira faz.
 * Uma segunda borda dentro do painel produzia moldura dupla e uma faixa morta
 * entre as duas — e, pior, um fundo opaco que apagava a malha do cockpit por
 * baixo do gráfico.
 *
 * A função continua existindo como ponto único caso um consumidor futuro
 * precise de um quadro solto; hoje o desenho certo é nenhum.
 */
function frame(_w: number, _h: number, _p: WorkforcePalette): string {
  return '';
}

/** Gradiente vertical por série — a profundidade é decoração, não geometria. */
function gradientDefs(id: string, colors: string[]): string {
  return (
    `<defs>${colors
      .map(
        (c, i) =>
          `<linearGradient id="${id}-g${i}" x1="0" y1="0" x2="0" y2="1">` +
          `<stop offset="0%" stop-color="${c}" stop-opacity="0.95"/>` +
          `<stop offset="100%" stop-color="${c}" stop-opacity="0.45"/></linearGradient>` +
          `<linearGradient id="${id}-a${i}" x1="0" y1="0" x2="0" y2="1">` +
          `<stop offset="0%" stop-color="${c}" stop-opacity="0.28"/>` +
          `<stop offset="100%" stop-color="${c}" stop-opacity="0"/></linearGradient>`,
      )
      .join('')}</defs>`
  );
}

let uidCounter = 0;
function uid(prefix: string): string {
  uidCounter += 1;
  return `${prefix}${uidCounter}`;
}

/* ─── Estado vazio ───────────────────────────────────────────────────────── */

/**
 * O quadro do "não apurado".
 *
 * Recebe o MOTIVO, não a ausência. "Sem dados" não é informação; "as rubricas
 * não foram classificadas pelo S-1010" é uma pendência com dono.
 */
export function wfEmptyChart(
  title: string,
  reason: string,
  opts: { width?: number; height?: number; palette: WorkforcePalette },
): string {
  const w = opts.width ?? DEFAULT_W;
  const h = opts.height ?? DEFAULT_H;
  const p = opts.palette;
  const cx = w / 2;

  // Quebra manual: SVG não reflui texto.
  const words = reason.split(' ');
  const lines: string[] = [];
  let line = '';
  const maxChars = Math.floor(w / 8.2);
  for (const word of words) {
    if ((line + word).length > maxChars) {
      lines.push(line.trim());
      line = '';
    }
    line += `${word} `;
  }
  if (line.trim()) lines.push(line.trim());

  const startY = h / 2 - (lines.length * 17) / 2 + 6;

  // `data-empty` deixa o quadro do "não apurado" reconhecível por quem monta o
  // painel: sem isso, o PDF e o deck imprimiriam a legenda de séries que este
  // gráfico justamente declara não existirem.
  return (
    `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" data-empty="1" xmlns="http://www.w3.org/2000/svg" role="img">` +
    `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="14" fill="none" ` +
    `stroke="${p.line}" stroke-dasharray="6 5"/>` +
    text(cx, startY - 26, UNMEASURED_DASH, { fill: p.unmeasured, size: 30, anchor: 'middle', weight: 400 }) +
    text(cx, startY, title, { fill: p.body, size: 14, anchor: 'middle', weight: 700 }) +
    lines
      .map((l, i) => text(cx, startY + 22 + i * 17, l, { fill: p.muted, size: 11.5, anchor: 'middle' }))
      .join('') +
    `</svg>`
  );
}

/* ─── Linhas ─────────────────────────────────────────────────────────────── */

export interface WfLineSeries {
  name: string;
  values: number[];
  color: string;
  dashed?: boolean;
  /** Preenche a área sob a linha. */
  area?: boolean;
}

export function wfLineChart(
  categories: string[],
  series: WfLineSeries[],
  opts: WfChartOptions & { emptyTitle?: string; emptyReason?: string },
): string {
  const p = opts.palette;
  if (categories.length === 0 || series.length === 0) {
    return wfEmptyChart(
      opts.emptyTitle ?? 'Série não apurada',
      opts.emptyReason ?? 'Nenhuma competência do período trouxe este indicador.',
      { width: opts.width, height: opts.height, palette: p },
    );
  }

  const w = opts.width ?? DEFAULT_W;
  const h = opts.height ?? DEFAULT_H;
  const fmt = opts.fmt ?? wfCompactCurrency;
  const id = uid('wfl');

  const padL = PAD_L;
  const padR = 26;
  const padT = opts.caption ? 34 : 22;
  const padB = 42;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const all = series.flatMap((s) => s.values);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(...all, 1));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const range = hi - lo || 1;

  const x = (i: number) =>
    padL + (categories.length === 1 ? innerW / 2 : (i / (categories.length - 1)) * innerW);
  const y = (v: number) => padT + innerH - ((v - lo) / range) * innerH;

  const grid = ticks
    .map(
      (t) =>
        `<line x1="${padL}" x2="${w - padR}" y1="${y(t)}" y2="${y(t)}" stroke="${p.grid}" stroke-dasharray="3 7"/>` +
        text(padL - 12, y(t) + 4, fmt(t), { fill: p.muted, size: AXIS.value, anchor: 'end' }),
    )
    .join('');

  // Um rótulo a cada N para o eixo não virar sopa em janelas longas.
  const labelStep = Math.max(1, Math.ceil(categories.length / 12));
  const xLabels = categories
    .map((c, i) =>
      i % labelStep === 0 || i === categories.length - 1
        ? text(x(i), h - padB + 21, c, { fill: p.muted, size: AXIS.category, anchor: 'middle' })
        : '',
    )
    .join('');

  const paths = series
    .map((s, si) => {
      const pts = s.values.map((v, i) => `${x(i)},${y(v)}`);
      const d = `M ${pts.join(' L ')}`;
      const areaPath =
        s.area && s.values.length > 1
          ? `<path d="${d} L ${x(s.values.length - 1)},${padT + innerH} L ${x(0)},${padT + innerH} Z" fill="url(#${id}-a${si})"/>`
          : '';
      const dots =
        s.values.length <= 14
          ? s.values
              .map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${s.color}"/>`)
              .join('')
          : '';
      return (
        areaPath +
        `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.4" ` +
        `stroke-linejoin="round" stroke-linecap="round"` +
        `${s.dashed ? ' stroke-dasharray="7 5"' : ''}${s.dashed ? '' : drawAttr(opts.animate)}/>` +
        dots
      );
    })
    .join('');

  return (
    `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img">` +
    gradientDefs(id, series.map((s) => s.color)) +
    frame(w, h, p) +
    (opts.caption ? text(padL, 22, opts.caption, { fill: p.body, size: AXIS.caption, weight: 700 }) : '') +
    grid +
    `<line x1="${padL}" x2="${w - padR}" y1="${padT + innerH}" y2="${padT + innerH}" stroke="${p.axisLine}"/>` +
    paths +
    xLabels +
    `</svg>`
  );
}

/* ─── Barras agrupadas ───────────────────────────────────────────────────── */

export interface WfBarSeries {
  name: string;
  values: number[];
  color: string;
}

export function wfGroupedBars(
  categories: string[],
  series: WfBarSeries[],
  opts: WfChartOptions & { emptyTitle?: string; emptyReason?: string },
): string {
  const p = opts.palette;
  if (categories.length === 0 || series.length === 0) {
    return wfEmptyChart(
      opts.emptyTitle ?? 'Série não apurada',
      opts.emptyReason ?? 'Nenhuma competência do período trouxe este indicador.',
      { width: opts.width, height: opts.height, palette: p },
    );
  }

  const w = opts.width ?? DEFAULT_W;
  const h = opts.height ?? DEFAULT_H;
  const fmt = opts.fmt ?? ((v: number) => String(Math.round(v)));
  const id = uid('wfb');

  const padL = PAD_L;
  const padR = 26;
  const padT = opts.caption ? 34 : 22;
  const padB = 42;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const all = series.flatMap((s) => s.values);
  const ticks = niceTicks(0, Math.max(...all, 1));
  const hi = ticks[ticks.length - 1] || 1;
  const y = (v: number) => padT + innerH - (v / hi) * innerH;

  const groupW = innerW / categories.length;
  const barW = Math.min(26, (groupW * 0.62) / series.length);

  const grid = ticks
    .map(
      (t) =>
        `<line x1="${padL}" x2="${w - padR}" y1="${y(t)}" y2="${y(t)}" stroke="${p.grid}" stroke-dasharray="3 7"/>` +
        text(padL - 12, y(t) + 4, fmt(t), { fill: p.muted, size: AXIS.value, anchor: 'end' }),
    )
    .join('');

  const bars = categories
    .map((_, ci) => {
      const groupCx = padL + groupW * ci + groupW / 2;
      const totalW = barW * series.length + 4 * (series.length - 1);
      return series
        .map((s, si) => {
          const v = s.values[ci] ?? 0;
          const bx = groupCx - totalW / 2 + si * (barW + 4);
          const by = y(v);
          const bh = Math.max(1, padT + innerH - by);
          return (
            `<rect x="${bx}" y="${by}" width="${barW}" height="${bh}" rx="3" fill="url(#${id}-g${si})"${riseAttr(opts.animate)}/>` +
            (v > 0 && categories.length <= 8
              ? text(bx + barW / 2, by - 5, fmt(v), { fill: p.muted, size: AXIS.mark, anchor: 'middle' })
              : '')
          );
        })
        .join('');
    })
    .join('');

  const labelStep = Math.max(1, Math.ceil(categories.length / 12));
  const xLabels = categories
    .map((c, i) =>
      i % labelStep === 0 || i === categories.length - 1
        ? text(padL + groupW * i + groupW / 2, h - padB + 21, c, {
            fill: p.muted,
            size: AXIS.category,
            anchor: 'middle',
          })
        : '',
    )
    .join('');

  return (
    `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img">` +
    gradientDefs(id, series.map((s) => s.color)) +
    frame(w, h, p) +
    (opts.caption ? text(padL, 22, opts.caption, { fill: p.body, size: AXIS.caption, weight: 700 }) : '') +
    grid +
    `<line x1="${padL}" x2="${w - padR}" y1="${padT + innerH}" y2="${padT + innerH}" stroke="${p.axisLine}"/>` +
    bars +
    xLabels +
    `</svg>`
  );
}

/* ─── Barras empilhadas ──────────────────────────────────────────────────── */

export function wfStackedBars(
  categories: string[],
  series: WfBarSeries[],
  opts: WfChartOptions & { emptyTitle?: string; emptyReason?: string },
): string {
  const p = opts.palette;
  if (categories.length === 0 || series.length === 0) {
    return wfEmptyChart(
      opts.emptyTitle ?? 'Composição não apurada',
      opts.emptyReason ?? 'Nenhuma competência do período trouxe esta abertura.',
      { width: opts.width, height: opts.height, palette: p },
    );
  }

  const w = opts.width ?? DEFAULT_W;
  const h = opts.height ?? DEFAULT_H;
  const fmt = opts.fmt ?? wfCompactCurrency;
  const id = uid('wfs');

  const padL = PAD_L;
  const padR = 26;
  const padT = opts.caption ? 34 : 22;
  const padB = 42;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const totals = categories.map((_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const ticks = niceTicks(0, Math.max(...totals, 1));
  const hi = ticks[ticks.length - 1] || 1;
  const y = (v: number) => padT + innerH - (v / hi) * innerH;

  const groupW = innerW / categories.length;
  const barW = Math.min(46, groupW * 0.6);

  const grid = ticks
    .map(
      (t) =>
        `<line x1="${padL}" x2="${w - padR}" y1="${y(t)}" y2="${y(t)}" stroke="${p.grid}" stroke-dasharray="3 7"/>` +
        text(padL - 12, y(t) + 4, fmt(t), { fill: p.muted, size: AXIS.value, anchor: 'end' }),
    )
    .join('');

  const bars = categories
    .map((_, ci) => {
      const bx = padL + groupW * ci + groupW / 2 - barW / 2;
      let acc = 0;
      return series
        .map((s, si) => {
          const v = s.values[ci] ?? 0;
          if (v <= 0) return '';
          const top = y(acc + v);
          const bottom = y(acc);
          acc += v;
          return `<rect x="${bx}" y="${top}" width="${barW}" height="${Math.max(1, bottom - top)}" fill="url(#${id}-g${si})"${riseAttr(opts.animate)}/>`;
        })
        .join('');
    })
    .join('');

  const labelStep = Math.max(1, Math.ceil(categories.length / 12));
  const xLabels = categories
    .map((c, i) =>
      i % labelStep === 0 || i === categories.length - 1
        ? text(padL + groupW * i + groupW / 2, h - padB + 21, c, {
            fill: p.muted,
            size: AXIS.category,
            anchor: 'middle',
          })
        : '',
    )
    .join('');

  return (
    `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img">` +
    gradientDefs(id, series.map((s) => s.color)) +
    frame(w, h, p) +
    (opts.caption ? text(padL, 22, opts.caption, { fill: p.body, size: AXIS.caption, weight: 700 }) : '') +
    grid +
    `<line x1="${padL}" x2="${w - padR}" y1="${padT + innerH}" y2="${padT + innerH}" stroke="${p.axisLine}"/>` +
    bars +
    xLabels +
    `</svg>`
  );
}

/* ─── Pareto: barras + acumulada ─────────────────────────────────────────── */

export interface WfParetoRow {
  label: string;
  value: number;
  highlight?: boolean;
}

/**
 * A leitura canônica de concentração deste módulo.
 *
 * Barra por centro + linha acumulada: a barra diz quanto pesa cada um, a linha
 * diz quantos são necessários para explicar a maior parte da folha — que é a
 * pergunta de risco de dependência.
 */
export function wfParetoChart(
  rows: WfParetoRow[],
  opts: WfChartOptions & { emptyTitle?: string; emptyReason?: string },
): string {
  const p = opts.palette;
  if (rows.length === 0) {
    return wfEmptyChart(
      opts.emptyTitle ?? 'Concentração não apurada',
      opts.emptyReason ??
        'A abertura por centro de custo vem do rateio da folha aprovada ou da lotação apurada no eSocial.',
      { width: opts.width, height: opts.height, palette: p },
    );
  }

  const w = opts.width ?? DEFAULT_W;
  const h = opts.height ?? DEFAULT_H;
  const fmt = opts.fmt ?? wfCompactCurrency;
  const id = uid('wfp');

  const sorted = [...rows].sort((a, b) => b.value - a.value).slice(0, 12);
  const total = rows.reduce((s, r) => s + r.value, 0) || 1;

  const padL = PAD_L;
  const padR = 60;
  const padT = opts.caption ? 34 : 22;
  /**
   * Espaço para os rótulos girados.
   *
   * Nome de centro de custo não cabe na horizontal, então gira -32°. A queda
   * vertical de um rótulo é `largura × sen(32°)`; com 22 caracteres isso passa
   * de 60px, e um padding fixo cortava a base do texto — visível na página de
   * concentração do PDF e no slide correspondente.
   *
   * A largura por caractere acompanha `AXIS.category`: subir a fonte do eixo
   * sem subir o padding traria o corte de volta.
   */
  const padB = Math.ceil(LABEL_MAX_CHARS * AXIS.category * 0.56 * Math.sin((32 * Math.PI) / 180)) + 30;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const ticks = niceTicks(0, Math.max(...sorted.map((r) => r.value), 1));
  const hi = ticks[ticks.length - 1] || 1;
  const y = (v: number) => padT + innerH - (v / hi) * innerH;
  const yPct = (pct: number) => padT + innerH - (pct / 100) * innerH;

  const groupW = innerW / sorted.length;
  const barW = Math.min(52, groupW * 0.6);

  const grid = ticks
    .map(
      (t) =>
        `<line x1="${padL}" x2="${w - padR}" y1="${y(t)}" y2="${y(t)}" stroke="${p.grid}" stroke-dasharray="3 7"/>` +
        text(padL - 12, y(t) + 4, fmt(t), { fill: p.muted, size: AXIS.value, anchor: 'end' }),
    )
    .join('');

  const bars = sorted
    .map((r, i) => {
      const bx = padL + groupW * i + groupW / 2 - barW / 2;
      const by = y(r.value);
      return `<rect x="${bx}" y="${by}" width="${barW}" height="${Math.max(1, padT + innerH - by)}" rx="3" fill="url(#${id}-g${r.highlight ? 1 : 0})"${riseAttr(opts.animate)}/>`;
    })
    .join('');

  let acc = 0;
  const cumulativePts = sorted.map((r, i) => {
    acc += r.value;
    return `${padL + groupW * i + groupW / 2},${yPct((acc / total) * 100)}`;
  });
  const cumulativeLine =
    `<path d="M ${cumulativePts.join(' L ')}" fill="none" stroke="${p.warning}" stroke-width="2.2" stroke-linejoin="round"${drawAttr(opts.animate)}/>` +
    cumulativePts
      .map((pt) => {
        const [cx, cy] = pt.split(',');
        return `<circle cx="${cx}" cy="${cy}" r="3" fill="${p.warning}"/>`;
      })
      .join('');

  // Eixo direito: a escala da acumulada.
  const pctAxis = [0, 25, 50, 75, 100]
    .map((pct) =>
      text(w - padR + 10, yPct(pct) + 4, `${pct}%`, {
        fill: p.muted,
        size: AXIS.category,
        anchor: 'start',
      }),
    )
    .join('');

  // Rótulos girados: nome de centro de custo não cabe na horizontal.
  const labels = sorted
    .map((r, i) => {
      const lx = padL + groupW * i + groupW / 2;
      const label =
        r.label.length > LABEL_MAX_CHARS ? `${r.label.slice(0, LABEL_MAX_CHARS - 1)}…` : r.label;
      return (
        `<g transform="translate(${lx}, ${h - padB + 16}) rotate(-32)">` +
        text(0, 0, label, { fill: p.muted, size: AXIS.category, anchor: 'end' }) +
        `</g>`
      );
    })
    .join('');

  return (
    `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img">` +
    gradientDefs(id, [p.accent, p.danger]) +
    frame(w, h, p) +
    (opts.caption ? text(padL, 22, opts.caption, { fill: p.body, size: AXIS.caption, weight: 700 }) : '') +
    grid +
    `<line x1="${padL}" x2="${w - padR}" y1="${padT + innerH}" y2="${padT + innerH}" stroke="${p.axisLine}"/>` +
    bars +
    cumulativeLine +
    pctAxis +
    labels +
    `</svg>`
  );
}

/* ─── Barras horizontais / ranking ───────────────────────────────────────── */

export function wfHorizontalBars(
  rows: { label: string; value: number; color?: string }[],
  opts: WfChartOptions & { emptyTitle?: string; emptyReason?: string },
): string {
  const p = opts.palette;
  if (rows.length === 0) {
    return wfEmptyChart(
      opts.emptyTitle ?? 'Ranking não apurado',
      opts.emptyReason ?? 'Nenhuma lotação do período trouxe este indicador.',
      { width: opts.width, height: opts.height, palette: p },
    );
  }

  const w = opts.width ?? DEFAULT_W;
  const rowH = 30;
  const padT = opts.caption ? 38 : 20;
  const padB = 16;
  const h = opts.height ?? padT + rows.length * rowH + padB;
  const fmt = opts.fmt ?? wfPct;
  const id = uid('wfh');

  const padL = 190;
  const padR = 90;
  const innerW = w - padL - padR;
  const max = Math.max(...rows.map((r) => r.value), 1);

  const bars = rows
    .map((r, i) => {
      const ry = padT + i * rowH;
      const bw = Math.max(2, (r.value / max) * innerW);
      const label = r.label.length > 26 ? `${r.label.slice(0, 25)}…` : r.label;
      return (
        text(padL - 12, ry + 15, label, { fill: p.muted, size: AXIS.category, anchor: 'end' }) +
        `<rect x="${padL}" y="${ry + 5}" width="${innerW}" height="15" rx="4" fill="${p.raised}"/>` +
        `<rect x="${padL}" y="${ry + 5}" width="${bw}" height="15" rx="4" fill="${r.color ?? p.accent}"/>` +
        text(padL + innerW + 10, ry + 16, fmt(r.value), { fill: p.body, size: AXIS.value, weight: 700 })
      );
    })
    .join('');

  return (
    `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img">` +
    gradientDefs(id, [p.accent]) +
    frame(w, h, p) +
    (opts.caption ? text(20, 24, opts.caption, { fill: p.body, size: AXIS.caption, weight: 700 }) : '') +
    bars +
    `</svg>`
  );
}

/* ─── Rosca ──────────────────────────────────────────────────────────────── */

export function wfDonut(
  slices: { name: string; value: number; color: string }[],
  opts: WfChartOptions & { centerLabel?: string; centerValue?: string; emptyTitle?: string; emptyReason?: string },
): string {
  const p = opts.palette;
  const usable = slices.filter((s) => s.value > 0);
  if (usable.length === 0) {
    return wfEmptyChart(
      opts.emptyTitle ?? 'Abertura não apurada',
      opts.emptyReason ?? 'A classificação por natureza depende das rubricas declaradas no S-1010.',
      { width: opts.width, height: opts.height, palette: p },
    );
  }

  const w = opts.width ?? 460;
  const h = opts.height ?? 300;
  const cx = w * 0.34;
  const cy = h / 2;
  const r = Math.min(cx - 20, h / 2 - 26);
  const inner = r * 0.62;
  const total = usable.reduce((a, s) => a + s.value, 0) || 1;

  let angle = -Math.PI / 2;
  const arcs = usable
    .map((s) => {
      const a0 = angle;
      const a1 = a0 + (s.value / total) * Math.PI * 2;
      angle = a1;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const x0 = cx + Math.cos(a0) * r;
      const y0 = cy + Math.sin(a0) * r;
      const x1 = cx + Math.cos(a1) * r;
      const y1 = cy + Math.sin(a1) * r;
      const x2 = cx + Math.cos(a1) * inner;
      const y2 = cy + Math.sin(a1) * inner;
      const x3 = cx + Math.cos(a0) * inner;
      const y3 = cy + Math.sin(a0) * inner;
      return `<path d="M ${x0},${y0} A ${r},${r} 0 ${large} 1 ${x1},${y1} L ${x2},${y2} A ${inner},${inner} 0 ${large} 0 ${x3},${y3} Z" fill="${s.color}"/>`;
    })
    .join('');

  const legendX = cx + r + 34;
  const legend = usable
    .map((s, i) => {
      const ly = cy - (usable.length * 24) / 2 + i * 24 + 8;
      const pct = ((s.value / total) * 100).toFixed(1).replace('.', ',');
      return (
        `<rect x="${legendX}" y="${ly - 9}" width="16" height="9" rx="3" fill="${s.color}"/>` +
        text(legendX + 25, ly, `${s.name}`, { fill: p.muted, size: 12 }) +
        text(w - 20, ly, `${pct}%`, { fill: p.body, size: 12, anchor: 'end', weight: 700 })
      );
    })
    .join('');

  return (
    `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img">` +
    frame(w, h, p) +
    arcs +
    (opts.centerValue
      ? text(cx, cy + 2, opts.centerValue, { fill: p.ink, size: 17, anchor: 'middle', weight: 800 })
      : '') +
    (opts.centerLabel
      ? text(cx, cy + 21, opts.centerLabel, { fill: p.subtle, size: 11, anchor: 'middle' })
      : '') +
    legend +
    `</svg>`
  );
}

/* ─── Medidor ────────────────────────────────────────────────────────────── */

/**
 * Medidor semicircular.
 *
 * ─── Anatomia ──────────────────────────────────────────────────────────────
 *
 * Três camadas concêntricas, de dentro para fora:
 *
 *   1. **Trilha** — o semicírculo completo, em tom de linha. Dá a extensão da
 *      escala mesmo quando o valor é baixo.
 *   2. **Arco do valor** — sobre a trilha, na cor da faixa em que o valor caiu,
 *      com gradiente da base para a ponta e um botão sólido no fim. É a única
 *      marca que o olho persegue.
 *   3. **Rail dos limiares** — um fio FINO por fora, segmentado, mostrando onde
 *      começa cada faixa de política.
 *
 * A versão anterior pintava os limiares sobre o MESMO anel a 30% de opacidade.
 * Sobre papel branco isso virava pastel indistinguível, e o arco do valor
 * cobria justamente a faixa que deveria contextualizá-lo. Separar em dois raios
 * resolve os dois problemas de uma vez.
 *
 * ─── A armadilha do `large-arc-flag` ───────────────────────────────────────
 *
 * `t` percorre o semicírculo SUPERIOR (`π → 2π`; o eixo Y do SVG cresce para
 * baixo, então o arco de cima é onde `sin` é negativo). Como o domínio inteiro
 * vale meia volta, NENHUM sub-arco daqui passa de 180° — e portanto
 * `large-arc-flag` é sempre `0`.
 *
 * Derivá-lo de `|t1 - t0| > 0.5` era o bug: uma faixa de 0 a 60 (108°) pedia ao
 * SVG o arco COMPLEMENTAR de 252°, que saía como um laço solto por cima do
 * medidor.
 */
export function wfGauge(
  value: number | null,
  opts: WfChartOptions & {
    label?: string;
    valueText?: string;
    bands?: [number, number, string][];
    max?: number;
  },
): string {
  const p = opts.palette;
  const w = opts.width ?? 420;
  const h = opts.height ?? 240;
  const max = opts.max ?? 100;
  const bands = opts.bands ?? [];
  const id = uid('wfg');
  const light = p.mode === 'light';

  const PAD = 16;
  const RING_W = 15;
  const RAIL_W = 4;
  const RAIL_GAP = 8;
  const labelH = opts.label ? 28 : 10;

  const cx = w / 2;
  // O raio é o menor entre o que a largura e o que a altura comportam; o bloco
  // inteiro (arco + rótulo) é então centrado verticalmente, para o medidor não
  // grudar no topo quando o painel é mais alto do que largo.
  const outer = Math.max(24, Math.min(w / 2 - PAD, h - PAD * 2 - labelH));
  const cy = PAD + outer + (h - PAD * 2 - outer - labelH) / 2;
  const r = Math.max(14, outer - RING_W / 2 - RAIL_GAP - RAIL_W);
  const rRail = r + RING_W / 2 + RAIL_GAP + RAIL_W / 2;

  const pointAt = (t: number, radius: number): [number, number] => {
    const angle = Math.PI + Math.max(0, Math.min(1, t)) * Math.PI;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
  };

  const arc = (t0: number, t1: number, radius: number) => {
    const [x0, y0] = pointAt(t0, radius);
    const [x1, y1] = pointAt(t1, radius);
    // large-arc-flag = 0 SEMPRE (ver cabeçalho); sweep = 1 percorre o topo da
    // esquerda para a direita.
    return `M ${x0.toFixed(2)},${y0.toFixed(2)} A ${radius},${radius} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
  };

  const t = value === null ? 0 : Math.max(0, Math.min(1, value / max));
  const active =
    value === null
      ? p.unmeasured
      : (bands.find(([from, to]) => value >= from && value <= to)?.[2] ?? p.accent);

  /** Fio externo dos limiares, com um respiro entre segmentos. */
  const rail = bands
    .map(([from, to, color]) => {
      const gap = 0.014;
      const s = from / max + (from === 0 ? 0 : gap);
      const e = to / max - (to === max ? 0 : gap);
      if (e <= s) return '';
      return (
        `<path d="${arc(s, e, rRail)}" fill="none" stroke="${color}" stroke-width="${RAIL_W}" ` +
        `stroke-linecap="round" opacity="${light ? 0.7 : 0.55}"/>`
      );
    })
    .join('');

  const track =
    `<path d="${arc(0, 1, r)}" fill="none" stroke="${p.lineSoft}" ` +
    `stroke-width="${RING_W}" stroke-linecap="round"/>`;

  const gradient =
    `<defs><linearGradient id="${id}" x1="0" y1="1" x2="1" y2="0">` +
    `<stop offset="0%" stop-color="${active}" stop-opacity="0.5"/>` +
    `<stop offset="100%" stop-color="${active}" stop-opacity="1"/>` +
    `</linearGradient></defs>`;

  const valueArc =
    value === null || t <= 0
      ? ''
      : `<path d="${arc(0, t, r)}" fill="none" stroke="url(#${id})" ` +
        `stroke-width="${RING_W}" stroke-linecap="round"${drawAttr(opts.animate)}/>`;

  // Botão na ponta: vazado na cor do fundo e miolo na cor da faixa. É o que dá
  // a leitura exata da posição quando o arco é curto.
  const [kx, ky] = pointAt(t, r);
  const knob =
    value === null
      ? ''
      : `<circle cx="${kx.toFixed(2)}" cy="${ky.toFixed(2)}" r="${(RING_W / 2 + 2).toFixed(1)}" ` +
        `fill="${light ? '#FFFFFF' : p.void}"/>` +
        `<circle cx="${kx.toFixed(2)}" cy="${ky.toFixed(2)}" r="${(RING_W / 2 - 2.5).toFixed(1)}" ` +
        `fill="${active}"/>`;

  const valueSize = Math.max(18, Math.min(40, r * 0.44));

  return (
    `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img">` +
    gradient +
    rail +
    track +
    valueArc +
    knob +
    text(cx, cy - valueSize * 0.22, value === null ? UNMEASURED_DASH : (opts.valueText ?? String(value)), {
      fill: value === null ? p.unmeasured : p.ink,
      size: valueSize,
      anchor: 'middle',
      weight: value === null ? 400 : 800,
    }) +
    (opts.label
      ? text(cx, cy + 20, opts.label, { fill: p.muted, size: 12, anchor: 'middle', weight: 700 })
      : '') +
    `</svg>`
  );
}

/* ─── Curva S ────────────────────────────────────────────────────────────── */

export function wfSCurve(
  categories: string[],
  current: number[],
  previous: number[] | null,
  opts: WfChartOptions & { emptyTitle?: string; emptyReason?: string },
): string {
  const series: WfLineSeries[] = [
    { name: 'Período atual', values: current, color: opts.palette.accent, area: true },
  ];
  if (previous && previous.some((v) => v > 0)) {
    series.push({
      name: 'Período anterior',
      values: previous,
      color: opts.palette.info,
      dashed: true,
    });
  }
  return wfLineChart(categories, series, {
    ...opts,
    emptyTitle: opts.emptyTitle ?? 'Curva não apurada',
    emptyReason:
      opts.emptyReason ?? 'A curva acumulada precisa de competências apuradas no período.',
  });
}

/* ─── Minigráfico ────────────────────────────────────────────────────────── */

export function wfSparkline(
  values: number[],
  color: string,
  opts?: { width?: number; height?: number },
): string {
  const w = opts?.width ?? 120;
  const h = opts?.height ?? 30;
  if (values.length < 2) return `<svg width="${w}" height="${h}"></svg>`;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (w - 4) + 2;
    const y = h - 3 - ((v - min) / range) * (h - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="M ${pts.join(' L ')}" fill="none" stroke="${color}" stroke-width="1.8" ` +
    `stroke-linejoin="round" stroke-linecap="round"/></svg>`
  );
}

/* ─── Legenda ────────────────────────────────────────────────────────────── */

export interface WfLegendItem {
  label: string;
  color: string;
  /**
   * Marca da série.
   *
   * As mesmas quatro de `apexLegend`: bloco sólido para área/barra, traço para
   * linha, tracejado para projeção e vazado para o previsto. A marca precisa
   * repetir o desenho do gráfico — legenda com bloco sólido ao lado de uma
   * linha tracejada obriga o leitor a adivinhar a correspondência.
   */
  shape?: 'solid' | 'line' | 'dash' | 'hollow';
}

/** Verdadeiro para o SVG devolvido por `wfEmptyChart`. */
export function isEmptyChart(svg: string): boolean {
  return svg.includes('data-empty="1"');
}

export function wfLegend(items: WfLegendItem[]): string {
  if (items.length === 0) return '';
  return (
    `<div class="wf-legend">` +
    items
      .map((i) => {
        const shape = i.shape ?? 'solid';
        const style =
          shape === 'line'
            ? `background:${i.color};height:3px;border-radius:2px;`
            : shape === 'dash'
              ? `background:repeating-linear-gradient(90deg, ${i.color} 0 5px, transparent 5px 9px);height:3px;`
              : shape === 'hollow'
                ? `background:transparent;border:1px solid ${i.color};`
                : `background:${i.color};`;
        return `<span class="wf-lg"><i class="wf-sw" style="${style}"></i>${esc(i.label)}</span>`;
      })
      .join('') +
    `</div>`
  );
}

/** Métricas transcritas de `apexLegendCss` — mesmo respiro, mesma marca. */
export function wfLegendCss(p: WorkforcePalette): string {
  return `
  .wf-legend{display:flex;flex-wrap:wrap;gap:6px 20px;margin-top:10px;font-family:${WF_FONT};}
  .wf-lg{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:${p.muted};}
  .wf-sw{display:inline-block;width:16px;height:9px;border-radius:3px;flex:0 0 auto;}
`;
}
