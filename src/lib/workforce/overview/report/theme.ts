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
 *
 * ─── Por que os cinzas são mais escuros que os do tema de tela ─────────────
 *
 * Num monitor retroiluminado um cinza claro ainda se lê. No papel ele
 * desaparece: a impressora reticula o tom, o contraste real cai e rótulo de
 * eixo, texto de apoio e legenda somem. Os tons de texto do claro são
 * calibrados para contraste sobre branco, não para elegância em tela —
 * `muted` fica em ~8:1 e `subtle` em ~5,6:1, ambos acima do mínimo de AA para
 * corpo pequeno.
 *
 * `unmeasured` é o único que fica deliberadamente mais leve: ele precisa ser
 * legível E parecer ausente. Abaixo dele o traço vira sujeira; acima, o "não
 * apurado" compete com o dado que existe.
 */
export const WF_LIGHT: WorkforcePalette = {
  mode: 'light',
  void: '#FFFFFF',
  panelTop: '#F7FAFB',
  panelBottom: '#FFFFFF',
  line: '#C2D1D8',
  lineSoft: '#DFE7EB',
  ink: '#0B1A20',
  body: '#1E2E35',
  muted: '#3F5159',
  subtle: '#5A6C75',
  accent: '#0891B2',
  success: '#059669',
  info: '#4F46E5',
  warning: '#B45309',
  danger: '#DC2626',
  budget: '#7C3AED',
  positive: '#059669',
  attention: '#B45309',
  negative: '#DC2626',
  grid: 'rgba(11, 26, 32, .12)',
  axisLine: 'rgba(11, 26, 32, .38)',
  raised: 'rgba(11, 26, 32, .04)',
  unmeasured: '#6E8089',
};

export function wfPalette(mode: WorkforceReportTheme): WorkforcePalette {
  return mode === 'light' ? WF_LIGHT : WF_DARK;
}

export const WF_FONT = FONT_FAMILY_SANS;

/**
 * Escala tipográfica dos documentos, em px sobre a grade de 1280×720.
 *
 * São os MESMOS degraus de `APEX_TYPE` (Projeção Financeira). Os dois materiais
 * saem para o mesmo board, muitas vezes na mesma reunião: uma escala própria
 * aqui faria o título de um slide chegar maior que o do outro sem nenhuma razão
 * editorial.
 */
export const WF_TYPE = {
  eyebrow: 12,
  display: 58,
  h1: 44,
  h2: 30,
  h3: 20,
  body: 17,
  small: 13,
  micro: 10,
} as const;

/**
 * Sombras/elevações, por tema.
 *
 * No escuro a profundidade vem da sombra densa sobre o fundo preto — é o
 * tratamento de vidro do cockpit.
 *
 * No claro ela vem de sombras curtas e de baixa opacidade, em duas camadas
 * (um contato de 1–2px e um halo difuso). É o que a folha impressa aguenta:
 * sombra pesada sobre papel branco vira mancha cinza na impressora, e sombra
 * nenhuma deixa o painel indistinguível do fundo.
 */
export const WF_ELEV = {
  panel: '0 24px 60px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
  card: '0 10px 26px rgba(0, 0, 0, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
  band: '0 22px 60px rgba(0, 0, 0, 0.38)',
  panelLight: '0 1px 2px rgba(11, 26, 32, .05), 0 10px 26px -8px rgba(11, 26, 32, .12)',
  cardLight: '0 1px 2px rgba(11, 26, 32, .05), 0 5px 14px -5px rgba(11, 26, 32, .10)',
  bandLight: '0 2px 4px rgba(11, 26, 32, .04), 0 14px 34px -12px rgba(11, 26, 32, .14)',
} as const;

const isLight = (p: WorkforcePalette) => p.mode === 'light';

export function wfPanelShadow(p: WorkforcePalette): string {
  return isLight(p) ? WF_ELEV.panelLight : WF_ELEV.panel;
}

export function wfCardShadow(p: WorkforcePalette): string {
  return isLight(p) ? WF_ELEV.cardLight : WF_ELEV.card;
}

export function wfBandShadow(p: WorkforcePalette): string {
  return isLight(p) ? WF_ELEV.bandLight : WF_ELEV.band;
}

/** Gradiente de vidro de painel (CSS). */
export function wfGlass(p: WorkforcePalette): string {
  return `linear-gradient(160deg, ${p.panelTop} 0%, ${p.panelBottom} 100%)`;
}

/**
 * Superfície de cartão/painel.
 *
 * No escuro é vidro translúcido — deixa a malha do fundo atravessar, que é o
 * que dá profundidade ao cockpit. No claro é papel opaco levemente tingido:
 * translucidez sobre branco não produz nada além de cinza sujo.
 */
export function wfSurface(p: WorkforcePalette, from = 0.92, to = 0.55): string {
  return p.mode === 'light'
    ? `linear-gradient(160deg, ${p.panelTop} 0%, ${p.panelBottom} 100%)`
    : `linear-gradient(160deg, rgba(13, 26, 36, ${from}), rgba(7, 18, 26, ${to}))`;
}

/**
 * Fundo do documento.
 *
 * ─── Escuro: o "cockpit" ───────────────────────────────────────────────────
 *
 * Duas auras radiais nos cantos opostos sobre uma malha fina, exatamente como
 * `apexBackdrop`. É o que separa o material de board de uma folha preta com
 * gráficos: sem as auras a malha sozinha lê como papel milimetrado.
 *
 * ─── Claro: papel ──────────────────────────────────────────────────────────
 *
 * NENHUMA malha, nenhuma aura. O tema claro existe para ser impresso e
 * anexado, e ali a textura de fundo é só custo: quadriculado de 34px vira
 * moiré na resolução da impressora, come toner e disputa atenção com a grade
 * dos próprios gráficos, que é a única grade que significa alguma coisa.
 *
 * A profundidade no claro vem inteiramente das sombras dos painéis
 * (`wfPanelShadow`, `wfCardShadow`, `wfBandShadow`) — que sobrevivem à
 * impressão porque são curtas e de baixa opacidade.
 */
export function wfBackdrop(
  p: WorkforcePalette,
  opts?: { grid?: number; intensity?: number },
): { image: string; size: string } {
  if (isLight(p)) return { image: 'none', size: 'auto' };

  const grid = opts?.grid ?? 34;
  const k = opts?.intensity ?? 1;
  const glowA = `rgba(34, 211, 238, ${0.13 * k})`;
  const glowB = `rgba(129, 140, 248, ${0.11 * k})`;
  const mesh = `rgba(255, 255, 255, ${0.016 * k})`;
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

/*
 * Não há selo de confidencialidade neste material.
 *
 * Existiu um `WF_CONFIDENTIALITY = 'USO INTERNO'` na capa e nos rodapés, por
 * analogia com o `confidentialityLabel` da Projeção Financeira. Lá o rótulo é
 * escolhido pelo autor do pack e carrega decisão; aqui era carimbo fixo, e
 * carimbo que nunca muda não informa nada — só ocupa a linha em que a marca e
 * o período precisam aparecer.
 */

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

/**
 * Data de vencimento em pt-BR.
 *
 * As obrigações chegam em ISO (`2026-07-03`), que é a forma certa para
 * ordenar e a errada para ler: num documento em português `2026-07-03` obriga
 * o leitor a decidir se o mês vem antes ou depois do dia.
 *
 * Parse manual em vez de `new Date(iso)` — a string sem fuso é interpretada
 * como UTC, e no horário de Brasília isso devolve o dia anterior.
 */
export function wfDueDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

/** Cor do sinal de uma variação, respeitando se subir é bom. */
export function wfSignColor(value: number, p: WorkforcePalette, upIsGood = true): string {
  if (Math.abs(value) < 0.05) return p.muted;
  return value > 0 === upIsGood ? p.positive : p.negative;
}
