/** Métricas compartilhadas entre cabeçalho, linhas, barras e camada de setas. */

export const ROW_H = 34;
/** Altura das duas faixas do cabeçalho de datas (grupo + tick). */
export const HEADER_H = 44;

/** Acima disso o corpo passa a renderizar só a janela visível. */
export const VIRTUALIZE_THRESHOLD = 120;
export const OVERSCAN = 12;

/** Larguras fixas do painel esquerdo (px). A coluna de título ocupa o resto. */
export const COL_W = {
  wbs: 64,
  progress: 52,
  start: 58,
  finish: 58,
  responsible: 44,
  // Cabe "EM ANDAMENTO"/"NÃO INICIADA" inteiros — em 88px o chip truncava.
  status: 112,
  plannedHours: 62,
  loggedHours: 62,
  lastActivity: 76,
  signal: 26,
} as const;

/** Largura mínima da coluna de título antes de o texto começar a truncar. */
export const TITLE_MIN_W = 180;

/**
 * Largura mínima que o painel esquerdo precisa para caber as colunas ligadas.
 *
 * Precisa existir porque a largura do painel é a MESMA usada para posicionar o
 * gráfico: se o conteúdo das células passar dela, ele invade a faixa das
 * barras. Por isso as colunas são ligadas/desligadas SÓ pelas flags de estado
 * — esconder por breakpoint de CSS dessincronizaria o cálculo do layout.
 */
export function panelWidthFor(
  columns: { responsible: boolean; status: boolean; plannedHours: boolean; loggedHours: boolean; lastActivity: boolean },
  executionKnown: boolean,
): number {
  let width = COL_W.wbs + TITLE_MIN_W + COL_W.progress + COL_W.start + COL_W.finish + COL_W.signal;
  if (columns.responsible) width += COL_W.responsible;
  if (columns.status) width += COL_W.status;
  if (executionKnown && columns.plannedHours) width += COL_W.plannedHours;
  if (executionKnown && columns.loggedHours) width += COL_W.loggedHours;
  if (executionKnown && columns.lastActivity) width += COL_W.lastActivity;
  return width;
}
