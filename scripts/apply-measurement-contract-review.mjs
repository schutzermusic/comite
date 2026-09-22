/**
 * Aplica a migration 192 — ANÁLISE CONTRATUAL, ENVIO E ACEITE DA CONTRATANTE.
 *
 * ADITIVA. Amplia o CHECK de `status` (nenhum estado sai), acrescenta carimbos
 * anuláveis, duas tabelas somente-acréscimo, arestas novas na máquina de
 * estados e seis RPCs. Não migra dado, não muda estado de medição nenhuma e
 * não toca Financeiro nem Fiscal.
 *
 * Os ensaios abaixo cobrem o que esta migration pode quebrar por descuido:
 * afrouxar o aceite, deixar um estado novo virar direito de faturar, ou abrir
 * escrita direta nas tabelas novas.
 *
 * Uso:  node scripts/apply-measurement-contract-review.mjs [--apply]
 */
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'node:fs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('SUPABASE_DB_URL ausente.'); process.exit(2); }

const FILE = '192_measurement_contract_review.sql';
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

  // ── 1) A máquina de estados ──────────────────────────────────────────
  const t = async (from, to) => (await client.query(
    'SELECT public.project_measurement_valid_transition($1,$2) ok', [from, to])).rows[0].ok;

  check(await t('SUBMITTED', 'APPROVED_FOR_CUSTOMER'), 'análise interna pode aprovar para envio');
  check(await t('APPROVED_FOR_CUSTOMER', 'AWAITING_CUSTOMER_ACCEPTANCE'), 'aprovado vai ao cliente');
  check(await t('AWAITING_CUSTOMER_ACCEPTANCE', 'ACCEPTED'), 'enviado pode ser aceito');
  check(await t('AWAITING_CUSTOMER_ACCEPTANCE', 'CUSTOMER_CORRECTION_REQUESTED'),
    'enviado pode voltar com pedido da Contratante');
  check(await t('RETURNED_FOR_CORRECTION', 'SUBMITTED'), 'devolvido reenvia o MESMO item');
  check(await t('CUSTOMER_CORRECTION_REQUESTED', 'SUBMITTED'), 'correção do cliente reentra na fila');

  // ── 2) O que a máquina tem de continuar recusando ────────────────────
  check(!(await t('APPROVED_FOR_CUSTOMER', 'ACCEPTED')),
    'aprovar para envio NÃO alcança o aceite sem passar pelo cliente');
  check(!(await t('READY_FOR_SUBMISSION', 'ACCEPTED')), 'pronto para submeter não é aceito');
  check(!(await t('IN_PREPARATION', 'AWAITING_CUSTOMER_ACCEPTANCE')),
    'preparação não envia ao cliente');
  check(await t('ACCEPTED', 'SUPERSEDED') && !(await t('ACCEPTED', 'IN_PREPARATION')),
    'ACCEPTED continua saindo só por supersessão');
  check(!(await t('CANCELLED', 'SUBMITTED')) && !(await t('SUPERSEDED', 'SUBMITTED')),
    'estados finais continuam finais');

  // ── 3) Estado novo NÃO é direito de faturar ──────────────────────────
  /*
    O ensaio roda o resolvedor sobre uma medição real em cada estado novo, via
    UPDATE + ROLLBACK aninhado: é a única forma de provar a dimensão de
    faturamento sem confiar na leitura do SQL.
  */
  const anyM = await client.query('SELECT id, status FROM public.project_measurements LIMIT 1');
  if (anyM.rows.length === 0) {
    console.log('  · nenhuma medição real na base: ensaio de prontidão por estado ignorado');
  } else {
    const id = anyM.rows[0].id;
    /*
      A trilha é percorrida ESTADO A ESTADO porque o gatilho `pm_guard` valida
      cada passo — e é justamente isso que se quer provar: não existe atalho
      para os estados novos, nem para quem escreve direto na tabela.
    */
    const walk = [
      ['IN_PREPARATION', ''],
      ['READY_FOR_SUBMISSION', ''],
      ['SUBMITTED', ', submitted_at = now()'],
      ['APPROVED_FOR_CUSTOMER', ', approved_for_customer_at = now()'],
      ['AWAITING_CUSTOMER_ACCEPTANCE', ', sent_to_customer_at = now()'],
    ];
    await client.query('SAVEPOINT s');
    for (const [st, extra] of walk) {
      await client.query(
        `UPDATE public.project_measurements SET status = $2${extra} WHERE id = $1`, [id, st]);
      if (st !== 'APPROVED_FOR_CUSTOMER' && st !== 'AWAITING_CUSTOMER_ACCEPTANCE') continue;
      const r = await client.query('SELECT public.project_measurement_readiness($1,NULL) j', [id]);
      const dims = r.rows[0].j.dimensions;
      check(dims.billing_prerequisite !== 'READY',
        `${st} não concede direito de faturar`, `billing_prerequisite=${dims.billing_prerequisite}`);
      check(dims.acceptance !== 'READY',
        `${st} não conta como aceite`, `acceptance=${dims.acceptance}`);
    }
    await client.query('ROLLBACK TO SAVEPOINT s');
  }

  // ── 4) Escrita direta continua fechada ───────────────────────────────
  const priv = await client.query(`
    SELECT table_name, privilege_type FROM information_schema.role_table_grants
     WHERE grantee = 'authenticated' AND table_schema = 'public'
       AND table_name IN ('project_measurement_customer_dispatches',
                          'project_measurement_correction_items')
     ORDER BY table_name, privilege_type`);
  const writes = priv.rows.filter((r) => r.privilege_type !== 'SELECT');
  check(writes.length === 0, 'tabelas novas: o navegador só LÊ',
    writes.map((r) => `${r.table_name}:${r.privilege_type}`).join(',') || 'nenhuma escrita');

  const rls = await client.query(`
    SELECT relname, relrowsecurity FROM pg_class
     WHERE relname IN ('project_measurement_customer_dispatches',
                       'project_measurement_correction_items')`);
  check(rls.rows.length === 2 && rls.rows.every((r) => r.relrowsecurity),
    'RLS habilitada nas duas tabelas novas');

  // ── 5) As RPCs novas são alcançáveis; as internas, não ───────────────
  const g = await client.query(`
    SELECT p.proname, bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')) auth_exec
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname IN (
       'project_measurement_start_review','project_measurement_request_correction',
       'project_measurement_resubmit','project_measurement_approve_for_customer',
       'project_measurement_send_to_customer','project_measurement_customer_correction',
       'project_measurement_accept','project_measurement_transition',
       'project_measurement_link_evidence')
     GROUP BY p.proname ORDER BY p.proname`);
  const byName = Object.fromEntries(g.rows.map((r) => [r.proname, r.auth_exec]));
  for (const fn of ['project_measurement_start_review', 'project_measurement_request_correction',
    'project_measurement_resubmit', 'project_measurement_approve_for_customer',
    'project_measurement_send_to_customer', 'project_measurement_customer_correction',
    'project_measurement_accept']) {
    check(byName[fn] === true, `${fn} é chamável pelo navegador`);
  }
  check(byName.project_measurement_transition === false,
    'o executor comum CONTINUA inalcançável pelo navegador');
  check(byName.project_measurement_link_evidence === false,
    'a função de 131 continua inalcançável pelo navegador');

  // ── 6) A permissão nova existe e não foi concedida a ninguém ─────────
  const perm = await client.query(
    `SELECT id FROM public.permissions WHERE key='contracts.measurements.review'`);
  check(perm.rows.length === 1, 'permissão contracts.measurements.review registrada');
  const granted = await client.query(`
    SELECT count(*)::int n FROM public.role_permissions rp
     JOIN public.permissions p ON p.id = rp.permission_id
     WHERE p.key = 'contracts.measurements.review'`);
  check(granted.rows[0].n === 0,
    'a permissão nova não foi concedida a papel nenhum (alçada é ato de quem administra)');

  // ── 7) Nada de estado mudou ──────────────────────────────────────────
  const st = await client.query(
    'SELECT status, count(*)::int n FROM public.project_measurements GROUP BY 1 ORDER BY 1');
  check(st.rows.every((r) => ['PLANNED', 'IN_PREPARATION', 'READY_FOR_SUBMISSION'].includes(r.status)),
    'o DDL não moveu nenhuma medição de estado',
    st.rows.map((r) => `${r.status}=${r.n}`).join(' '));
  const dis = await client.query('SELECT count(*)::int n FROM public.project_measurement_customer_dispatches');
  const ci = await client.query('SELECT count(*)::int n FROM public.project_measurement_correction_items');
  check(dis.rows[0].n === 0 && ci.rows[0].n === 0,
    'o DDL não cria remessa nem item de correção');

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
