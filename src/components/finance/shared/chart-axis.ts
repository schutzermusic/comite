/**
 * Geometria do eixo de categoria — sem React, sem JSX.
 *
 * Mora fora de `FuturisticCharts.tsx` porque é aritmética pura: dá para
 * testá-la em Node, o que um arquivo de componente com JSX não permite no
 * runner de unidade deste projeto.
 */

/**
 * Quais rótulos do eixo de categoria desenhar sem que colidam.
 *
 * O kit desenhava TODOS. Num gráfico largo com seis competências isso é o
 * certo; num painel de meia largura com "Todo o período" (até 24 competências)
 * `Jan/2026` ocupa ~45px e o espaço por categoria cai para ~18px — os rótulos
 * viravam uma faixa ilegível de tinta sobreposta.
 *
 * O passo sai da MEDIDA, não de um teto fixo: o rótulo mais longo define
 * quanto espaço um item precisa, e daí quantos cabem. Assim nada muda nos
 * gráficos que já cabiam — que é a condição para mexer num kit compartilhado
 * por ~15 telas do Financeiro.
 *
 * As duas pontas são sempre desenhadas: elas ancoram a leitura do eixo. Quando
 * o último índice não cai no passo, o tick anterior que colidiria com ele é
 * REMOVIDO — sobra um vão um pouco maior perto do fim, que é preferível a dois
 * rótulos encavalados.
 *
 * (Aceitar o último com meio passo de folga era o que produzia `Out/2026` e
 * `Dez/2026` colados na borda direita, com 24 competências a 640px.)
 */
export function visibleCategoryTicks(
  categories: string[],
  innerWidth: number,
  fontSize = 10,
): Set<number> {
  const n = categories.length;
  const shown = new Set<number>();
  if (n === 0) return shown;
  if (n === 1) {
    shown.add(0);
    return shown;
  }

  const longest = categories.reduce((max, c) => Math.max(max, c.length), 0);
  // ~0.58em por caractere na Gilroy, mais um respiro entre vizinhos.
  const needed = longest * fontSize * 0.58 + 10;
  const slot = innerWidth / n;
  const step = Math.max(1, Math.ceil(needed / Math.max(slot, 1)));

  for (let i = 0; i < n; i += step) shown.add(i);

  // O último índice entra sempre; quem estiver a menos de um passo dele sai.
  const last = n - 1;
  if (!shown.has(last)) {
    for (const i of [...shown]) if (last - i < step) shown.delete(i);
    shown.add(last);
  }

  return shown;
}
