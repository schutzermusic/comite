/** Métricas compartilhadas entre cabeçalho, linhas, barras e camada de setas. */

/**
 * 44px comporta DUAS linhas de título a 12px/16px sem estourar. Era 34px, que
 * só cabia uma linha truncada — nomes vindos do MS Project são longos e o
 * gestor não conseguia ler a atividade inteira sem abrir o drawer.
 *
 * Tudo que é vertical no gráfico deriva daqui (barras, marcos, setas, janela
 * de virtualização), então mudar esta constante reposiciona o resto sozinho.
 */
export const ROW_H = 44;
/** Altura das duas faixas do cabeçalho de datas (grupo + tick). */
export const HEADER_H = 44;

/** Acima disso o corpo passa a renderizar só a janela visível. */
export const VIRTUALIZE_THRESHOLD = 120;
export const OVERSCAN = 12;

/** Chaves das colunas do painel esquerdo (redimensionáveis como no Excel). */
export type GanttColKey =
  | 'wbs'
  | 'title'
  | 'progress'
  | 'start'
  | 'finish'
  | 'responsible'
  | 'status'
  | 'plannedHours'
  | 'loggedHours'
  | 'lastActivity'
  | 'signal';

/** Larguras padrão do painel esquerdo (px). */
export const COL_W: Record<GanttColKey, number> = {
  wbs: 64,
  // Coluna de título: antes era flex com min 260; agora tem largura própria
  // para o gestor poder alargar/encolher como no Excel.
  title: 260,
  progress: 52,
  // 68px cabe "25/05/26" inteiro a 12px + o padding da célula. Em 58px, que
  // servia para a fonte antiga de 11px, a data virava "25/05/…".
  start: 68,
  finish: 68,
  responsible: 44,
  // Cabe "EM ANDAMENTO"/"NÃO INICIADA" inteiros — em 88px o chip truncava.
  status: 112,
  plannedHours: 62,
  // "Apont." + valores tipo "12h" — 62 era largo demais ao lado do gráfico.
  loggedHours: 48,
  lastActivity: 76,
  signal: 26,
};

/** Largura mínima por coluna ao arrastar a borda. */
export const COL_MIN_W: Record<GanttColKey, number> = {
  wbs: 40,
  title: 120,
  progress: 36,
  start: 52,
  finish: 52,
  responsible: 32,
  status: 72,
  plannedHours: 44,
  loggedHours: 36,
  lastActivity: 52,
  signal: 20,
};

/** Teto ao arrastar — evita painel monstruoso por acidente. */
export const COL_MAX_W: Record<GanttColKey, number> = {
  wbs: 160,
  title: 640,
  progress: 100,
  start: 140,
  finish: 140,
  responsible: 120,
  status: 220,
  plannedHours: 120,
  loggedHours: 120,
  lastActivity: 140,
  signal: 48,
};

/** @deprecated Use COL_W.title — mantido para imports legados. */
export const TITLE_MIN_W = COL_W.title;

export type GanttColWidths = Record<GanttColKey, number>;

/** Mescla overrides do usuário com os padrões. */
export function resolveColWidths(overrides?: Partial<GanttColWidths> | null): GanttColWidths {
  if (!overrides) return { ...COL_W };
  return { ...COL_W, ...overrides };
}

export function clampColWidth(key: GanttColKey, width: number): number {
  return Math.min(COL_MAX_W[key], Math.max(COL_MIN_W[key], Math.round(width)));
}

/**
 * Largura do painel esquerdo = soma das colunas ligadas.
 *
 * Precisa existir porque a largura do painel é a MESMA usada para posicionar o
 * gráfico: se o conteúdo das células passar dela, ele invade a faixa das
 * barras. Por isso as colunas são ligadas/desligadas SÓ pelas flags de estado
 * — esconder por breakpoint de CSS dessincronizaria o cálculo do layout.
 */
export function panelWidthFor(
  columns: {
    responsible: boolean;
    status: boolean;
    plannedHours: boolean;
    loggedHours: boolean;
    lastActivity: boolean;
  },
  executionKnown: boolean,
  widths?: Partial<GanttColWidths> | null,
): number {
  const w = resolveColWidths(widths);
  let width = w.wbs + w.title + w.progress + w.start + w.finish + w.signal;
  if (columns.responsible) width += w.responsible;
  if (columns.status) width += w.status;
  if (executionKnown && columns.plannedHours) width += w.plannedHours;
  if (executionKnown && columns.loggedHours) width += w.loggedHours;
  if (executionKnown && columns.lastActivity) width += w.lastActivity;
  return width;
}
