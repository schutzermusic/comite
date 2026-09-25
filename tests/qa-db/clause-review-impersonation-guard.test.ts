/**
 * GUARDA DE REVISÃO DE CLÁUSULA (contracts_guard_review_impersonation) — no
 * banco, mas SÓ no QA isolado.
 *
 * Antes: este teste morava em tests/unit, carregava `.env.local` e rodava
 * `UPDATE contract_clauses … 'validated'` no banco de PRODUÇÃO, fora de
 * transação, confiando no gatilho para recusar. Se o gatilho faltasse, o
 * teste FORJARIA uma revisão humana em produção.
 *
 * Agora: endereço do QA pelo guarda (`loadQaEnv`/`assertLocal` recusam host
 * que não seja desta máquina); cada caso em BEGIN … ROLLBACK, com a própria
 * cláusula de fixture — nada persiste, mesmo que o gatilho falhe.
 *
 *   npm run qa:up && npm run test:qa-db
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { loadQaEnv } from '../../scripts/qa/lib/qa-env.mjs';

const db = new pg.Client({ connectionString: (loadQaEnv() as Record<string, string>).QA_DB_URL });
let org = ''; let userA = ''; let userB = ''; let clause = '';
const claims = (uid: string | null) => JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : { role: 'service_role' });
/**
 * A identidade entra por um `set_config` PRÓPRIO, dentro da transação do caso.
 * (Um `WITH … set_config()` não referenciado num UPDATE nunca é avaliado — a
 * sessão ficaria sem identidade e os casos negativos passariam pelo motivo errado.)
 */
const as = async (uid: string | null, sql: string, params: unknown[] = []) => {
  await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [claims(uid)]);
  return db.query(sql, params);
};

beforeAll(async () => {
  await db.connect();
  const anchor = (await db.query(`SELECT p.organization_id, p.user_id FROM public.profiles p
    WHERE p.status = 'active' ORDER BY p.created_at LIMIT 2`)).rows;
  if (anchor.length < 2) throw new Error('QA sem perfis ativos — rode `npm run qa:build`.');
  org = anchor[0].organization_id; userA = anchor[0].user_id; userB = anchor[1].user_id;
});
afterAll(async () => { await db.end(); });

beforeEach(async () => {
  await db.query('BEGIN');
  const contract = (await db.query(`INSERT INTO public.contracts (organization_id, title) VALUES ($1, '[QA-DB] Contrato de prova') RETURNING id`,
    [org])).rows[0].id;
  // Cláusula em rascunho (a guarda vale para qualquer origem; a lida pela IA exigiria documento-fonte).
  clause = (await db.query(`INSERT INTO public.contract_clauses (organization_id, contract_id, title)
    VALUES ($1, $2, '[QA-DB] Cláusula em rascunho') RETURNING id`, [org, contract])).rows[0].id;
});
afterEach(async () => { await db.query('ROLLBACK'); });

describe('contracts_guard_review_impersonation (QA isolado, transação desfeita)', () => {
  it('servidor/IA (sem sessão) não valida', async () => {
    await expect(as(null, `UPDATE public.contract_clauses SET review_status = 'validated', reviewed_by = $2, reviewed_at = now() WHERE id = $1`,
      [clause, userB])).rejects.toThrow(/GOVERNANCE VIOLATION/);
  });
  it('servidor/IA (sem sessão) não rejeita', async () => {
    await expect(as(null, `UPDATE public.contract_clauses SET review_status = 'rejected', reviewed_by = $2, reviewed_at = now() WHERE id = $1`,
      [clause, userB])).rejects.toThrow(/GOVERNANCE VIOLATION/);
  });
  it('servidor/IA não carimba revisor arbitrário', async () => {
    await expect(as(null, `UPDATE public.contract_clauses SET reviewed_by = $2 WHERE id = $1`, [clause, userB]))
      .rejects.toThrow(/GOVERNANCE VIOLATION/);
  });
  it('a identidade da sessão é a que a guarda vê (sanidade do próprio teste)', async () => {
    const r = await as(userA, `SELECT auth.uid() AS uid`);
    expect(r.rows[0].uid).toBe(userA);
  });
  it('sessão autenticada não carimba OUTRA pessoa como revisora', async () => {
    await expect(as(userA, `UPDATE public.contract_clauses SET review_status = 'validated', reviewed_by = $2, reviewed_at = now() WHERE id = $1`,
      [clause, userB])).rejects.toThrow(/GOVERNANCE VIOLATION/);
  });
  it('a própria pessoa autenticada valida em seu nome', async () => {
    const r = await as(userA, `UPDATE public.contract_clauses SET review_status = 'validated', reviewed_by = $2, reviewed_at = now()
      WHERE id = $1 RETURNING review_status, reviewed_by`, [clause, userA]);
    expect(r.rows[0]).toEqual({ review_status: 'validated', reviewed_by: userA });
  });
  it('estado que não é decisão (em revisão) segue livre para o servidor', async () => {
    const r = await as(null, `UPDATE public.contract_clauses SET review_status = 'in_review' WHERE id = $1 RETURNING review_status`, [clause]);
    expect(r.rows[0].review_status).toBe('in_review');
  });
});
