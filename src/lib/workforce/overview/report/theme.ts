/**
 * Tokens visuais dos documentos de Pessoas & Custos.
 *
 * Fonte única de verdade para o PDF, o deck HTML e o PowerPoint. Mudança
 * visual nos três acontece AQUI; nenhum cálculo entra neste arquivo.
 *
 * ─── Por que uma paleta própria, e não a do engine claro compartilhado ─────
 *
 * `src/lib/reports/report-theme.ts` serve ~15 telas e é deliberadamente sóbrio.
 * O material do cockpit é de board: precisa de uma direção escura para
 * apresentação em projetor e de uma clara para circular impresso. Alterar o
 * tema compartilhado mudaria os quinze relatórios; por isso os tokens moram
 * aqui, exatamente como a Projeção Financeira faz em `apex-theme.ts`.
 *
 * ─── Regra das duas paletas ────────────────────────────────────────────────
 *
 * Cor nova entra nas DUAS paletas e é lida de `palette.<chave>`. Um rgba
 * escuro hardcoded no meio de um gráfico quebra o tema claro em silêncio — o
 * tipo de defeito que só aparece quando alguém imprime.
 */

import { FONT_FAMILY_SANS } from '@/lib/fonts';
import type { WorkforceReportTheme } from '../types';

export type { WorkforceReportTheme };

export interface WorkforcePalette {
  mode: WorkforceReportTheme;
  /** Fundo do documento / slide. */
  void: string;
  panelTop: string;
  panelBottom: string;
  line: string;
  lineSoft: string;
  /** Texto. */
  ink: string;
  body: string;
  muted: string;
  subtle: string;
  /** Séries — espelham os tons do kit de tela (accent, success, …). */
  accent: string;
  success: string;
  info: string;
  warning: string;
  danger: string;
  budget: string;
  /** Semântico. */
  positive: string;
  attention: string;
  negative: string;
  /** Eixos e grade, já com alpha. */
  grid: string;
  axisLine: string;
  /** Superfícies auxiliares. */
  raised: string;
  /** Tom do "não apurado": presente, legível e sem carga semântica. */
  unmeasured: string;
}

/**
 * Paleta escura — apresentação.
 *
 * As séries repetem os hex do kit de tela (`PALETTE_DARK` em
 * `FuturisticCharts.tsx`) para que o gráfico do documento e o da tela sejam a
 * MESMA imagem, não duas parecidas.
 */
export const WF_DARK: WorkforcePalette = {
  mode: 'dark',
  void: '#050B12',
  panelTop: '#0D1A24',
  panelBottom: '#07121A',
  line: '#1D3542',
  lineSoft: '#132630',
  ink: '#F2F7FA',
  body: '#C6D6DE',
  muted: '#8AA0AC',
  subtle: '#5C7482',
  accent: '#22D3EE',
  success: '#34D399',
  info: '#818CF8',
  warning: '#FBBF24',
  danger: '#F87171',
  budget: '#A78BFA',
  positive: '#34D399',
  attention: '#FBBF24',
  negative: '#F87171',
  grid: 'rgba(180, 220, 235, .09)',
  axisLine: 'rgba(180, 220, 235, .28)',
  raised: 'rgba(255, 255, 255, .04)',
  unmeasured: '#5C7482',
};

/**
 * Paleta clara — documento impresso.
 *
 * Séries em variantes de tinta, não nos neons da tela: sobre papel branco o
 * ciano de tela vira quase invisível. São os mesmos hex de `PALETTE_LIGHT`.
 */
export const WF_LIGHT: WorkforcePalette = {
  mode: 'light',
  void: '#FFFFFF',
  panelTop: '#F7FAFB',
  panelBottom: '#FFFFFF',
  line: '#CBD8DE',
  lineSoft: '#E4EBEF',
  ink: '#0B1A20',
  body: '#26383F',
  muted: '#5B7078',
  subtle: '#7E939C',
  accent: '#0891B2',
  success: '#059669',
  info: '#4F46E5',
  warning: '#B45309',
  danger: '#DC2626',
  budget: '#7C3AED',
  positive: '#059669',
  attention: '#B45309',
  negative: '#DC2626',
  grid: 'rgba(11, 26, 32, .09)',
  axisLine: 'rgba(11, 26, 32, .30)',
  raised: 'rgba(11, 26, 32, .035)',
  unmeasured: '#7E939C',
};

export function wfPalette(mode: WorkforceReportTheme): WorkforcePalette {
  return mode === 'light' ? WF_LIGHT : WF_DARK;
}

export const WF_FONT = FONT_FAMILY_SANS;

/** Escala tipográfica dos documentos, em px sobre a grade de 1280×720. */
export const WF_TYPE = {
  displayXl: 46,
  display: 34,
  title: 24,
  section: 18,
  body: 13.5,
  small: 11.5,
  micro: 10,
  kpi: 30,
  kpiSmall: 22,
} as const;

export const WF_ELEV = {
  panel: '0 1px 0 rgba(255,255,255,.04) inset, 0 12px 32px rgba(0,0,0,.28)',
  panelLight: '0 1px 0 rgba(255,255,255,.9) inset, 0 8px 24px rgba(11,26,32,.08)',
  card: '0 6px 18px rgba(0,0,0,.22)',
  cardLight: '0 4px 14px rgba(11,26,32,.07)',
} as const;

export function wfPanelShadow(p: WorkforcePalette): string {
  return p.mode === 'light' ? WF_ELEV.panelLight : WF_ELEV.panel;
}

export function wfGlass(p: WorkforcePalette): string {
  return `background:linear-gradient(160deg, ${p.panelTop}, ${p.panelBottom});border:1px solid ${p.line};box-shadow:${wfPanelShadow(p)};`;
}

/** Malha de fundo — a mesma textura do estado vazio da tela. */
export function wfBackdrop(p: WorkforcePalette, opts?: { grid?: number }): string {
  const step = opts?.grid ?? 34;
  return (
    `background-color:${p.void};` +
    `background-image:linear-gradient(${p.grid} 1px, transparent 1px),linear-gradient(90deg, ${p.grid} 1px, transparent 1px);` +
    `background-size:${step}px ${step}px;`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Identidade do material
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A marca NÃO mora aqui.
 *
 * Nome e logo vêm de `model.meta.branding`, alimentado pelo que o
 * administrador configurou em Configurações › Branding. Uma constante de marca
 * neste arquivo voltaria a ser usada por engano no primeiro documento novo, e
 * o material sairia com a marca da plataforma no lugar da do cliente.
 */
export const WF_MODULE = 'Pessoas & Custos';

/**
 * Área de respiro da marca, em px sobre a grade do documento.
 *
 * O logo do cliente pode ser largo, quadrado ou vertical. Fixar a ALTURA e
 * deixar a largura seguir a proporção é o que impede distorção; a margem
 * garante que a marca nunca encoste em texto ou borda.
 */
export const WF_LOGO = {
  coverHeight: 46,
  coverMaxWidth: 300,
  footerHeight: 14,
  footerMaxWidth: 110,
  safeArea: 14,
} as const;
export const REPORT_NAME = 'Relatório Executivo de Pessoas & Custos';
export const REPORT_NAME_SHORT = 'Pessoas & Custos';
export const REPORT_FILE_SLUG = 'relatorio-pessoas-e-custos';
export const WF_SOURCE = 'Folha de pagamento aprovada e eventos apurados do eSocial';

/**
 * Roteiro dos documentos — a MESMA ordem no PDF, no deck e no PowerPoint.
 *
 * Centralizar o roteiro é o que impede os três de contarem a história em
 * ordens diferentes conforme cada um for editado.
 */
export function wfAgenda(opts: {
  hasEfficiency: boolean;
  hasDynamics: boolean;
  hasCostStructure: boolean;
  hasConcentration: boolean;
}): { id: string; title: string; sub: string }[] {
  return [
    { id: 'resumo', title: 'Resumo executivo', sub: 'Indicadores-chave e sinais do período' },
    ...(opts.hasEfficiency
      ? [{ id: 'eficiencia', title: 'Eficiência & produtividade', sub: 'Receita e custo por colaborador' }]
      : []),
    ...(opts.hasDynamics
      ? [{ id: 'dinamica', title: 'Dinâmica do quadro', sub: 'Movimentação, rotatividade e absenteísmo' }]
      : []),
    ...(opts.hasCostStructure
      ? [{ id: 'custo', title: 'Estrutura de custo', sub: 'Composição da folha e evolução acumulada' }]
      : []),
    ...(opts.hasConcentration
      ? [{ id: 'concentracao', title: 'Risco & concentração', sub: 'Dependência dos maiores centros de custo' }]
      : []),
    { id: 'conformidade', title: 'Conformidade', sub: 'Ciclo folha → eSocial → guias' },
    { id: 'metodologia', title: 'Procedência & método', sub: 'Fontes, recorte e o que não foi apurado' },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// Formatação
// ═══════════════════════════════════════════════════════════════════════════

/** O traço do "não apurado". Um único glifo, em todos os documentos. */
export const UNMEASURED_DASH = '–';

export function wfCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(value);
}

export function wfCompactCurrency(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1).replace('.', ',')} mi`;
  if (abs >= 1_000) return `R$ ${(value / 1_000).toFixed(0)} mil`;
  return wfCurrency(value);
}

export function wfInt(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(Math.round(value));
}

export function wfPct(value: number, digits = 1): string {
  return `${value.toFixed(digits).replace('.', ',')}%`;
}

export function wfSignedPct(value: number, digits = 1): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(digits).replace('.', ',')}%`;
}

/** Cor do sinal de uma variação, respeitando se subir é bom. */
export function wfSignColor(value: number, p: WorkforcePalette, upIsGood = true): string {
  if (Math.abs(value) < 0.05) return p.muted;
  return value > 0 === upIsGood ? p.positive : p.negative;
}
