/**
 * INVARIANTES VIVOS do Planejamento (231) — SOMENTE LEITURA.
 * Pula sem `SUPABASE_DB_URL`.
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

suite('Planejamento — invariantes no banco vivo (somente leitura)', () => {
  let db: pg.Client;
  const rows = async (sql: string) => (await db.query(sql)).rows;
  beforeAll(async () => {
    db = new pg.Client({ connectionString: URL_DB, ssl: { rejectUnauthorized: false } });
    await db.connect();
    await db.query('SET SESSION default_transaction_read_only = on');
  }, 30_000);
  afterAll(async () => { await db?.end(); });

  it('a 231 está registrada', async () => {
    expect(await rows(`SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '231'`)).toHaveLength(1);
  });

  it('requisito vindo da OS aponta OS emitida do MESMO projeto', async () => {
    expect(await rows(`SELECT r.id FROM public.project_requirements r
      JOIN public.internal_service_orders o ON o.organization_id = r.organization_id AND o.id = r.service_order_id
      WHERE r.source = 'SERVICE_ORDER' AND (o.project_id IS DISTINCT FROM r.project_id OR o.issued_at IS NULL)`)).toEqual([]);
  });

  it('atividade do requisito é do mesmo projeto', async () => {
    expect(await rows(`SELECT r.id FROM public.project_requirements r
      JOIN public.project_timeline_items t ON t.id = r.activity_id
      WHERE t.project_id <> r.project_id OR t.organization_id <> r.organization_id`)).toEqual([]);
  });

  it('todo requisito tem história, e confirmado tem quem confirmou', async () => {
    expect(await rows(`SELECT r.id FROM public.project_requirements r WHERE NOT EXISTS (
      SELECT 1 FROM public.project_requirement_history h WHERE h.requirement_id = r.id)`)).toEqual([]);
    expect(await rows(`SELECT id FROM public.project_requirements WHERE status = 'CONFIRMED' AND confirmed_by IS NULL`)).toEqual([]);
  });

  it('material nunca é "atendido" à mão', async () => {
    expect(await rows(`SELECT id FROM public.project_requirements
      WHERE requirement_type IN ('MATERIAL','EXTERNAL_SERVICE') AND satisfied_at IS NOT NULL`)).toEqual([]);
  });
});
