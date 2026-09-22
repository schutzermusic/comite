/**
 * Aplica a migration 196 — O AUTOR DO FECHAMENTO DO ITEM DE CORREÇÃO.
 *
 * Corrige uma restrição da 192 que impedia o reenvio quando o chamador é
 * servidor (sem `auth.uid()`), sem passar a fabricar autoria. Aditiva: uma
 * coluna anulável, três restrições e a mesma função de reenvio.
 *
 * Uso:  node scripts/apply-correction-item-closure-actor.mjs [--apply]
 */
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'node:fs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('SUPABASE_DB_URL ausente.'); process.exit(2); }

const FILE = '196_correction_item_closure_actor.sql';
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
  console.log('✓', FILE, '\n');

  const m = await client.query(
    'SELECT id, organization_id FROM public.project_measurements LIMIT 1');
  if (m.rows.length === 0) {
    console.log('  · nenhuma medição real: ensaio de fechamento ignorado');
  } else {
    const { id, organization_id: org } = m.rows[0];
    await client.query('SAVEPOINT s');
    await client.query(`
      INSERT INTO public.project_measurement_correction_items
        (organization_id, measurement_id, round, requested_by_side, item)
      VALUES ($1,$2,1,'contract_management','ensaio')`, [org, id]);

    // Fechamento SEM pessoa: agora possível, e declarado como 'system'.
    await client.query(`
      UPDATE public.project_measurement_correction_items
         SET resolved_at = now(), closure_actor_source = 'system'
       WHERE measurement_id = $1`, [id]);
    const r = await client.query(`
      SELECT resolved_at, resolved_by, closure_actor_source
        FROM public.project_measurement_correction_items WHERE measurement_id = $1`, [id]);
    check(r.rows[0].resolved_at !== null && r.rows[0].resolved_by === null
      && r.rows[0].closure_actor_source === 'system',
      'fechamento por servidor é aceito e DECLARADO como system');

    // 'human' sem pessoa continua recusado: o rótulo não pode mentir.
    let refused = false;
    try {
      await client.query('SAVEPOINT s2');
      await client.query(`
        UPDATE public.project_measurement_correction_items
           SET closure_actor_source = 'human', resolved_by = NULL
         WHERE measurement_id = $1`, [id]);
      await client.query('ROLLBACK TO SAVEPOINT s2');
    } catch { refused = true; await client.query('ROLLBACK TO SAVEPOINT s2'); }
    check(refused, '"fechado por pessoa" SEM pessoa é recusado');

    // Aberto não pode carregar origem de fechamento.
    let refusedOpen = false;
    try {
      await client.query('SAVEPOINT s3');
      await client.query(`
        UPDATE public.project_measurement_correction_items
           SET resolved_at = NULL, resolved_by = NULL
         WHERE measurement_id = $1`, [id]);
      await client.query('ROLLBACK TO SAVEPOINT s3');
    } catch { refusedOpen = true; await client.query('ROLLBACK TO SAVEPOINT s3'); }
    check(refusedOpen, 'item aberto NÃO carrega origem de fechamento');

    await client.query('ROLLBACK TO SAVEPOINT s');
  }

  const n = await client.query(
    'SELECT count(*)::int n FROM public.project_measurement_correction_items');
  check(n.rows[0].n === 0, 'o DDL não deixa item de correção na base');

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
