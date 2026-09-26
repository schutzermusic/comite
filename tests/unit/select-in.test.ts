/**
 * `.in()` grande em lotes. Regressão: com ~223 itens na demanda o PostgREST
 * devolvia 414 (URI Too Long) para `inventory_position`; o erro era ignorado e
 * o Planejamento de Materiais dizia "sem estoque disponível: comprar" para
 * itens com 40 m livres no almoxarifado.
 */
import { describe, expect, it, vi } from 'vitest';
import { PAGE_ROWS, selectAllPages, selectIn, SELECT_IN_CHUNK } from '@/lib/supabase/select-in';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);

describe('selectIn', () => {
  it('divide em lotes do tamanho seguro e soma os resultados', async () => {
    const run = vi.fn(async (chunk: string[]) => ({ data: chunk.map((id) => ({ id })), error: null }));
    const out = await selectIn(ids(223), run);
    expect(run).toHaveBeenCalledTimes(Math.ceil(223 / SELECT_IN_CHUNK));
    expect(Math.max(...run.mock.calls.map((c) => c[0].length))).toBeLessThanOrEqual(SELECT_IN_CHUNK);
    expect(out).toHaveLength(223);
  });

  it('erro de QUALQUER lote sobe — não vira lista vazia', async () => {
    const run = vi.fn(async (chunk: string[]) => (chunk.includes('id-150')
      ? { data: null, error: { message: 'URI too long' } } : { data: [{ id: chunk[0] }], error: null }));
    await expect(selectIn(ids(223), run)).rejects.toThrow('URI too long');
  });

  it('lista vazia não consulta; repetidos e nulos saem', async () => {
    const run = vi.fn(async (chunk: string[]) => ({ data: chunk, error: null }));
    expect(await selectIn([], run)).toEqual([]);
    expect(run).not.toHaveBeenCalled();
    expect(await selectIn(['a', 'a', null, undefined, '', 'b'], run)).toEqual(['a', 'b']);
  });
});

/**
 * Lista inteira em páginas. O PostgREST corta cada resposta em `max_rows` (1 000) seja qual for o `.limit()`: com
 * 1 139 locais no QA, o local recém-criado sumia do "Liberar para" da inspeção (receiving-mobile caiu por isso).
 */
describe('selectAllPages', () => {
  const table = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));
  const server = (rows: Array<{ id: number }>) => vi.fn(async (from: number, to: number) =>
    ({ data: rows.slice(from, Math.min(to + 1, from + PAGE_ROWS)), error: null }));

  it('lê todas as linhas acima do teto do PostgREST (1 139 → 1 139, não 1 000)', async () => {
    const page = server(table(1139));
    const out = await selectAllPages(page);
    expect(out).toHaveLength(1139);
    expect(out[1138]).toEqual({ id: 1138 });
    expect(page.mock.calls).toEqual([[0, 999], [1000, 1999]]);
  });

  it('múltiplo exato de 1 000: uma página vazia fecha a leitura', async () => {
    const page = server(table(2000));
    expect(await selectAllPages(page)).toHaveLength(2000);
    expect(page).toHaveBeenCalledTimes(3);
  });

  it('erro em qualquer página SOBE — nunca lista pela metade', async () => {
    const page = vi.fn(async (from: number) => (from === 1000 ? { data: null, error: { message: 'statement timeout' } }
      : { data: table(1000), error: null }));
    await expect(selectAllPages(page)).rejects.toThrow('statement timeout');
  });

  it('passar do teto declarado é erro claro, não corte calado', async () => {
    await expect(selectAllPages(server(table(3500)), 3000)).rejects.toThrow('Leitura acima do teto de 3000 linhas.');
  });
});

