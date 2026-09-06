/**
 * Fase 6 — remoção das organizações DESCARTÁVEIS de medição.
 *
 *   node scripts/cleanup-contracts-v2-phase6-disposable.mjs           # ENSAIO
 *   node scripts/cleanup-contracts-v2-phase6-disposable.mjs --apply   # APAGA
 *
 * ─── Por que este arquivo existe ───────────────────────────────────────────
 *
 * Porque `DELETE FROM organizations` NÃO basta, e descobrir isso em produção
 * custou uma limpeza manual. `projects` e `tasks` referenciam a organização
 * SEM cascata: o delete falha, e num bloco com try/catch em volta ele falha em
 * SILÊNCIO — deixando organização de teste, medição de teste e evento de teste
 * no banco real. A §59 e a §102 proíbem exatamente isso.
 *
 * A varredura é genérica de propósito. Uma lista de tabelas escrita à mão
 * envelhece com a próxima migration, e o sintoma seria lixo residual que
 * ninguém procura. Aqui, toda tabela com `organization_id` entra, e os passes
 * repetidos resolvem a ordem de dependência sem ninguém precisar declará-la.
 */
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
/** Prefixos usados pelos cenários descartáveis desta fase. */
const PATTERNS = ['[P6]%', '[P6-LIVE]%', '[P6-SMOKE]%'];

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query('SET SESSION default_transaction_read_only = off');

let ok = true;
try {
  await c.query('BEGIN');

  const { rows: orgs } = await c.query(
    `SELECT id, name FROM organizations WHERE name LIKE ANY($1::text[])`, [PATTERNS]);
  console.log(`organizações descartáveis: ${orgs.length}`);
  for (const o of orgs) console.log(`  · ${o.name} (${o.id})`);

  if (orgs.length > 0) {
    const ids = orgs.map((o) => o.id);
    const { rows: tables } = await c.query(
      `SELECT c.table_name FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema='public' AND c.column_name='organization_id' AND t.table_type='BASE TABLE'
        ORDER BY c.table_name`);

    let remaining = tables.map((t) => t.table_name);
    for (let pass = 0; pass < 8 && remaining.length > 0; pass += 1) {
      const next = [];
      for (const t of remaining) {
        await c.query('SAVEPOINT s');
        try {
          const r = await c.query(`DELETE FROM public.${t} WHERE organization_id = ANY($1::uuid[])`, [ids]);
          await c.query('RELEASE SAVEPOINT s');
          if (r.rowCount > 0) console.log(`  passe ${pass} · ${t}: ${r.rowCount}`);
        } catch {
          // Bloqueada por dependência ainda viva. Volta para o próximo passe.
          await c.query('ROLLBACK TO SAVEPOINT s');
          next.push(t);
        }
      }
      remaining = next;
    }
    if (remaining.length > 0) console.log(`  ainda bloqueadas: ${remaining.join(', ')}`);

    await c.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [ids]);
    await c.query(
      `DELETE FROM auth.users WHERE email LIKE 'p6.%@example.test'
          OR email LIKE 'p6live.%@example.test' OR email LIKE 'p6smoke.%@example.test'`);
  }

  const after = (await c.query(`SELECT
      (SELECT count(*)::int FROM project_measurements) medicoes,
      (SELECT count(*)::int FROM domain_events WHERE aggregate_type='project_measurement') eventos,
      (SELECT count(*)::int FROM organizations WHERE name LIKE ANY($1::text[])) orgs`, [PATTERNS])).rows[0];
  /*
    O rótulo importa. No ensaio, estes números descrevem o que RESTARIA depois
    do apagamento — e a transação é desfeita logo abaixo, então o banco continua
    como estava. Ler "restante: 0" de um ensaio como "produção está limpa" é um
    engano fácil de cometer, e eu o cometi uma vez nesta fase.
  */
  console.log(APPLY
    ? `\nrestante (APLICADO): ${JSON.stringify(after)}`
    : `\nrestaria se aplicado (ENSAIO — nada foi apagado): ${JSON.stringify(after)}`);

  // A verificação é sobre a AUSÊNCIA. Um script de limpeza que não confere o
  // resultado é indistinguível de um que não limpou.
  if (after.orgs !== 0) { ok = false; console.error('✗ ainda há organização descartável'); }
  if (after.medicoes !== 0) { ok = false; console.error('✗ ainda há medição de teste'); }
  if (after.eventos !== 0) { ok = false; console.error('✗ ainda há evento de medição de teste'); }

  if (APPLY && ok) { await c.query('COMMIT'); console.log('### APAGADO ###'); }
  else { await c.query('ROLLBACK'); console.log(APPLY ? '### ROLLBACK: verificação falhou ###' : '### ROLLBACK (ensaio) ###'); }
} catch (e) {
  ok = false;
  try { await c.query('ROLLBACK'); } catch { /* já desfeita */ }
  console.error('FALHA:', e.message);
} finally {
  await c.end();
}
console.log(ok ? 'VERDE' : 'VERMELHO');
process.exit(ok ? 0 : 1);
