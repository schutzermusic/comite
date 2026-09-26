/**
 * `.in(coluna, ids)` que não quebra com lista grande.
 *
 * O PostgREST recebe o filtro na URL: com ~200 UUIDs a requisição passa do
 * limite do proxy e volta 414 (URI Too Long). Quem ignorava o erro via "nenhum
 * registro" — no Planejamento de Materiais, "sem estoque disponível: comprar"
 * para itens com estoque. Aqui a lista vira lotes pequenos, os resultados se
 * somam e um erro SOBE (não vira lista vazia).
 */
export const SELECT_IN_CHUNK = 100;

type Result<T> = { data: T[] | null; error: { message: string } | null };

export async function selectIn<T>(
  ids: readonly (string | null | undefined)[],
  run: (chunk: string[]) => PromiseLike<Result<T>>,
  chunkSize = SELECT_IN_CHUNK,
): Promise<T[]> {
  const unique = Array.from(new Set(ids.filter((x): x is string => typeof x === 'string' && x.length > 0)));
  if (unique.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += chunkSize) chunks.push(unique.slice(i, i + chunkSize));
  const results = await Promise.all(chunks.map((c) => run(c)));
  const out: T[] = [];
  for (const r of results) {
    if (r.error) throw new Error(r.error.message);
    out.push(...(r.data ?? []));
  }
  return out;
}

/**
 * Lista INTEIRA, em páginas. O PostgREST corta cada resposta no `max_rows` (1 000 no Supabase) seja qual for o
 * `.limit()` pedido — acima disso a leitura voltava truncada, calada: com 1 139 locais no QA, o local recém-criado
 * sumia do "Liberar para" da inspeção. `page(from, to)` monta a consulta com `.range(from, to)` e uma ordem TOTAL
 * (termine em `.order('id')`), para as páginas não se sobreporem nem pularem linha. Para na primeira página
 * incompleta; `cap` é o teto declarado da leitura — passar dele é erro claro, nunca corte calado.
 */
export const PAGE_ROWS = 1000;

export async function selectAllPages<T>(
  page: (from: number, to: number) => PromiseLike<Result<T>>,
  cap = 50_000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < cap; from += PAGE_ROWS) {
    const r = await page(from, from + PAGE_ROWS - 1);
    if (r.error) throw new Error(r.error.message);
    const rows = r.data ?? [];
    out.push(...rows);
    if (rows.length < PAGE_ROWS) return out;
  }
  throw new Error(`Leitura acima do teto de ${cap} linhas.`);
}
