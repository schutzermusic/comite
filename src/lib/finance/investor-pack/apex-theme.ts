/**
 * Apex — design tokens da experiência de relatório de Faturamento vs Folha.
 *
 * Fonte única de verdade visual para os três destinos de export (PDF, PPTX e
 * apresentação HTML), de modo que os três leiam como o mesmo produto.
 *
 * Duas paletas: `APEX_DARK` (padrão — vidro/HUD, material de tela e projeção) e
 * `APEX_LIGHT` (documento para impressão/anexo, com as cores da marca em
 * contraste de tinta). Mesmas chaves nas duas, para que qualquer componente
 * receba a paleta como parâmetro e não precise saber em qual modo está.
 *
 * Aqui não existe regra financeira — apenas cor, tipografia, elevação e rótulo.
 */

import { FONT_FAMILY_SANS } from '@/lib/fonts';
import type { InvestorPackConfidentiality } from './types';

export type ApexThemeMode = 'dark' | 'light';

export interface ApexPalette {
  mode: ApexThemeMode;
  /** Fundo do documento / slide. */
  void: string;
  /** Fundo de painel (topo do gradiente). */
  panelTop: string;
  /** Fundo de painel (base do gradiente). */
  panelBottom: string;
  /** Contornos. */
  line: string;
  lineSoft: string;
  /** Texto. */
  ink: string;
  body: string;
  muted: string;
  subtle: string;
  /** Séries. */
  revenue: string;
  revenueForecast: string;
  payroll: string;
  payrollForecast: string;
  balance: string;
  /** Semântico. */
  positive: string;
  attention: string;
  negative: string;
  /** Traços de eixo/grade dos gráficos (já com alpha). */
  grid: string;
  axisLine: string;
  /** Realce de citação (blockquote do fecho). */
  quote: string;
  /** Superfície levemente destacada (zebra de tabela, cabeçalho). */
  raised: string;
}

/** Paleta escura — hex puro nas séries para que o PPTX use o mesmo token. */
export const APEX_DARK: ApexPalette = {
  mode: 'dark',
  void: '#040A10',
  panelTop: '#0C1C24',
  panelBottom: '#06121A',
  line: '#1E3A42',
  lineSoft: '#132A32',
  ink: '#F2FAF9',
  body: '#CBDBDD',
  muted: '#8CA5AB',
  subtle: '#5E7880',
  revenue: '#35E6BB',
  revenueForecast: '#4C9DFF',
  payroll: '#FF6B81',
  payrollForecast: '#FFB74D',
  balance: '#9C8CFF',
  positive: '#35E6BB',
  attention: '#FFB74D',
  negative: '#FF6B81',
  grid: 'rgba(180, 230, 222, .09)',
  axisLine: 'rgba(180, 230, 222, .28)',
  quote: '#DFF9F3',
  raised: 'rgba(255, 255, 255, .04)',
};

/**
 * Paleta clara — documento impresso. As séries usam variantes de tinta (não os
 * neons da tela): o verde é o da própria marca Insight Energy, o que amarra o
 * relatório à logo do cabeçalho.
 */
export const APEX_LIGHT: ApexPalette = {
  mode: 'light',
  void: '#FFFFFF',
  panelTop: '#F6FAFB',
  panelBottom: '#FFFFFF',
  line: '#CBD8DE',
  lineSoft: '#E4EBEF',
  ink: '#0B1A20',
  body: '#26383F',
  muted: '#5B7078',
  subtle: '#7E939C',
  revenue: '#00874A',
  revenueForecast: '#1D4ED8',
  payroll: '#BE2A3E',
  payrollForecast: '#B45309',
  balance: '#6D3FD4',
  positive: '#00874A',
  attention: '#B45309',
  negative: '#BE2A3E',
  grid: 'rgba(11, 26, 32, .09)',
  axisLine: 'rgba(11, 26, 32, .3)',
  quote: '#0B3B2A',
  raised: 'rgba(11, 26, 32, .035)',
};

export function apexPalette(mode: ApexThemeMode): ApexPalette {
  return mode === 'light' ? APEX_LIGHT : APEX_DARK;
}

/** Paleta padrão (escura) — mantida para os consumidores que só têm um tema. */
export const APEX = APEX_DARK;

export const APEX_FONT = FONT_FAMILY_SANS;

/** Rótulos de série — usados nas legendas dos três destinos, sem divergir. */
export const SERIES_LABEL = {
  revenueActual: 'Faturamento realizado',
  revenueForecast: 'Faturamento previsto',
  payrollActual: 'Folha fechada + encargos',
  payrollForecast: 'Folha projetada',
  revenueCumulative: 'Faturamento acumulado',
  payrollCumulative: 'Folha acumulada',
  balance: 'Saldo do mês',
  balanceCumulative: 'Saldo acumulado',
} as const;

/** Fonte do dado — exibida em todo rodapé, em todos os destinos. */
export const APEX_SOURCE = 'Dados informados do sistema na Projeção Financeira';
export const APEX_CLIENT_FORECAST_DESCRIPTION = 'A composição mensal reflete o cronograma contratual e a evolução prevista da carteira de clientes.';
export const APEX_CLOSING_TITLE = 'Confiança para investir, clareza para crescer';
export const APEX_CLOSING_MESSAGE = 'Seguimos comprometidos com uma execução disciplinada, crescimento sustentável e geração consistente de valor para nossos investidores.';
const LEGACY_CLOSING_MESSAGE = 'Atualizar as premissas e os valores mensais à medida que novas informações forem consolidadas.';

export function investorClosingMessage(message?: string | null): string {
  const normalized = message?.trim();
  return !normalized || normalized === LEGACY_CLOSING_MESSAGE ? APEX_CLOSING_MESSAGE : normalized;
}

/** Marca institucional do material (a logo embutida em `apex-logo.ts`). */
export const APEX_BRAND = 'Insight Energy';
/** Nome curto do módulo exibido nas capas e sobrelinhas das apresentações. */
export const APEX_MODULE = 'Projeção Financeira';

/** Nome do relatório — o mesmo em PDF, PPTX, HTML e nos nomes de arquivo. */
export const REPORT_NAME = 'Relatório de Faturamento vs Folha de Pagamento';
/** Forma curta, para sobrelinhas e chips onde o nome completo não cabe. */
export const REPORT_NAME_SHORT = 'Faturamento vs Folha de Pagamento';
/** Segmento de nome de arquivo. */
export const REPORT_FILE_SLUG = 'relatorio-faturamento-vs-folha';

export function confidentialityLabel(value: InvestorPackConfidentiality): string {
  if (value === 'confidential') return 'CONFIDENCIAL';
  if (value === 'restricted') return 'USO RESTRITO';
  return 'PÚBLICO';
}

/** Sombras/elevações do tratamento de vidro (válidas em impressão). */
export const APEX_ELEV = {
  panel: '0 24px 60px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
  card: '0 10px 26px rgba(0, 0, 0, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
} as const;

/** Gradiente de vidro de painel (CSS). */
export function apexGlass(palette: ApexPalette = APEX): string {
  return `linear-gradient(160deg, ${palette.panelTop} 0%, ${palette.panelBottom} 100%)`;
}

/**
 * Malha/aura de fundo do documento — o "cockpit". Usada no deck HTML e no PDF;
 * no PPTX o equivalente é resolvido com formas, porque OOXML não tem radial-gradient.
 * No tema claro a aura é discreta (papel), mantendo a grade como textura leve.
 */
export function apexBackdrop(opts?: { grid?: number; intensity?: number; palette?: ApexPalette }): { image: string; size: string } {
  const grid = opts?.grid ?? 34;
  const k = opts?.intensity ?? 1;
  const light = (opts?.palette ?? APEX).mode === 'light';
  const glowA = light ? `rgba(0, 135, 74, ${0.055 * k})` : `rgba(53, 230, 187, ${0.13 * k})`;
  const glowB = light ? `rgba(29, 78, 216, ${0.045 * k})` : `rgba(76, 157, 255, ${0.11 * k})`;
  const mesh = light ? `rgba(11, 26, 32, ${0.032 * k})` : `rgba(255, 255, 255, ${0.016 * k})`;
  return {
    image: [
      `radial-gradient(circle at 84% 6%, ${glowA}, transparent 34%)`,
      `radial-gradient(circle at 8% 92%, ${glowB}, transparent 36%)`,
      `linear-gradient(${mesh} 1px, transparent 1px)`,
      `linear-gradient(90deg, ${mesh} 1px, transparent 1px)`,
    ].join(', '),
    size: `auto, auto, ${grid}px ${grid}px, ${grid}px ${grid}px`,
  };
}

/** Escala tipográfica do deck/relatório (px na base de 1280×720 do slide). */
export const APEX_TYPE = {
  eyebrow: 12,
  display: 58,
  h1: 44,
  h2: 30,
  h3: 20,
  body: 17,
  small: 13,
  micro: 10,
} as const;

/** Razão de cobertura em pt-BR: 2.15 → "2,15x" (nunca com ponto decimal). */
export function formatInvestorRatio(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return 'N/D';
  return `${ratio.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`;
}

/**
 * Zero em relatório executivo é ruído: a célula vazia comunica "não informado"
 * melhor que uma coluna de "R$ 0,00". Só para exibição — o dado segue zero.
 */
export function dashIfZero(cents: number, formatted: string): string {
  return cents === 0 ? '—' : formatted;
}

/** Cor de valor conforme o sinal do número (saldo, delta). */
export function signColor(value: number, palette: ApexPalette = APEX): string {
  if (value > 0) return palette.positive;
  if (value < 0) return palette.negative;
  return palette.muted;
}
