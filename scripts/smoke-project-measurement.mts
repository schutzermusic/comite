/**
 * Fase 6 — FUMAÇA de produção da cadeia de medição.
 *
 *   npx tsx scripts/smoke-project-measurement.mts
 *
 * Percorre, contra o banco REAL, a cadeia inteira que a fase promete:
 *
 *   regra contratual
 *     → mapeamento de cronograma governado
 *       → candidato materializado
 *         → evidência vinculada
 *           → prontidão explica o que falta
 *             → submissão
 *               → aceite autoritativo
 *                 → fato de domínio
 *                   → modelo de leitura
 *
 * ─── Sobre os dados ────────────────────────────────────────────────────────
 *
 * Organização DESCARTÁVEL, criada aqui e apagada no fim, sempre — inclusive
 * quando a fumaça falha. Nada toca inquilino real: a §102 proíbe fabricar
 * evento de medição em Projetos e Contratos de verdade, e a forma de obedecer
 * não é tomar cuidado, é não ter acesso ao caso real.
 *
 * ─── O que a fumaça NÃO prova ──────────────────────────────────────────────
 *
 * Que a operação real funciona. Cenário descartável prova o MOTOR; a §103 é
 * explícita em não deixar isso virar afirmação sobre dado real. A prova real
 * exige um projeto real com contrato vinculado, regra de medição, mapeamento,
 * evidência e fonte de aceite — e essa é uma condição de dado, não de código.
 */
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const DB_URL = process.env.SUPABASE_DB_URL;
if (!DB_URL) {
  console.error('SUPABASE_DB_URL ausente.');
  process.exit(1);
}

const c = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
const sfx = Math.random().toString(36).slice(2, 10);

let ok = true;
const step = (label: string, pass: boolean, detail = '') => {
  console.log(`   ${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) ok = false;
};
const one = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
  (await c.query(sql, params)).rows[0] as T;

/** A identidade viaja na MESMA instrução — pooler em modo transação. */
const asUser = (uid: string, sql: string) =>
  `WITH actor AS (SELECT set_config('request.jwt.claims', '${JSON.stringify({ sub: uid, role: 'authenticated' })}', true)) ${sql}`;

let orgId = '';

async function cleanup(): Promise<void> {
  if (!orgId) return;
  /*
    Varredura genérica em passes: `projects` e `tasks` referenciam a
    organização SEM cascata, e um DELETE direto falharia — deixando a
    organização descartável viva no banco real.
  */
  try {
    await c.query('BEGIN');
    const { rows } = await c.query<{ table_name: string }>(
      `SELECT c.table_name FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema=c.table_schema AND t.table_name=c.table_name
        WHERE c.table_schema='public' AND c.column_name='organization_id' AND t.table_type='BASE TABLE'`);
    let remaining = rows.map((r) => r.table_name);
    for (let pass = 0; pass < 8 && remaining.length; pass += 1) {
      const next: string[] = [];
      for (const t of remaining) {
        await c.query('SAVEPOINT s');
        try {
          await c.query(`DELETE FROM public.${t} WHERE organization_id = $1`, [orgId]);
          await c.query('RELEASE SAVEPOINT s');
        } catch { await c.query('ROLLBACK TO SAVEPOINT s'); next.push(t); }
      }
      remaining = next;
    }
    await c.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    await c.query(`DELETE FROM auth.users WHERE email LIKE $1`, [`p6smoke.%.${sfx}@example.test`]);
    await c.query('COMMIT');

    const left = await one<{ n: number }>(
      `SELECT count(*)::int n FROM organizations WHERE id = $1`, [orgId]);
    step('cenário descartável removido', left.n === 0);
  } catch (e) {
    ok = false;
    try { await c.query('ROLLBACK'); } catch { /* já desfeita */ }
    console.error('FALHA na limpeza:', (e as Error).message);
  }
}

async function main(): Promise<void> {
try {
  await c.connect();
  await c.query('SET SESSION default_transaction_read_only = off');

  console.log('=== CENÁRIO DESCARTÁVEL ===');
  orgId = (await one<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ('[P6-SMOKE] Org', $1) RETURNING id`,
    [`p6smoke-${sfx}`])).id;

  const mkUser = async (label: string, roleKey: string) => {
    const uid = (await one<{ id: string }>(
      `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
       VALUES (gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
               $1,'x',now(),now()) RETURNING id`, [`p6smoke.${label}.${sfx}@example.test`])).id;
    await c.query(`INSERT INTO profiles (user_id, organization_id, full_name, status)
                   VALUES ($1,$2,$3,'active')`, [uid, orgId, `[P6-SMOKE] ${label}`]);
    await c.query(`INSERT INTO user_roles (user_id, role_id, organization_id)
                   SELECT $1, r.id, $2 FROM roles r WHERE r.key=$3 AND r.organization_id IS NULL`,
      [uid, orgId, roleKey]);
    return uid;
  };
  const engineer = await mkUser('engineer', 'engenharia_pcp');
  const manager = await mkUser('manager', 'gestor_projetos');

  const projectId = `p6smoke-${sfx}`;
  await c.query(`INSERT INTO projects (id, organization_id, project) VALUES ($1,$2,$3)`,
    [projectId, orgId, JSON.stringify({ name: '[P6-SMOKE] Projeto', status: 'em_andamento' })]);

  const contractId = (await one<{ id: string }>(
    `INSERT INTO contracts (organization_id, title, status, currency, data_class)
     VALUES ($1,'[P6-SMOKE] Contrato','active','BRL','demo') RETURNING id`, [orgId])).id;
  step('projeto e contrato descartáveis criados', true);

  // ── 1) O vínculo EXPLÍCITO Projeto↔Contrato ──
  await c.query(`INSERT INTO contract_project_links (organization_id, contract_id, project_id)
                 VALUES ($1,$2,$3)`, [orgId, contractId, projectId]);
  step('vínculo Projeto↔Contrato explícito', true);

  // ── 2) A regra contratual de medição ──
  const ruleId = (await one<{ id: string }>(
    `INSERT INTO contract_measurement_requirements
       (organization_id, contract_id, title, source_reference, effective_from,
        report_required, technical_report_required, evidence_required,
        tests_inspection_required, customer_acceptance_required,
        measurement_basis, accumulation_mode, aggregation_mode, cadence)
     VALUES ($1,$2,'Medição mensal de serviços','Cláusula 5.1', current_date - 365,
             true, true, true, false, true, 'MONETARY','INCREMENTAL','SUM_INCREMENTAL','MONTHLY')
     RETURNING id`, [orgId, contractId])).id;
  step('regra contratual de medição registrada', true);

  // ── 3) O mapeamento GOVERNADO ao cronograma ──
  const itemId = (await one<{ id: string }>(
    `INSERT INTO project_timeline_items (organization_id, project_id, title, planned_start, planned_finish)
     VALUES ($1,$2,'Execução de campo', date_trunc('month', current_date)::date,
             (date_trunc('month', current_date) + interval '1 month - 1 day')::date) RETURNING id`,
    [orgId, projectId])).id;
  await c.query(
    `INSERT INTO contract_measurement_rule_timeline_mappings
       (organization_id, contract_id, rule_id, project_id, timeline_item_id, mapping_source, review_state, mapped_by)
     VALUES ($1,$2,$3,$4,$5,'explicit','accepted',$6)`,
    [orgId, contractId, ruleId, projectId, itemId, manager]);
  step('mapeamento regra ↔ etapa governado', true);

  // ── 4) O candidato determinístico ──
  console.log('\n=== MATERIALIZAÇÃO ===');
  const mat = await one<{ r: { created: number; considered: number } }>(
    `SELECT project_measurements_materialize($1) r`, [orgId]);
  step('candidato materializado', mat.r.created === 1, JSON.stringify(mat.r));

  const mat2 = await one<{ r: { created: number } }>(
    `SELECT project_measurements_materialize($1) r`, [orgId]);
  step('segunda execução é idempotente', mat2.r.created === 0);

  const m = await one<{ id: string; status: string; occurrence_key: string }>(
    `SELECT id, status, occurrence_key FROM project_measurements WHERE organization_id=$1`, [orgId]);
  step('nasceu PLANEJADA, não aceita', m.status === 'PLANNED', m.status);

  // ── 5) Prontidão explica o que falta ──
  console.log('\n=== PRONTIDÃO ===');
  const r0 = await one<{ r: Record<string, unknown> }>(
    `SELECT project_measurement_readiness($1) r`, [m.id]);
  const reasons0 = JSON.stringify(r0.r.reasons);
  step('não está pronta, e diz por quê', r0.r.overall !== 'READY', `${r0.r.overall} ${reasons0}`);
  step('cobra o relatório exigido', reasons0.includes('MISSING_REQUIRED_REPORT'));
  step('cobra a execução observada', reasons0.includes('EXECUTION_NOT_OBSERVED'));

  // ── 6) Evidência ──
  console.log('\n=== EVIDÊNCIA ===');
  for (const [kind, name] of [
    ['TECHNICAL_REPORT', 'relatorio-tecnico.pdf'],
    ['SERVICE_REPORT', 'relatorio-servico.pdf'],
    ['EVIDENCE', 'evidencias.pdf'],
    ['CUSTOMER_ACCEPTANCE', 'boletim-assinado.pdf'],
  ]) {
    const f = (await one<{ id: string }>(
      `INSERT INTO project_files (organization_id, project_id, bucket_id, object_path, file_name, content_type, file_size)
       VALUES ($1,$2,'projects',$3,$4,'application/pdf',1024) RETURNING id`,
      [orgId, projectId, `p6smoke/${sfx}/${name}`, name])).id;
    await c.query(
      `SELECT project_measurement_link_evidence($1,'project_file',$2,'RAW_EVIDENCE','deterministic',NULL,$3)`,
      [m.id, f, kind]);
  }
  const evs = await one<{ n: number }>(
    `SELECT count(*)::int n FROM project_measurement_evidence WHERE measurement_id=$1`, [m.id]);
  step('evidência determinística vinculada', evs.n === 4, `${evs.n} vínculos`);

  await c.query(`UPDATE project_measurements SET measured_value = 250000, currency = 'BRL' WHERE id=$1`, [m.id]);
  await c.query(`SELECT project_measurement_recompute_readiness($1)`, [m.id]);

  const r1 = await one<{ r: Record<string, unknown> }>(
    `SELECT project_measurement_readiness($1) r`, [m.id]);
  step('com o pacote completo, a submissão fica pronta',
    (r1.r.dimensions as Record<string, string>).submission === 'READY',
    JSON.stringify(r1.r.dimensions));
  step('e o ACEITE continua pendente',
    (r1.r.dimensions as Record<string, string>).acceptance !== 'READY');

  // ── 7) Ciclo governado ──
  console.log('\n=== CICLO ===');
  await c.query(asUser(engineer, `SELECT public.project_measurement_prepare('${m.id}') FROM actor`));
  await c.query(asUser(engineer, `SELECT public.project_measurement_mark_ready('${m.id}') FROM actor`));
  await c.query(asUser(engineer, `SELECT public.project_measurement_submit('${m.id}','pacote de fumaça') FROM actor`));
  step('submetida por engenharia',
    (await one<{ status: string }>(`SELECT status FROM project_measurements WHERE id=$1`, [m.id])).status === 'SUBMITTED');

  // A recusa que importa: quem preparou não decide.
  let refused = false;
  try {
    await c.query(asUser(engineer, `SELECT public.project_measurement_accept('${m.id}','internal_reviewer') FROM actor`));
  } catch { refused = true; }
  step('quem preparou NÃO pode aceitar', refused);

  await c.query(asUser(manager,
    `SELECT public.project_measurement_accept('${m.id}','signed_bulletin', NULL, 250000, 'BRL', NULL,
       'Boletim de medição 001/2026') FROM actor`));
  const accepted = await one<{ status: string; accepted_value: string; acceptance_source: string }>(
    `SELECT status, accepted_value, acceptance_source FROM project_measurements WHERE id=$1`, [m.id]);
  step('aceita com proveniência de boletim assinado',
    accepted.status === 'ACCEPTED' && accepted.acceptance_source === 'signed_bulletin');
  step('valor aceito congelado', Number(accepted.accepted_value) === 250000);

  // ── 8) O fato de domínio que a Fase 7 vai consumir ──
  console.log('\n=== FATO DE DOMÍNIO ===');
  const ev = await one<{ n: number; payload: Record<string, unknown> }>(
    `SELECT count(*)::int n, (array_agg(payload))[1] payload FROM domain_events
      WHERE aggregate_id=$1 AND event_type='projects.measurement.accepted'`, [m.id]);
  step('projects.measurement.accepted emitido, uma vez', ev.n === 1);
  step('o fato carrega o valor ACEITO e a regra que o rege',
    ev.payload?.accepted_value !== undefined && ev.payload?.contract_measurement_rule_id === ruleId);

  // ── 9) Imutabilidade ──
  let immutable = false;
  try {
    await c.query(`UPDATE project_measurements SET accepted_value = 1 WHERE id=$1`, [m.id]);
  } catch { immutable = true; }
  step('fato aceito é imutável', immutable);

  // ── 10) O modelo de leitura ──
  console.log('\n=== MODELO DE LEITURA ===');
  const rm = await one<{ status: string; rule_title: string; source_reference: string; readiness_overall: string }>(
    `SELECT status, rule_title, source_reference, readiness_overall
       FROM project_measurement_read_model WHERE id=$1`, [m.id]);
  step('leitura canônica traz estado, regra e proveniência',
    rm.status === 'ACCEPTED' && rm.rule_title !== null && rm.source_reference === 'Cláusula 5.1',
    JSON.stringify(rm));

  // ── 11) A fronteira: nada de Financeiro/Fiscal ──
  console.log('\n=== FRONTEIRA FASE 7 ===');
  const { rows: fiscalTables } = await c.query<{ table_name: string }>(
    `SELECT c.table_name FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name
      WHERE c.table_schema='public' AND c.column_name='organization_id' AND t.table_type='BASE TABLE'
        AND (c.table_name LIKE 'fiscal%' OR c.table_name LIKE 'finance%')`);
  let fiscalRows = 0;
  for (const t of fiscalTables) {
    fiscalRows += (await one<{ n: number }>(
      `SELECT count(*)::int n FROM public.${t.table_name} WHERE organization_id=$1`, [orgId])).n;
  }
  step('nenhuma linha Fiscal/Financeira criada', fiscalRows === 0,
    `${fiscalTables.length} tabelas varridas`);

  const trunc = await one<{ n: number }>(
    `SELECT count(*)::int n FROM information_schema.role_table_grants
      WHERE table_schema='public' AND privilege_type='TRUNCATE' AND grantee IN ('anon','authenticated')`);
  step('TRUNCATE de navegador segue zero', trunc.n === 0);
} catch (e) {
  ok = false;
  console.error('\nFALHA:', (e as Error).message);
} finally {
  console.log('\n=== LIMPEZA ===');
  await cleanup();
  await c.end();
}

}

/*
  Extensão `.mts`, e corpo dentro de `main()`. O alvo de compilação padrão deste
  repositório é CJS, onde `await` de topo não existe — os outros scripts em
  `scripts/` são `.mjs` pela mesma razão. Aqui vale a tipagem, então `.mts`.
*/
await main().catch((e) => { ok = false; console.error('FALHA:', (e as Error).message); });

console.log(`\n${ok ? 'VERDE' : 'VERMELHO'}`);
process.exit(ok ? 0 : 1);
