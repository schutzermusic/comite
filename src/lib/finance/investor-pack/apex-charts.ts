/**
 * Apex — motor de gráficos SVG da Projeção Financeira.
 *
 * SVG puro em string, sem dependência de runtime: o mesmo renderizador serve o
 * deck HTML (interativo, com <title> como tooltip nativo) e o PDF dark
 * (impressão). Nada aqui calcula finanças — os valores chegam prontos do
 * `InvestorPackCurvePoint` produzido por `calculateInvestorPack`.
 *
 * Cada gráfico gera ids de <defs> próprios (`uid`) porque vários SVGs coexistem
 * no mesmo documento e ids repetidos fazem gradientes/hachuras vazarem entre eles.
 */

import { esc } from '@/lib/reports/report-formatters';
import { APEX, SERIES_LABEL, formatInvestorRatio, type ApexPalette } from './apex-theme';
import { formatInvestorCurrency, formatInvestorPeriod } from './calculations';
import type { InvestorClientForecast, InvestorPackCurvePoint } from './types';

let uidCounter = 0;
function uid(prefix: string): string {
  uidCounter += 1;
  return `${prefix}${uidCounter}`;
}

export interface ApexChartOptions {
  width?: number;
  height?: number;
  /** Anima a entrada das marcas (deck HTML). Desligado no PDF. */
  animate?: boolean;
  /** Última competência com valor realizado — separa a zona de previsão. */
  forecastFromPeriod?: string | null;
  /** Paleta de render. Omitida = escura (tela/projeção). */
  palette?: ApexPalette;
}

/**
 * Topo do eixo escolhido a partir de um passo "redondo" (1 / 2 / 2,5 / 5 / 10 ×
 * 10^k) multiplicado pelo número de divisões: garante que TODOS os rótulos do
 * eixo caiam em valores legíveis, e não só o topo (senão a escala mostra
 * "1,1 mi" no meio de uma escala de 1,5 mi).
 */
function niceMax(value: number, divisions = 4): number {
  if (value <= 0) return 1;
  const raw = value / divisions;
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  const step = [1, 2, 2.5, 5, 10].find((candidate) => raw <= candidate * base + 1e-9);
  return (step ?? 10) * base * divisions;
}

function axisMoney(cents: number): string {
  return formatInvestorCurrency(cents, true).replace('R$', '').trim();
}

/** Rótulo de eixo compacto e simétrico para escalas que cruzam o zero. */
function ticks(min: number, max: number, count = 4): number[] {
  const out: number[] = [];
  for (let i = 0; i <= count; i += 1) out.push(max - ((max - min) / count) * i);
  return out;
}

function gridLines(
  x0: number,
  x1: number,
  y: (value: number) => number,
  values: number[],
  opts?: { zero?: number },
): string {
  return values.map((value) => {
    const gy = y(value);
    const isZero = opts?.zero != null && Math.abs(value - opts.zero) < 1e-6;
    return `<line x1="${x0}" x2="${x1}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}" `
      + `class="${isZero ? 'apex-axisline' : 'apex-grid'}"/>`
      + `<text x="${x0 - 10}" y="${(gy + 4).toFixed(1)}" text-anchor="end" class="apex-axis">${esc(axisMoney(value))}</text>`;
  }).join('');
}

/** Hachura diagonal usada para toda marca "prevista" — legenda visual constante. */
function hatchDef(id: string, color: string): string {
  return `<pattern id="${id}" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
    <rect width="7" height="7" fill="${color}" fill-opacity=".2"/>
    <line x1="0" y1="0" x2="0" y2="7" stroke="${color}" stroke-width="3.4" stroke-opacity=".95"/>
  </pattern>`;
}

function vGradient(id: string, color: string, from = 0.85, to = 0.35): string {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${color}" stop-opacity="${from}"/>
    <stop offset="1" stop-color="${color}" stop-opacity="${to}"/>
  </linearGradient>`;
}

function areaGradient(id: string, color: string, top = 0.3): string {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${color}" stop-opacity="${top}"/>
    <stop offset="1" stop-color="${color}" stop-opacity="0"/>
  </linearGradient>`;
}

/** Painel de fundo do plot (vidro) + moldura. */
function plotShell(uidBase: string, w: number, h: number, P: ApexPalette): { defs: string; body: string } {
  const gid = `${uidBase}-shell`;
  const solid = P.mode === 'light';
  return {
    defs: `<linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${P.panelTop}" stop-opacity="${solid ? '1' : '.55'}"/>
      <stop offset="1" stop-color="${P.panelBottom}" stop-opacity="${solid ? '1' : '.2'}"/>
    </linearGradient>`,
    body: `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="18" fill="url(#${gid})" stroke="${P.lineSoft}"/>`,
  };
}

export function apexEmptyChart(message: string, opts?: ApexChartOptions): string {
  const P = opts?.palette ?? APEX;
  const w = opts?.width ?? 1120;
  const h = opts?.height ?? 380;
  return `<svg viewBox="0 0 ${w} ${h}" class="apex-chart" role="img" aria-label="${esc(message)}">
    <rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="18" fill="${P.panelBottom}" fill-opacity=".5" stroke="${P.lineSoft}"/>
    <text x="${w / 2}" y="${h / 2}" text-anchor="middle" class="apex-axis" font-size="20">${esc(message)}</text>
  </svg>`;
}

/**
 * Cores derivadas das identidades visuais dos clientes.
 *
 * Quando marcas compartilham uma cor principal, usamos uma cor secundária do
 * respectivo logotipo para manter as séries distinguíveis (Cemig e Âmbar).
 */
export const CLIENT_FORECAST_BRAND_COLORS: Readonly<Record<string, { dark: string; light: string }>> = {
  axia: { dark: '#4D8DFF', light: '#135DDE' },
  petrobras: { dark: '#20A456', light: '#008542' },
  enel: { dark: '#F04A9D', light: '#D60073' },
  belem: { dark: '#83C941', light: '#5F941E' },
  flessak: { dark: '#F04B43', light: '#D9342B' },
  cemig: { dark: '#F3CD33', light: '#B58E00' },
  harbin: { dark: '#5B7FB4', light: '#244D8E' },
  arcelor: { dark: '#FF7A2D', light: '#D9570B' },
  andritz: { dark: '#28A9E0', light: '#006EB6' },
  ambar: { dark: '#B8AAA3', light: '#71645E' },
  hydro: { dark: '#22B8B5', light: '#007F82' },
};

/** Sequência de fallback para clientes ainda não cadastrados na paleta de marca. */
export function clientForecastColors(palette: ApexPalette = APEX): string[] {
  const light = palette.mode === 'light';
  return [
    palette.revenue,
    palette.revenueForecast,
    palette.payrollForecast,
    palette.balance,
    light ? '#0E7490' : '#22D3EE',
    light ? '#BE185D' : '#F472B6',
    light ? '#4D7C0F' : '#A3E635',
    light ? '#9F1239' : '#FB7185',
    light ? '#86198F' : '#E879F9',
    light ? '#A16207' : '#FDE047',
    light ? '#475569' : '#94A3B8',
  ];
}

export const CLIENT_FORECAST_COLORS: string[] = clientForecastColors(APEX);

export function clientForecastColor(
  clientId: string,
  fallbackIndex = 0,
  palette: ApexPalette = APEX,
): string {
  const brand = CLIENT_FORECAST_BRAND_COLORS[clientId.trim().toLowerCase()];
  if (brand) return palette.mode === 'light' ? brand.light : brand.dark;
  const fallback = clientForecastColors(palette);
  return fallback[fallbackIndex % fallback.length];
}

/** Colunas empilhadas por cliente para tornar a composição do faturamento auditável. */
export function apexClientForecastChart(
  forecasts: InvestorClientForecast[],
  periods: string[],
  opts?: ApexChartOptions,
): string {
  const visible = forecasts.filter((forecast) => periods.includes(forecast.period) && forecast.amountCents > 0);
  if (!visible.length) return apexEmptyChart('Nenhuma projeção por cliente no período.', opts);
  const firstForecastPeriod = visible.reduce(
    (first, forecast) => forecast.period < first ? forecast.period : first,
    visible[0].period,
  );
  const chartPeriods = periods.filter((period) => period >= firstForecastPeriod);
  const w = opts?.width ?? 1120;
  const h = opts?.height ?? 400;
  const pad = { left: 82, right: 30, top: 28, bottom: 54 };
  const iw = w - pad.left - pad.right;
  const ih = h - pad.top - pad.bottom;
  const u = uid('acl');
  const P = opts?.palette ?? APEX;
  const clients = [...new Map(visible.map((item) => [item.clientId, item.client])).entries()];
  const values = new Map<string, number>();
  visible.forEach((item) => {
    const key = `${item.period}:${item.clientId}`;
    values.set(key, (values.get(key) ?? 0) + item.amountCents);
  });
  const totals = chartPeriods.map((period) => clients.reduce((sum, [id]) => sum + (values.get(`${period}:${id}`) ?? 0), 0));
  const max = niceMax(Math.max(1, ...totals));
  const y = (value: number) => pad.top + ih - (value / max) * ih;
  const groupW = iw / chartPeriods.length;
  const barW = Math.max(8, Math.min(38, groupW * 0.62));
  const bars = chartPeriods.map((period, periodIndex) => {
    let acc = 0;
    return clients.map(([clientId, client], clientIndex) => {
      const value = values.get(`${period}:${clientId}`) ?? 0;
      if (!value) return '';
      const height = (value / max) * ih;
      const x = pad.left + groupW * periodIndex + (groupW - barW) / 2;
      const top = pad.top + ih - ((acc + value) / max) * ih;
      acc += value;
      return `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, height).toFixed(1)}" rx="2" fill="${clientForecastColor(clientId, clientIndex, P)}"${opts?.animate ? ' class="apex-bar apex-rise"' : ''}>
        <title>${esc(formatInvestorPeriod(period))} · ${esc(client)} · ${esc(formatInvestorCurrency(value))}</title>
      </rect>`;
    }).join('');
  }).join('');
  const every = Math.max(1, Math.ceil(chartPeriods.length / 12));
  const labels = chartPeriods.map((period, index) => index % every === 0 || index === chartPeriods.length - 1
    ? `<text x="${(pad.left + groupW * index + groupW / 2).toFixed(1)}" y="${h - 25}" text-anchor="middle" class="apex-axis">${esc(formatInvestorPeriod(period))}</text>`
    : '').join('');
  const shell = plotShell(u, w, h, P);
  return `<svg viewBox="0 0 ${w} ${h}" class="apex-chart" role="img" aria-label="Faturamento previsto por cliente">
    <defs>${shell.defs}</defs>${shell.body}
    ${gridLines(pad.left, w - pad.right, y, ticks(0, max))}
    ${bars}
    <line x1="${pad.left}" x2="${w - pad.right}" y1="${pad.top + ih}" y2="${pad.top + ih}" class="apex-axisline"/>
    ${labels}
  </svg>`;
}

/* ─────────────────────────────────────────────────────────────
 * 1. Receita × folha mês a mês
 * Colunas empilhadas realizado (sólido) + previsto (hachurado),
 * receita e folha lado a lado, com linha de cobertura mensal.
 * ───────────────────────────────────────────────────────────── */
export function apexMonthlyChart(points: InvestorPackCurvePoint[], opts?: ApexChartOptions): string {
  if (!points.length) return apexEmptyChart('Informe ao menos uma competência para ver a evolução mensal.', opts);

  const w = opts?.width ?? 1120;
  const h = opts?.height ?? 400;
  const pad = { left: 78, right: 30, top: 26, bottom: 54 };
  const iw = w - pad.left - pad.right;
  const ih = h - pad.top - pad.bottom;
  const u = uid('am');
  const P = opts?.palette ?? APEX;

  const max = niceMax(Math.max(1, ...points.map((p) => Math.max(p.revenueTotalCents, p.payrollTotalCents))));
  const y = (value: number) => pad.top + ih - (value / max) * ih;
  const groupW = iw / points.length;
  const barW = Math.max(8, Math.min(44, (groupW - 14) / 2));
  const anim = opts?.animate ? ' apex-rise' : '';

  const columns = points.map((point, index) => {
    const center = pad.left + groupW * index + groupW / 2;
    const gap = 5;
    const stacks: Array<{ x: number; actual: number; forecast: number; solid: string; hatch: string; label: string }> = [
      {
        x: center - barW - gap / 2,
        actual: point.revenueActualCents,
        forecast: point.revenueForecastCents,
        solid: `url(#${u}-rev)`,
        hatch: `url(#${u}-revh)`,
        label: 'Receita',
      },
      {
        x: center + gap / 2,
        actual: point.payrollActualCents,
        forecast: point.payrollForecastCents,
        solid: `url(#${u}-pay)`,
        hatch: `url(#${u}-payh)`,
        label: 'Folha',
      },
    ];

    return stacks.map((stack) => {
      const total = stack.actual + stack.forecast;
      const actualH = (stack.actual / max) * ih;
      const forecastH = (stack.forecast / max) * ih;
      const baseY = pad.top + ih;
      const parts: string[] = [];
      if (actualH > 0) {
        parts.push(`<rect x="${stack.x.toFixed(1)}" y="${(baseY - actualH).toFixed(1)}" width="${barW.toFixed(1)}" height="${actualH.toFixed(1)}" rx="3" fill="${stack.solid}" class="apex-bar${anim}"/>`);
      }
      if (forecastH > 0) {
        parts.push(`<rect x="${stack.x.toFixed(1)}" y="${(baseY - actualH - forecastH).toFixed(1)}" width="${barW.toFixed(1)}" height="${forecastH.toFixed(1)}" rx="3" fill="${stack.hatch}" stroke="${stack.label === 'Receita' ? P.revenueForecast : P.payrollForecast}" stroke-opacity=".55" stroke-width="1" class="apex-bar${anim}"/>`);
      }
      if (!parts.length) return '';
      return `<g><title>${esc(formatInvestorPeriod(point.period))} · ${esc(stack.label)}: ${esc(formatInvestorCurrency(total))}</title>${parts.join('')}</g>`;
    }).join('');
  }).join('');

  const labels = points.map((point, index) => {
    const x = pad.left + groupW * index + groupW / 2;
    const isForecast = point.revenueForecastCents > 0 || point.payrollForecastCents > 0;
    return `<text x="${x.toFixed(1)}" y="${h - 26}" text-anchor="middle" class="apex-axis${isForecast ? ' apex-axis-forecast' : ''}">${esc(formatInvestorPeriod(point.period))}</text>`;
  }).join('');

  const shell = plotShell(u, w, h, P);

  return `<svg viewBox="0 0 ${w} ${h}" class="apex-chart" role="img" aria-label="Receita e folha por competência">
  <defs>
    ${shell.defs}
    ${vGradient(`${u}-rev`, P.revenue)}
    ${vGradient(`${u}-pay`, P.payroll)}
    ${hatchDef(`${u}-revh`, P.revenueForecast)}
    ${hatchDef(`${u}-payh`, P.payrollForecast)}
  </defs>
  ${shell.body}
  ${gridLines(pad.left, w - pad.right, y, ticks(0, max))}
  ${columns}
  <line x1="${pad.left}" x2="${w - pad.right}" y1="${pad.top + ih}" y2="${pad.top + ih}" class="apex-axisline"/>
  ${labels}
</svg>`;
}

/* ─────────────────────────────────────────────────────────────
 * 2. Curva S acumulada — receita vs folha, com zona de previsão
 * ───────────────────────────────────────────────────────────── */
export function apexCurveChart(points: InvestorPackCurvePoint[], opts?: ApexChartOptions): string {
  if (!points.length) return apexEmptyChart('Informe ao menos uma competência para ver a Curva S.', opts);

  const w = opts?.width ?? 1120;
  const h = opts?.height ?? 400;
  const pad = { left: 82, right: 34, top: 26, bottom: 54 };
  const iw = w - pad.left - pad.right;
  const ih = h - pad.top - pad.bottom;
  const u = uid('ac');
  const P = opts?.palette ?? APEX;

  const revenue = points.map((p) => p.revenueCumulativeCents);
  const payroll = points.map((p) => p.payrollCumulativeCents);
  const max = niceMax(Math.max(1, ...revenue, ...payroll));
  const x = (index: number) => pad.left + (points.length === 1 ? iw / 2 : (index / (points.length - 1)) * iw);
  const y = (value: number) => pad.top + ih - (value / max) * ih;

  const line = (values: number[]) => values
    .map((value, index) => `${index ? 'L' : 'M'} ${x(index).toFixed(1)} ${y(value).toFixed(1)}`)
    .join(' ');
  const area = (values: number[]) => `${line(values)} L ${x(values.length - 1).toFixed(1)} ${(pad.top + ih).toFixed(1)} L ${x(0).toFixed(1)} ${(pad.top + ih).toFixed(1)} Z`;

  /** Índice do primeiro mês com previsão — a partir dele o traço é tracejado. */
  const forecastIndex = points.findIndex((p) => p.revenueForecastCents > 0 || p.payrollForecastCents > 0);
  const forecastBand = forecastIndex > 0
    ? `<rect x="${x(forecastIndex - 0.5 < 0 ? 0 : forecastIndex).toFixed(1)}" y="${pad.top}" width="${(w - pad.right - x(forecastIndex)).toFixed(1)}" height="${ih}" fill="${P.revenueForecast}" fill-opacity=".05"/>
      <line x1="${x(forecastIndex).toFixed(1)}" x2="${x(forecastIndex).toFixed(1)}" y1="${pad.top}" y2="${pad.top + ih}" stroke="${P.revenueForecast}" stroke-opacity=".45" stroke-width="1" stroke-dasharray="4 5"/>
      <text x="${(x(forecastIndex) + 10).toFixed(1)}" y="${pad.top + 16}" class="apex-axis" fill="${P.revenueForecast}">Zona de previsão</text>`
    : '';

  const dots = (values: number[], color: string, r: number) => values
    .map((value, index) => `<circle cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="${r}" fill="${P.void}" stroke="${color}" stroke-width="2.5"><title>${esc(formatInvestorPeriod(points[index].period))} · ${esc(formatInvestorCurrency(value))}</title></circle>`)
    .join('');

  const labels = points.map((point, index) =>
    `<text x="${x(index).toFixed(1)}" y="${h - 26}" text-anchor="middle" class="apex-axis">${esc(formatInvestorPeriod(point.period))}</text>`,
  ).join('');

  const last = points.length - 1;
  const closing = points[last].balanceCumulativeCents;
  const callout = `<g>
    <line x1="${x(last).toFixed(1)}" x2="${x(last).toFixed(1)}" y1="${y(revenue[last]).toFixed(1)}" y2="${y(payroll[last]).toFixed(1)}" stroke="${P.balance}" stroke-width="2" stroke-dasharray="3 4"/>
    <title>${esc(SERIES_LABEL.balanceCumulative)}: ${esc(formatInvestorCurrency(closing))}</title>
  </g>`;

  const shell = plotShell(u, w, h, P);
  const draw = opts?.animate ? ' apex-draw' : '';

  return `<svg viewBox="0 0 ${w} ${h}" class="apex-chart" role="img" aria-label="Curva S acumulada de receita e folha">
  <defs>
    ${shell.defs}
    ${areaGradient(`${u}-rev`, P.revenue, 0.32)}
    ${areaGradient(`${u}-pay`, P.payroll, 0.16)}
  </defs>
  ${shell.body}
  ${forecastBand}
  ${gridLines(pad.left, w - pad.right, y, ticks(0, max))}
  <path d="${area(revenue)}" fill="url(#${u}-rev)"/>
  <path d="${area(payroll)}" fill="url(#${u}-pay)"/>
  <path d="${line(payroll)}" fill="none" stroke="${P.payroll}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="apex-line${draw}"/>
  <path d="${line(revenue)}" fill="none" stroke="${P.revenue}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" class="apex-line${draw}"/>
  ${callout}
  ${dots(payroll, P.payroll, 3.5)}
  ${dots(revenue, P.revenue, 4.5)}
  <line x1="${pad.left}" x2="${w - pad.right}" y1="${pad.top + ih}" y2="${pad.top + ih}" class="apex-axisline"/>
  ${labels}
</svg>`;
}

/* ─────────────────────────────────────────────────────────────
 * 3. Saldo mensal (± colunas) com saldo acumulado sobreposto
 * ───────────────────────────────────────────────────────────── */
export function apexBalanceChart(points: InvestorPackCurvePoint[], opts?: ApexChartOptions): string {
  if (!points.length) return apexEmptyChart('Informe ao menos uma competência para ver o saldo.', opts);

  const w = opts?.width ?? 1120;
  const h = opts?.height ?? 340;
  const pad = { left: 82, right: 86, top: 26, bottom: 52 };
  const iw = w - pad.left - pad.right;
  const ih = h - pad.top - pad.bottom;
  const u = uid('ab');
  const P = opts?.palette ?? APEX;

  const monthly = points.map((p) => p.balanceCents);
  const cumulative = points.map((p) => p.balanceCumulativeCents);
  const mMax = niceMax(Math.max(1, ...monthly.map(Math.abs)));
  const mMin = monthly.some((v) => v < 0) ? -mMax : 0;
  const yBar = (value: number) => pad.top + ih - ((value - mMin) / (mMax - mMin)) * ih;
  const zeroY = yBar(0);

  const cMaxAbs = niceMax(Math.max(1, ...cumulative.map(Math.abs)));
  const cMin = cumulative.some((v) => v < 0) ? -cMaxAbs : 0;
  const yLine = (value: number) => pad.top + ih - ((value - cMin) / (cMaxAbs - cMin)) * ih;

  const groupW = iw / points.length;
  const barW = Math.max(10, Math.min(52, groupW * 0.5));
  const anim = opts?.animate ? ' apex-rise' : '';

  const bars = points.map((point, index) => {
    const center = pad.left + groupW * index + groupW / 2;
    const value = point.balanceCents;
    const top = Math.min(yBar(value), zeroY);
    const height = Math.abs(yBar(value) - zeroY);
    const color = value >= 0 ? `url(#${u}-pos)` : `url(#${u}-neg)`;
    return `<g><title>${esc(formatInvestorPeriod(point.period))} · ${esc(SERIES_LABEL.balance)}: ${esc(formatInvestorCurrency(value))}</title>
      <rect x="${(center - barW / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, height).toFixed(1)}" rx="3" fill="${color}" class="apex-bar${anim}"/>
    </g>`;
  }).join('');

  const xc = (index: number) => pad.left + groupW * index + groupW / 2;
  const linePath = cumulative
    .map((value, index) => `${index ? 'L' : 'M'} ${xc(index).toFixed(1)} ${yLine(value).toFixed(1)}`)
    .join(' ');
  const lineDots = cumulative.map((value, index) =>
    `<circle cx="${xc(index).toFixed(1)}" cy="${yLine(value).toFixed(1)}" r="3.5" fill="${P.void}" stroke="${P.balance}" stroke-width="2"><title>${esc(formatInvestorPeriod(points[index].period))} · ${esc(SERIES_LABEL.balanceCumulative)}: ${esc(formatInvestorCurrency(value))}</title></circle>`,
  ).join('');

  const labels = points.map((point, index) =>
    `<text x="${xc(index).toFixed(1)}" y="${h - 24}" text-anchor="middle" class="apex-axis">${esc(formatInvestorPeriod(point.period))}</text>`,
  ).join('');

  // Eixo direito: escala do acumulado, rotulada para não confundir com as colunas.
  const rightAxis = ticks(cMin, cMaxAbs).map((value) => {
    const gy = yLine(value);
    return `<text x="${w - pad.right + 12}" y="${(gy + 4).toFixed(1)}" class="apex-axis" fill="${P.balance}">${esc(axisMoney(value))}</text>`;
  }).join('');

  const shell = plotShell(u, w, h, P);

  return `<svg viewBox="0 0 ${w} ${h}" class="apex-chart" role="img" aria-label="Saldo mensal e saldo acumulado">
  <defs>
    ${shell.defs}
    ${vGradient(`${u}-pos`, P.positive)}
    ${vGradient(`${u}-neg`, P.negative)}
  </defs>
  ${shell.body}
  ${gridLines(pad.left, w - pad.right, yBar, ticks(mMin, mMax), { zero: 0 })}
  ${bars}
  <line x1="${pad.left}" x2="${w - pad.right}" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}" class="apex-axisline"/>
  <path d="${linePath}" fill="none" stroke="${P.balance}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  ${lineDots}
  ${rightAxis}
  ${labels}
</svg>`;
}

/* ─────────────────────────────────────────────────────────────
 * 4. Mostrador de cobertura (arco radial)
 * ───────────────────────────────────────────────────────────── */
export function apexCoverageDial(
  ratio: number | null,
  opts?: { size?: number; animate?: boolean; palette?: ApexPalette },
): string {
  const P = opts?.palette ?? APEX;
  const size = opts?.size ?? 260;
  const u = uid('ad');
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 26;
  const start = -220;
  const sweep = 260;
  /** 2.0x satura o arco — a escala é de leitura, não um cálculo financeiro. */
  const pct = ratio == null ? 0 : Math.max(0, Math.min(1, ratio / 2));
  const color = ratio == null ? P.muted : ratio >= 1.15 ? P.positive : ratio >= 1 ? P.attention : P.negative;

  const point = (angleDeg: number, radius: number) => {
    const rad = (angleDeg * Math.PI) / 180;
    return `${(cx + Math.cos(rad) * radius).toFixed(2)} ${(cy + Math.sin(rad) * radius).toFixed(2)}`;
  };
  const arc = (fromPct: number, toPct: number, radius: number) => {
    const a0 = start + sweep * fromPct;
    const a1 = start + sweep * toPct;
    const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
    return `M ${point(a0, radius)} A ${radius} ${radius} 0 ${large} 1 ${point(a1, radius)}`;
  };
  /** Marca do ponto de equilíbrio (1,00x) na escala do arco. */
  const breakEven = 0.5;

  return `<svg viewBox="0 0 ${size} ${size}" class="apex-dial" role="img" aria-label="Cobertura receita sobre folha">
  <defs>
    <linearGradient id="${u}-g" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="${color}" stop-opacity=".55"/>
      <stop offset="1" stop-color="${color}" stop-opacity="1"/>
    </linearGradient>
  </defs>
  <path d="${arc(0, 1, r)}" fill="none" stroke="${P.lineSoft}" stroke-width="14" stroke-linecap="round"/>
  ${pct > 0 ? `<path d="${arc(0, pct, r)}" fill="none" stroke="url(#${u}-g)" stroke-width="14" stroke-linecap="round"${opts?.animate ? ' class="apex-draw"' : ''}/>` : ''}
  <path d="${arc(breakEven, breakEven + 0.004, r + 13)}" fill="none" stroke="${P.ink}" stroke-opacity=".7" stroke-width="10" stroke-linecap="butt"/>
  <text x="${cx}" y="${cy + Math.round(size * 0.09)}" text-anchor="middle" fill="${color}" font-size="${Math.round(size * 0.24)}" font-weight="700" letter-spacing="-0.03em">${esc(formatInvestorRatio(ratio))}</text>
</svg>`;
}

/* ─────────────────────────────────────────────────────────────
 * 5. Sparkline para cartões de KPI
 * ───────────────────────────────────────────────────────────── */
export function apexSparkline(values: number[], color: string, opts?: { width?: number; height?: number }): string {
  if (values.length < 2) return '';
  const w = opts?.width ?? 120;
  const h = opts?.height ?? 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const u = uid('as');
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => h - ((v - min) / span) * (h - 4) - 2;
  const path = values.map((v, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" class="apex-spark" aria-hidden="true" preserveAspectRatio="none">
    <defs>${areaGradient(`${u}-a`, color, 0.35)}</defs>
    <path d="${path} L ${w} ${h} L 0 ${h} Z" fill="url(#${u}-a)"/>
    <path d="${path}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/** CSS que os SVGs acima esperam. Injetado uma vez por documento, por paleta. */
export function apexChartCss(palette: ApexPalette = APEX): string {
  return `
  .apex-chart { display: block; width: 100%; }
  .apex-grid { stroke: ${palette.grid}; stroke-dasharray: 3 7; }
  .apex-axisline { stroke: ${palette.axisLine}; }
  .apex-axis { fill: ${palette.muted}; font-size: 12px; letter-spacing: .02em; }
  .apex-axis-forecast { fill: ${palette.revenueForecast}; }
  .apex-bar { transform-origin: center bottom; }
  .apex-spark { display: block; }
`;
}

export const APEX_CHART_CSS = apexChartCss(APEX);

/** Animações — só o deck HTML as usa; o PDF importa apenas o CSS acima. */
export const APEX_CHART_ANIM_CSS = `
  @keyframes apexRise { from { transform: scaleY(.02); opacity: 0 } to { transform: scaleY(1); opacity: 1 } }
  @keyframes apexDraw { from { stroke-dasharray: 1 2400; } to { stroke-dasharray: 2400 0; } }
  .apex-rise { animation: apexRise .85s cubic-bezier(.22, 1, .36, 1) both; }
  .apex-draw { animation: apexDraw 1.5s ease-out both; }
  @media (prefers-reduced-motion: reduce) {
    .apex-rise, .apex-draw { animation: none !important; }
  }
`;

/** Legenda padronizada (mesmos rótulos/cores em PDF e HTML). */
export interface ApexLegendItem {
  label: string;
  color: string;
  /** Marca hachurada (previsto) ou traço (linha) em vez do bloco sólido. */
  shape?: 'solid' | 'hatch' | 'line' | 'dash';
}

export function apexLegend(items: ApexLegendItem[]): string {
  return `<div class="apex-legend">${items.map((item) => {
    const shape = item.shape ?? 'solid';
    const style = shape === 'hatch'
      ? `background: repeating-linear-gradient(45deg, ${item.color} 0 2px, transparent 2px 5px); border: 1px solid ${item.color};`
      : shape === 'line'
        ? `background: ${item.color}; height: 3px; border-radius: 2px;`
        : shape === 'dash'
          ? `background: repeating-linear-gradient(90deg, ${item.color} 0 5px, transparent 5px 9px); height: 3px;`
          : `background: ${item.color};`;
    return `<span class="apex-lg"><i class="apex-sw" style="${style}"></i>${esc(item.label)}</span>`;
  }).join('')}</div>`;
}

export function monthlyLegend(P: ApexPalette = APEX): ApexLegendItem[] {
  return [
    { label: SERIES_LABEL.revenueActual, color: P.revenue },
    { label: SERIES_LABEL.revenueForecast, color: P.revenueForecast, shape: 'hatch' },
    { label: SERIES_LABEL.payrollActual, color: P.payroll },
    { label: SERIES_LABEL.payrollForecast, color: P.payrollForecast, shape: 'hatch' },
  ];
}

export function curveLegend(P: ApexPalette = APEX): ApexLegendItem[] {
  return [
    { label: SERIES_LABEL.revenueCumulative, color: P.revenue, shape: 'line' },
    { label: SERIES_LABEL.payrollCumulative, color: P.payroll, shape: 'line' },
    { label: SERIES_LABEL.balanceCumulative, color: P.balance, shape: 'dash' },
  ];
}

export function balanceLegend(P: ApexPalette = APEX): ApexLegendItem[] {
  return [
    { label: `${SERIES_LABEL.balance} (positivo)`, color: P.positive },
    { label: `${SERIES_LABEL.balance} (negativo)`, color: P.negative },
    { label: `${SERIES_LABEL.balanceCumulative} — eixo direito`, color: P.balance, shape: 'line' },
  ];
}

export const MONTHLY_LEGEND: ApexLegendItem[] = monthlyLegend(APEX);
export const CURVE_LEGEND: ApexLegendItem[] = curveLegend(APEX);
export const BALANCE_LEGEND: ApexLegendItem[] = balanceLegend(APEX);

export function apexLegendCss(palette: ApexPalette = APEX): string {
  return `
  .apex-legend { display: flex; flex-wrap: wrap; gap: 6px 20px; margin-top: 10px; }
  .apex-lg { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: ${palette.muted}; }
  .apex-sw { display: inline-block; width: 16px; height: 9px; border-radius: 3px; flex: 0 0 auto; }
`;
}

export const APEX_LEGEND_CSS = apexLegendCss(APEX);
