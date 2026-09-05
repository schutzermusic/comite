/**
 * Fase 0 — prova VIVA dos invariantes, contra o Postgres real.
 *
 * O teste irmão (`contracts-phase0-security-contract.test.ts`) lê o texto das
 * migrations. Este executa. A distinção importa porque `034` também "dizia" que
 * aprovação era controlada, e a política concedia FOR ALL a `contracts.edit`:
 * ler a intenção nunca provou o efeito.
 *
 * Tudo roda dentro de UMA transação com ROLLBACK ao final. Nenhuma linha
 * sobrevive, inclusive as organizações e usuários criados para provar o
 * isolamento entre inquilinos.
 *
 * Sem `SUPABASE_DB_URL` a suíte é pulada — em CI sem banco ela não falha, e não
 * finge ter passado.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { CONTRACT_STATUS_VOCABULARY } from '@/lib/contracts/contract-service';

for (const file of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* arquivo ausente é um caso normal */ }
}

const DB_URL = process.env.SUPABASE_DB_URL;
const suite = DB_URL ? describe : describe.skip;

const ORG_B = '00000000-0000-4000-8000-0000000000b0';

suite('Fase 0 · invariantes vivos no Postgres', () => {
  let client: pg.Client;
  /** Usuário com `contracts.edit` e SEM `contracts.approve`. */
  let editor: string;
  /** Usuário com `contracts.approve`. */
  let approver: string;
  let orgA: string;
  let contractByApprover: string;
  let contractByEditor: string;

  /** Executa uma consulta como usuário autenticado — com RLS valendo. */
  async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await client.query('SAVEPOINT as_user');
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
    try {
      return await fn();
    } finally {
      await client.query('RESET ROLE');
      await client.query('RELEASE SAVEPOINT as_user').catch(() => undefined);
    }
  }

  /** Espera que a operação seja recusada, e devolve a mensagem. */
  async function refused(fn: () => Promise<unknown>): Promise<string> {
    await client.query('SAVEPOINT attempt');
    try {
      await fn();
      await client.query('ROLLBACK TO SAVEPOINT attempt');
      return '';
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT attempt');
      return err instanceof Error ? err.message : String(err);
    }
  }

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    /*
      O pooler do Supabase reaproveita backends entre conexões, e um
      `SET default_transaction_read_only` de sessão deixado por outro processo
      chega até aqui. Já chegou: esta suíte falhou uma vez com "cannot execute
      ALTER TABLE in a read-only transaction" por causa de um script de
      inventário que rodara antes. Declarar o modo é mais barato que depender
      do estado que o pooler entregar.
    */
    await client.query('SET SESSION default_transaction_read_only = off');
    await client.query('BEGIN');

    for (const f of [
      '099_tenant_isolation_reference_tables.sql',
      '100_contract_approval_safety.sql',
      '101_contract_status_vocabulary.sql',
    ]) {
      const sql = readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), 'utf8')
        .replace(/^\s*BEGIN;\s*$/gm, '')
        .replace(/^\s*COMMIT;\s*$/gm, '');
      await client.query(sql);
    }

    orgA = (await client.query(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`)).rows[0].id;

    /*
      Usuários sintéticos, criados aqui e desfeitos no ROLLBACK.

      A primeira versão deste teste usou os usuários reais da base — e passou a
      afirmar coisa errada, porque a mesma pessoa acumula `juridico_contratos` e
      `ceo_diretoria`: "o editor" e "o aprovador" eram o mesmo `user_id`, e o
      teste de ORDEM na verdade reencontrava a segregação de funções. Papel de
      produção é distribuição de trabalho, não fixture: para provar que
      `contracts.edit` sozinho não aprova é preciso alguém que tenha SÓ isso.
    */
    const mkUser = async (label: string, roleKey: string) => {
      const { rows } = await client.query(
        `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
         VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
                 $1, 'x', now(), now())
         RETURNING id`, [`phase0.${label}@example.test`]);
      const userId: string = rows[0].id;
      await client.query(
        `INSERT INTO profiles (user_id, organization_id, full_name) VALUES ($1, $2, $3)`,
        [userId, orgA, `[PHASE0] ${label}`]);
      await client.query(
        `INSERT INTO user_roles (user_id, role_id, organization_id)
         SELECT $1, r.id, $2 FROM roles r WHERE r.key = $3`, [userId, orgA, roleKey]);
      return userId;
    };

    // `juridico_contratos` tem `contracts.edit` e NÃO tem `contracts.approve` —
    // é exatamente o papel que a política antiga (034) deixava aprovar.
    editor = await mkUser('editor', 'juridico_contratos');
    approver = await mkUser('approver', 'ceo_diretoria');

    const mk = async (createdBy: string) => (await client.query(
      `INSERT INTO contracts (organization_id, title, status, risk_level, currency, data_class, created_by, owner_user_id)
       VALUES ($1, '[PHASE0] fixture', 'negotiation', 'medium', 'BRL', 'demo', $2, $2) RETURNING id`,
      [orgA, createdBy])).rows[0].id;
    contractByApprover = await mk(approver);
    contractByEditor = await mk(editor);

    // Segunda organização, com dados de referência próprios.
    await client.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, '[PHASE0] Org B', 'phase0-org-b')`, [ORG_B]);
    /*
      `business_unit.organization_id` passou a ser NOT NULL na migration 104
      (Fase 1). A unidade sempre foi "da Org B" — o comentário acima já dizia
      isso —, só que o schema não exigia declará-lo. Agora exige, e declarar o
      dono é a correção certa: inventar uma unidade sem inquilino para o teste
      passar recriaria justamente o defeito que a 104 fechou.
    */
    await client.query(
      `INSERT INTO business_unit (id, code, name, uf, organization_id)
       VALUES (gen_random_uuid(), 'PH0-BU', '[PHASE0] BU', 'SP', $1)
       ON CONFLICT DO NOTHING`, [ORG_B]);
    const bu = (await client.query(
      `SELECT id FROM business_unit WHERE organization_id = $1 LIMIT 1`, [ORG_B])).rows[0].id;
    await client.query(
      `INSERT INTO cost_center (id, code, name, business_unit_id, type, organization_id)
       VALUES (gen_random_uuid(), 'PH0-B', '[PHASE0] CC da Org B', $1, 'direct', $2)`, [bu, ORG_B]);
    await client.query(
      `INSERT INTO cost_center (id, code, name, business_unit_id, type, organization_id)
       VALUES (gen_random_uuid(), 'PH0-A', '[PHASE0] CC da Org A', $1, 'direct', $2)`, [bu, orgA]);
    await client.query(
      `INSERT INTO supplier (id, name, organization_id) VALUES (gen_random_uuid(), '[PHASE0] Fornecedor da Org B', $1)`, [ORG_B]);
    await client.query(
      `INSERT INTO supplier (id, name, organization_id) VALUES (gen_random_uuid(), '[PHASE0] Fornecedor da Org A', $1)`, [orgA]);
  }, 60_000);

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK');
    await client.end();
  });

  // ── 1 · isolamento entre inquilinos ────────────────────────────────────────

  it('1 · a Org A não lê centro de custo nem fornecedor da Org B', async () => {
    const seen = await asUser(editor, async () => ({
      cc: (await client.query(`SELECT code, organization_id FROM cost_center`)).rows,
      sup: (await client.query(`SELECT name, organization_id FROM supplier`)).rows,
    }));

    expect(seen.cc.length).toBeGreaterThan(0);
    expect(seen.cc.map((r) => r.code)).toContain('PH0-A');
    expect(seen.cc.map((r) => r.code)).not.toContain('PH0-B');
    expect(seen.cc.every((r) => r.organization_id === orgA)).toBe(true);

    expect(seen.sup.map((r) => r.name)).toContain('[PHASE0] Fornecedor da Org A');
    expect(seen.sup.map((r) => r.name)).not.toContain('[PHASE0] Fornecedor da Org B');
    expect(seen.sup.every((r) => r.organization_id === orgA)).toBe(true);
  });

  it('1b · a leitura irrestrita não existe mais em nenhuma das duas tabelas', async () => {
    const { rows } = await client.query(
      `SELECT tablename, policyname, qual FROM pg_policies
        WHERE schemaname = 'public' AND tablename IN ('cost_center','supplier') AND cmd = 'SELECT'`);
    expect(rows.length).toBe(2);
    for (const row of rows) expect(row.qual).toContain('current_user_organization_id()');
  });

  // ── 2/3/4 · aprovação ──────────────────────────────────────────────────────

  const insertApproval = (contract: string, step: string, status: string, reviewer: string) =>
    client.query(
      `INSERT INTO contract_approvals (organization_id, contract_id, step_name, status, reviewer_user_id)
       VALUES ($1, $2, $3, $4, $5)`, [orgA, contract, step, status, reviewer]);

  it('2 · contracts.edit sozinho não aprova', async () => {
    // Pré-condição do teste: o editor realmente não tem a permissão de aprovar.
    const perms = await asUser(editor, async () => (await client.query(
      `SELECT current_user_has_permission('contracts.edit') AS can_edit,
              current_user_has_permission('contracts.approve') AS can_approve`)).rows[0]);
    expect(perms.can_edit).toBe(true);
    expect(perms.can_approve).toBe(false);

    const msg = await asUser(editor, () =>
      refused(() => insertApproval(contractByApprover, 'juridico', 'approved', editor)));
    expect(msg).toMatch(/row-level security|violates/i);
  });

  it('3 · quem cadastrou o contrato não aprova o próprio contrato', async () => {
    const msg = await asUser(approver, () =>
      refused(() => insertApproval(contractByApprover, 'juridico', 'approved', approver)));
    expect(msg).toContain('Segregação de funções');
  });

  it('3b · o mesmo vale para rejeitar, e vale também para a chave de serviço', async () => {
    // Sem trocar de papel: `postgres` ignora RLS. O trigger não.
    const msg = await refused(() => insertApproval(contractByApprover, 'juridico', 'rejected', approver));
    expect(msg).toContain('Segregação de funções');
  });

  it('3c · o trâmite continua livre — under_review não é decisão', async () => {
    const msg = await refused(() => insertApproval(contractByApprover, 'juridico', 'under_review', approver));
    expect(msg).toBe('');
  });

  it('4 · etapa posterior não pode ser aprovada com anterior pendente', async () => {
    await client.query('SAVEPOINT order_case');
    await insertApproval(contractByEditor, 'juridico', 'pending', approver);
    const msg = await refused(() => insertApproval(contractByEditor, 'diretoria', 'approved', approver));
    expect(msg).toContain('Ordem de aprovação');
    expect(msg).toContain('juridico');
    await client.query('ROLLBACK TO SAVEPOINT order_case');
  });

  it('4b · com a anterior aprovada, a posterior passa', async () => {
    await client.query('SAVEPOINT order_ok');
    await insertApproval(contractByEditor, 'juridico', 'approved', approver);
    const msg = await refused(() => insertApproval(contractByEditor, 'financeiro', 'approved', approver));
    expect(msg).toBe('');
    await client.query('ROLLBACK TO SAVEPOINT order_ok');
  });

  it('4c · rejeitar não exige ordem: recusar cedo é o esperado de um parecer', async () => {
    await client.query('SAVEPOINT reject_case');
    const msg = await refused(() => insertApproval(contractByEditor, 'diretoria', 'rejected', approver));
    expect(msg).toBe('');
    await client.query('ROLLBACK TO SAVEPOINT reject_case');
  });

  it('4d · o revisor gravado é a sessão, e não quem se digitar', async () => {
    const msg = await asUser(approver, () =>
      refused(() => insertApproval(contractByEditor, 'comite', 'pending', editor)));
    expect(msg).toMatch(/row-level security|violates/i);
  });

  // ── 6 · vocabulário de status ──────────────────────────────────────────────

  it('6 · todo status em produção pertence ao vocabulário canônico', async () => {
    const { rows } = await client.query(
      `SELECT DISTINCT status FROM contracts WHERE NOT (status = ANY($1::text[]))`,
      [CONTRACT_STATUS_VOCABULARY as unknown as string[]]);
    expect(rows.map((r) => r.status)).toEqual([]);
  });

  it('6b · o CHECK do banco e a união do TypeScript dizem a mesma coisa', async () => {
    const def: string = (await client.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'public.contracts'::regclass AND conname = 'contracts_status_check'`)).rows[0].def;
    const inCheck = [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort();
    expect(inCheck).toEqual([...CONTRACT_STATUS_VOCABULARY].sort());
  });

  it('6c · o banco recusa status fora do vocabulário', async () => {
    const msg = await refused(() =>
      client.query(`UPDATE contracts SET status = 'nao_existe' WHERE id = $1`, [contractByEditor]));
    expect(msg).toContain('contracts_status_check');
  });
});
