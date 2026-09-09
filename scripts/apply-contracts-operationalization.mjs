/**
 * Runner das migrations 154–156 — Contracts Operationalization.
 *
 * Mesmo protocolo dos runners anteriores: preflight na ponta do registro,
 * aplicação das três em UMA transação, bateria de asserções REAIS contra o
 * schema resultante, e ROLLBACK a menos que `--apply` seja passado.
 *
 * As asserções não conferem "a tabela existe": elas provam o COMPORTAMENTO que
 * a arquitetura exige — que interpretação bem evidenciada não entra em fila,
 * que exceção entra, que service role não fabrica autoridade humana, que regra
 * ancorada em agenda não inventa data e que a âncora, quando chega, produz o
 * prazo certo.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';
import { recordMigrationApplied } from './lib/migration-registry.mjs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error('SUPABASE_DB_URL ausente. Migrations 154–156 não executadas.');
  process.exit(2);
}

const MIGRATIONS = [
  ['154', 'contract_interpretation_governance'],
  ['155', 'contract_schedule_anchored_rules'],
  ['156', 'apex_followup_foundation'],
];

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
const stripTransaction = (sql) => sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gmi, '');

let ok = true;
const must = (label, condition, detail = '') => {
  console.log(`   ${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) ok = false;
};
const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];
/** Espera que o SQL FALHE — e com a mensagem certa. */
const mustReject = async (label, sql, params, fragment) => {
  await client.query('SAVEPOINT probe');
  try {
    await client.query(sql, params);
    await client.query('ROLLBACK TO SAVEPOINT probe');
    must(label, false, 'a operação foi aceita');
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT probe');
    must(label, String(error.message).includes(fragment), String(error.message).slice(0, 120));
  }
};

try {
  await client.connect();
  await client.query('SET SESSION default_transaction_read_only = off');

  const tip = (await one(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1',
  ))?.version;
  must('ponta do registro é 153', tip === '153', String(tip));
  if (tip !== '153') throw new Error(`ponta de migration inesperada: ${tip}`);

  await client.query('BEGIN');
  for (const [version, name] of MIGRATIONS) {
    await client.query(stripTransaction(readFileSync(
      `supabase/migrations/${version}_${name}.sql`, 'utf8',
    )));
    await recordMigrationApplied(client, version, name);
    console.log(`   · ${version}_${name} aplicada`);
  }

  // O inquilino das provas é o do primeiro contrato: calendário, obrigação e
  // medição precisam pertencer TODOS à mesma organização, senão a prova
  // testaria o isolamento em vez da regra.
  const contract = (await one(
    `SELECT id, organization_id FROM public.contracts LIMIT 1`)) ?? null;

  console.log('\n── 154: interpretação estruturada e governança por exceção ──');
  must('coluna interpretation_state presente',
    (await one(`SELECT count(*)::int n FROM information_schema.columns
                 WHERE table_name='contract_clauses' AND column_name='interpretation_state'`)).n === 1);
  must('gatilho classify_interpretation ativo',
    (await one(`SELECT count(*)::int n FROM pg_trigger
                 WHERE tgname='classify_interpretation' AND tgrelid='public.contract_clauses'::regclass`)).n === 1);

  // Política de exceção — determinística, sem tocar em linha nenhuma.
  must('leitura clara e imaterial NÃO exige atenção',
    (await one(`SELECT public.contract_interpretation_attention_reasons(
                  true, 0.94, 'low', NULL::numeric, 'pagamento', 'trecho literal suficiente', 3) r`)).r.length === 0);
  must('confiança baixa exige atenção',
    (await one(`SELECT public.contract_interpretation_attention_reasons(
                  true, 0.42, 'low', NULL::numeric, 'pagamento', 'trecho', 3) r`)).r.includes('low_confidence'));
  must('exposição material exige atenção',
    (await one(`SELECT public.contract_interpretation_attention_reasons(
                  true, 0.98, 'low', 250000::numeric, 'pagamento', 'trecho', 3) r`)).r.includes('material_financial_exposure'));
  must('risco alto exige atenção',
    (await one(`SELECT public.contract_interpretation_attention_reasons(
                  true, 0.99, 'high', NULL::numeric, 'pagamento', 'trecho', 3) r`)).r.includes('material_contractual_risk'));
  must('leitura sem evidência exige atenção',
    (await one(`SELECT public.contract_interpretation_attention_reasons(
                  true, 0.99, 'low', NULL::numeric, 'pagamento', NULL::text, NULL::integer) r`)).r.includes('legal_ambiguity'));

  console.log('\n── 155: regra ancorada em agenda ──');
  must('date_state presente em contract_obligation_instances',
    (await one(`SELECT count(*)::int n FROM information_schema.columns
                 WHERE table_name='contract_obligation_instances' AND column_name='date_state'`)).n === 1);
  must('AWAITING_SCHEDULE_ANCHOR aceito pelo CHECK',
    (await one(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint
                 WHERE conname='coi_date_state'`)).d.includes('AWAITING_SCHEDULE_ANCHOR'));
  must('due_kind aceita days_before_schedule_anchor',
    (await one(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint
                 WHERE conname='cod_due_kind'`)).d.includes('days_before_schedule_anchor'));
  must('dia útil sem calendário declarado devolve NULL',
    (await one(`SELECT public.organization_shift_business_days(gen_random_uuid(), DATE '2026-09-30', -5) d`)).d === null);

  // Calendário declarado numa organização real: a conta passa a ser possível.
  //
  // Tudo daqui até o fim das provas de âncora roda dentro de um SAVEPOINT que
  // é desfeito: declarar calendário e feriado é decisão da organização, não
  // efeito colateral de rodar uma migration. A prova precisa do dado; a
  // produção, não.
  await client.query('SAVEPOINT calendarpath');
  const org = contract?.organization_id
    ?? (await one(`SELECT id FROM public.organizations ORDER BY created_at LIMIT 1`)).id;
  await client.query(
    `INSERT INTO public.organization_business_calendars (organization_id) VALUES ($1)
     ON CONFLICT (organization_id) DO NOTHING`, [org]);
  // 30/09/2026 é uma quarta-feira. Cinco dias úteis antes = 23/09/2026 (quarta).
  const shifted = (await one(
    `SELECT public.organization_shift_business_days($1, DATE '2026-09-30', -5) d`, [org])).d;
  must('5 dias úteis antes de 30/09/2026 = 23/09/2026',
    shifted && new Date(shifted).toISOString().slice(0, 10) === '2026-09-23',
    String(shifted));
  // Um feriado no meio empurra o prazo mais um dia para trás.
  await client.query(
    `INSERT INTO public.organization_non_business_days (organization_id, day, label)
     VALUES ($1, DATE '2026-09-24', 'teste') ON CONFLICT DO NOTHING`, [org]);
  const shiftedHoliday = (await one(
    `SELECT public.organization_shift_business_days($1, DATE '2026-09-30', -5) d`, [org])).d;
  must('feriado no caminho empurra o prazo para 22/09/2026',
    shiftedHoliday && new Date(shiftedHoliday).toISOString().slice(0, 10) === '2026-09-22',
    String(shiftedHoliday));

  console.log('\n── 156: fundação do acompanhamento ──');
  must('tabela apex_followups presente',
    (await one(`SELECT count(*)::int n FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='apex_followups'`)).n === 1);
  must('RLS ligada em apex_followups',
    (await one(`SELECT relrowsecurity r FROM pg_class WHERE oid='public.apex_followups'::regclass`)).r === true);
  must('authenticated não pode gravar em apex_followups',
    (await one(`SELECT count(*)::int n FROM information_schema.role_table_grants
                 WHERE table_name='apex_followups' AND grantee='authenticated'
                   AND privilege_type IN ('INSERT','UPDATE','DELETE')`)).n === 0);
  must('WAITING_EXTERNAL_PARTY exige próximo evento esperado',
    (await one(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint
                 WHERE conname='af_waiting_has_expectation'`)).d.includes('next_expected_event_at'));
  must('transição terminal recusada',
    (await one(`SELECT public.apex_followup_valid_transition('COMPLETED','ACTIVE') v`)).v === false);
  must('ACTIVE -> WAITING_EXTERNAL_PARTY permitida',
    (await one(`SELECT public.apex_followup_valid_transition('ACTIVE','WAITING_EXTERNAL_PARTY') v`)).v === true);

  console.log('\n── autoridade: o que uma conexão sem sessão NÃO pode fazer ──');
  if (contract) {
    await mustReject('service role não designa responsável',
      `INSERT INTO public.apex_followups
         (organization_id, source_kind, source_id, contract_id, goal, responsible_text, assigned_by, assigned_at)
       VALUES ($1,'contract',$2,$2,'meta','Fulano',$3, now())`,
      [contract.organization_id, contract.id, '00000000-0000-0000-0000-000000000001'],
      'GOVERNANCE VIOLATION');
    await mustReject('service role não fabrica verificação humana',
      `INSERT INTO public.apex_followups
         (organization_id, source_kind, source_id, contract_id, goal, responsible_text, verified_by, verified_at)
       VALUES ($1,'contract',$2,$2,'meta','Fulano',$3, now())`,
      [contract.organization_id, contract.id, '00000000-0000-0000-0000-000000000001'],
      'GOVERNANCE VIOLATION');
    await mustReject('fechamento por evidência exige verificação determinística',
      `INSERT INTO public.apex_followups
         (organization_id, source_kind, source_id, contract_id, goal, responsible_text,
          state, closure_basis, closed_at, verification_mode, verification_evidence_id)
       VALUES ($1,'contract',$2,$2,'meta','Fulano','COMPLETED','verified_evidence', now(),
               'human_confirmation', gen_random_uuid())`,
      [contract.organization_id, contract.id],
      'GOVERNANCE VIOLATION');

    // O caminho legítimo do Apex: identificar, sem inventar autoridade.
    await client.query('SAVEPOINT apexpath');
    const created = await one(
      `INSERT INTO public.apex_followups
         (organization_id, source_kind, source_id, contract_id, goal, responsible_text,
          state, cadence_days, due_date)
       VALUES ($1,'contract',$2,$2,'Renovar CND','Contraparte','ACTIVE',7, CURRENT_DATE - 1)
       RETURNING id`, [contract.organization_id, contract.id]);
    must('Apex cria acompanhamento sem autoridade humana', Boolean(created?.id));
    const nudges = (await client.query(
      `SELECT id FROM public.apex_followup_due_nudges($1, CURRENT_DATE)`, [contract.organization_id])).rows;
    must('acompanhamento ativo e vencido entra na fila de cobrança',
      nudges.some((r) => r.id === created.id));
    await client.query(
      `UPDATE public.apex_followups
          SET state='WAITING_EXTERNAL_PARTY', next_expected_event='Resposta do cliente',
              next_expected_event_at = CURRENT_DATE + 6
        WHERE id=$1`, [created.id]);
    const quiet = (await client.query(
      `SELECT id FROM public.apex_followup_due_nudges($1, CURRENT_DATE)`, [contract.organization_id])).rows;
    must('aguardando terceiro NÃO é cobrado antes do evento esperado',
      !quiet.some((r) => r.id === created.id));
    const later = (await client.query(
      `SELECT id FROM public.apex_followup_due_nudges($1, CURRENT_DATE + 6)`, [contract.organization_id])).rows;
    must('na data do evento esperado, volta à fila',
      later.some((r) => r.id === created.id));
    const history = (await one(
      `SELECT count(*)::int n FROM public.apex_followup_events WHERE followup_id=$1`, [created.id])).n;
    must('histórico registrou criação e transição', history >= 2, String(history));
    await client.query('ROLLBACK TO SAVEPOINT apexpath');
  } else {
    console.log('   · (sem contrato na base: provas de acompanhamento puladas)');
  }

  console.log('\n── ponta a ponta: a agenda chega e o prazo aparece ──');
  if (contract) {
    await client.query('SAVEPOINT anchorpath');
    // Um contrato descartável, para não amarrar a prova a dado de produção.
    const c = await one(
      `INSERT INTO public.contracts (organization_id, title, contract_number, status, start_date, end_date)
       VALUES ($1, '[154-156] Âncora de agenda', '[154-156] TMP', 'active', DATE '2026-01-01', DATE '2026-12-31')
       RETURNING id`, [contract.organization_id]);
    const doc = await one(
      `INSERT INTO public.contract_documents (organization_id, contract_id, title, file_path, document_type)
       VALUES ($1, $2, 'Contrato original', 'tmp/154.pdf', 'contract') RETURNING id`,
      [contract.organization_id, c.id]);
    // "Os documentos devem ser entregues 5 dias úteis antes da medição."
    const def = await one(
      `INSERT INTO public.contract_obligation_definitions
         (organization_id, contract_id, title, responsible_side, source_document_id,
          effective_from, activation_kind, due_kind, calendar_basis,
          schedule_anchor, schedule_anchor_offset_days, schedule_anchor_text, recurrence_kind)
       VALUES ($1, $2, 'Entregar documentos antes da medição', 'contracting_organization', $3,
               DATE '2026-01-01', 'schedule_anchor', 'days_before_schedule_anchor', 'business_days',
               'measurement', 5, '5 dias úteis antes da medição', 'one_time')
       RETURNING id`, [contract.organization_id, c.id, doc.id]);
    const madeCount = (await one(
      `SELECT public.contract_obligations_materialize($1, DATE '2026-12-31', $2) n`,
      [def.id, contract.organization_id])).n;
    must('regra ancorada materializa a ocorrência', madeCount === 1, String(madeCount));
    const born = await one(
      `SELECT date_state, due_date, due_confidence, schedule_anchor
         FROM public.contract_obligation_instances WHERE definition_id = $1`, [def.id]);
    must('nasce AWAITING_SCHEDULE_ANCHOR', born.date_state === 'AWAITING_SCHEDULE_ANCHOR', born.date_state);
    must('nenhuma data é inventada', born.due_date === null);
    must('a âncora fica registrada', born.schedule_anchor === 'measurement');
    // Rodar de novo não duplica.
    const again = (await one(
      `SELECT public.contract_obligations_materialize($1, DATE '2026-12-31', $2) n`,
      [def.id, contract.organization_id])).n;
    must('materialização é idempotente', again === 0, String(again));

    // Projetos agenda a medição para 30/09/2026.
    const rule = await one(
      `INSERT INTO public.contract_measurement_requirements
         (organization_id, contract_id, title, source_document_id, effective_from)
       VALUES ($1, $2, 'Medição mensal', $3, DATE '2026-01-01') RETURNING id`,
      [contract.organization_id, c.id, doc.id]);
    // Projeto descartável: a base de produção nasce vazia, e a prova não pode
    // depender de dado que só existe em ambiente com histórico.
    let proj = await one(`SELECT id FROM public.projects WHERE organization_id = $1 LIMIT 1`,
      [contract.organization_id]);
    if (!proj) {
      proj = await one(
        `INSERT INTO public.projects (id, organization_id, project)
         VALUES ('TMP-154-156', $1, '{"codigo":"TMP-154-156","nome":"[154-156] descartável"}'::jsonb)
         RETURNING id`, [contract.organization_id]);
    }
    if (proj) {
      // Medição pertence a um projeto LIGADO ao contrato — o banco recusa
      // qualquer outro par, e é essa recusa que mantém a fronteira honesta.
      await client.query(
        `INSERT INTO public.contract_project_links (organization_id, contract_id, project_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [contract.organization_id, c.id, proj.id]);
      const meas = await one(
        `INSERT INTO public.project_measurements
           (organization_id, project_id, contract_id, contract_measurement_rule_id,
            occurrence_key, expected_at, status)
         VALUES ($1, $2, $3, $4, '2026-09', DATE '2026-09-30', 'PLANNED') RETURNING id`,
        [contract.organization_id, proj.id, c.id, rule.id]);
      const applied = (await one(
        `SELECT public.contract_obligations_apply_schedule_anchor($1, $2) n`,
        [meas.id, contract.organization_id])).n;
      must('a âncora resolve a exigência', applied === 1, String(applied));
      const resolved = await one(
        `SELECT date_state, due_date, due_confidence, state, schedule_anchor_date
           FROM public.contract_obligation_instances WHERE definition_id = $1`, [def.id]);
      must('prazo passa a RESOLVED', resolved.date_state === 'RESOLVED', resolved.date_state);
      must('prazo = 5 dias úteis antes de 30/09 (com o feriado declarado): 22/09/2026',
        resolved.due_date && new Date(resolved.due_date).toISOString().slice(0, 10) === '2026-09-22',
        String(resolved.due_date));
      must('a ocorrência passa a valer', resolved.state === 'OPEN', resolved.state);
      must('confiança do prazo é conhecida', resolved.due_confidence === 'known');
      const reapplied = (await one(
        `SELECT public.contract_obligations_apply_schedule_anchor($1, $2) n`,
        [meas.id, contract.organization_id])).n;
      must('aplicar a âncora de novo não muda nada', reapplied === 0, String(reapplied));
    } else {
      console.log('   · (sem projeto na base: prova da âncora de medição pulada)');
    }
    await client.query('ROLLBACK TO SAVEPOINT anchorpath');
  }

  await client.query('ROLLBACK TO SAVEPOINT calendarpath');

  const clause = await one(`SELECT id, organization_id FROM public.contract_clauses LIMIT 1`);
  if (clause) {
    await mustReject('service role não confirma interpretação',
      `UPDATE public.contract_clauses SET interpretation_state='human_confirmed' WHERE id=$1`,
      [clause.id], 'GOVERNANCE VIOLATION');
    await mustReject('service role não baixa atenção',
      `UPDATE public.contract_clauses
          SET attention_resolved_by=$2, attention_resolved_at=now() WHERE id=$1`,
      [clause.id, '00000000-0000-0000-0000-000000000001'], 'GOVERNANCE VIOLATION');
  }

  if (!ok) throw new Error('bateria das migrations reprovada');

  if (apply) {
    await client.query('COMMIT');
    console.log('\n=== MIGRATIONS 154–156 COMETIDAS E REGISTRADAS ===');
  } else {
    await client.query('ROLLBACK');
    console.log('\n=== ENSAIO APROVADO; DESFEITO ===');
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error(`✗ FALHOU: ${error instanceof Error ? error.message : String(error)}`);
  ok = false;
} finally {
  await client.end().catch(() => undefined);
}

process.exit(ok ? 0 : 1);
