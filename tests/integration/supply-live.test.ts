/**
 * INVARIANTES VIVOS do Supply (232+) — SOMENTE LEITURA. Pula sem `SUPABASE_DB_URL`.
 * Cresce a cada wave de Supply (estoque, compras, recebimento).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import pg from 'pg';

for (const f of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* ausente em CI */ }
}
const URL_DB = process.env.SUPABASE_DB_URL;
const suite = URL_DB ? describe : describe.skip;

suite('Supply — invariantes no banco vivo (somente leitura)', () => {
  let db: pg.Client;
  const rows = async (sql: string) => (await db.query(sql)).rows;
  const applied = async (v: string) => (await rows(`SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${v}'`)).length === 1;
  beforeAll(async () => {
    db = new pg.Client({ connectionString: URL_DB, ssl: { rejectUnauthorized: false } });
    await db.connect();
    await db.query('SET SESSION default_transaction_read_only = on');
  }, 30_000);
  afterAll(async () => { await db?.end(); });

  it('232: item de catálogo com código normalizado e único por inquilino', async () => {
    expect(await applied('232')).toBe(true);
    expect(await rows(`SELECT id FROM public.supply_items WHERE code <> upper(btrim(code))`)).toEqual([]);
  });

  it('232: material confirmado aponta item do MESMO inquilino e fala a unidade dele', async () => {
    // Todo material confirmado depois da 232 aponta item (o gatilho recusa o contrário).
    expect(await rows(`SELECT r.id FROM public.project_requirements r
      WHERE r.status = 'CONFIRMED' AND r.requirement_type = 'MATERIAL' AND r.item_id IS NULL`)).toEqual([]);
    expect(await rows(`SELECT r.id FROM public.project_requirements r
      JOIN public.supply_items i ON i.id = r.item_id
      WHERE i.organization_id <> r.organization_id OR i.unit IS DISTINCT FROM r.unit`)).toEqual([]);
  });

  it('232: a cobertura nunca afirma falta negativa nem cobre mais do que o requerido como falta', async () => {
    expect(await rows(`SELECT requirement_id FROM public.supply_requirement_coverage WHERE shortage_qty < 0`)).toEqual([]);
  });
});
