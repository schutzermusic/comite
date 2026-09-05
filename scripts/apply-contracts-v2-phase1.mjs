/**
 * Aplicador das migrations da Fase 1 do Contracts V2 (102, 103, 104, 105, 106).
 *
 *   node scripts/apply-contracts-v2-phase1.mjs           # ENSAIO: aplica e faz ROLLBACK
 *   node scripts/apply-contracts-v2-phase1.mjs --apply   # aplica de verdade (COMMIT)
 *
 * As cinco vão numa transação só, pelo mesmo motivo da Fase 0: aplicar metade
 * deixa o banco num estado que nenhum teste descreve. A ordem importa e é fixa:
 *
 *   102  parties + party_roles              (identidade; não depende de nada)
 *   103  permissões parties.*               (depende de 102 só por coerência)
 *   104  tenant em client e business_unit   (antes da 105: a canônica vai
 *                                            referenciar business_unit, e não se
 *                                            importa tabela sem inquilino para
 *                                            dentro do modelo canônico)
 *   105  finance_cost_centers canônica      (depende de 104)
 *   106  contracts.counterparty_party_id    (depende de 102)
 *
 * O ensaio é o modo padrão de propósito: executa o mesmo SQL, roda as mesmas
 * provas contra os dados REAIS desta base, e desfaz tudo no fim. "Passou no
 * ensaio" significa que vale aqui, não numa cópia parecida.
 *
 * Se qualquer prova falhar, o COMMIT não acontece nem com `--apply`.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg'; import dotenv from 'dotenv';
dotenv.config({ path: '.env' }); dotenv.config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const FILES = [
  '102_platform_parties.sql',
  '103_parties_perm_seeds.sql',
  '104_tenant_isolation_client_business_unit.sql',
  '105_canonical_cost_center.sql',
  '106_contracts_counterparty_party.sql',
];

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
c.on('notice', n => console.log(`   NOTICE: ${n.message}`));
await c.connect();
console.log(APPLY ? '### MODO APLICAR (COMMIT) ###' : '### ENSAIO (ROLLBACK ao final) ###');

let ok = true;

/** Preflight — as premissas da Fase 1, verificadas ANTES de qualquer DDL. */
async function preflight() {
  console.log('\n=== PREFLIGHT (antes de qualquer alteração) ===');
  const one = async (sql) => (await c.query(sql)).rows[0];

  const orgs = Number((await one('SELECT count(*) n FROM organizations')).n);
  const cc = Number((await one('SELECT count(*) n FROM cost_center')).n);
  const le = Number((await one('SELECT count(*) n FROM ledger_entry')).n);
  const ar = Number((await one('SELECT count(*) n FROM allocation_rule')).n);
  const fcc = Number((await one('SELECT count(*) n FROM finance_cost_centers')).n);
  const ct = await one(`SELECT count(*) total, count(counterparty_name) texto,
                               count(client_id) cli, count(supplier_id) sup FROM contracts`);
  const parties = Number((await one(`SELECT count(*) n FROM information_schema.tables
                                      WHERE table_schema='public' AND table_name IN ('parties','party_roles')`)).n);

  console.log(`   organizações ............ ${orgs}`);
  console.log(`   cost_center (legado) .... ${cc}     [esperado 0]`);
  console.log(`   ledger_entry ............ ${le}     [esperado 0 — PORTÃO]`);
  console.log(`   allocation_rule ......... ${ar}     [esperado 0 — PORTÃO]`);
  console.log(`   finance_cost_centers .... ${fcc}    [esperado 8]`);
  console.log(`   contracts ............... ${ct.total} (texto=${ct.texto}, client_id=${ct.cli}, supplier_id=${ct.sup})`);
  console.log(`   parties/party_roles ..... ${parties} [esperado 0 = fase ainda não aplicada]`);

  const stop = [];
  if (cc > 0) stop.push(`cost_center tem ${cc} linha(s): o repontamento estrutural não foi provado com dado real`);
  if (le > 0) stop.push(`ledger_entry tem ${le} linha(s): remapeamento exigiria mapa code->code revisado por gente`);
  if (ar > 0) stop.push(`allocation_rule tem ${ar} linha(s): idem`);
  if (Number(ct.cli) > 0 || Number(ct.sup) > 0) stop.push(`contracts.client_id/supplier_id não estão vazios: a premissa de colunas mortas é falsa`);
  if (orgs === 0) stop.push('nenhuma organização: não há inquilino a quem atribuir nada');

  if (stop.length) {
    console.error('\n!!! PORTÃO DE PARADA — a Fase 1 NÃO pode prosseguir:');
    for (const s of stop) console.error(`    · ${s}`);
    console.error('    Nada foi gravado. Replaneje antes de tentar de novo.');
    return false;
  }
  console.log('   → nenhuma condição de parada. Premissas da Fase 1 confirmadas.');
  return true;
}

/** Provas funcionais: executa como usuário autenticado, com RLS valendo. */
async function asUser(userId, fn) {
  await c.query('SAVEPOINT as_user');
  await c.query('SET LOCAL ROLE authenticated');
  await c.query(`SELECT set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: userId, role: 'authenticated' })]);
  try { return await fn(); }
  finally { await c.query('RESET ROLE'); await c.query('RELEASE SAVEPOINT as_user').catch(() => undefined); }
}

try {
  if (!(await preflight())) { ok = false; throw new Error('preflight'); }

  await c.query('BEGIN');
  for (const f of FILES) {
    const sql = readFileSync(`supabase/migrations/${f}`, 'utf8')
      .replace(/^\s*BEGIN;\s*$/gm, '').replace(/^\s*COMMIT;\s*$/gm, '');
    process.stdout.write(`\n-> ${f}\n`);
    await c.query(sql);
    console.log('   OK');
  }

  // ---- verificações estruturais, dentro da mesma transação ----
  const v = async (label, sql) => {
    const { rows } = await c.query(sql);
    console.log(`\n[check] ${label}`);
    console.log(rows.length ? rows.map(r => '   ' + JSON.stringify(r)).join('\n') : '   (vazio)');
  };
  const must = async (label, sql, expect) => {
    const { rows } = await c.query(sql);
    const got = rows[0] ? Object.values(rows[0])[0] : null;
    const pass = String(got) === String(expect);
    console.log(`   ${pass ? '✓' : '✗'} ${label}: ${got} (esperado ${expect})`);
    if (!pass) ok = false;
  };

  console.log('\n=== ASSERÇÕES ESTRUTURAIS ===');
  await must('nenhuma política irrestrita na fronteira da Fase 1',
    `SELECT count(*) FROM pg_policies WHERE schemaname='public'
       AND tablename IN ('parties','party_roles','client','business_unit','finance_cost_centers','cost_center','supplier')
       AND (qual='true' OR with_check='true')`, 0);
  await must('RLS habilitada em parties e party_roles',
    `SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace
       AND relname IN ('parties','party_roles') AND relrowsecurity`, 2);
  await must('parties nasce VAZIA (nenhuma identidade inventada)', 'SELECT count(*) FROM parties', 0);
  await must('party_roles nasce VAZIA', 'SELECT count(*) FROM party_roles', 0);
  await must('NENHUM contrato foi auto-vinculado',
    'SELECT count(*) FROM contracts WHERE counterparty_party_id IS NOT NULL', 0);
  await must('os 6 contratos mantêm a contraparte em texto',
    'SELECT count(*) FROM contracts WHERE counterparty_name IS NOT NULL', 6);
  await must('ledger_entry e allocation_rule apontam para finance_cost_centers',
    `SELECT count(*) FROM pg_constraint WHERE confrelid='public.finance_cost_centers'::regclass
       AND conrelid IN ('public.ledger_entry'::regclass,'public.allocation_rule'::regclass)`, 2);
  await must('cost_center guarda apenas a própria autorreferência',
    `SELECT count(*) FROM pg_constraint WHERE confrelid='public.cost_center'::regclass`, 1);
  await must('finance_cost_centers absorveu parent_id/business_unit_id/type',
    `SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
       AND table_name='finance_cost_centers' AND column_name IN ('parent_id','business_unit_id','type')`, 3);
  await must('client e business_unit ganharam inquilino',
    `SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
       AND table_name IN ('client','business_unit') AND column_name='organization_id'`, 2);
  await must('permissões parties.* registradas',
    `SELECT count(*) FROM permissions WHERE key LIKE 'parties.%'`, 4);

  await v('políticas de parties/party_roles',
    `SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname='public'
       AND tablename IN ('parties','party_roles') ORDER BY 1,3,2`);

  // ---- provas funcionais dos invariantes ----
  console.log('\n=== PROVAS FUNCIONAIS (RLS e chaves, com dado descartável) ===');
  const orgA = (await c.query('SELECT id FROM organizations LIMIT 1')).rows[0].id;
  const userA = (await c.query('SELECT user_id FROM profiles WHERE organization_id=$1 LIMIT 1', [orgA])).rows[0]?.user_id;

  const expectFail = async (label, fn) => {
    await c.query('SAVEPOINT sp');
    try { await fn(); console.log(`   ✗ ${label}: PASSOU (deveria falhar)`); ok = false; }
    catch (e) { console.log(`   ✓ ${label}: recusado — ${e.message.split('\n')[0].slice(0, 110)}`); }
    await c.query('ROLLBACK TO SAVEPOINT sp');
  };
  const expectOk = async (label, fn) => {
    await c.query('SAVEPOINT sp');
    try { await fn(); console.log(`   ✓ ${label}: permitido`); }
    catch (e) { console.log(`   ✗ ${label}: BLOQUEADO — ${e.message.split('\n')[0].slice(0, 110)}`); ok = false; }
    await c.query('ROLLBACK TO SAVEPOINT sp');
  };

  // Documento duplicado dentro da organização é recusado pelo índice único.
  await expectFail('documento duplicado na mesma organização', async () => {
    await c.query(`INSERT INTO parties (organization_id, kind, legal_name, document_type, document_number)
                   VALUES ($1,'organization','A Ltda','cnpj','11222333000181'),
                          ($1,'organization','B Ltda','cnpj','11.222.333/0001-81')`, [orgA]);
  });

  // Duas empresas SEM documento e com o MESMO nome são duas linhas. Nome não é identidade.
  await expectOk('duas parties homônimas SEM documento coexistem', async () => {
    await c.query(`INSERT INTO parties (organization_id, kind, legal_name)
                   VALUES ($1,'organization','ENEL'), ($1,'organization','ENEL')`, [orgA]);
  });

  // Papel apontando para party de outro inquilino é impossível por chave composta.
  const orgB = '00000000-0000-4000-8000-0000000000b1';
  await expectFail('papel cross-tenant (chave composta)', async () => {
    await c.query(`INSERT INTO organizations (id, name, slug) VALUES ($1,'Org B','org-b-phase1')`, [orgB]);
    const p = (await c.query(`INSERT INTO parties (organization_id, kind, legal_name)
                              VALUES ($1,'organization','Party da B') RETURNING id`, [orgB])).rows[0].id;
    await c.query(`INSERT INTO party_roles (organization_id, party_id, role) VALUES ($1,$2,'customer')`, [orgA, p]);
  });

  // O mesmo CNPJ em organizações diferentes são DUAS parties, e isso está certo.
  await expectOk('mesmo CNPJ em organizações diferentes = duas parties', async () => {
    await c.query(`INSERT INTO organizations (id, name, slug) VALUES ($1,'Org B','org-b-phase1b')`, [orgB]);
    await c.query(`INSERT INTO parties (organization_id, kind, legal_name, document_type, document_number)
                   VALUES ($1,'organization','X SA','cnpj','11222333000181'),
                          ($2,'organization','X SA','cnpj','11222333000181')`, [orgA, orgB]);
  });

  // Papel fora do vocabulário é recusado pelo CHECK.
  await expectFail('papel fora do vocabulário (customer/supplier)', async () => {
    const p = (await c.query(`INSERT INTO parties (organization_id, kind, legal_name)
                              VALUES ($1,'organization','Y') RETURNING id`, [orgA])).rows[0].id;
    await c.query(`INSERT INTO party_roles (organization_id, party_id, role) VALUES ($1,$2,'contractor')`, [orgA, p]);
  });

  // Isolamento de leitura, com RLS realmente ligada.
  if (userA) {
    await c.query('SAVEPOINT iso');
    await c.query(`INSERT INTO organizations (id, name, slug) VALUES ($1,'Org B','org-b-iso')`, [orgB]);
    await c.query(`INSERT INTO parties (organization_id, kind, legal_name) VALUES ($1,'organization','Invisível da B')`, [orgB]);
    const seen = await asUser(userA, async () =>
      (await c.query(`SELECT count(*) n FROM parties WHERE organization_id = $1`, [orgB])).rows[0].n);
    const pass = String(seen) === '0';
    console.log(`   ${pass ? '✓' : '✗'} usuário da org A não enxerga party da org B: ${seen} linha(s) (esperado 0)`);
    if (!pass) ok = false;
    await c.query('ROLLBACK TO SAVEPOINT iso');
  } else {
    console.log('   ! nenhum profile na organização: prova de isolamento por sessão pulada');
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
