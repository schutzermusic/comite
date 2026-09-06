/**
 * Plataforma — TRUNCATE não é privilégio do navegador.
 *
 * ─── Por que este teste existe ─────────────────────────────────────────────
 *
 * O schema `public` deste projeto vem com DEFAULT PRIVILEGES que concedem todos
 * os privilégios de tabela a `anon` e `authenticated` — TRUNCATE incluído. A
 * migration 118 corrigiu as tabelas existentes E o default, mas um default é
 * exatamente o tipo de coisa que volta sem ninguém reparar: basta alguém rodar
 * um `GRANT ALL`, ou a plataforma reinstalar o padrão dela.
 *
 * ─── Por que TRUNCATE e não os outros ──────────────────────────────────────
 *
 * TRUNCATE é o único privilégio de escrita que a RLS **não filtra**. SELECT,
 * INSERT, UPDATE e DELETE passam pelas políticas e um papel sem organização não
 * alcança linha nenhuma. TRUNCATE não olha para linha — esvazia a tabela. Por
 * isso ele é revogado, e por isso os outros NÃO são: revogá-los seria
 * redesenhar o controle de acesso, não endurecê-lo.
 *
 * A prova é VIVA porque ler a migration não responde à pergunta. O que importa
 * é o estado do catálogo agora, e o comportamento de uma tabela criada agora.
 * Tudo acontece dentro de uma transação que termina em ROLLBACK.
 *
 * Sem `SUPABASE_DB_URL` a suíte é pulada — em CI sem banco ela não falha, e não
 * finge ter passado.
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

const BROWSER_ROLES = ['anon', 'authenticated'] as const;

suite('Plataforma · TRUNCATE não alcança anon nem authenticated', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    await client.query('BEGIN');
  }, 60_000);

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('1 · nenhuma tabela de public concede TRUNCATE ao navegador', async () => {
    const { rows } = await client.query(
      `SELECT grantee, string_agg(table_name, ', ' ORDER BY table_name) tabelas
         FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND privilege_type = 'TRUNCATE' AND grantee = ANY($1)
        GROUP BY grantee`,
      [BROWSER_ROLES],
    );
    // A mensagem lista as tabelas: quando este teste quebrar, o que falta saber
    // é QUAL migration reabriu, e o nome da tabela leva direto até ela.
    expect(rows.map((r) => `${r.grantee}: ${r.tabelas}`)).toEqual([]);
  });

  it('2 · o DEFAULT ACL dos donos de tabela não concede TRUNCATE ao navegador', async () => {
    const { rows } = await client.query(
      `SELECT d.defaclrole::regrole::text owner, a.grantee::regrole::text grantee
         FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
        WHERE d.defaclnamespace = 'public'::regnamespace
          AND d.defaclobjtype = 'r'
          AND a.privilege_type = 'TRUNCATE'
          AND a.grantee::regrole::text = ANY($1)
          AND d.defaclrole::regrole::text IN (
            SELECT DISTINCT c.relowner::regrole::text FROM pg_class c
             WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p'))`,
      [BROWSER_ROLES],
    );
    expect(rows.map((r) => `${r.owner} → ${r.grantee}`)).toEqual([]);
  });

  it('3 · uma tabela criada AGORA não nasce com TRUNCATE para o navegador', async () => {
    // A prova que a contagem não dá: se o default tivesse voltado, esta tabela
    // nasceria com o privilégio e as duas asserções acima ainda passariam.
    await client.query('CREATE TABLE public.__truncate_probe_vitest (id integer)');
    const { rows } = await client.query(
      `SELECT grantee, privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND table_name = '__truncate_probe_vitest'
          AND grantee = ANY($1) ORDER BY grantee, privilege_type`,
      [BROWSER_ROLES],
    );
    const privs = rows.map((r) => r.privilege_type);
    expect(privs).not.toContain('TRUNCATE');
    // ...e o DML herdado continua lá: o endurecimento não pode ter levado junto
    // o que a RLS governa.
    expect(privs).toContain('SELECT');
    expect(privs).toContain('INSERT');
    await client.query('DROP TABLE public.__truncate_probe_vitest');
  });

  it('4 · agindo COMO o papel, esvaziar a tabela é recusado', async () => {
    await client.query('CREATE TABLE public.__truncate_probe_vitest (id integer)');
    await client.query('INSERT INTO public.__truncate_probe_vitest VALUES (1)');

    for (const role of BROWSER_ROLES) {
      await client.query('SAVEPOINT sp');
      let recusado = false;
      try {
        await client.query(`SET LOCAL ROLE ${role}`);
        await client.query('TRUNCATE public.__truncate_probe_vitest');
      } catch (error) {
        recusado = (error as { code?: string }).code === '42501';
      }
      await client.query('ROLLBACK TO SAVEPOINT sp');
      expect(recusado, `${role} conseguiu executar TRUNCATE`).toBe(true);
    }

    const { rows } = await client.query('SELECT count(*)::int n FROM public.__truncate_probe_vitest');
    expect(rows[0].n, 'a tabela foi esvaziada apesar da recusa').toBe(1);
    await client.query('DROP TABLE public.__truncate_probe_vitest');
  });

  it('5 · service_role e postgres mantiveram TRUNCATE', async () => {
    // É por eles que as rotas e as migrations trabalham. Uma revogação que os
    // alcançasse teria quebrado o produto para consertar um privilégio.
    const { rows } = await client.query(
      `SELECT grantee, count(DISTINCT table_name)::int n FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND privilege_type = 'TRUNCATE'
          AND grantee IN ('service_role','postgres') GROUP BY grantee ORDER BY grantee`,
    );
    expect(rows.length).toBe(2);
    for (const row of rows) expect(row.n).toBeGreaterThan(100);
  });

  it('6 · o DML governado por RLS continua amplo — isto não é um redesenho de RBAC', async () => {
    const { rows } = await client.query(
      `SELECT privilege_type, count(DISTINCT table_name)::int n
         FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND grantee = 'authenticated'
          AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
        GROUP BY privilege_type ORDER BY privilege_type`,
    );
    const by = Object.fromEntries(rows.map((r) => [r.privilege_type, r.n]));
    // Números amplos DE PROPÓSITO: quem filtra linha é a política, não o grant.
    expect(by.SELECT).toBeGreaterThan(100);
    expect(by.INSERT).toBeGreaterThan(100);
    expect(by.UPDATE).toBeGreaterThan(100);
    expect(by.DELETE).toBeGreaterThan(100);
  });

  it('7 · as tabelas da Fiscal (112) e da Fase 3 estão cobertas', async () => {
    const { rows } = await client.query(
      `SELECT table_name FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND privilege_type = 'TRUNCATE' AND grantee = ANY($1)
          AND (table_name LIKE 'fiscal\\_%' OR table_name LIKE 'contract\\_obligation%')`,
      [BROWSER_ROLES],
    );
    expect(rows.map((r) => r.table_name)).toEqual([]);

    // ...e as duas famílias seguem existindo, para o teste não passar por vazio.
    const { rows: counts } = await client.query(
      `SELECT count(*) FILTER (WHERE relname LIKE 'fiscal\\_%')::int fiscais,
              count(*) FILTER (WHERE relname LIKE 'contract\\_obligation%')::int obrigacoes
         FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'`,
    );
    expect(counts[0].fiscais).toBe(11);
    expect(counts[0].obrigacoes).toBe(12); // 11 da Fase 3 + a lista legada
  });
});
