import { describe, expect, it } from 'vitest';
import {
  formatCompactBRL,
  toggleHiddenSeries,
  visibleStackedSeries,
  visibleStackedTotals,
} from '@/components/finance/shared/stacked-bar-totals';

const SERIES = [
  { name: 'AXIA', data: [1_000_000, 900_000, 800_000] },
  { name: 'Petrobras', data: [500_000, 450_000, 400_000] },
  { name: 'Enel', data: [250_000, 200_000, 150_000] },
  { name: 'CEMIG', data: [100_000, 120_000, 140_000] },
];

describe('projeção por cliente — legenda-filtro', () => {
  it('parte com todos os clientes selecionados', () => {
    expect(visibleStackedSeries(SERIES, []).map((s) => s.name)).toEqual(['AXIA', 'Petrobras', 'Enel', 'CEMIG']);
    expect(visibleStackedTotals(SERIES, 3)).toEqual([1_850_000, 1_670_000, 1_490_000]);
  });

  it('remove um cliente deselecionado de todas as competências', () => {
    const hidden = toggleHiddenSeries([], 'CEMIG');
    expect(hidden).toEqual(['CEMIG']);
    expect(visibleStackedSeries(SERIES, hidden).map((s) => s.name)).not.toContain('CEMIG');
    expect(visibleStackedTotals(SERIES, 3, hidden)).toEqual([1_750_000, 1_550_000, 1_350_000]);
  });

  it('suporta múltiplos clientes deselecionados ao mesmo tempo', () => {
    const hidden = toggleHiddenSeries(toggleHiddenSeries([], 'CEMIG'), 'Enel');
    expect(hidden).toEqual(['CEMIG', 'Enel']);
    expect(visibleStackedTotals(SERIES, 3, hidden)).toEqual([1_500_000, 1_350_000, 1_200_000]);
  });

  it('suporta apenas um cliente selecionado', () => {
    const hidden = ['AXIA', 'Petrobras', 'Enel'];
    expect(visibleStackedSeries(SERIES, hidden).map((s) => s.name)).toEqual(['CEMIG']);
    expect(visibleStackedTotals(SERIES, 3, hidden)).toEqual([100_000, 120_000, 140_000]);
  });

  it('restaura a série ao reselecionar, sem duplicar', () => {
    const off = toggleHiddenSeries([], 'CEMIG');
    const on = toggleHiddenSeries(off, 'CEMIG');
    expect(on).toEqual([]);
    expect(toggleHiddenSeries(toggleHiddenSeries(on, 'Enel'), 'Enel')).toEqual([]);
    expect(visibleStackedSeries(SERIES, on)).toHaveLength(4);
    expect(visibleStackedTotals(SERIES, 3, on)).toEqual([1_850_000, 1_670_000, 1_490_000]);
  });

  it('preserva a ordem de empilhamento das séries visíveis', () => {
    expect(visibleStackedSeries(SERIES, ['Petrobras']).map((s) => s.name)).toEqual(['AXIA', 'Enel', 'CEMIG']);
  });

  it('zera o total quando nenhum cliente está selecionado', () => {
    expect(visibleStackedTotals(SERIES, 3, ['AXIA', 'Petrobras', 'Enel', 'CEMIG'])).toEqual([0, 0, 0]);
  });

  it('formata o total em pt-BR compacto', () => {
    expect(formatCompactBRL(1_200_000)).toBe('R$ 1,2 mi');
    expect(formatCompactBRL(1_850_000)).toBe('R$ 1,9 mi');
    expect(formatCompactBRL(850_000)).toBe('R$ 850 mil');
    expect(formatCompactBRL(2_400_000_000)).toBe('R$ 2,4 bi');
    // Abaixo de mil cai no formato de moeda cheio do Intl, que usa espaço fino.
    expect(formatCompactBRL(940)).toBe('R$\u00a0940');
    expect(formatCompactBRL(0)).toBe('R$\u00a00');
  });
});
