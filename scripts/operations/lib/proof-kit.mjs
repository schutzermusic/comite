/**
 * Kit de ENSAIO e PROVA das migrations de Operações e Supply (230+).
 *
 * Mesmo contrato dos runners de `scripts/` (ver `apply-proposal-context-217`):
 *
 *   • sem `--apply`, TUDO roda numa transação desfeita no fim — o banco real
 *     não muda;
 *   • as provas rodam num SAVEPOINT e são SEMPRE desfeitas, mesmo com
 *     `--apply`: nenhum dado de prova sobra em produção;
 *   • com `--apply`, a migration e o registro em
 *     `supabase_migrations.schema_migrations` entram na MESMA transação.
 *
 * As provas usam âncoras REAIS (organização, ator owner_admin) e criam o
 * mínimo necessário para o cenário.
 *
 * `--target=qa` roda contra o QA ISOLADO (`scripts/qa`) em vez do banco
 * hospedado: é lá que a migration é ensaiada primeiro, com o mesmo esquema.
 *
 * A transação é `BEGIN READ WRITE` — escopo de TRANSAÇÃO. Nunca `SET SESSION`:
 * pelo pooler em modo transação, um ajuste de sessão vaza para a próxima
 * conexão que pegar o mesmo backend.
 */
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';
import { recordMigrationApplied } from '../../lib/migration-registry.mjs';
import { loadQaEnv } from '../../qa/lib/qa-env.mjs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

/** Banco-alvo: o hospedado (padrão) ou o QA isolado (`--target=qa`). */
export function targetDatabase() {
  if (process.argv.includes('--target=qa')) {
    return { label: 'QA isolado', client: () => new pg.Client({ connectionString: loadQaEnv().QA_DB_URL }) };
  }
  return { label: 'banco hospedado',
    client: () => new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } }) };
}

export const strip = (sql) => sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gmi, '');

export function migrationFile(version) {
  const [file] = readdirSync('supabase/migrations').filter((f) => f.startsWith(`${version}_`));
  if (!file) throw new Error(`Migration ${version} não encontrada.`);
  return file;
}

export function createProofContext(db) {
  const results = [];
  let seq = 0;
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  const all = async (sql, params = []) => (await db.query(sql, params)).rows;

  const check = (label, ok, detail) => {
    results.push({ label, ok: Boolean(ok), detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
    return Boolean(ok);
  };

  /** Executa algo que DEVE falhar, sem derrubar a transação do ensaio. */
  const rejects = async (label, sql, params = [], pattern) => {
    const sp = `sp_${++seq}`;
    await db.query(`SAVEPOINT ${sp}`);
    try {
      await db.query(sql, params);
      await db.query(`RELEASE SAVEPOINT ${sp}`);
      return check(label, false, 'foi aceito, deveria ter sido recusado');
    } catch (error) {
      await db.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      await db.query(`RELEASE SAVEPOINT ${sp}`);
      const ok = pattern ? pattern.test(error.message) : true;
      return check(label, ok, error.message.slice(0, 160));
    }
  };

  /** Executa algo que DEVE funcionar, isolado em SAVEPOINT se falhar. */
  const succeeds = async (label, sql, params = []) => {
    const sp = `sp_${++seq}`;
    await db.query(`SAVEPOINT ${sp}`);
    try {
      const out = await db.query(sql, params);
      await db.query(`RELEASE SAVEPOINT ${sp}`);
      check(label, true);
      return out.rows[0];
    } catch (error) {
      await db.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      await db.query(`RELEASE SAVEPOINT ${sp}`);
      check(label, false, error.message.slice(0, 200));
      return null;
    }
  };

  /** Funções que o navegador NÃO pode executar. */
  const browserCannotExecute = async (signatures) => {
    for (const fn of signatures) {
      const r = await one(`SELECT has_function_privilege('authenticated', $1, 'EXECUTE') a,
                                  has_function_privilege('anon', $1, 'EXECUTE') b`, [`public.${fn}`]);
      check(`navegador não executa ${fn.split('(')[0]}`, !r.a && !r.b);
    }
  };

  /** Tabelas: RLS ligada e sem escrita para authenticated/anon. */
  const tablesAreGoverned = async (tables) => {
    for (const t of tables) {
      const r = await one(`SELECT c.relrowsecurity rls,
          has_table_privilege('authenticated', $1, 'INSERT') ai,
          has_table_privilege('authenticated', $1, 'UPDATE') au,
          has_table_privilege('authenticated', $1, 'DELETE') ad,
          has_table_privilege('anon', $1, 'SELECT') an
        FROM pg_class c WHERE c.oid = $1::regclass`, [`public.${t}`]);
      check(`${t}: RLS ligada, sem escrita do navegador, sem leitura anônima`,
        r.rls && !r.ai && !r.au && !r.ad && !r.an);
    }
  };

  return { results, one, all, check, rejects, succeeds, browserCannotExecute, tablesAreGoverned };
}

/** Âncoras reais: uma organização com um usuário owner_admin ativo. */
export async function realAnchors(db) {
  const row = (await db.query(`
    SELECT ur.organization_id AS org, ur.user_id AS actor
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id AND r.key = 'owner_admin'
      JOIN public.profiles p ON p.user_id = ur.user_id AND p.status = 'active'
     ORDER BY p.created_at, ur.user_id LIMIT 1`)).rows[0];
  if (!row) throw new Error('Nenhum owner_admin ativo para ancorar as provas.');
  return row;
}

/**
 * Roda uma migration com ensaio, provas e (opcionalmente) aplicação.
 *
 * @param {object} opts
 * @param {string} opts.version       ex.: '230'
 * @param {string} opts.expectedTip   ponta do registro exigida antes de aplicar
 * @param {(ctx) => Promise<void>} opts.proofs
 */
export async function runMigration({ version, expectedTip, proofs, preflight }) {
  const apply = process.argv.includes('--apply');
  const target = targetDatabase();
  const db = target.client();
  const file = migrationFile(version);
  let failed = 0;
  try {
    await db.connect();
    console.log(`Alvo: ${target.label}${apply ? ' (APLICAR)' : ' (ensaio)'}`);
    const tip = (await db.query(
      'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1')).rows[0]?.version;
    if (tip === version) {
      console.log(`${version} já está aplicada. Nada a fazer.`);
      return;
    }
    if (tip !== expectedTip) throw new Error(`Esperava ponta ${expectedTip}, encontrei ${tip}.`);

    await db.query('BEGIN READ WRITE');
    if (preflight) await preflight(db);
    await db.query(strip(readFileSync(`supabase/migrations/${file}`, 'utf8')));
    await recordMigrationApplied(db, version, file.slice(4).replace(/\.sql$/, ''));
    console.log(`      (migration ${file} aplicada dentro da transação)`);

    await db.query('SAVEPOINT proofs');
    const ctx = createProofContext(db);
    try {
      await proofs({ db, ...ctx, anchors: await realAnchors(db) });
    } catch (error) {
      ctx.check('provas concluídas sem erro inesperado', false, error.message);
    }
    await db.query('ROLLBACK TO SAVEPOINT proofs');
    failed = ctx.results.filter((r) => !r.ok).length;
    console.log(`\n${ctx.results.length - failed}/${ctx.results.length} provas passaram.`);

    if (failed > 0 || !apply) {
      await db.query('ROLLBACK');
      console.log(failed > 0 ? 'ROLLBACK — há provas falhando; nada foi aplicado.'
                             : 'ROLLBACK — ensaio. Use --apply para aplicar.');
    } else {
      await db.query('COMMIT');
      console.log(`COMMIT — ${file} aplicada e registrada.`);
    }
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    console.error(`FALHA: ${error.message}`);
    failed = failed || 1;
  } finally {
    await db.end().catch(() => undefined);
  }
  process.exitCode = failed > 0 ? 1 : 0;
}
