/**
 * Aplica a migration 190 — A MEDIÇÃO NASCE QUANDO O GATILHO OCORRE.
 *
 * ADITIVA em DDL: quatro funções e dois gatilhos novos. Nenhuma tabela muda,
 * nenhuma função existente é substituída, a 134 fica intacta.
 *
 * O que NÃO é aditivo é o BACKFILL: ele cria linhas em `project_measurements`
 * para gatilhos que já ocorreram. Por isso ele é um passo SEPARADO e opt-in
 * (`--backfill`), e o ensaio mostra quantas linhas ele criaria antes de
 * qualquer decisão.
 *
 * Uso:  node scripts/apply-measurement-materialization-on-trigger.mjs
 *         → ensaio completo (inclusive do backfill), desfeito no fim
 *       … --apply              → grava só o DDL
 *       … --apply --backfill   → grava o DDL e materializa o passivo
 */
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'node:fs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
const backfill = process.argv.includes('--backfill');
const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('SUPABASE_DB_URL ausente.'); process.exit(2); }

const FILE = '190_measurement_materialization_on_trigger.sql';
const client = new pg.Client({ connectionString: url });
await client.connect();

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

try {
  await client.query('BEGIN');

  const before = await client.query(`
    SELECT (SELECT count(*) FROM public.project_measurements)::int medicoes,
           (SELECT count(*) FROM public.project_measurement_evidence)::int evidencias,
           (SELECT count(*) FROM public.contract_billing_events)::int faturamentos`);

  const sql = fs.readFileSync(`supabase/migrations/${FILE}`, 'utf8')
    .replace(/^BEGIN;$/m, '-- BEGIN (controlado pelo script)')
    .replace(/^COMMIT;$/m, '-- COMMIT (controlado pelo script)');
  await client.query(sql);
  console.log('✓', FILE);

  // ── 1. O DDL não cria dado ───────────────────────────────────────────────
  console.log('\n1) O DDL sozinho não cria medição');
  const afterDdl = await client.query('SELECT count(*)::int n FROM public.project_measurements');
  check(afterDdl.rows[0].n === before.rows[0].medicoes,
    'project_measurements inalterado pelo DDL', `${afterDdl.rows[0].n}`);

  // ── 2. Superfície de chamada ─────────────────────────────────────────────
  console.log('\n2) Superfície de chamada');
  const grants = await client.query(`
    SELECT p.proname, p.prosecdef,
           COALESCE(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) AS authenticated
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN (
       'project_measurement_materialize_for_timeline_item',
       'project_measurement_ensure_for_milestone',
       'project_measurements_backfill_from_schedule',
       'project_timeline_items_materialize_measurement',
       'project_measurement_trigger_occurrence_key')
     ORDER BY p.proname`);
  for (const g of grants.rows) {
    const esperado = g.proname === 'project_measurement_ensure_for_milestone'
      || g.proname === 'project_measurement_trigger_occurrence_key';
    check(g.authenticated === esperado,
      `${g.proname}: authenticated ${g.authenticated ? 'PODE' : 'não pode'} executar`,
      esperado ? 'esperado' : 'escrita fechada ao navegador');
  }

  const trg = await client.query(`
    SELECT tgname FROM pg_trigger
     WHERE tgrelid = 'public.project_timeline_items'::regclass AND NOT tgisinternal
       AND tgname LIKE 'trg_timeline_materialize%' ORDER BY tgname`);
  check(trg.rows.length === 2, 'os dois gatilhos de cronograma existem',
    trg.rows.map((t) => t.tgname).join(' '));

  // ── 3. A chave de ocorrência ─────────────────────────────────────────────
  console.log('\n3) Chave de ocorrência determinística');
  const k = await client.query(`
    SELECT public.project_measurement_trigger_occurrence_key('MONTHLY','2025-11-03'::date,'11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222') mensal,
           public.project_measurement_trigger_occurrence_key('UNKNOWN','2025-11-03'::date,'11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222') desconhecida,
           public.project_measurement_trigger_occurrence_key('MILESTONE','2025-11-03'::date,'11111111-1111-1111-1111-111111111111',NULL) marco,
           public.project_measurement_trigger_occurrence_key('ON_EVENT','2025-11-03'::date,NULL,'22222222-2222-2222-2222-222222222222') etapa,
           public.project_measurement_trigger_occurrence_key('ON_EVENT',NULL,NULL,NULL) sem_ancora`);
  const key = k.rows[0];
  check(key.mensal === '2025-11', 'cadência de calendário continua com a chave da 134', key.mensal);
  check(key.desconhecida === key.marco,
    'UNKNOWN e MILESTONE produzem a MESMA chave — corrigir a cadência não duplica', key.desconhecida);
  check(key.etapa === 'timeline:22222222-2222-2222-2222-222222222222',
    'sem marco, a âncora é a etapa governada');
  check(key.sem_ancora === null, 'sem marco e sem etapa não há ocorrência — e nada é criado');

  // ── 4. O passivo, em ensaio ──────────────────────────────────────────────
  console.log('\n4) Passivo de gatilhos já ocorridos');
  const result = await client.query('SELECT public.project_measurements_backfill_from_schedule() AS r');
  const r = result.rows[0].r;
  console.log(`    etapas visitadas: ${r.timeline_items_visited} · medições criadas: ${r.measurements_created}`);

  const criadas = await client.query(`
    SELECT c.contract_number, pm.status, pm.origin, pm.occurrence_key, pm.expected_at,
           i.wbs_code, m.title
      FROM public.project_measurements pm
      JOIN public.contracts c ON c.id = pm.contract_id
      LEFT JOIN public.project_timeline_items i ON i.id = pm.timeline_item_id
      LEFT JOIN public.contract_milestones m ON m.id = pm.milestone_id
     ORDER BY c.contract_number, m.title`);
  console.table(criadas.rows);

  check(criadas.rows.every((x) => x.status === 'PLANNED'),
    'TODA medição nasceu PLANNED — nenhuma medida, aceita ou elegível');

  const segunda = await client.query('SELECT public.project_measurements_backfill_from_schedule() AS r');
  check(segunda.rows[0].r.measurements_created === 0,
    'a segunda execução cria ZERO — idempotente', JSON.stringify(segunda.rows[0].r));

  const dupes = await client.query(`
    SELECT count(*)::int n FROM (
      SELECT organization_id, project_id, contract_measurement_rule_id, occurrence_key
        FROM public.project_measurements
       WHERE occurrence_state = 'resolved' AND status NOT IN ('SUPERSEDED','CANCELLED')
       GROUP BY 1,2,3,4 HAVING count(*) > 1) d`);
  check(dupes.rows[0].n === 0, 'nenhuma ocorrência duplicada');

  // ── 5. Nada a jusante foi fabricado ─────────────────────────────────────
  console.log('\n5) Auditoria de fabricação');
  const after = await client.query(`
    SELECT (SELECT count(*) FROM public.project_measurements WHERE status <> 'PLANNED')::int nao_planned,
           (SELECT count(*) FROM public.project_measurements WHERE accepted_at IS NOT NULL)::int aceitas,
           (SELECT count(*) FROM public.project_measurements WHERE measured_value IS NOT NULL)::int com_valor,
           (SELECT count(*) FROM public.project_measurement_evidence)::int evidencias,
           (SELECT count(*) FROM public.contract_billing_events)::int faturamentos`);
  const a = after.rows[0];
  check(a.nao_planned === 0, 'nenhuma medição fora de PLANNED', String(a.nao_planned));
  check(a.aceitas === 0, 'nenhum aceite fabricado', String(a.aceitas));
  check(a.com_valor === 0, 'nenhum valor medido fabricado', String(a.com_valor));
  check(a.evidencias === before.rows[0].evidencias, 'nenhuma evidência fabricada', String(a.evidencias));
  check(a.faturamentos === before.rows[0].faturamentos,
    'nenhum evento de faturamento criado', String(a.faturamentos));

  // Elegibilidade continua vindo da cadeia canônica, não da materialização.
  const eleg = await client.query(`
    SELECT count(*) FILTER (WHERE billing_eligibility_state = 'ELIGIBLE')::int elegiveis,
           count(*)::int total
      FROM public.contract_milestone_workbench`);
  check(eleg.rows[0].elegiveis === 0,
    'nenhum marco virou elegível para faturar', `${eleg.rows[0].elegiveis}/${eleg.rows[0].total}`);

  if (apply && failures === 0) {
    if (!backfill) {
      // Desfaz SÓ o backfill, mantendo o DDL: as funções e gatilhos são
      // idempotentes por natureza, mas as linhas criadas não devem persistir
      // sem decisão explícita.
      await client.query('ROLLBACK');
      await client.query('BEGIN');
      await client.query(sql);
      console.log('\n(backfill descartado — rode com --backfill para materializar o passivo)');
    }
    await client.query('COMMIT');
    console.log(backfill ? '\nAPLICADA COM BACKFILL.' : '\nAPLICADA (somente DDL).');
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
