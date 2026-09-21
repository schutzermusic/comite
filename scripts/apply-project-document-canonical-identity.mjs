/**
 * Aplica a migration 189 — O DOCUMENTO CANÔNICO DO PROJETO.
 *
 * ADITIVA. Acrescenta quatro colunas nuláveis a `project_files`, um CHECK que
 * só restringe valores que hoje não existem (a coluna nasce vazia), dois
 * índices parciais e uma visão nova. Nenhuma tabela perde coluna, nenhum dado
 * é reescrito, nenhum arquivo é copiado.
 *
 * O ponto que merece atenção é o DROP/CREATE da política
 * `project_files_insert`: ela é recriada com TODOS os predicados da 150 mais
 * a exigência de que contrato, marco e medição apontados pertençam ao mesmo
 * inquilino. O ensaio abaixo confere que a política voltou e que os
 * predicados antigos continuam lá — uma política recriada pela metade é
 * afrouxamento silencioso, e é o único risco real desta migration.
 *
 * Uso:  node scripts/apply-project-document-canonical-identity.mjs [--apply]
 *       Sem --apply, ensaia dentro de uma transação e desfaz.
 */
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'node:fs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('SUPABASE_DB_URL ausente.'); process.exit(2); }

const FILE = '189_project_document_canonical_identity.sql';

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  await client.query('BEGIN');

  // Antes: quantos arquivos existem. Depois tem de ser o MESMO número —
  // esta migration não cria, não copia e não apaga documento nenhum.
  const before = await client.query(
    'SELECT count(*)::int AS n FROM public.project_files');

  const sql = fs.readFileSync(`supabase/migrations/${FILE}`, 'utf8')
    .replace(/^BEGIN;$/m, '-- BEGIN (controlado pelo script)')
    .replace(/^COMMIT;$/m, '-- COMMIT (controlado pelo script)');
  await client.query(sql);
  console.log('✓', FILE);

  // ── Conferências antes de confirmar ─────────────────────────────────────
  const after = await client.query(
    'SELECT count(*)::int AS n FROM public.project_files');
  if (after.rows[0].n !== before.rows[0].n) {
    throw new Error(
      `project_files mudou de ${before.rows[0].n} para ${after.rows[0].n} linhas — `
      + 'a 189 não pode criar nem apagar documento.',
    );
  }
  console.log('  project_files:', after.rows[0].n, 'linha(s) (inalterado)');

  const cols = await client.query(`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'project_files'
       AND column_name IN ('contract_id','contract_milestone_id','measurement_id','evidence_category')
     ORDER BY column_name`);
  console.log('  colunas novas:', cols.rows.map((c) => c.column_name).join(' '));
  if (cols.rows.length !== 4) throw new Error('colunas de vínculo faltando.');

  // A política precisa ter voltado INTEIRA. Os predicados da 150 são
  // conferidos um a um: recriá-la sem um deles seria afrouxar a escrita.
  const policy = await client.query(`
    SELECT with_check FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'project_files'
       AND policyname = 'project_files_insert'`);
  if (policy.rows.length !== 1) throw new Error('project_files_insert não foi recriada.');
  for (const predicate of [
    'current_user_organization_id', 'projects.upload', 'auth.uid()',
    'project-documents', 'contract_milestones', 'project_measurements',
  ]) {
    if (!policy.rows[0].with_check.includes(predicate)) {
      throw new Error(`project_files_insert perdeu o predicado: ${predicate}`);
    }
  }
  console.log('  project_files_insert: predicados da 150 + vínculos do mesmo inquilino ✓');

  const view = await client.query(`
    SELECT origin, count(*)::int AS n
      FROM public.project_document_read_model
     GROUP BY origin ORDER BY origin`);
  console.log('  project_document_read_model:');
  for (const r of view.rows) console.log(`    ${r.origin}: ${r.n}`);

  // Documento contratual é REFERÊNCIA: nenhuma linha CONTRACT pode sair
  // desta visão com caminho de objeto. Um caminho aqui seria o segundo
  // caminho até o mesmo byte — e é assim que uma cópia se justifica depois.
  const leaked = await client.query(`
    SELECT count(*)::int AS n FROM public.project_document_read_model
     WHERE origin = 'CONTRACT' AND (object_path IS NOT NULL OR bucket_id IS NOT NULL)`);
  if (leaked.rows[0].n > 0) {
    throw new Error('documento contratual saiu com caminho de objeto — é referência, não cópia.');
  }
  console.log('  documento contratual sem caminho de objeto ✓');

  const grants = await client.query(`
    SELECT grantee, privilege_type
      FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'project_document_read_model'
     ORDER BY grantee, privilege_type`);
  console.log('  grants:', grants.rows.map((g) => `${g.grantee}:${g.privilege_type}`).join(' '));

  // Esta migration não toca em medição, aceite nem faturamento.
  for (const table of ['project_measurements', 'project_measurement_evidence', 'contract_billing_events']) {
    const n = await client.query(`SELECT count(*)::int AS n FROM public.${table}`);
    console.log(`  ${table}:`, n.rows[0].n, '(inalterado pela 189)');
  }

  if (apply) {
    await client.query('COMMIT');
    console.log('\nAPLICADA.');
  } else {
    await client.query('ROLLBACK');
    console.log('\nENSAIO — desfeito. Rode com --apply para gravar.');
  }
} catch (e) {
  await client.query('ROLLBACK');
  console.error('\nFALHOU:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
