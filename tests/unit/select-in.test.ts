/**
 * `.in()` grande em lotes. Regressão: com ~223 itens na demanda o PostgREST
 * devolvia 414 (URI Too Long) para `inventory_position`; o erro era ignorado e
 * o Planejamento de Materiais dizia "sem estoque disponível: comprar" para
 * itens com 40 m livres no almoxarifado.
 */
import { describe, expect, it, vi } from 'vitest';
import { selectIn, SELECT_IN_CHUNK } from '@/lib/supabase/select-in';

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
