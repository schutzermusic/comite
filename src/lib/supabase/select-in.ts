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
