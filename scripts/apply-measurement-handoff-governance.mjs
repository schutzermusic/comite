/**
 * Aplica a migration 194 — RESPONSÁVEIS, SLA, DEDUPLICAÇÃO E FILA DE ANÁLISE.
 *
 * ADITIVA: duas tabelas, uma visão, cinco funções. Não escreve medição,
 * evidência, faturamento, fiscal nem financeiro, e não semeia política — sem
 * política declarada o SLA responde NOT_ASSESSED, que é a verdade.
 *
 * Os ensaios provam as duas coisas que esta migration pode errar feio:
 * inventar prazo, e inventar responsável.
 *
 * Uso:  node scripts/apply-measurement-handoff-governance.mjs [--apply]
 */
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'node:fs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('SUPABASE_DB_URL ausente.'); process.exit(2); }

const FILE = '194_measurement_handoff_governance.sql';
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

  // ── privilégio ───────────────────────────────────────────────────────
  const priv = await client.query(`
    SELECT table_name, privilege_type FROM information_schema.role_table_grants
     WHERE grantee='authenticated' AND table_schema='public'
       AND table_name IN ('project_measurement_notification_policies',
                          'project_measurement_handoff_dispatches')`);
  const writes = priv.rows.filter((r) => r.privilege_type !== 'SELECT');
  check(writes.length === 0, 'o navegador só LÊ política e registro de entrega',
    writes.map((r) => `${r.table_name}:${r.privilege_type}`).join(',') || 'nenhuma escrita');

  const g = await client.query(`
    SELECT p.proname, bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')) auth_exec
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname IN (
       'project_measurement_stakeholders','project_measurement_sla',
       'project_measurement_policy','project_measurement_handoff_record',
       'project_measurement_sla_nudges')
     GROUP BY p.proname ORDER BY p.proname`);
  const byName = Object.fromEntries(g.rows.map((r) => [r.proname, r.auth_exec]));
  check(byName.project_measurement_stakeholders === true
    && byName.project_measurement_sla === true
    && byName.project_measurement_policy === true, 'leituras liberadas ao navegador');
  check(byName.project_measurement_handoff_record === false
    && byName.project_measurement_sla_nudges === false,
    'gravar entrega e varrer SLA são server-only');

  const m = await client.query('SELECT id, organization_id FROM public.project_measurements LIMIT 1');
  if (m.rows.length === 0) {
    console.log('  · nenhuma medição real: ensaios de SLA e responsáveis ignorados');
  } else {
    const id = m.rows[0].id;

    // ── SLA sem política: NÃO inventa prazo ────────────────────────────
    const s0 = await client.query('SELECT public.project_measurement_sla($1,NULL) j', [id]);
    check(['NOT_ASSESSED', 'NOT_APPLICABLE'].includes(s0.rows[0].j.state),
      'sem política declarada o SLA NÃO inventa prazo', s0.rows[0].j.state);

    // ── SLA com política: prazo aparece, e vem da declaração ───────────
    await client.query('SAVEPOINT s');
    await client.query(`INSERT INTO public.project_measurement_notification_policies
      (organization_id, review_due_days, warning_days) VALUES ($1, 5, 2)`,
      [m.rows[0].organization_id]);
    await client.query(`UPDATE public.project_measurements
      SET status='IN_PREPARATION' WHERE id=$1`, [id]);
    await client.query(`UPDATE public.project_measurements
      SET status='READY_FOR_SUBMISSION' WHERE id=$1`, [id]);
    await client.query(`UPDATE public.project_measurements
      SET status='SUBMITTED', submitted_at = now() - interval '9 days' WHERE id=$1`, [id]);
    const s1 = await client.query('SELECT public.project_measurement_sla($1,NULL) j', [id]);
    check(s1.rows[0].j.stage === 'CONTRACT_REVIEW' && s1.rows[0].j.state === 'OVERDUE',
      'com prazo declarado, nove dias em análise é ATRASO',
      `${s1.rows[0].j.stage}/${s1.rows[0].j.state} due=${s1.rows[0].j.due_at}`);

    const nudges = await client.query(
      'SELECT * FROM public.project_measurement_sla_nudges($1,NULL,10)', [m.rows[0].organization_id]);
    check(nudges.rows.some((r) => r.measurement_id === id),
      'a pendência vencida entra na lista de cobrança');

    // ── dedup: registrar duas vezes não cria duas linhas ───────────────
    const u = await client.query('SELECT user_id FROM public.profiles WHERE status=\'active\' LIMIT 1');
    if (u.rows.length > 0) {
      const uid = u.rows[0].user_id;
      await client.query(
        `SELECT public.project_measurement_handoff_record($1,'k:r1','sla.reminder',$2,'contract_manager','in_app','DELIVERED')`,
        [id, uid]);
      await client.query(
        `SELECT public.project_measurement_handoff_record($1,'k:r1','sla.reminder',$2,'contract_manager','in_app','DELIVERED')`,
        [id, uid]);
      const n = await client.query(
        `SELECT count(*)::int n FROM public.project_measurement_handoff_dispatches
          WHERE measurement_id=$1 AND handoff_key='k:r1' AND channel='in_app'`, [id]);
      check(n.rows[0].n === 1, 'a segunda entrega do MESMO handoff não duplica', `linhas=${n.rows[0].n}`);

      const n2 = await client.query(
        `SELECT public.project_measurement_handoff_record($1,'k:r2','sla.reminder',$2,'contract_manager','in_app','DELIVERED') id`,
        [id, uid]);
      check(n2.rows[0].id !== null, 'a RODADA seguinte volta a avisar');
    } else {
      console.log('  · nenhum perfil ativo: ensaio de deduplicação ignorado');
    }

    await client.query('ROLLBACK TO SAVEPOINT s');

    // ── responsáveis: nada de aproximação ──────────────────────────────
    const st = await client.query('SELECT * FROM public.project_measurement_stakeholders($1)', [id]);
    check(st.rows.length === 6, 'os seis papéis são sempre respondidos',
      st.rows.map((r) => `${r.role}=${r.resolution}`).join(' '));
    check(st.rows.every((r) => (r.resolution === 'RESOLVED') === (r.user_id !== null)),
      'papel resolvido tem usuário; papel indefinido não tem nenhum');
    check(st.rows.every((r) => r.source && r.source.length > 0),
      'todo papel diz DE ONDE sairia o responsável');

    // ── a fila mostra o MESMO id ───────────────────────────────────────
    const q = await client.query(
      'SELECT count(*)::int n FROM public.project_measurement_review_queue');
    check(typeof q.rows[0].n === 'number', 'a fila é consultável', `itens=${q.rows[0].n}`);
  }

  const pol = await client.query(
    'SELECT count(*)::int n FROM public.project_measurement_notification_policies');
  check(pol.rows[0].n === 0, 'o DDL não semeia política de prazo nem responsável');
  const d = await client.query(
    'SELECT count(*)::int n FROM public.project_measurement_handoff_dispatches');
  check(d.rows[0].n === 0, 'o DDL não registra entrega nenhuma');
  const stt = await client.query(
    'SELECT DISTINCT status FROM public.project_measurements ORDER BY 1');
  check(stt.rows.every((r) => ['PLANNED', 'IN_PREPARATION', 'READY_FOR_SUBMISSION'].includes(r.status)),
    'nenhuma medição saiu do estado em que estava',
    stt.rows.map((r) => r.status).join(','));

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
