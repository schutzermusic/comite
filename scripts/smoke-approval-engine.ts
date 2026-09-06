/**
 * Fumaça do Motor de Aprovação — em PRODUÇÃO, com dados descartáveis.
 *
 *   npx tsx scripts/smoke-approval-engine.ts
 *
 * ─── A regra que este arquivo obedece ──────────────────────────────────────
 *
 * Nenhuma linha toca uma organização real. Tudo acontece numa organização
 * criada aqui e APAGADA no final, mesmo quando o roteiro falha no meio. A §62
 * é explícita: não se fabrica histórico de aprovação em inquilino de verdade,
 * e a forma de obedecer não é cuidado — é não ter onde errar.
 *
 * O que ele exercita, na ordem em que um usuário faria:
 *
 *   política → ativação → pedido → decisão do estágio 1 → abertura do estágio 2
 *   → quórum → desfecho → eventos → modelo de leitura
 *
 * E, no caminho, o que NÃO pode acontecer: autoaprovação, decisão fora de
 * ordem, retentativa duplicando história, e decisão depois do desfecho.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

for (const file of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* arquivo ausente é um caso normal */ }
}

const DB_URL = process.env.SUPABASE_DB_URL;
if (!DB_URL) { console.error('SUPABASE_DB_URL ausente.'); process.exit(1); }

const c = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
let ok = true;
const step = (label: string, pass: boolean, detail = '') => {
  console.log(`   ${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) ok = false;
};
const one = async <T = Record<string, unknown>>(sql: string, p?: unknown[]): Promise<T> =>
  (await c.query(sql, p)).rows[0] as T;

/*
  A identidade viaja NA MESMA INSTRUÇÃO da chamada.

  `SUPABASE_DB_URL` aponta para o PgBouncer em modo TRANSAÇÃO: um `set_config`
  de sessão feito antes pode simplesmente não estar lá na instrução seguinte, e
  o sintoma seria `auth.uid()` devolvendo outra pessoa.
*/
const asUser = (sql: string) => `WITH actor AS (SELECT set_config('request.jwt.claims', $1, true)) ${sql}`;

const suffix = Math.random().toString(36).slice(2, 10);
let orgId: string | null = null;

// Envolvido numa função porque o `tsx` deste projeto emite CJS, e CJS não tem
// `await` de topo. Nada aqui depende de ser módulo.
async function main(): Promise<void> {
try {
  await c.connect();
  await c.query('SET SESSION default_transaction_read_only = off');
  console.log('### FUMAÇA — MOTOR DE APROVAÇÃO (organização descartável) ###\n');

  orgId = (await one<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ('[SMOKE] Motor de Aprovação', $1) RETURNING id`,
    [`smoke-approvals-${suffix}`])).id;
  step('organização descartável criada', true, orgId);

  const mkUser = async (label: string, roleKey: string) => {
    const uid = (await one<{ id: string }>(
      `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
       VALUES (gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
               $1,'x',now(),now()) RETURNING id`, [`smoke.${label}.${suffix}@example.test`])).id;
    await c.query(`INSERT INTO profiles (user_id, organization_id, full_name, status)
                   VALUES ($1,$2,$3,'active')`, [uid, orgId, `[SMOKE] ${label}`]);
    await c.query(`INSERT INTO user_roles (user_id, role_id, organization_id)
                   SELECT $1, r.id, $2 FROM roles r WHERE r.key=$3 AND r.organization_id IS NULL`,
                  [uid, orgId, roleKey]);
    return uid;
  };
  const requester = await mkUser('requester', 'owner_admin');
  const legal     = await mkUser('legal',     'juridico_contratos');
  const finance   = await mkUser('finance',   'financeiro');
  const director  = await mkUser('director',  'ceo_diretoria');

  const contractId = (await one<{ id: string }>(
    `INSERT INTO contracts (organization_id, title, contract_number, status, risk_level, currency,
                            total_value, data_class, created_by, owner_user_id)
     VALUES ($1,'[SMOKE] Contrato','SMK-001','negotiation','medium','BRL',75000,'demo',$2,$2) RETURNING id`,
    [orgId, requester])).id;

  await c.query(
    `INSERT INTO approval_engine_cutover (organization_id, business_domain, subject_type, action_type, justification)
     VALUES ($1,'contracts','contract','approve','Fumaça em organização descartável.')`, [orgId]);
  step('fronteira de corte ligada SÓ nesta organização', true);

  // ---- política descartável ----
  const policyId = (await one<{ id: string }>(
    `INSERT INTO approval_policies (organization_id, policy_key, name, business_domain)
     VALUES ($1,'contracts.approve.smoke','[SMOKE] Política','contracts') RETURNING id`, [orgId])).id;
  const versionId = (await one<{ id: string }>(
    `INSERT INTO approval_policy_versions (organization_id, policy_id, version_no, subject_type,
       action_type, decision_purpose) VALUES ($1,$2,1,'contract','approve','APPROVAL') RETURNING id`,
    [orgId, policyId])).id;
  const s1 = (await one<{ id: string }>(
    `INSERT INTO approval_policy_stages (organization_id, policy_version_id, stage_no, name)
     VALUES ($1,$2,1,'Jurídico') RETURNING id`, [orgId, versionId])).id;
  const s2 = (await one<{ id: string }>(
    `INSERT INTO approval_policy_stages (organization_id, policy_version_id, stage_no, name, quorum_required)
     VALUES ($1,$2,2,'Financeiro + Diretoria',2) RETURNING id`, [orgId, versionId])).id;
  const mkStep = (stage: string, key: string, role: string, authority?: number) => c.query(
    `INSERT INTO approval_policy_steps (organization_id, policy_version_id, policy_stage_id, step_key,
       name, decision_purpose, eligibility_mode, role_key, sod_forbid_requester,
       authority_required, authority_max_amount, authority_currency)
     VALUES ($1,$2,$3,$4,$5,'APPROVAL','ROLE',$6,true,$7,$8,$9)`,
    [orgId, versionId, stage, key, `[SMOKE] ${key}`, role,
     authority !== undefined, authority ?? null, authority !== undefined ? 'BRL' : null]);
  await mkStep(s1, 'juridico', 'juridico_contratos');
  await mkStep(s2, 'financeiro', 'financeiro', 100000);
  await mkStep(s2, 'diretoria', 'ceo_diretoria');

  await c.query(`SELECT approval_policy_activate($1)`, [versionId]);
  step('política validada e ativada', true);

  // ---- pedido ----
  const created = (await one<{ r: { status: string; request_id: string; policy_version_no: number } }>(
    asUser(`SELECT approval_request_create($2,'contract',$3,'approve','APPROVAL','fumaça') AS r FROM actor`),
    [JSON.stringify({ sub: requester }), orgId, contractId])).r;
  step('pedido criado sob a política ativa', created.status === 'CREATED', JSON.stringify(created).slice(0, 90));
  const requestId = created.request_id;

  const stepOf = async (key: string) => (await one<{ id: string }>(
    `SELECT id FROM approval_request_steps WHERE request_id=$1 AND step_key=$2`, [requestId, key])).id;
  const decide = async (uid: string, stepId: string, decision: string, idem: string, reason?: string) =>
    (await one<{ r: Record<string, unknown> }>(
      asUser(`SELECT approval_decide($2,$3,$4,$5) AS r FROM actor`),
      [JSON.stringify({ sub: uid }), stepId, decision, idem, reason ?? null])).r;
  const refuses = async (fn: () => Promise<unknown>) => {
    try { await fn(); return null; } catch (e) { return (e as Error).message; }
  };

  const legalStep = await stepOf('juridico');
  const finStep = await stepOf('financeiro');
  const dirStep = await stepOf('diretoria');

  // ---- o que NÃO pode ----
  step('autoaprovação recusada',
    (await refuses(() => decide(requester, legalStep, 'APPROVED', `smk-self-${suffix}`)))?.includes('SOD_REQUESTER') ?? false);
  step('decisão fora de ordem recusada',
    (await refuses(() => decide(finance, finStep, 'APPROVED', `smk-ooo-${suffix}`)))?.includes('Ordem de aprovação') ?? false);

  // ---- o caminho feliz ----
  const d1 = await decide(legal, legalStep, 'APPROVED', `smk-1-${suffix}`);
  step('estágio 1 aprovado; pedido segue pendente', d1.request_status === 'PENDING' && d1.current_stage_no === 2);

  const retry = await decide(legal, legalStep, 'APPROVED', `smk-1-${suffix}`);
  step('retentativa com a mesma chave devolve a MESMA decisão',
    retry.status === 'IDEMPOTENT_REPLAY' && retry.decision_id === d1.decision_id);
  step('e não duplicou o histórico',
    Number((await one<{ n: string }>(
      `SELECT count(*) n FROM approval_decisions WHERE request_step_id=$1`, [legalStep])).n) === 1);

  const d2 = await decide(finance, finStep, 'APPROVED', `smk-2-${suffix}`);
  step('quórum 2/2: uma aprovação não fecha o estágio', d2.request_status === 'PENDING');

  const d3 = await decide(director, dirStep, 'APPROVED', `smk-3-${suffix}`);
  step('quórum completo finaliza o pedido como APPROVED', d3.request_status === 'APPROVED');

  step('decisão após o desfecho é recusada',
    (await refuses(() => decide(director, dirStep, 'REJECTED', `smk-after-${suffix}`, 'x'))) !== null);

  // ---- eventos e leitura ----
  const evs = (await c.query<{ event_type: string }>(
    `SELECT event_type FROM domain_events WHERE organization_id=$1 AND event_type LIKE 'approval.%'
      ORDER BY recorded_at`, [orgId])).rows.map(r => r.event_type);
  step('eventos emitidos na mesma transação da decisão',
    evs.includes('approval.request.created') && evs.includes('approval.stage.opened')
    && evs.includes('approval.decision.recorded') && evs.includes('approval.request.approved'),
    evs.join(', '));

  const rm = await one<{ policy_key: string; policy_version_no: number; status: string;
                         st: number; sp: number; de: number; provenance: string }>(
    `SELECT policy_key, policy_version_no, status, provenance,
            jsonb_array_length(stages) st, jsonb_array_length(steps) sp, jsonb_array_length(decisions) de
       FROM approval_request_read_model WHERE request_id=$1`, [requestId]);
  step('modelo de leitura devolve política, versão, estágios, etapas e decisões',
    rm.policy_key === 'contracts.approve.smoke' && rm.policy_version_no === 1
    && rm.status === 'APPROVED' && rm.st === 2 && rm.sp === 3 && rm.de === 3
    && rm.provenance === 'SHARED_ENGINE',
    JSON.stringify(rm));

  const prov = await one<{ n: string }>(
    `SELECT count(*) n FROM approval_decisions
      WHERE organization_id=$1 AND authority_source IS NOT NULL AND subject_fingerprint IS NOT NULL`, [orgId]);
  step('toda decisão gravou proveniência de autoridade e impressão digital', Number(prov.n) === 3);
} catch (e) {
  ok = false;
  console.error('\nFALHA:', (e as Error).message);
} finally {
  // ---- limpeza, aconteça o que acontecer ----
  if (orgId) {
    try {
      // FK sem CASCADE em contract_amendment_revisions (deferido da Fase 4).
      await c.query(`DELETE FROM contract_amendment_revisions WHERE organization_id=$1`, [orgId]);
      await c.query(`DELETE FROM organizations WHERE id=$1`, [orgId]);
      await c.query(`DELETE FROM auth.users WHERE email LIKE $1`, [`smoke.%.${suffix}@example.test`]);
      const left = await one<{ n: string }>(
        `SELECT count(*) n FROM organizations WHERE id=$1`, [orgId]);
      step('\n   dados descartáveis removidos de produção', Number(left.n) === 0);
    } catch (e) {
      ok = false;
      console.error('LIMPEZA FALHOU — resíduo em produção:', (e as Error).message);
    }
  }
  await c.end();
}
}

main().then(() => {
  console.log(ok ? '\nRESULTADO: VERDE' : '\nRESULTADO: VERMELHO');
  process.exit(ok ? 0 : 1);
});
