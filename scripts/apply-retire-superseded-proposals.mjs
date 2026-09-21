/**
 * Aplica a migration 187 — faxina de palpites superados.
 *
 * Uso: node scripts/apply-retire-superseded-proposals.mjs [--apply]
 */
import pg from 'pg'; import dotenv from 'dotenv'; import fs from 'node:fs';
dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });
const apply = process.argv.includes('--apply');
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
await c.connect();
const P = 'proj-3a445bb5-c576-445d-bb49-adcddd52dc1d';
try {
  await c.query('BEGIN');
  await c.query(fs.readFileSync('supabase/migrations/187_retire_superseded_proposals.sql', 'utf8')
    .replace(/^BEGIN;$/m, '--').replace(/^COMMIT;$/m, '--'));
  console.log('✓ 187_retire_superseded_proposals.sql');

  // Prova: decisão humana é intocável mesmo mandando a função apagar tudo.
  await c.query('SAVEPOINT s');
  const before = (await c.query(`select review_state, count(*)::int n
    from contract_measurement_rule_timeline_mappings where project_id=$1 group by 1 order by 1`, [P])).rows;
  const rules = (await c.query(
    `select array_agg(distinct rule_id) ids from contract_measurement_rule_timeline_mappings where project_id=$1`, [P])).rows[0].ids;
  const n = (await c.query(
    `select public.contract_billing_retire_superseded_proposals($1,$2,$3,ARRAY[]::uuid[]) n`,
    ['ea674f46-1ea2-421a-9122-eefe9307776a', P, rules])).rows[0].n;
  const after = (await c.query(`select review_state, count(*)::int n
    from contract_measurement_rule_timeline_mappings where project_id=$1 group by 1 order by 1`, [P])).rows;
  console.log('  antes :', before.map(r => `${r.review_state}=${r.n}`).join(' '));
  console.log('  removidos (nenhum id preservado):', n);
  console.log('  depois:', after.map(r => `${r.review_state}=${r.n}`).join(' '));
  const acc = after.find(r => r.review_state === 'accepted')?.n ?? 0;
  if (acc !== (before.find(r => r.review_state === 'accepted')?.n ?? 0)) {
    throw new Error('FALHA: decisão humana foi afetada');
  }
  console.log('  decisões humanas preservadas ✓');
  await c.query('ROLLBACK TO SAVEPOINT s');

  if (apply) { await c.query('COMMIT'); console.log('\nAPLICADA.'); }
  else { await c.query('ROLLBACK'); console.log('\nENSAIO — desfeito.'); }
} catch (e) {
  await c.query('ROLLBACK'); console.error('FALHOU:', e.message); process.exitCode = 1;
} finally { await c.end(); }
