/**
 * Fase 1.5 — a unidade de negócio de um centro de custo é do MESMO inquilino.
 *
 * A 105 deu chave composta à hierarquia (`parent_id`) e deixou
 * `business_unit_id` com chave simples, o que permitia ao schema representar um
 * centro de custo da Org A apontando para uma unidade de negócio da Org B. A
 * 107 fecha isso.
 *
 * ─── Por que este teste roda com RLS DESLIGADA ─────────────────────────────
 *
 * Provar a rejeição como usuário autenticado não provaria nada sobre o banco:
 * a linha da Org B seria simplesmente invisível, e o INSERT falharia por
 * invisibilidade — que é uma afirmação sobre a SESSÃO, não sobre o SCHEMA.
 *
 * Verificação de chave estrangeira no PostgreSQL não passa por política de
 * linha. Então a prova útil é a oposta: conectar como o dono do banco, com RLS
 * fora do caminho, enxergar as duas organizações, e mostrar que o INSERT ainda
 * assim é RECUSADO — pela chave, não pela política. É a diferença entre "você
 * não vê" e "não pode existir".
 *
 * Tudo dentro de UMA transação com ROLLBACK. Nenhuma linha sobrevive.
 * Sem `SUPABASE_DB_URL` a suíte é pulada, e não finge ter passado.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import pg from 'pg';

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

const ORG_A = '00000000-0000-4000-8000-00000000107a';
const ORG_B = '00000000-0000-4000-8000-00000000107b';

/** A 107, sem o BEGIN/COMMIT dela — a transação é desta suíte. */
function migration107(): string {
  return readFileSync(
    new URL('../../supabase/migrations/107_fcc_business_unit_tenant_fk.sql', import.meta.url),
    'utf8',
  ).replace(/^\s*BEGIN;\s*$/gm, '').replace(/^\s*COMMIT;\s*$/gm, '');
}

suite('Fase 1.5 · unidade de negócio no mesmo inquilino', () => {
  let client: pg.Client;
  let buOrgB = '';
  let buOrgA = '';
  let fccOrgA = '';

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    await client.query('BEGIN');

    // Idempotente: em produção a 107 já está aplicada; aqui ela é reafirmada
    // dentro da transação para que a suíte também valha numa base que ainda não a tem.
    await client.query(migration107());

    await client.query(
      `INSERT INTO organizations (id, name, slug) VALUES
         ($1, 'Org A · 107', 'org-a-107'),
         ($2, 'Org B · 107', 'org-b-107')`,
      [ORG_A, ORG_B],
    );

    buOrgB = (await client.query(
      `INSERT INTO business_unit (organization_id, code, name, uf)
       VALUES ($1, 'BU-B-107', 'Unidade da Org B', 'SP') RETURNING id`, [ORG_B],
    )).rows[0].id;

    buOrgA = (await client.query(
      `INSERT INTO business_unit (organization_id, code, name, uf)
       VALUES ($1, 'BU-A-107', 'Unidade da Org A', 'MG') RETURNING id`, [ORG_A],
    )).rows[0].id;

    fccOrgA = (await client.query(
      `INSERT INTO finance_cost_centers (organization_id, code, name)
       VALUES ($1, 'CC-A-107', 'Centro de custo da Org A') RETURNING id`, [ORG_A],
    )).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end().catch(() => undefined);
  });

  /** Executa e devolve a mensagem de erro, ou '' se a operação passou. */
  async function refused(sql: string, params: unknown[] = []): Promise<string> {
    await client.query('SAVEPOINT attempt');
    try {
      await client.query(sql, params);
      await client.query('ROLLBACK TO SAVEPOINT attempt');
      return '';
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT attempt');
      return err instanceof Error ? err.message : String(err);
    }
  }

  it('a sessão é o DONO do banco: RLS não está no caminho da prova', async () => {
    const { rows } = await client.query(
      `SELECT current_user, (SELECT count(*) FROM business_unit WHERE organization_id = $1) AS bu_da_b`,
      [ORG_B],
    );
    // Enxerga a unidade da Org B: o que vier a recusar o vínculo NÃO é invisibilidade.
    expect(Number(rows[0].bu_da_b)).toBe(1);
  });

  it('UPDATE cruzado é RECUSADO pela chave, não pela política', async () => {
    const msg = await refused(
      `UPDATE finance_cost_centers SET business_unit_id = $1 WHERE id = $2`,
      [buOrgB, fccOrgA],
    );
    expect(msg).not.toBe('');
    expect(msg).toContain('fcc_business_unit_same_org');
    expect(msg.toLowerCase()).toContain('foreign key');
  });

  it('INSERT cruzado é RECUSADO pela mesma chave', async () => {
    const msg = await refused(
      `INSERT INTO finance_cost_centers (organization_id, code, name, business_unit_id)
       VALUES ($1, 'CC-A-107-X', 'Novo centro da Org A', $2)`,
      [ORG_A, buOrgB],
    );
    expect(msg).toContain('fcc_business_unit_same_org');
  });

  it('o vínculo do MESMO inquilino é permitido', async () => {
    const msg = await refused(
      `UPDATE finance_cost_centers SET business_unit_id = $1 WHERE id = $2`,
      [buOrgA, fccOrgA],
    );
    expect(msg).toBe('');
  });

  it('business_unit_id continua NULLABLE: centro sem unidade é legítimo', async () => {
    const msg = await refused(
      `INSERT INTO finance_cost_centers (organization_id, code, name, business_unit_id)
       VALUES ($1, 'CC-A-107-NULL', 'Centro sem unidade', NULL)`,
      [ORG_A],
    );
    expect(msg).toBe('');

    const { rows } = await client.query(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema='public' AND table_name='finance_cost_centers'
          AND column_name='business_unit_id'`,
    );
    expect(rows[0].is_nullable).toBe('YES');
  });

  it('a chave composta existe, com a forma e a semântica esperadas', async () => {
    const { rows } = await client.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid='public.finance_cost_centers'::regclass
          AND conname='fcc_business_unit_same_org'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].def).toContain('FOREIGN KEY (organization_id, business_unit_id)');
    expect(rows[0].def).toContain('business_unit(organization_id, id)');
    expect(rows[0].def).toContain('ON DELETE RESTRICT');
  });

  it('business_unit ganhou o alvo composto que a chave exige', async () => {
    const { rows } = await client.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid='public.business_unit'::regclass
          AND conname='business_unit_org_id_unique' AND contype='u'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].def).toContain('UNIQUE (organization_id, id)');
  });

  it('apagar unidade referenciada é RESTRITO, não cascata', async () => {
    await client.query(`UPDATE finance_cost_centers SET business_unit_id = $1 WHERE id = $2`, [buOrgA, fccOrgA]);
    const msg = await refused(`DELETE FROM business_unit WHERE id = $1`, [buOrgA]);
    expect(msg).not.toBe('');
    expect(msg.toLowerCase()).toContain('violates foreign key constraint');
    /*
      Qual das duas chaves recusa primeiro é indiferente: a simples da 105
      (`finance_cost_centers_business_unit_id_fkey`) e a composta da 107
      (`fcc_business_unit_same_org`) carregam ambas ON DELETE RESTRICT. O que
      importa é que apagar unidade referenciada NÃO é cascata.
    */
    expect(msg).toMatch(/finance_cost_centers_business_unit_id_fkey|fcc_business_unit_same_org/);
    await client.query(`UPDATE finance_cost_centers SET business_unit_id = NULL WHERE id = $1`, [fccOrgA]);
  });

  it('a 107 não alterou dado de produção: os 8 centros seguem sem unidade', async () => {
    const { rows } = await client.query(
      `SELECT count(*) AS n FROM finance_cost_centers
        WHERE organization_id NOT IN ($1, $2) AND business_unit_id IS NOT NULL`,
      [ORG_A, ORG_B],
    );
    expect(Number(rows[0].n)).toBe(0);
  });
});
