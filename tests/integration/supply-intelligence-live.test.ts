/**
 * Leitura da Apex contra o banco vivo — SOMENTE LEITURA. Pula sem credenciais.
 * Prova que cada consulta do coletor de fatos casa com o esquema real (nome de
 * coluna errado só apareceria em produção) e que o motor roda sobre os dados
 * reais sem escrever nada (a sincronização do livro NÃO é chamada aqui).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

for (const f of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* ausente em CI */ }
}
const URL_API = process.env.NEXT_PUBLIC_SUPABASE_URL; const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; const DB = process.env.SUPABASE_DB_URL;
const suite = URL_API && KEY && DB ? describe : describe.skip;

suite('Apex · leitura do Supply no banco vivo (somente leitura)', () => {
  it('coleta os fatos de cada inquilino com Supply e calcula sinais sem erro', async () => {
    const { gatherIntelligenceFacts } = await import('@/lib/supply/intelligence-read');
    const { computeSignals } = await import('@/lib/supply/intelligence');
    const db = new pg.Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
    await db.connect();
    const orgs = (await db.query(`SELECT DISTINCT organization_id FROM public.user_roles LIMIT 3`)).rows.map((r) => r.organization_id as string);
    await db.end();
    const sb = createClient(URL_API as string, KEY as string, { auth: { persistSession: false } });
    for (const org of orgs) {
      const facts = await gatherIntelligenceFacts(org, new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()), sb);
      const signals = computeSignals(facts);
      expect(Array.isArray(signals)).toBe(true);
      for (const s of signals) expect(['RESERVE', 'TRANSFER', 'REQUISITION', 'FOLLOW_UP', 'OPEN']).toContain(s.recommended_action.kind);
    }
  }, 60_000);

  it('livro: descartada tem motivo, decidida tem pessoa, histórico é coerente', async () => {
    const db = new pg.Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
    await db.connect();
    await db.query('BEGIN TRANSACTION READ ONLY');
    const bad = await db.query(`SELECT id FROM public.supply_signals WHERE (status = 'DISMISSED' AND nullif(btrim(decision_note),'') IS NULL)
      OR (status IN ('EXECUTED','DISMISSED') AND decided_by IS NULL) OR ((status = 'RESOLVED') <> (resolved_at IS NOT NULL))`);
    const priv = await db.query(`SELECT has_function_privilege('authenticated','public.supply_signal_execute(uuid,uuid,uuid,jsonb)','EXECUTE') e,
      has_table_privilege('authenticated','public.supply_signals','UPDATE') u`);
    await db.query('ROLLBACK');
    await db.end();
    expect(bad.rows).toEqual([]);
    expect(priv.rows[0]).toEqual({ e: false, u: false });
  });
});
