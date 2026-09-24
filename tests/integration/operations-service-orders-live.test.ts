/**
 * INVARIANTES VIVOS da OS interna (230), contra o banco real, SOMENTE LEITURA.
 *
 * Pula em silêncio sem `SUPABASE_DB_URL`, como as demais integrações. O que se
 * prova aqui é o que a unidade não alcança: que os dados REAIS obedecem às
 * regras — nenhuma OS emitida sem revisão, nenhuma emitida com linha lida
 * pendente, nenhuma emitida com bloqueio anterior à emissão sem exceção, um
 * pacote aceito gera no máximo uma OS viva.
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
  } catch { /* arquivo ausente é normal em CI */ }
}

const URL_DB = process.env.SUPABASE_DB_URL;
const suite = URL_DB ? describe : describe.skip;

suite('OS interna — invariantes no banco vivo (somente leitura)', () => {
  let db: pg.Client;
  const rows = async (sql: string) => (await db.query(sql)).rows;

  beforeAll(async () => {
    db = new pg.Client({ connectionString: URL_DB, ssl: { rejectUnauthorized: false } });
    await db.connect();
    await db.query('SET SESSION default_transaction_read_only = on');
  }, 30_000);
  afterAll(async () => { await db?.end(); });

  it('a 230 está registrada', async () => {
    expect(await rows(`SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '230'`)).toHaveLength(1);
  });

  it('toda OS emitida tem a revisão 1 (emissão ou instantâneo inicial)', async () => {
    const missing = await rows(`SELECT o.id FROM public.internal_service_orders o
      WHERE o.issued_at IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.internal_service_order_revisions r
         WHERE r.organization_id = o.organization_id AND r.service_order_id = o.id AND r.revision = 1)`);
    expect(missing).toEqual([]);
  });

  it('nenhuma OS emitida carrega linha lida pendente de revisão', async () => {
    const bad = await rows(`SELECT o.id FROM public.internal_service_orders o
      JOIN public.internal_service_order_items i ON i.organization_id = o.organization_id AND i.service_order_id = o.id
      WHERE o.issued_at IS NOT NULL AND i.confirmation_state = 'UNCONFIRMED'
        AND i.created_at <= o.issued_at`);
    expect(bad).toEqual([]);
  });

  it('nenhuma OS foi emitida sobre bloqueio anterior à emissão sem exceção nomeada', async () => {
    const bad = await rows(`SELECT o.id, d.id AS divergence_id FROM public.internal_service_orders o
      JOIN public.commercial_divergences d ON d.organization_id = o.organization_id
       AND (d.service_order_id = o.id OR (d.service_order_id IS NULL AND d.engagement_id = o.engagement_id))
      WHERE o.issued_at IS NOT NULL AND d.severity = 'BLOCKING' AND d.created_at < o.issued_at
        AND (d.state = 'OPEN' OR (d.resolved_at IS NOT NULL AND d.resolved_at > o.issued_at))
        AND NOT EXISTS (SELECT 1 FROM public.internal_service_order_issue_exceptions e
                         WHERE e.organization_id = o.organization_id AND e.service_order_id = o.id
                           AND d.id = ANY (e.divergence_ids))`);
    expect(bad).toEqual([]);
  });

  it('um pacote aceito tem no máximo uma OS viva, e o aceite é sempre completo', async () => {
    const dup = await rows(`SELECT source_context_acceptance_id, count(*) FROM public.internal_service_orders
      WHERE source_context_acceptance_id IS NOT NULL AND status <> 'CANCELLED'
      GROUP BY 1 HAVING count(*) > 1`);
    expect(dup).toEqual([]);
    const incomplete = await rows(`SELECT o.id FROM public.internal_service_orders o
      JOIN public.commercial_proposal_context_acceptances a ON a.organization_id = o.organization_id
       AND a.id = o.source_context_acceptance_id WHERE NOT a.complete`);
    expect(incomplete).toEqual([]);
  });

  it('OS de proposta aponta a revisão de valor que está no aceite do pacote', async () => {
    const bad = await rows(`SELECT o.id FROM public.internal_service_orders o
      JOIN public.commercial_proposal_context_acceptances a ON a.organization_id = o.organization_id
       AND a.id = o.source_context_acceptance_id
      WHERE o.source_proposal_revision_id IS NOT NULL
        AND o.source_proposal_revision_id NOT IN (
          COALESCE(a.technical_revision_id, '00000000-0000-0000-0000-000000000000'),
          COALESCE(a.commercial_revision_id, '00000000-0000-0000-0000-000000000000'),
          COALESCE(a.combined_revision_id, '00000000-0000-0000-0000-000000000000'))`);
    expect(bad).toEqual([]);
  });

  it('exceção de emissão sempre nomeia ator e a permissão verificada', async () => {
    const bad = await rows(`SELECT id FROM public.internal_service_order_issue_exceptions
      WHERE authorized_by IS NULL OR authorized_permission <> 'operations.service_orders.override'
         OR length(btrim(reason)) < 20`);
    expect(bad).toEqual([]);
  });

  it('linha lida pela IA carrega provedor e modelo', async () => {
    const bad = await rows(`SELECT id FROM public.internal_service_order_items
      WHERE origin = 'document_extraction' AND (ai_provider IS NULL OR ai_model IS NULL)`);
    expect(bad).toEqual([]);
  });
});
