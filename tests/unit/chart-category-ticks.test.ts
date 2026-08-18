/**
 * Afinamento dos rótulos de categoria do kit de gráficos da tela.
 *
 * O kit serve ~15 telas do Financeiro além do cockpit de Pessoas & Custos, e
 * antes desenhava TODOS os rótulos. A regra nova precisa de duas garantias, e
 * a primeira é a que protege as outras telas: onde já cabia, nada muda.
 */

import { describe, expect, it } from 'vitest';

import { visibleCategoryTicks } from '@/components/finance/shared/chart-axis';

/** Competências como o cockpit as rotula. */
const months = (n: number) =>
  Array.from({ length: n }, (_, i) => `${['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][i % 12]}/${2026 + Math.floor(i / 12)}`);

describe('visibleCategoryTicks', () => {
  it('desenha todos os rótulos quando eles cabem', () => {
    // Seis competências num painel largo: o caso das telas que já existiam.
    const cats = months(6);
    const ticks = visibleCategoryTicks(cats, 900);
    expect(ticks.size).toBe(cats.length);
  });

  it('nunca deixa dois rótulos colidirem, em nenhuma largura', () => {
    /**
     * A primeira versão testava só 430px e passava; a 640px o passo caía de 4
     * para 3, o último rótulo entrava com meio passo de folga e `Out/2026`
     * encostava em `Dez/2026`. Só apareceu ao renderizar o componente de
     * verdade — daí a varredura de larguras aqui.
     */
    const needed = 'Jan/2026'.length * 10 * 0.58;
    for (const width of [300, 380, 430, 500, 560, 640, 760, 900, 1180]) {
      for (const n of [2, 5, 6, 9, 12, 18, 24, 36]) {
        const cats = months(n);
        const drawn = [...visibleCategoryTicks(cats, width)].sort((a, b) => a - b);
        if (drawn.length === n) continue; // coube tudo: nada a checar
        const slot = width / n;
        for (let i = 1; i < drawn.length; i += 1) {
          expect(
            (drawn[i] - drawn[i - 1]) * slot,
            `w=${width} n=${n}: rótulos ${drawn[i - 1]} e ${drawn[i]} colidem`,
          ).toBeGreaterThanOrEqual(needed);
        }
      }
    }
  });

  it('afina quando o espaço por categoria é menor que o rótulo', () => {
    // 24 competências num painel de meia largura — o caso de "Todo o período",
    // em que os rótulos se sobrepunham.
    const cats = months(24);
    expect(visibleCategoryTicks(cats, 430).size).toBeLessThan(cats.length);
  });

  it('ancora as duas pontas do eixo', () => {
    // Primeiro e último dão o intervalo coberto; sem eles o leitor não sabe
    // onde a série começa nem termina.
    for (const width of [300, 430, 640, 900]) {
      for (const n of [2, 7, 13, 24, 36]) {
        const t = visibleCategoryTicks(months(n), width);
        expect(t.has(0), `w=${width} n=${n}: falta a primeira`).toBe(true);
        expect(t.has(n - 1), `w=${width} n=${n}: falta a última`).toBe(true);
      }
    }
  });

  it('não quebra com série vazia ou de um ponto só', () => {
    expect(visibleCategoryTicks([], 400).size).toBe(0);
    expect([...visibleCategoryTicks(['Jan/2026'], 400)]).toEqual([0]);
  });

  it('rótulo mais longo afina mais que rótulo curto', () => {
    const short = visibleCategoryTicks(Array.from({ length: 18 }, (_, i) => `${i}`), 430);
    const long = visibleCategoryTicks(
      Array.from({ length: 18 }, () => 'Operações de Campo'),
      430,
    );
    expect(long.size).toBeLessThan(short.size);
  });
});
