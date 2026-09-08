/**
 * Fase 7.5 — aplicação das migrations 145–147 (fundação empresarial
 * multi-organização).
 *
 *   node scripts/apply-contracts-v2-phase75.mjs           # ENSAIO (ROLLBACK)
 *   node scripts/apply-contracts-v2-phase75.mjs --apply   # COMETE
 *
 * O ensaio percorre o MESMO caminho do modo aplicar — inclusive a bateria
 * inteira contra organizações descartáveis criadas pelo fluxo REAL de
 * provisionamento. Um ensaio que só rodasse o DDL provaria que a sintaxe está
 * certa e nada sobre a fronteira de inquilino, que é o objeto da fase.
 *
 * Quem aplica, registra: `recordMigrationApplied` roda DENTRO da transação.
 */
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';
import { recordMigrationApplied, assertRegistryMatches } from './lib/migration-registry.mjs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const MIGRATIONS = [
  ['146', 'enterprise_tenant_blind_hardening'],
  ['147', 'enterprise_provisioning_and_lifecycle'],
];

/**
 * A 145 já está aplicada e REGISTRADA. Ela foi ao banco sozinha porque o
 * `COMMIT` de dentro do arquivo encerrou a transação externa do runner — e é
 * exatamente por isso que os arquivos passam por aqui SEM os seus marcadores
 * de transação: quem controla a transação é o runner, para que ensaio queira
 * dizer ensaio.
 */
const stripTx = (sql) => sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gmi, '');

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query('SET SESSION default_transaction_read_only = off');

let ok = true;
const must = (label, pass, detail = '') => {
  console.log(`   ${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) ok = false;
};
const one = async (sql, params) => (await c.query(sql, params)).rows[0];

/** Executa uma instrução COMO a pessoa, no papel `authenticated`. */
const asRole = (uid, sql) =>
  `SET LOCAL ROLE authenticated;`
  + ` SELECT set_config('request.jwt.claims', json_build_object('sub','${uid}','role','authenticated')::text, true);`
  + ` ${sql}; RESET ROLE;`;
const callAs = async (uid, sql) => {
  const res = await c.query(asRole(uid, sql));
  const list = Array.isArray(res) ? res : [res];
  return list[list.length - 2].rows;
};
/**
 * Devolve a mensagem quando a chamada FALHA, e null quando ela passa.
 *
 * O SAVEPOINT não é zelo: a bateria inteira roda DENTRO da transação do
 * runner, e um erro esperado abortaria tudo o que vem depois. Sem ele, a
 * primeira recusa correta faria as recusas seguintes "passarem" pelo motivo
 * errado — que é pior do que não testar.
 */
const refusedAs = async (uid, sql) => {
  await c.query('SAVEPOINT probe');
  try { await c.query(asRole(uid, sql)); await c.query('RELEASE SAVEPOINT probe'); return null; }
  catch (e) { await c.query('ROLLBACK TO SAVEPOINT probe'); return e.message; }
};

const sfx = Math.random().toString(36).slice(2, 8);

try {
  // ---------------- PORTÃO PRÉ-APLICAÇÃO ----------------
  console.log('=== PORTÃO PRÉ-APLICAÇÃO ===');
  const tip = (await one(
    `SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1`)).version;
  must('ponta do registro é 145 (a 145 já está aplicada)', tip === '145', tip);
  if (tip !== '145') throw new Error(`esperava 145, encontrei ${tip}`);

  const files = readdirSync('supabase/migrations')
    .filter((f) => /^\d{3}_.*\.sql$/.test(f)).map((f) => f.slice(0, 3)).sort();
  const problems = await assertRegistryMatches(c, {
    files: files.filter((v) => !MIGRATIONS.some(([m]) => m === v)),
    expectedAbsent: ['090'],
  });
  must('registro consistente com o diretório (090 arquivada)', problems.length === 0, problems.join('; '));
  if (!ok) throw new Error('portão pré-aplicação reprovado');

  const beforeOrgs = Number((await one(`SELECT count(*)::int n FROM organizations`)).n);
  const beforeProfiles = Number((await one(`SELECT count(*)::int n FROM profiles WHERE organization_id IS NOT NULL`)).n);
  console.log(`   · ${beforeOrgs} organização(ões), ${beforeProfiles} perfil(is) com organização`);

  // ---------------- APLICAÇÃO ----------------
  await c.query('BEGIN');
  console.log(`\n=== ${APPLY ? 'APLICANDO' : 'ENSAIO'} 146–147 ===`);
  for (const [version, name] of MIGRATIONS) {
    const sql = stripTx(readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8'));
    await c.query(sql);
    await recordMigrationApplied(c, version, name);
    console.log(`   ✓ ${version}_${name}`);
  }

  // ---------------- RETROALIMENTAÇÃO ----------------
  console.log('\n=== RETROALIMENTAÇÃO ===');
  const eaN = Number((await one(`SELECT count(*)::int n FROM enterprise_accounts`)).n);
  must('uma conta empresarial por organização existente', eaN === beforeOrgs, `${eaN}`);
  must('toda organização ancorada',
    Number((await one(`SELECT count(*)::int n FROM organizations WHERE enterprise_account_id IS NULL`)).n) === 0);
  const memN = Number((await one(`SELECT count(*)::int n FROM organization_memberships`)).n);
  must('um vínculo por perfil com organização', memN === beforeProfiles, `${memN} vs ${beforeProfiles}`);
  must('nenhum vínculo sem perfil correspondente',
    Number((await one(`SELECT count(*)::int n FROM organization_memberships om
       WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.user_id=om.user_id AND p.organization_id=om.organization_id)`)).n) === 0);
  const admN = Number((await one(`SELECT count(*)::int n FROM enterprise_account_memberships`)).n);
  const permN = Number((await one(
    `SELECT count(DISTINCT ur.user_id)::int n FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id=ur.role_id
       JOIN permissions p ON p.id=rp.permission_id WHERE p.key='admin.manage_organization'`)).n);
  must('titularidade empresarial = quem já tinha admin.manage_organization', admN === permN, `${admN} vs ${permN}`);
  must('nenhuma tabela financeira antiga sem organização',
    Number((await one(`SELECT count(*)::int n FROM information_schema.columns
        WHERE table_schema='public' AND column_name='organization_id' AND is_nullable='YES'
          AND table_name IN ('allocation_result','allocation_rule','attachment','category_mapping',
                             'ingestion_batch','payroll_batch','user_finance_role')`)).n) === 0);

  // ---------------- CONTINUIDADE ----------------
  console.log('\n=== CONTINUIDADE (a organização de hoje não muda) ===');
  const sergio = (await one(
    `SELECT p.user_id, p.organization_id FROM profiles p
      JOIN user_roles ur ON ur.user_id=p.user_id
      JOIN roles r ON r.id=ur.role_id AND r.key='owner_admin'
      ORDER BY p.created_at LIMIT 1`));
  const resolved = (await callAs(sergio.user_id, `SELECT current_user_organization_id() AS org`))[0].org;
  must('administrador resolve a MESMA organização de antes', resolved === sergio.organization_id,
    `${resolved}`);
  const seesContracts = Number((await callAs(sergio.user_id, `SELECT count(*)::int n FROM contracts`))[0].n);
  must('administrador continua vendo os contratos da organização dele', seesContracts > 0, `${seesContracts}`);

  /* ------------------------------------------------------------------
     BATERIA DESCARTÁVEL — sempre desfeita, inclusive no modo aplicar.

     `audit_logs` é append-only por gatilho, e a chave estrangeira da
     organização é ON DELETE CASCADE. Consequência: uma organização que já
     registrou QUALQUER auditoria — e provisionar registra — não pode mais ser
     apagada sem reescrever história imutável, que é justamente o que não se
     faz. Então a bateria não tenta limpar depois: ela roda dentro de um
     SAVEPOINT que volta atrás sempre. Resíduo zero por construção, e não por
     faxina.
     ------------------------------------------------------------------ */
  await c.query('SAVEPOINT battery');

  // ---------------- PROVISIONAMENTO DESCARTÁVEL ----------------
  console.log('\n=== ORGANIZAÇÃO DESCARTÁVEL PELO FLUXO REAL ===');
  const prov = (await callAs(sergio.user_id,
    `SELECT organization_provision('[P75] Descartavel ${sfx}','[P75] Razao Social','BR','BRL',
        'America/Sao_Paulo',NULL,'p75-idem-${sfx}') AS r`))[0].r;
  const dispo = prov.organization_id;
  must('provisionamento devolveu organização', !!dispo, dispo);
  must('não é replay na primeira chamada', prov.idempotent_replay === false);

  const replay = (await callAs(sergio.user_id,
    `SELECT organization_provision('[P75] Descartavel ${sfx}','[P75] Razao Social','BR','BRL',
        'America/Sao_Paulo',NULL,'p75-idem-${sfx}') AS r`))[0].r;
  must('mesma chave de idempotência → mesma organização',
    replay.organization_id === dispo && replay.idempotent_replay === true);

  const readiness = (await callAs(sergio.user_id, `SELECT organization_readiness('${dispo}') AS r`))[0].r;
  must('organização nova nasce com ZERO fato operacional',
    Number(readiness.operational_facts_total) === 0, JSON.stringify(readiness.operational_facts));
  must('perfil da empresa nasce INCOMPLETO ou pronto conforme o informado',
    ['READY', 'INCOMPLETE'].includes(readiness.configuration.company_profile),
    readiness.configuration.company_profile);
  must('fiscal nasce NÃO CONFIGURADO', readiness.configuration.fiscal === 'NOT_CONFIGURED');
  must('aprovação nasce NÃO CONFIGURADA', readiness.configuration.approval_policies === 'NOT_CONFIGURED');
  must('alçada de faturamento nasce NÃO CONFIGURADA',
    readiness.configuration.billing_release_authority === 'NOT_CONFIGURED');
  must('exatamente um membro (quem criou)', Number(readiness.configuration.members) === 1);

  // ---------------- TROCA DE CONTEXTO ----------------
  console.log('\n=== TROCA DE ORGANIZAÇÃO ===');
  await callAs(sergio.user_id, `SELECT organization_switch('${dispo}')`);
  const afterSwitch = (await callAs(sergio.user_id, `SELECT current_user_organization_id() AS org`))[0].org;
  must('contexto ativo passou para a organização nova', afterSwitch === dispo);
  const contractsAfter = Number((await callAs(sergio.user_id, `SELECT count(*)::int n FROM contracts`))[0].n);
  must('nenhum contrato da organização anterior atravessa a troca', contractsAfter === 0, `${contractsAfter}`);

  await callAs(sergio.user_id, `SELECT organization_switch('${sergio.organization_id}')`);
  must('volta ao contexto original',
    (await callAs(sergio.user_id, `SELECT current_user_organization_id() AS org`))[0].org === sergio.organization_id);

  // ---------------- FRONTEIRA ----------------
  console.log('\n=== FRONTEIRA DE INQUILINO ===');
  const strangerOrg = (await one(
    `INSERT INTO enterprise_accounts (name,slug) VALUES ('[P75] Estranha ${sfx}','p75-ea-${sfx}') RETURNING id`)).id;
  const strangerOrgId = (await one(
    `INSERT INTO organizations (name,slug,enterprise_account_id)
     VALUES ('[P75] Estranha ${sfx}','p75-org-${sfx}',$1) RETURNING id`, [strangerOrg])).id;
  const stranger = (await one(
    `INSERT INTO auth.users (id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
     VALUES (gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
             $1,'x',now(),now()) RETURNING id`, [`p75.stranger.${sfx}@example.test`])).id;
  await c.query(`INSERT INTO profiles (user_id,organization_id,full_name,status)
                 VALUES ($1,$2,'[P75] Estranho','active')`, [stranger, strangerOrgId]);

  must('estranho não lê contrato da organização de produção',
    Number((await callAs(stranger, `SELECT count(*)::int n FROM contracts`))[0].n) === 0);
  must('estranho não vê a organização de produção',
    Number((await callAs(stranger, `SELECT count(*)::int n FROM organizations WHERE id='${sergio.organization_id}'`))[0].n) === 0);
  must('estranho não troca para organização de que não é membro',
    (await refusedAs(stranger, `SELECT organization_switch('${sergio.organization_id}')`))?.includes('ORGANIZATION_NOT_FOUND'));
  must('estranho não lê a prontidão de organização alheia',
    (await refusedAs(stranger, `SELECT organization_readiness('${sergio.organization_id}')`))?.includes('ORGANIZATION_NOT_FOUND'));
  must('estranho não provisiona (sem autoridade empresarial)',
    (await refusedAs(stranger, `SELECT organization_provision('[P75] Pirata ${sfx}')`))?.includes('ENTERPRISE_PROVISIONING_NOT_ALLOWED'));
  must('estranho não escreve vínculo diretamente',
    !!(await refusedAs(stranger,
      `INSERT INTO organization_memberships (organization_id,user_id,status)
       VALUES ('${sergio.organization_id}','${stranger}','ACTIVE')`)));
  must('estranho não escreve contexto ativo diretamente',
    !!(await refusedAs(stranger,
      `INSERT INTO user_active_organization (user_id,organization_id)
       VALUES ('${stranger}','${sergio.organization_id}')`)));
  must('estranho não altera a organização de produção',
    Number((await callAs(stranger,
      `WITH u AS (UPDATE organizations SET name='INVADIDA' WHERE id='${sergio.organization_id}' RETURNING 1)
       SELECT count(*)::int n FROM u`))[0].n) === 0);

  // ---------------- REVOGAÇÃO ----------------
  console.log('\n=== REVOGAÇÃO DERRUBA O ACESSO ===');
  await c.query(`UPDATE organization_memberships SET status='REVOKED', disabled_at=now()
                  WHERE user_id=$1 AND organization_id=$2`, [stranger, strangerOrgId]);
  must('vínculo revogado deixa a pessoa sem contexto',
    (await callAs(stranger, `SELECT current_user_organization_id() AS org`))[0].org === null);

  // ---------------- SUSPENSÃO DA ORGANIZAÇÃO ----------------
  await c.query(`UPDATE organization_memberships SET status='ACTIVE', disabled_at=NULL
                  WHERE user_id=$1 AND organization_id=$2`, [stranger, strangerOrgId]);
  await c.query(`UPDATE organizations SET status='suspended', suspended_at=now() WHERE id=$1`, [strangerOrgId]);
  must('organização suspensa deixa de render contexto',
    (await callAs(stranger, `SELECT current_user_organization_id() AS org`))[0].org === null);

  // ---------------- AUDITORIA SECURITY DEFINER ----------------
  /* Fora da bateria: audita o SCHEMA aplicado, não os dados descartáveis. */
  console.log('\n=== AUDITORIA SECURITY DEFINER ===');
  const noPath = (await c.query(
    `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prosecdef
        AND has_function_privilege('authenticated',p.oid,'EXECUTE')
        AND (p.proconfig IS NULL OR NOT EXISTS (
              SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search_path=%'))`)).rows;
  must('nenhuma função DEFINER do navegador sem search_path fixo', noPath.length === 0,
    noPath.map((r) => r.proname).join(', '));
  const anonNew = (await c.query(
    `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND has_function_privilege('anon',p.oid,'EXECUTE')
        AND p.proname IN ('organization_switch','organization_provision','my_organizations',
                          'organization_membership_set_status','organization_set_lifecycle_status',
                          'organization_readiness')`)).rows;
  must('nenhuma RPC da fase alcançável por anon', anonNew.length === 0,
    anonNew.map((r) => r.proname).join(', '));

  const orgPolicies = (await c.query(
    `SELECT policyname, cmd FROM pg_policies WHERE schemaname='public' AND tablename='organizations'`)).rows;
  must('organizations sem política irrestrita FOR ALL',
    !orgPolicies.some((p) => p.cmd === 'ALL'), JSON.stringify(orgPolicies));

  // ---------------- RESÍDUO ----------------
  console.log('\n=== RESÍDUO ===');
  await c.query('ROLLBACK TO SAVEPOINT battery');
  must('resíduo zero: nenhuma organização descartável sobrevive',
    Number((await one(`SELECT count(*)::int n FROM organizations WHERE name LIKE '[P75]%'`)).n) === 0);
  must('resíduo zero: nenhuma conta empresarial descartável',
    Number((await one(`SELECT count(*)::int n FROM enterprise_accounts WHERE name LIKE '[P75]%'`)).n) === 0);
  must('resíduo zero: nenhum vínculo descartável',
    Number((await one(`SELECT count(*)::int n FROM organization_memberships om
       JOIN organizations o ON o.id=om.organization_id WHERE o.name LIKE '[P75]%'`)).n) === 0);
  must('produção intacta: mesma contagem de organizações',
    Number((await one(`SELECT count(*)::int n FROM organizations`)).n) === beforeOrgs);
  must('produção intacta: mesma contagem de vínculos',
    Number((await one(`SELECT count(*)::int n FROM organization_memberships`)).n) === beforeProfiles);

  if (!ok) throw new Error('bateria reprovada');

  if (APPLY) { await c.query('COMMIT'); console.log('\n=== COMETIDO ==='); }
  else { await c.query('ROLLBACK'); console.log('\n=== ENSAIO: DESFEITO (ROLLBACK) ==='); }
} catch (e) {
  await c.query('ROLLBACK').catch(() => {});
  console.error('\n✗ FALHOU:', e.message);
  ok = false;
} finally {
  await c.end();
}
process.exit(ok ? 0 : 1);
