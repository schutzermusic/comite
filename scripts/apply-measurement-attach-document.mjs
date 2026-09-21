/**
 * Aplica a migration 191 — ANEXAR DOCUMENTO À MEDIÇÃO, PELA PORTA CERTA.
 *
 * ADITIVA e puramente DDL: uma função nova. A função de 131 não é tocada e
 * continua inalcançável pelo navegador — o ensaio confere isso explicitamente,
 * porque o risco desta migration é exatamente afrouxar aquela porta por
 * descuido.
 *
 * Uso:  node scripts/apply-measurement-attach-document.mjs [--apply]
 */
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'node:fs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('SUPABASE_DB_URL ausente.'); process.exit(2); }

const FILE = '191_measurement_attach_document.sql';
const client = new pg.Client({ connectionString: url });
await client.connect();

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

try {
  await client.query('BEGIN');
  const sql = fs.readFileSync(`supabase/migrations/${FILE}`, 'utf8')
    .replace(/^BEGIN;$/m, '-- BEGIN (controlado pelo script)')
    .replace(/^COMMIT;$/m, '-- COMMIT (controlado pelo script)');
  await client.query(sql);
  console.log('✓', FILE);

  const g = await client.query(`
    SELECT p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('project_measurement_attach_document',
                         'project_measurement_link_evidence')
     ORDER BY p.proname`);
  const byName = Object.fromEntries(g.rows.map((r) => [r.proname, r.auth_exec]));
  check(byName.project_measurement_attach_document === true,
    'a porta estreita é executável pelo navegador');
  check(byName.project_measurement_link_evidence === false,
    'a função de 131 CONTINUA inalcançável pelo navegador');

  const n = await client.query(
    'SELECT count(*)::int n FROM public.project_measurement_evidence');
  check(n.rows[0].n === 0, 'o DDL não cria vínculo de evidência', String(n.rows[0].n));

  if (apply && failures === 0) {
    await client.query('COMMIT');
    console.log('\nAPLICADA.');
  } else {
    await client.query('ROLLBACK');
    console.log('\nENSAIO — desfeito. Rode com --apply para gravar.');
  }
  console.log(failures === 0 ? 'RESULTADO: APROVADO' : `RESULTADO: ${failures} FALHA(S)`);
  if (failures > 0) process.exitCode = 1;
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('\nFALHOU:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
