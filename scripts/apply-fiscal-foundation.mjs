/**
 * Aplicador da fundação Fiscal (migrations 112, 113).
 *
 *   node scripts/apply-fiscal-foundation.mjs           # ENSAIO: aplica e faz ROLLBACK
 *   node scripts/apply-fiscal-foundation.mjs --apply   # aplica de verdade (COMMIT)
 *
 * As duas vão na MESMA transação, junto com a gravação no registro canônico de
 * migrations. É o ponto principal deste runner: aplicar e registrar deixam de
 * ser dois eventos que podem divergir. Se qualquer asserção falhar, nem o
 * schema nem o registro mudam.
 *
 *   112  fundação NFS-e   (estabelecimento, extensão fiscal da Party canônica,
 *                          catálogo, documento, itens, tributos, eventos,
 *                          tentativas, fila, integração, portão de produção)
 *   113  permissões       (as sete chaves `fiscal.*` que as rotas já exigem)
 *
 * O ensaio é o padrão de propósito: roda o mesmo SQL contra os dados REAIS
 * desta base, prova o resultado, e desfaz. Nada é aplicado sem `--apply`, e nem
 * com `--apply` se uma prova falhar.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg'; import dotenv from 'dotenv';
import { recordMigrationApplied, assertRegistryMatches } from './lib/migration-registry.mjs';
dotenv.config({ path: '.env', quiet: true }); dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const FILES = [
  ['112', 'fiscal_nfse_foundation', '112_fiscal_nfse_foundation.sql'],
  ['113', 'fiscal_perm_seeds', '113_fiscal_perm_seeds.sql'],
];

const FISCAL_TABLES = `('fiscal_establishments','fiscal_party_profiles','fiscal_service_catalog',
  'fiscal_documents','fiscal_document_items','fiscal_tax_lines','fiscal_events',
  'fiscal_transmission_attempts','fiscal_jobs','fiscal_production_gates')`;

/** Verdade já gravada por OUTROS módulos, comparada antes e depois da DDL. */
const FINGERPRINT = `
  SELECT 'contracts' t, count(*) n, md5(coalesce(string_agg((id,organization_id,title,status,total_value)::text,'' ORDER BY id),'')) f FROM contracts
  UNION ALL SELECT 'parties', count(*), md5(coalesce(string_agg((id,organization_id,legal_name,document_normalized)::text,'' ORDER BY id),'')) FROM parties
  UNION ALL SELECT 'finance_cost_centers', count(*), md5(coalesce(string_agg((id,organization_id,code,name)::text,'' ORDER BY id),'')) FROM finance_cost_centers
  UNION ALL SELECT 'ledger_entry', count(*), md5(coalesce(string_agg((id,amount_cents,status)::text,'' ORDER BY id),'')) FROM ledger_entry
  UNION ALL SELECT 'apar_title', count(*), md5(coalesce(string_agg((id,amount_cents,status)::text,'' ORDER BY id),'')) FROM apar_title
  UNION ALL SELECT 'projects', count(*), md5(coalesce(string_agg((id,organization_id,project)::text,'' ORDER BY id),'')) FROM projects
  UNION ALL SELECT 'permissions', count(*), md5(coalesce(string_agg((key,module,action)::text,'' ORDER BY key),'')) FROM permissions`;

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
c.on('notice', n => console.log(`   NOTICE: ${n.message}`));
await c.connect();
console.log(APPLY ? '### MODO APLICAR (COMMIT) ###' : '### ENSAIO (ROLLBACK ao final) ###');

let ok = true;
const line = (label, value) => console.log(`   ${label.padEnd(44, '.')} ${value}`);

try {
  // ---------- PREFLIGHT ----------
  console.log('\n=== PREFLIGHT (somente leitura) ===');
  const stops = [];

  const [{ version: tip }] = (await c.query(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 1')).rows;
  line('ponta do registro de migrations', tip);
  if (tip !== '111') stops.push(`registro de migrations em ${tip}; a 112 espera 111. Rode scripts/prove-migrations-089-111.mjs --apply.`);

  // 001–111 menos a 090, que está arquivada como NUNCA aplicada.
  const registryProblems = await assertRegistryMatches(c, {
    files: Array.from({ length: 111 }, (_, i) => String(i + 1).padStart(3, '0')).filter(v => v !== '090'),
    expectedAbsent: ['090'],
  });
  line('registro descreve o diretório', registryProblems.length === 0 ? 'sim' : `NÃO (${registryProblems.length})`);
  for (const p of registryProblems) stops.push(`registro: ${p}`);

  // A 090 nunca foi aplicada. Se algum objeto dela aparecer, alguém a rodou por
  // fora e a 112 estaria criando tabelas sobre um estado que ninguém descreveu.
  const legacy = (await c.query(`SELECT count(*) n FROM pg_class
    WHERE relnamespace='public'::regnamespace AND relname IN ('fiscal_parties','tax_obligation')`)).rows[0].n;
  line('rascunho 090 continua não aplicado', legacy === '0' ? 'sim' : `NÃO (${legacy} objeto(s))`);
  if (legacy !== '0') stops.push('objetos do rascunho 090 existem no banco — a fundação 112 não pode ser aplicada por cima.');

  const already = (await c.query(`SELECT count(*) n FROM pg_class
    WHERE relnamespace='public'::regnamespace AND relname IN ${FISCAL_TABLES}`)).rows[0].n;
  line('tabelas da fundação já presentes', `${already}/10`);
  if (already !== '0') stops.push(`${already} tabela(s) da fundação já existem — migration aplicada é registro, não rascunho.`);

  // Alvos compostos que as FKs da 112 exigem.
  const targets = (await c.query(`SELECT count(DISTINCT conrelid::regclass::text) n FROM pg_constraint
     WHERE contype IN ('u','p') AND pg_get_constraintdef(oid) = 'UNIQUE (organization_id, id)'
       AND conrelid::regclass::text IN ('parties','finance_cost_centers','business_unit')`)).rows[0].n;
  line('alvos compostos (org,id) disponíveis', `${targets}/3 + contracts(índice) + projects(criado pela 112)`);
  if (targets !== '3') stops.push('faltam alvos compostos (organization_id, id) em parties/finance_cost_centers/business_unit.');

  const contractsTarget = (await c.query(
    `SELECT count(*) n FROM pg_indexes WHERE schemaname='public' AND indexname='contracts_org_id_phase2'`)).rows[0].n;
  if (contractsTarget !== '1') stops.push('índice contracts_org_id_phase2 ausente — a FK de contrato da 112 não pode ser criada.');

  const projectsDup = (await c.query(
    `SELECT count(*) n FROM (SELECT organization_id, id FROM projects GROUP BY 1,2 HAVING count(*) > 1) d`)).rows[0].n;
  if (projectsDup !== '0') stops.push('projects tem (organization_id, id) duplicado — o índice único da 112 falharia.');

  const orphanOrg = (await c.query(
    `SELECT count(*) n FROM projects p LEFT JOIN organizations o ON o.id = p.organization_id WHERE o.id IS NULL`)).rows[0].n;
  line('projetos órfãos de organização', orphanOrg);
  if (orphanOrg !== '0') stops.push('há projeto sem organização válida.');

  const fiscalPerms = (await c.query(`SELECT count(*) n FROM permissions WHERE module='fiscal'`)).rows[0].n;
  line('permissões fiscal.* pré-existentes', fiscalPerms);

  if (stops.length) {
    console.error('\n!!! PORTÃO DE PARADA — a fundação Fiscal NÃO pode ser aplicada:');
    for (const s of stops) console.error(`    · ${s}`);
    ok = false; throw new Error('preflight');
  }
  console.log('   → nenhuma condição de parada.');

  const fingerprint = async () => Object.fromEntries(
    (await c.query(FINGERPRINT)).rows.map(r => [r.t, `${r.n}:${r.f}`]));
  const before = await fingerprint();

  // ---------- APLICAÇÃO ----------
  await c.query('BEGIN');
  for (const [version, name, file] of FILES) {
    const sql = readFileSync(`supabase/migrations/${file}`, 'utf8')
      .replace(/^\s*BEGIN;\s*$/gm, '').replace(/^\s*COMMIT;\s*$/gm, '');
    process.stdout.write(`\n-> ${file}\n`);
    await c.query(sql);
    // Registrar DENTRO da transação: aplicar e registrar viram o mesmo evento.
    await recordMigrationApplied(c, version, name);
    console.log('   OK (aplicada e registrada)');
  }

  // ---------- ASSERÇÕES ----------
  const must = async (label, sql, expect) => {
    const { rows } = await c.query(sql);
    const got = rows[0] ? Object.values(rows[0])[0] : null;
    const pass = String(got) === String(expect);
    console.log(`   ${pass ? '✓' : '✗'} ${label}: ${got} (esperado ${expect})`);
    if (!pass) ok = false;
  };

  console.log('\n=== ASSERÇÕES ESTRUTURAIS ===');
  await must('as 10 tabelas de inquilino existem com RLS habilitada',
    `SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace
       AND relname IN ${FISCAL_TABLES} AND relrowsecurity`, 10);
  await must('nenhuma política irrestrita nas tabelas fiscais',
    `SELECT count(*) FROM pg_policies WHERE schemaname='public'
       AND tablename LIKE 'fiscal_%' AND (qual='true' OR with_check='true')`, 0);
  await must('toda tabela de inquilino tem leitura escopada por organização',
    `SELECT count(DISTINCT tablename) FROM pg_policies WHERE schemaname='public'
       AND tablename IN ${FISCAL_TABLES} AND cmd='SELECT'
       AND qual LIKE '%current_user_organization_id%'`, 10);
  await must('nenhuma tabela fiscal concede escrita a authenticated/anon',
    `SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema='public'
       AND table_name LIKE 'fiscal_%' AND grantee IN ('authenticated','anon')
       AND privilege_type IN ('INSERT','UPDATE','DELETE')`, 0);
  await must('a tabela de credenciais não concede NADA a authenticated/anon',
    `SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema='public'
       AND table_name='fiscal_provider_configs' AND grantee IN ('authenticated','anon')`, 0);
  await must('toda referência de inquilino é composta (organization_id, ...)',
    `SELECT count(*) FROM pg_constraint WHERE contype='f'
       AND conrelid::regclass::text LIKE 'fiscal_%'
       AND confrelid::regclass::text IN ('contracts','projects','parties','business_unit',
         'finance_cost_centers','fiscal_establishments','fiscal_documents','fiscal_service_catalog',
         'fiscal_party_profiles')
       AND pg_get_constraintdef(oid) NOT LIKE '%(organization_id, %'`, 0);
  await must('o tomador aponta para a Party CANÔNICA',
    `SELECT count(*) FROM pg_constraint WHERE contype='f'
       AND conrelid='public.fiscal_documents'::regclass AND confrelid='public.parties'::regclass
       AND pg_get_constraintdef(oid) LIKE '%(organization_id, party_id)%'`, 1);
  await must('o centro de custo aponta para finance_cost_centers (canônico)',
    `SELECT count(*) FROM pg_constraint WHERE contype='f'
       AND conrelid='public.fiscal_documents'::regclass
       AND confrelid='public.finance_cost_centers'::regclass`, 1);
  await must('nenhuma FK fiscal aponta para o cost_center legado',
    `SELECT count(*) FROM pg_constraint WHERE contype='f'
       AND conrelid::regclass::text LIKE 'fiscal_%' AND confrelid='public.cost_center'::regclass`, 0);
  await must('o Fiscal não cria vínculo estrutural com o razão nem com o AR',
    `SELECT count(*) FROM pg_constraint WHERE contype='f'
       AND conrelid::regclass::text LIKE 'fiscal_%'
       AND confrelid::regclass::text IN ('ledger_entry','apar_title')`, 0);
  await must('o portão de produção existe e guarda o estabelecimento',
    `SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
       AND tgfoid='public.fiscal_guard_production()'::regprocedure`, 2);
  await must('a NFS-e emitida é imutável',
    `SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
       AND tgfoid='public.fiscal_documents_protect_issued()'::regprocedure`, 1);
  await must('o histórico fiscal é somente-acréscimo',
    `SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
       AND tgfoid='public.fiscal_reject_history_mutation()'::regprocedure`, 2);
  await must('a reserva de numeração de DPS não é exposta ao navegador',
    `SELECT has_function_privilege('authenticated','public.fiscal_reserve_dps_number(uuid,uuid)','EXECUTE')::int`, 0);
  await must('o bucket de artefatos é privado',
    `SELECT (NOT public)::int FROM storage.buckets WHERE id='fiscal-documents'`, 1);
  await must('nenhuma política de storage expõe o bucket ao navegador',
    `SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
       AND (qual LIKE '%fiscal-documents%' OR with_check LIKE '%fiscal-documents%')`, 0);
  await must('as 7 permissões fiscais existem', `SELECT count(*) FROM permissions WHERE module='fiscal'`, 7);
  await must('owner_admin recebeu as 7',
    `SELECT count(*) FROM role_permissions rp
       JOIN roles r ON r.id=rp.role_id AND r.key='owner_admin' AND r.organization_id IS NULL
       JOIN permissions p ON p.id=rp.permission_id WHERE p.module='fiscal'`, 7);
  for (const t of ['fiscal_establishments', 'fiscal_documents', 'fiscal_service_catalog', 'fiscal_party_profiles']) {
    await must(`${t} nasce VAZIA (nenhum dado fiscal inventado)`, `SELECT count(*) FROM ${t}`, 0);
  }
  await must('nenhum estabelecimento nasce com produção habilitada',
    `SELECT count(*) FROM fiscal_establishments WHERE production_enabled`, 0);

  console.log('\n=== PROVAS FUNCIONAIS ===');
  await c.query(readFileSync('scripts/assert-fiscal-foundation.sql', 'utf8'));
  console.log('   ✓ todas as asserções de scripts/assert-fiscal-foundation.sql passaram');

  console.log('\n=== REGISTRO DE MIGRATIONS ===');
  await must('a 112 foi registrada como aplicada',
    `SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='112'`, 1);
  await must('a 113 foi registrada como aplicada',
    `SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='113'`, 1);
  await must('a 090 continua FORA do registro',
    `SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='090'`, 0);

  console.log('\n=== DADOS DE OUTROS MÓDULOS ===');
  const after = await fingerprint();
  for (const [t, hash] of Object.entries(before)) {
    // `permissions` muda de propósito: a 113 semeia sete linhas. O resto não.
    const expected = t === 'permissions' ? after[t] !== hash : after[t] === hash;
    const label = t === 'permissions'
      ? (after[t] !== hash ? 'permissões fiscais semeadas' : 'NADA SEMEADO')
      : (after[t] === hash ? 'intacto' : `ALTERADO (${hash} -> ${after[t]})`);
    console.log(`   ${expected ? '✓' : '✗'} ${t}: ${label}`);
    if (!expected) ok = false;
  }
} catch (e) {
  ok = false;
  if (e.message !== 'preflight') console.error(`\n!!! FALHA: ${e.message}`);
} finally {
  try {
    if (APPLY && ok) { await c.query('COMMIT'); console.log('\n>>> COMMIT aplicado.'); }
    else { await c.query('ROLLBACK'); console.log(APPLY ? '\n>>> ROLLBACK (houve falha) — nada aplicado.' : '\n>>> ROLLBACK (ensaio) — nada aplicado.'); }
  } catch { /* sem transação aberta */ }
  await c.end();
}

process.exit(ok ? 0 : 1);
