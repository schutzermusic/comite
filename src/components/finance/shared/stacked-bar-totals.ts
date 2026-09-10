/**
 * Regras puras do empilhado com legenda-filtro.
 *
 * Vivem fora do componente porque são o que precisa de teste: qual série entra
 * no empilhamento e quanto soma cada competência depois do filtro. O componente
 * SVG só desenha o resultado.
 */

export interface StackedSeriesInput {
  name: string;
  data: number[];
}

/**
 * Séries que continuam visíveis, na ordem original de empilhamento.
 *
 * Filtrar por nome (e não por índice) mantém a seleção estável quando o pack
 * ganha ou perde um cliente entre dois renders.
 */
export function visibleStackedSeries<T extends StackedSeriesInput>(series: T[], hidden: readonly string[]): T[] {
  const hiddenSet = new Set(hidden);
  return series.filter((item) => !hiddenSet.has(item.name));
}

/**
 * Total visível por competência: soma apenas das séries selecionadas.
 *
 * É esse valor — não o total canônico do mês — que vai para o rótulo acima da
 * coluna, senão o número contradiz a barra logo abaixo dele.
 */
export function visibleStackedTotals(
  series: readonly StackedSeriesInput[],
  categoryCount: number,
  hidden: readonly string[] = [],
): number[] {
  const visible = visibleStackedSeries(series as StackedSeriesInput[], hidden);
  return Array.from({ length: categoryCount }, (_, index) =>
    visible.reduce((total, item) => total + Math.abs(item.data[index] || 0), 0),
  );
}

/** Alterna uma série no conjunto oculto (seleção múltipla, sem duplicar nomes). */
export function toggleHiddenSeries(hidden: readonly string[], name: string): string[] {
  return hidden.includes(name) ? hidden.filter((item) => item !== name) : [...hidden, name];
}

/**
 * Rótulo executivo em pt-BR: `R$ 1,2 mi`, `R$ 850 mil`, `R$ 940`.
 *
 * O valor exato continua no tooltip e no `<title>` do rótulo — o formato
 * compacto existe para leitura de topo de barra, não para substituir a fonte.
 */
export function formatCompactBRL(value: number): string {
  const magnitude = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const nf = (amount: number, digits: number) =>
    new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(amount);
  if (magnitude >= 1e9) return `${sign}R$ ${nf(magnitude / 1e9, 1)} bi`;
  if (magnitude >= 1e6) return `${sign}R$ ${nf(magnitude / 1e6, 1)} mi`;
  if (magnitude >= 1e3) return `${sign}R$ ${nf(magnitude / 1e3, 0)} mil`;
  return `${sign}${formatBRL(magnitude)}`;
}

export function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(value);
}
