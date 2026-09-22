/**
 * Aplica a migration 195 — A PORTA DE SERVIDOR DA NOTIFICAÇÃO IN-APP.
 *
 * ADITIVA: uma função nova. A função de 026 não é tocada e continua sendo o
 * caminho do navegador — o ensaio confere isso explicitamente, porque o risco
 * desta migration é afrouxar aquela porta por descuido.
 *
 * Uso:  node scripts/apply-notification-server-door.mjs [--apply]
 */
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'node:fs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('SUPABASE_DB_URL ausente.'); process.exit(2); }

const FILE = '195_notification_server_door.sql';
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

  const g = await client.query(`
    SELECT p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_exec
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname IN ('create_notification','create_notification_for')
     ORDER BY p.proname`);
  const byName = Object.fromEntries(g.rows.map((r) => [r.proname, r.auth_exec]));
  check(byName.create_notification === true, 'a porta do navegador (026) continua aberta ao navegador');
  check(byName.create_notification_for === false, 'a porta de servidor é inalcançável pelo navegador');

  const before = (await client.query('SELECT count(*)::int n FROM public.notifications')).rows[0].n;

  const u = await client.query(
    `SELECT user_id, organization_id FROM public.profiles
      WHERE status='active' AND organization_id IS NOT NULL LIMIT 1`);
  if (u.rows.length === 0) {
    console.log('  · nenhum perfil ativo com organização: ensaio de entrega ignorado');
  } else {
    const { user_id: uid, organization_id: org } = u.rows[0];
    const r = await client.query(
      `SELECT public.create_notification_for($1,$2,'ensaio.porta','Ensaio','corpo','/x') id`, [org, uid]);
    check(r.rows[0].id !== null, 'o servidor consegue criar notificação in-app');

    let refused = false;
    try {
      await client.query('SAVEPOINT s');
      await client.query(
        `SELECT public.create_notification_for($1,$2,'ensaio.porta','Ensaio',NULL,NULL)`,
        ['00000000-0000-0000-0000-000000000000', uid]);
      await client.query('ROLLBACK TO SAVEPOINT s');
    } catch { refused = true; await client.query('ROLLBACK TO SAVEPOINT s'); }
    check(refused, 'destinatário fora da organização informada é RECUSADO');
  }

  await client.query('ROLLBACK');
  const after = (await client.query('SELECT count(*)::int n FROM public.notifications')).rows[0].n;
  check(after === before, 'o ensaio não deixou notificação na base', `${before} → ${after}`);

  if (apply && failures === 0) {
    // O ensaio já desfez tudo; a aplicação reexecuta apenas o DDL.
    await client.query('BEGIN');
    await client.query(fs.readFileSync(`supabase/migrations/${FILE}`, 'utf8')
      .replace(/^BEGIN;$/m, '-- BEGIN').replace(/^COMMIT;$/m, '-- COMMIT'));
    await client.query('COMMIT');
    console.log('\nAPLICADA.');
  } else {
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
