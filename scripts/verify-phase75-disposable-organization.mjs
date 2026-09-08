/**
 * Fase 7.5 — organização descartável pelo fluxo REAL de provisionamento.
 *
 *   node scripts/verify-phase75-disposable-organization.mjs
 *
 * Prova a §11 e a §34 do MD: uma organização recém-provisionada nasce com ZERO
 * fato operacional em TODA a matriz de domínios, e com a governança de negócio
 * declaradamente AUSENTE em vez de preenchida.
 *
 * ─── Por que tudo roda dentro de um SAVEPOINT revertido ───────────────────
 *
 * `audit_logs` é append-only por gatilho e a chave estrangeira da organização é
 * ON DELETE CASCADE. Uma organização que registrou qualquer auditoria — e
 * provisionar registra — não pode mais ser apagada sem reescrever história
 * imutável. Então a limpeza não é uma faxina depois: é a transação inteira
 * voltando atrás. Resíduo zero por construção.
 */
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

/** A matriz da §11 — o que uma organização nova NÃO pode ter. */
const OPERATIONAL_DOMAINS = [
  'contracts', 'contract_amendments', 'contract_clauses', 'contract_obligations',
  'contract_obligation_instances', 'contract_project_links', 'contract_milestones',
  'contract_files', 'projects', 'project_measurements', 'contract_billing_events',
  'fiscal_documents', 'fiscal_establishments', 'finance_receivables',
  'finance_settlements', 'finance_reconciliations', 'risks',
  'approval_policies', 'approval_requests', 'contract_billing_release_authorities',
  'parties',
];

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query('SET SESSION default_transaction_read_only = off');

let ok = true;
const must = (label, pass, detail = '') => {
  console.log(`   ${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) ok = false;
};
const one = async (sql, params) => (await c.query(sql, params)).rows[0];
const asRole = (uid, sql) =>
  `SET LOCAL ROLE authenticated;`
  + ` SELECT set_config('request.jwt.claims', json_build_object('sub','${uid}','role','authenticated')::text, true);`
  + ` ${sql}; RESET ROLE;`;
const callAs = async (uid, sql) => {
  const res = await c.query(asRole(uid, sql));
  const list = Array.isArray(res) ? res : [res];
  return list[list.length - 2].rows[0];
};

const sfx = Math.random().toString(36).slice(2, 8);

try {
  console.log('=== ORGANIZAÇÃO DESCARTÁVEL PELO FLUXO REAL ===');

  const provisioner = await one(
    `SELECT m.user_id FROM enterprise_account_memberships m
      JOIN auth.users u ON u.id = m.user_id
     WHERE m.status='ACTIVE' AND m.role IN ('OWNER','ADMIN')
       AND u.email NOT LIKE '%@example.test'
     ORDER BY m.created_at LIMIT 1`);
  must('há titular empresarial real para provisionar', !!provisioner, provisioner?.user_id);
  if (!provisioner) throw new Error('sem autoridade de provisionamento');

  const orgsBefore = Number((await one(`SELECT count(*)::int n FROM organizations`)).n);

  await c.query('BEGIN');
  await c.query('SAVEPOINT disposable');

  const created = (await callAs(provisioner.user_id,
    `SELECT organization_provision('[P75-DESC] Descartavel ${sfx}','[P75-DESC] Razao Social',
       'BR','BRL','America/Sao_Paulo',NULL,'p75-desc-${sfx}') AS r`)).r;
  const org = created.organization_id;
  must('provisionada pelo fluxo real', !!org, org);

  console.log('\n--- matriz de fatos operacionais (§11) ---');
  let total = 0;
  for (const table of OPERATIONAL_DOMAINS) {
    const n = Number((await one(`SELECT count(*)::int n FROM public.${table} WHERE organization_id = $1`, [org])).n);
    total += n;
    must(table, n === 0, String(n));
  }
  must('TOTAL de fatos operacionais é ZERO', total === 0, String(total));

  console.log('\n--- configuração: ausente, não inventada (§12) ---');
  await callAs(provisioner.user_id, `SELECT organization_switch('${org}')`);
  const readiness = (await callAs(provisioner.user_id, `SELECT organization_readiness('${org}') AS r`)).r;
  must('prontidão concorda com a contagem direta',
    Number(readiness.operational_facts_total) === 0, String(readiness.operational_facts_total));
  must('fiscal NÃO CONFIGURADO', readiness.configuration.fiscal === 'NOT_CONFIGURED');
  must('política de aprovação NÃO CONFIGURADA', readiness.configuration.approval_policies === 'NOT_CONFIGURED');
  must('alçada de faturamento NÃO CONFIGURADA', readiness.configuration.billing_release_authority === 'NOT_CONFIGURED');
  must('exatamente 1 membro — quem provisionou', Number(readiness.configuration.members) === 1);

  console.log('\n--- rastro de plataforma: existe, e é só ele ---');
  must('1 evento de criação e nada mais',
    Number(readiness.platform_facts.domain_events) === 1, JSON.stringify(readiness.platform_facts));
  must('nenhum job foi enfileirado', Number(readiness.platform_facts.apex_jobs) === 0);

  console.log('\n--- nada foi copiado da organização existente ---');
  must('nenhum papel de negócio além do administrador de quem criou',
    Number((await one(`SELECT count(*)::int n FROM user_roles WHERE organization_id=$1`, [org])).n) === 1);
  must('nenhum comitê semeado',
    Number((await one(`SELECT count(*)::int n FROM committees WHERE organization_id=$1`, [org])).n) === 0);
  must('nenhum centro de custo herdado',
    Number((await one(`SELECT count(*)::int n FROM finance_cost_centers WHERE organization_id=$1`, [org])).n) === 0);

  console.log('\n--- limpeza e resíduo ---');
  await c.query('ROLLBACK TO SAVEPOINT disposable');
  must('a organização descartável não existe mais',
    Number((await one(`SELECT count(*)::int n FROM organizations WHERE id=$1`, [org])).n) === 0);
  must('nenhum resíduo [P75-DESC]',
    Number((await one(`SELECT count(*)::int n FROM organizations WHERE name LIKE '[P75-DESC]%'`)).n) === 0);
  must('contagem de organizações voltou ao que era',
    Number((await one(`SELECT count(*)::int n FROM organizations`)).n) === orgsBefore, String(orgsBefore));
  await c.query('ROLLBACK');
} catch (e) {
  await c.query('ROLLBACK').catch(() => {});
  console.error('\n✗ FALHOU:', e.message);
  ok = false;
} finally {
  await c.end();
}

console.log(ok ? '\n=== DESCARTÁVEL: ZERO FATOS, ZERO RESÍDUO ===' : '\n=== REPROVADO ===');
process.exit(ok ? 0 : 1);
