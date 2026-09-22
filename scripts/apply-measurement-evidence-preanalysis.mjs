/**
 * Aplica a migration 193 — PRÉ-ANÁLISE DO APEX SOBRE A EVIDÊNCIA.
 *
 * ADITIVA e puramente DDL: duas tabelas novas, quatro funções. Nenhuma delas
 * escreve em medição, exigência, evidência, faturamento, fiscal ou financeiro.
 *
 * O ensaio roda um parecer COMPLETO sobre a evidência real que existe na base
 * e confere, depois, que o estado do mundo não mudou: a exigência continua
 * MISSING, a evidência continua `unvalidated` e a medição continua PLANNED.
 * É esse o risco desta migration — um parecer que se transforma em decisão.
 *
 * Uso:  node scripts/apply-measurement-evidence-preanalysis.mjs [--apply]
 */
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'node:fs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('SUPABASE_DB_URL ausente.'); process.exit(2); }

const FILE = '193_measurement_evidence_preanalysis.sql';
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

  // ── 1) Postura de privilégio ─────────────────────────────────────────
  const priv = await client.query(`
    SELECT table_name, privilege_type FROM information_schema.role_table_grants
     WHERE grantee = 'authenticated' AND table_schema = 'public'
       AND table_name IN ('project_measurement_evidence_analyses',
                          'project_measurement_evidence_findings')`);
  const writes = priv.rows.filter((r) => r.privilege_type !== 'SELECT');
  check(writes.length === 0, 'o navegador só LÊ o parecer',
    writes.map((r) => `${r.table_name}:${r.privilege_type}`).join(',') || 'nenhuma escrita');

  const g = await client.query(`
    SELECT p.proname, bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')) auth_exec
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname LIKE 'project_measurement_preanalysis%'
     GROUP BY p.proname ORDER BY p.proname`);
  const byName = Object.fromEntries(g.rows.map((r) => [r.proname, r.auth_exec]));
  check(byName.project_measurement_preanalysis === true,
    'ler o parecer consolidado é permitido ao navegador');
  check(byName.project_measurement_preanalysis_open === false
    && byName.project_measurement_preanalysis_complete === false
    && byName.project_measurement_preanalysis_fail === false,
    'GRAVAR parecer é server-only — o navegador não inscreve veredito');

  // ── 2) Um parecer real, e o mundo intacto depois dele ────────────────
  const ev = await client.query(
    'SELECT id, measurement_id FROM public.project_measurement_evidence WHERE revoked_at IS NULL LIMIT 1');
  if (ev.rows.length === 0) {
    console.log('  · nenhuma evidência real na base: ensaio de parecer ignorado');
  } else {
    const { id: evidenceId, measurement_id: mid } = ev.rows[0];

    const before = await client.query(`
      SELECT (SELECT status FROM public.project_measurements WHERE id=$1) status,
             (SELECT validation_state FROM public.project_measurement_evidence WHERE id=$2) vstate,
             (SELECT string_agg(requirement_kind||':'||satisfaction_state, ',' ORDER BY requirement_kind)
                FROM public.project_measurement_requirements WHERE measurement_id=$1) reqs`,
      [mid, evidenceId]);

    const a = await client.query('SELECT public.project_measurement_preanalysis_open($1,NULL) id',
      [evidenceId]);
    const analysisId = a.rows[0].id;

    const done = await client.query(
      'SELECT public.project_measurement_preanalysis_complete($1,$2::jsonb,$3,$4,$5,$6,$7,$8,$9) j',
      [analysisId, JSON.stringify([
        { requirement_kind: 'EVIDENCE', verdict: 'MET', rationale: 'ensaio', quote: 'trecho', page: 1 },
        { requirement_kind: 'DOCUMENT', verdict: 'NOT_FOUND', rationale: 'ensaio' },
        { requirement_kind: 'TESTS_INSPECTION', verdict: 'NEEDS_HUMAN_REVIEW', rationale: 'ensaio' },
        { requirement_kind: 'CUSTOMER_ACCEPTANCE', verdict: 'NOT_MET', rationale: 'ensaio' },
      ]), 'ensaio', 'anthropic', 'claude-sonnet-5', 100, 50, 1200, 1]);
    const j = done.rows[0].j;
    check(j.state === 'COMPLETED', 'o parecer fecha');
    check(j.verifiable === 2 && j.met === 1,
      'o denominador exclui aceite do cliente e revisão humana',
      `${j.met}/${j.verifiable}`);

    const sum = await client.query('SELECT public.project_measurement_preanalysis($1) j', [mid]);
    check(sum.rows[0].j.analyzed === true, 'o consolidado enxerga o parecer');
    check(sum.rows[0].j.not_found === 1 && sum.rows[0].j.needs_human_review === 1,
      'NOT_FOUND e NEEDS_HUMAN_REVIEW não viram NOT_MET');

    const after = await client.query(`
      SELECT (SELECT status FROM public.project_measurements WHERE id=$1) status,
             (SELECT validation_state FROM public.project_measurement_evidence WHERE id=$2) vstate,
             (SELECT string_agg(requirement_kind||':'||satisfaction_state, ',' ORDER BY requirement_kind)
                FROM public.project_measurement_requirements WHERE measurement_id=$1) reqs`,
      [mid, evidenceId]);
    check(before.rows[0].status === after.rows[0].status, 'a medição NÃO mudou de estado',
      `${before.rows[0].status} → ${after.rows[0].status}`);
    check(before.rows[0].vstate === after.rows[0].vstate,
      'a evidência NÃO se autovalidou', String(after.rows[0].vstate));
    check(before.rows[0].reqs === after.rows[0].reqs,
      'nenhuma exigência foi satisfeita pelo parecer');

    // MET sem lastro tem de ser recusado pela restrição.
    const a2 = await client.query('SELECT public.project_measurement_preanalysis_open($1,NULL) id',
      [evidenceId]);
    let refused = false;
    try {
      await client.query('SAVEPOINT s2');
      await client.query('SELECT public.project_measurement_preanalysis_complete($1,$2::jsonb)',
        [a2.rows[0].id, JSON.stringify([{ requirement_kind: 'EVIDENCE', verdict: 'MET' }])]);
      await client.query('ROLLBACK TO SAVEPOINT s2');
    } catch {
      refused = true;
      await client.query('ROLLBACK TO SAVEPOINT s2');
    }
    check(refused, '"atendido" sem trecho nem justificativa é RECUSADO');
  }

  /*
    O ENSAIO É SEMPRE DESFEITO, inclusive quando se aplica.

    A primeira versão deste script comitava a transação inteira em `--apply` — e
    levava consigo os pareceres de ensaio, que ficaram na base como se o Apex
    tivesse analisado a evidência real de JA10182283. Parecer de ensaio
    indistinguível de parecer real é exatamente o tipo de estado fabricado que
    esta fase existe para não produzir.

    Então: descarta-se tudo, e a aplicação reexecuta SÓ o DDL.
  */
  await client.query('ROLLBACK');
  if (apply && failures === 0) {
    await client.query('BEGIN');
    await client.query(fs.readFileSync(`supabase/migrations/${FILE}`, 'utf8')
      .replace(/^BEGIN;$/m, '-- BEGIN').replace(/^COMMIT;$/m, '-- COMMIT'));
    await client.query('COMMIT');
    console.log('\nAPLICADA (só o DDL — os pareceres do ensaio foram descartados).');
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
