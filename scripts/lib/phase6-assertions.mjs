/**
 * Fase 6 — a bateria ESTRUTURAL e FUNCIONAL da medição de projeto.
 *
 * Roda dentro da transação que aplicou as migrations, contra organizações
 * DESCARTÁVEIS criadas aqui. A consequência de desenho é a mesma da Fase 5: o
 * caso real não é tocado porque este código não tem acesso a ele, e não porque
 * alguém tomou cuidado.
 *
 * O que NÃO cabe aqui, por precisar de duas conexões simultâneas — corrida de
 * aceite contra rejeição, submissão duplicada, supersessão concorrente — está
 * em `tests/integration/project-measurement-live.test.ts`.
 */

/** Levanta se o SQL NÃO falhar; devolve a mensagem quando falha. */
async function refuses(c, sql, params) {
  await c.query('SAVEPOINT s');
  try {
    await c.query(sql, params);
    await c.query('ROLLBACK TO SAVEPOINT s');
    return null;
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT s');
    return e.message;
  }
}

/** Roda como uma pessoa: identidade na MESMA instrução (pooler em modo transação). */
const asUser = (uid, sql) =>
  `SELECT set_config('request.jwt.claims', json_build_object('sub','${uid}','role','authenticated')::text, true); ${sql}`;

/**
 * Roda SEM identidade — é o sistema, a rotina, a IA.
 *
 * Limpar a reivindicação explicitamente, em vez de confiar que a anterior já
 * saiu, é o que faz o teste provar o que diz: "sem pessoa autenticada" tem de
 * ser um estado ESTABELECIDO, não um resíduo de execução.
 */
const asSystem = (sql) => `SELECT set_config('request.jwt.claims', '', true); ${sql}`;

export async function runPhase6Assertions(c, { must, one }) {
  let ok = true;
  const check = (label, pass, detail) => { must(label, pass, detail); if (!pass) ok = false; };

  /*
    `asUser` produz DUAS instruções, e o driver devolve um array de resultados
    para o protocolo simples. `oneAs` pega a linha do ÚLTIMO resultado — o da
    chamada, não o do `set_config`.
  */
  const oneAs = async (uid, sql) => {
    const res = await c.query(asUser(uid, sql));
    return (Array.isArray(res) ? res[res.length - 1] : res).rows[0];
  };

  // ============================================================
  // ESTRUTURA
  // ============================================================
  console.log('\n=== ESTRUTURA ===');
  const TABLES = ['project_measurements', 'project_measurement_history',
    'project_measurement_evidence', 'project_measurement_requirements',
    'contract_measurement_rule_timeline_mappings', 'project_measurement_readiness_cache'];
  for (const t of TABLES) {
    const r = await one(`SELECT to_regclass('public.${t}') AS r`);
    check(`tabela ${t}`, r.r !== null);
  }

  const FNS = ['project_measurement_valid_transition', 'project_measurement_fingerprint',
    'project_measurement_resolve_source', 'project_measurement_link_evidence',
    'project_measurement_revoke_evidence', 'project_measurement_resolve_requirements',
    'project_measurement_reconcile_requirements', 'project_measurement_dimension_state',
    'project_measurement_readiness', 'project_measurement_recompute_readiness',
    'project_measurement_emit', 'project_measurement_transition',
    'project_measurement_submit', 'project_measurement_accept', 'project_measurement_reject',
    'project_measurement_return', 'project_measurement_cancel', 'project_measurement_supersede',
    'project_measurement_occurrence_key', 'project_measurements_materialize',
    'projects_enqueue_measurement_reconciliation', 'projects_recompute_measurement_readiness',
    'contract_milestone_measured_amount'];
  for (const f of FNS) {
    const r = await one(`SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
                          WHERE ns.nspname='public' AND p.proname=$1`, [f]);
    check(`função ${f}`, r.n > 0);
  }

  check('modelo de leitura canônico existe',
    (await one(`SELECT to_regclass('public.project_measurement_read_model') r`)).r !== null);
  check('visão de mapeamento GOVERNADO existe',
    (await one(`SELECT to_regclass('public.contract_measurement_rule_timeline_governed') r`)).r !== null);

  // RLS em toda tabela nova
  for (const t of TABLES) {
    const r = await one(`SELECT relrowsecurity rls FROM pg_class WHERE oid = 'public.${t}'::regclass`);
    check(`RLS ligada em ${t}`, r.rls === true);
  }

  // O navegador não escreve verdade governada (§60).
  const w = await one(
    `SELECT count(*)::int n FROM information_schema.role_table_grants
      WHERE table_schema='public' AND grantee IN ('anon','authenticated')
        AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
        AND table_name = ANY($1::text[])`, [TABLES]);
  check('nenhuma escrita direta de navegador nas tabelas de medição', w.n === 0, `${w.n} concessões`);

  const trunc = await one(
    `SELECT count(*)::int n FROM information_schema.role_table_grants
      WHERE table_schema='public' AND privilege_type='TRUNCATE' AND grantee IN ('anon','authenticated')`);
  check('TRUNCATE de navegador segue ZERO em todo o schema', trunc.n === 0, String(trunc.n));

  const anonSel = await one(
    `SELECT count(*)::int n FROM information_schema.role_table_grants
      WHERE table_schema='public' AND grantee='anon' AND table_name = ANY($1::text[])`, [TABLES]);
  check('anon não enxerga nada de medição', anonSel.n === 0);

  // ============================================================
  // MÁQUINA DE ESTADOS (tabela verdade, sem executar o produto)
  // ============================================================
  console.log('\n=== MÁQUINA DE ESTADOS ===');
  const t = async (from, to) =>
    (await one(`SELECT project_measurement_valid_transition($1,$2) v`, [from, to])).v;

  check('PLANNED → IN_PREPARATION', await t('PLANNED', 'IN_PREPARATION'));
  check('IN_PREPARATION → READY_FOR_SUBMISSION', await t('IN_PREPARATION', 'READY_FOR_SUBMISSION'));
  check('READY_FOR_SUBMISSION → SUBMITTED', await t('READY_FOR_SUBMISSION', 'SUBMITTED'));
  check('SUBMITTED → ACCEPTED', await t('SUBMITTED', 'ACCEPTED'));
  check('SUBMITTED → REJECTED', await t('SUBMITTED', 'REJECTED'));
  check('SUBMITTED → RETURNED_FOR_CORRECTION', await t('SUBMITTED', 'RETURNED_FOR_CORRECTION'));
  check('RETURNED_FOR_CORRECTION volta para preparação', await t('RETURNED_FOR_CORRECTION', 'IN_PREPARATION'));

  // As recusas são o que importa.
  check('evidência não alcança ACEITE: PLANNED → ACCEPTED recusado', (await t('PLANNED', 'ACCEPTED')) === false);
  check('IN_PREPARATION → ACCEPTED recusado', (await t('IN_PREPARATION', 'ACCEPTED')) === false);
  check('READY_FOR_SUBMISSION → ACCEPTED recusado (§10)', (await t('READY_FOR_SUBMISSION', 'ACCEPTED')) === false);
  check('ACCEPTED → SUBMITTED recusado (sem rollback de aceite, §73)', (await t('ACCEPTED', 'SUBMITTED')) === false);
  check('ACCEPTED → REJECTED recusado', (await t('ACCEPTED', 'REJECTED')) === false);
  check('ACCEPTED → SUPERSEDED é o ÚNICO caminho', await t('ACCEPTED', 'SUPERSEDED'));
  check('REJECTED → ACCEPTED recusado', (await t('REJECTED', 'ACCEPTED')) === false);
  check('CANCELLED é terminal', (await t('CANCELLED', 'IN_PREPARATION')) === false);
  check('SUPERSEDED é terminal', (await t('SUPERSEDED', 'ACCEPTED')) === false);

  // ============================================================
  // CENÁRIO DESCARTÁVEL
  // ============================================================
  console.log('\n=== CENÁRIO DESCARTÁVEL ===');
  const sfx = Math.random().toString(36).slice(2, 10);
  const org = (await one(`INSERT INTO organizations (name, slug) VALUES ('[P6] Org', $1) RETURNING id`, [`p6-${sfx}`])).id;
  const orgB = (await one(`INSERT INTO organizations (name, slug) VALUES ('[P6] Org B', $1) RETURNING id`, [`p6b-${sfx}`])).id;

  const mkUser = async (label, orgId, roleKey) => {
    const uid = (await one(
      `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
       VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated','authenticated',
               $1,'x',now(),now()) RETURNING id`, [`p6.${label}.${sfx}@example.test`])).id;
    await c.query(`INSERT INTO profiles (user_id, organization_id, full_name, status) VALUES ($1,$2,$3,'active')`,
      [uid, orgId, `[P6] ${label}`]);
    if (roleKey) await c.query(
      `INSERT INTO user_roles (user_id, role_id, organization_id)
       SELECT $1, r.id, $2 FROM roles r WHERE r.key=$3 AND r.organization_id IS NULL`, [uid, orgId, roleKey]);
    return uid;
  };

  // `engenharia_pcp` prepara e submete mas NÃO aceita — é a separação que a
  // seed de permissões da 130 estabelece, e ela é provada abaixo.
  const engineer = await mkUser('engineer', org, 'engenharia_pcp');
  const manager  = await mkUser('manager',  org, 'gestor_projetos');
  const admin    = await mkUser('admin',    org, 'owner_admin');
  const outsider = await mkUser('outsider', orgB, 'owner_admin');

  const mkProject = async (orgId, id) => {
    await c.query(`INSERT INTO projects (id, organization_id, project) VALUES ($1,$2,$3)`,
      [id, orgId, JSON.stringify({ name: `[P6] ${id}`, status: 'em_andamento' })]);
    return id;
  };
  const project = await mkProject(org, `p6-proj-${sfx}`);
  const projectB = await mkProject(orgB, `p6-projb-${sfx}`);

  const mkContract = async (orgId, title) => (await one(
    `INSERT INTO contracts (organization_id, title, status, currency, data_class)
     VALUES ($1,$2,'active','BRL','demo') RETURNING id`, [orgId, title])).id;
  const contract = await mkContract(org, '[P6] Contrato');
  const contractB = await mkContract(orgB, '[P6] Contrato B');

  await c.query(`INSERT INTO contract_project_links (organization_id, contract_id, project_id) VALUES ($1,$2,$3)`,
    [org, contract, project]);
  await c.query(`INSERT INTO contract_project_links (organization_id, contract_id, project_id) VALUES ($1,$2,$3)`,
    [orgB, contractB, projectB]);

  const milestone = (await one(
    `INSERT INTO contract_milestones (organization_id, contract_id, project_id, title, milestone_type,
                                      due_date, billing_amount, status)
     VALUES ($1,$2,$3,'[P6] Marco','Medição', current_date + 30, 500000, 'pending') RETURNING id`,
    [org, contract, project])).id;

  const mkRule = async (orgId, contractId, over = {}) => (await one(
    `INSERT INTO contract_measurement_requirements
       (organization_id, contract_id, title, source_reference, effective_from,
        report_required, technical_report_required, evidence_required,
        tests_inspection_required, customer_acceptance_required, required_document_type,
        measurement_basis, accumulation_mode, aggregation_mode, cadence, milestone_id)
     VALUES ($1,$2,$3,'Cláusula 5.1', current_date - 365, $4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id`,
    [orgId, contractId, over.title ?? '[P6] Medição mensal',
     over.report_required ?? true, over.technical_report_required ?? true,
     over.evidence_required ?? true, over.tests_inspection_required ?? false,
     over.customer_acceptance_required ?? true, over.required_document_type ?? null,
     over.measurement_basis ?? 'MONETARY', over.accumulation_mode ?? 'INCREMENTAL',
     over.aggregation_mode ?? 'SUM_INCREMENTAL', over.cadence ?? 'MONTHLY',
     over.milestone_id ?? null])).id;

  const rule = await mkRule(org, contract, { milestone_id: milestone });
  const ruleB = await mkRule(orgB, contractB);

  const mkTimeline = async (orgId, projectId, title) => (await one(
    `INSERT INTO project_timeline_items (organization_id, project_id, title, planned_start, planned_finish, type)
     VALUES ($1,$2,$3, date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date, 'task')
     RETURNING id`, [orgId, projectId, title])).id;
  const item = await mkTimeline(org, project, '[P6] Etapa de campo');
  const itemB = await mkTimeline(orgB, projectB, '[P6] Etapa B');

  check('cenário montado', true, `org=${org.slice(0, 8)} projeto=${project}`);

  // ============================================================
  // INTEGRIDADE DE INQUILINO (§61)
  // ============================================================
  console.log('\n=== INQUILINO E INTEGRIDADE ESTRUTURAL ===');

  const mkMeasurement = async (over = {}) => (await one(
    `INSERT INTO project_measurements
       (organization_id, project_id, contract_id, contract_measurement_rule_id, timeline_item_id,
        milestone_id, occurrence_key, occurrence_state, measurement_period_start, measurement_period_end,
        expected_at, measurement_basis, accumulation_mode, measured_value, currency, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, date_trunc('month', current_date)::date,
             (date_trunc('month', current_date) + interval '1 month - 1 day')::date,
             current_date, $9,$10,$11,$12,$13) RETURNING id`,
    [over.org ?? org, over.project ?? project, over.contract ?? contract, over.rule ?? rule,
     over.item === null ? null : (over.item ?? item), over.milestone === null ? null : (over.milestone ?? milestone),
     over.key ?? `${sfx}-${Math.random().toString(36).slice(2, 8)}`,
     over.occState ?? 'resolved',
     over.basis ?? 'MONETARY', over.accum ?? 'INCREMENTAL',
     over.value === null ? null : (over.value ?? 100000), over.currency === null ? null : (over.currency ?? 'BRL'),
     over.status ?? 'PLANNED'])).id;

  check('regra de OUTRO contrato é recusada',
    (await refuses(c, `INSERT INTO project_measurements
        (organization_id, project_id, contract_id, contract_measurement_rule_id, occurrence_key)
       VALUES ($1,$2,$3,$4,'x')`, [org, project, contract, ruleB])) !== null);

  check('projeto de OUTRO inquilino é recusado',
    (await refuses(c, `INSERT INTO project_measurements
        (organization_id, project_id, contract_id, contract_measurement_rule_id, occurrence_key)
       VALUES ($1,$2,$3,$4,'x')`, [org, projectB, contract, rule])) !== null);

  check('etapa de cronograma de OUTRO projeto é recusada',
    (await refuses(c, `INSERT INTO project_measurements
        (organization_id, project_id, contract_id, contract_measurement_rule_id, timeline_item_id, occurrence_key)
       VALUES ($1,$2,$3,$4,$5,'x')`, [org, project, contract, rule, itemB])) !== null);

  {
    const p2 = await mkProject(org, `p6-unlinked-${sfx}`);
    check('projeto SEM vínculo explícito ao contrato é recusado (§76)',
      (await refuses(c, `INSERT INTO project_measurements
          (organization_id, project_id, contract_id, contract_measurement_rule_id, occurrence_key)
         VALUES ($1,$2,$3,$4,'x')`, [org, p2, contract, rule])) !== null);
  }

  // ---- unicidade da ocorrência (§46) ----
  {
    const key = `dup-${sfx}`;
    await mkMeasurement({ key });
    check('ocorrência determinística NÃO duplica',
      (await refuses(c, `INSERT INTO project_measurements
          (organization_id, project_id, contract_id, contract_measurement_rule_id, occurrence_key)
         VALUES ($1,$2,$3,$4,$5)`, [org, project, contract, rule, key])) !== null);
  }
  {
    // Duas ocorrências NÃO RESOLVIDAS com a mesma chave coexistem: unificar o
    // desconhecido seria afirmar que duas coisas ignoradas são a mesma.
    const key = `unres-${sfx}`;
    await mkMeasurement({ key, occState: 'unresolved' });
    const second = await refuses(c, `INSERT INTO project_measurements
        (organization_id, project_id, contract_id, contract_measurement_rule_id, occurrence_key, occurrence_state)
       VALUES ($1,$2,$3,$4,$5,'unresolved')`, [org, project, contract, rule, key]);
    check('ocorrência não resolvida não é unificada com outra não resolvida', second === null);
  }

  // ============================================================
  // CICLO DE VIDA COMPLETO
  // ============================================================
  console.log('\n=== CICLO DE VIDA ===');
  const m1 = await mkMeasurement({ key: `life-${sfx}` });
  await c.query(`SELECT project_measurement_resolve_requirements($1)`, [m1]);

  {
    const r = await one(`SELECT count(*)::int n FROM project_measurement_requirements WHERE measurement_id=$1`, [m1]);
    check('exigências resolvidas a partir da regra', r.n === 6, `${r.n} exigências`);
    const unknown = await one(
      `SELECT count(*)::int n FROM project_measurement_requirements
        WHERE measurement_id=$1 AND requirement_kind='DOCUMENT' AND satisfaction_state='NOT_APPLICABLE'`, [m1]);
    check('documento não exigido entra como NOT_APPLICABLE', unknown.n === 1);
  }

  {
    const rd = await one(`SELECT project_measurement_readiness($1) r`, [m1]);
    check('prontidão inicial NÃO é READY', rd.r.overall !== 'READY', rd.r.overall);
    check('execução não observada aparece como razão',
      JSON.stringify(rd.r.reasons).includes('EXECUTION_NOT_OBSERVED'));
    check('relatório faltando aparece como razão',
      JSON.stringify(rd.r.reasons).includes('MISSING_REQUIRED_REPORT'));
  }

  // ---- evidência determinística ----
  const file = (await one(
    `INSERT INTO project_files (organization_id, project_id, bucket_id, object_path, file_name, content_type, file_size)
     VALUES ($1,$2,'projects',$3,'relatorio.pdf','application/pdf',100) RETURNING id`,
    [org, project, `p6/${sfx}/relatorio.pdf`])).id;

  const ev1 = (await one(
    `SELECT project_measurement_link_evidence($1,'project_file',$2,'RAW_EVIDENCE','deterministic',NULL,'TECHNICAL_REPORT') id`,
    [m1, file])).id;
  check('evidência determinística vincula', ev1 !== null);

  check('vínculo repetido é IDEMPOTENTE',
    (await one(`SELECT project_measurement_link_evidence($1,'project_file',$2,'RAW_EVIDENCE','deterministic',NULL,'TECHNICAL_REPORT') id`,
      [m1, file])).id === ev1);

  // ---- evidência de outro inquilino / projeto ----
  {
    const fileB = (await one(
      `INSERT INTO project_files (organization_id, project_id, bucket_id, object_path, file_name, content_type, file_size)
       VALUES ($1,$2,'projects',$3,'b.pdf','application/pdf',10) RETURNING id`,
      [orgB, projectB, `p6/${sfx}/b.pdf`])).id;
    const msg = await refuses(c, `SELECT project_measurement_link_evidence($1,'project_file',$2)`, [m1, fileB]);
    check('evidência de OUTRO inquilino é recusada', msg !== null && /CROSS_TENANT_EVIDENCE/.test(msg), msg);
  }
  {
    const p3 = await mkProject(org, `p6-other-${sfx}`);
    const f3 = (await one(
      `INSERT INTO project_files (organization_id, project_id, bucket_id, object_path, file_name, content_type, file_size)
       VALUES ($1,$2,'projects',$3,'o.pdf','application/pdf',10) RETURNING id`,
      [org, p3, `p6/${sfx}/o.pdf`])).id;
    const msg = await refuses(c, `SELECT project_measurement_link_evidence($1,'project_file',$2)`, [m1, f3]);
    check('evidência do PROJETO ERRADO é recusada', msg !== null && /WRONG_PROJECT/.test(msg), msg);
  }

  // ---- ponto: origem sem projeto não é determinística (§79) ----
  {
    const person = (await one(
      `INSERT INTO people (organization_id, full_name, status) VALUES ($1,'[P6] Pessoa','active') RETURNING id`, [org])).id;
    const punch = (await one(
      `INSERT INTO attendance_punches (organization_id, person_id, type, occurred_at, timezone, source, status)
       VALUES ($1,$2,'clock_in', now(), 'America/Sao_Paulo','mobile','accepted') RETURNING id`, [org, person])).id;

    const msg = await refuses(c,
      `SELECT project_measurement_link_evidence($1,'attendance_punch',$2,'RAW_EVIDENCE','deterministic')`, [m1, punch]);
    check('batida de ponto NÃO vira evidência determinística (§79)',
      msg !== null && /NOT_DETERMINISTIC/.test(msg), msg);

    const inferred = (await one(
      `SELECT project_measurement_link_evidence($1,'attendance_punch',$2,'DERIVED_EVIDENCE','system_inferred',0.92,NULL,
         '{"resolver":"execution-matching","reason_codes":["ALLOCATION_WINDOW"]}'::jsonb) id`, [m1, punch])).id;
    check('batida entra como DERIVED com confiança do resolvedor existente', inferred !== null);

    const bad = await refuses(c, `UPDATE project_measurement_evidence
        SET evidence_class='ACCEPTANCE_EVIDENCE' WHERE id=$1`, [inferred]);
    check('evidência inferida NÃO sobe para ACCEPTANCE_EVIDENCE (§21)', bad !== null);

    const bad2 = await refuses(c, `UPDATE project_measurement_evidence
        SET evidence_class='VALIDATED_EVIDENCE' WHERE id=$1`, [inferred]);
    check('evidência inferida NÃO sobe para VALIDATED_EVIDENCE sem humano', bad2 !== null);
  }

  // ---- registro inválido na origem não é evidência ----
  {
    const task = (await one(
      `INSERT INTO tasks (organization_id, creator_user_id, title, status, related_project_id)
       VALUES ($1,$2,'[P6] Tarefa aberta','todo',$3) RETURNING id`, [org, engineer, project])).id;
    const msg = await refuses(c, `SELECT project_measurement_link_evidence($1,'task',$2)`, [m1, task]);
    check('tarefa NÃO concluída não é evidência de execução (§80)',
      msg !== null && /SOURCE_INVALID/.test(msg), msg);
  }

  // ---- exigências satisfeitas ----
  for (const [kind, name] of [['SERVICE_REPORT', 'servico.pdf'], ['EVIDENCE', 'fotos.pdf'], ['CUSTOMER_ACCEPTANCE', 'aceite.pdf']]) {
    const f = (await one(
      `INSERT INTO project_files (organization_id, project_id, bucket_id, object_path, file_name, content_type, file_size)
       VALUES ($1,$2,'projects',$3,$4,'application/pdf',10) RETURNING id`,
      [org, project, `p6/${sfx}/${name}`, name])).id;
    await c.query(`SELECT project_measurement_link_evidence($1,'project_file',$2,'RAW_EVIDENCE','deterministic',NULL,$3)`,
      [m1, f, kind]);
  }

  await c.query(`SELECT project_measurement_recompute_readiness($1)`, [m1]);
  {
    const rd = await one(`SELECT project_measurement_readiness($1) r`, [m1]);
    check('com pacote completo a submissão fica READY', rd.r.dimensions.submission === 'READY',
      `${rd.r.dimensions.submission} / ${JSON.stringify(rd.r.reasons)}`);
    check('o ACEITE continua pendente, e não READY', rd.r.dimensions.acceptance !== 'READY',
      rd.r.dimensions.acceptance);
    check('cache de prontidão gravado com computed_at',
      (await one(`SELECT count(*)::int n FROM project_measurement_readiness_cache
                   WHERE measurement_id=$1 AND computed_at IS NOT NULL`, [m1])).n === 1);
  }

  // ---- transições governadas ----
  await c.query(asUser(engineer, `SELECT project_measurement_prepare('${m1}')`));
  check('PLANNED → IN_PREPARATION por engenharia',
    (await one(`SELECT status FROM project_measurements WHERE id=$1`, [m1])).status === 'IN_PREPARATION');

  await c.query(asUser(engineer, `SELECT project_measurement_mark_ready('${m1}')`));
  await c.query(asUser(engineer, `SELECT project_measurement_submit('${m1}', 'pacote 1')`));
  check('READY → SUBMITTED por engenharia',
    (await one(`SELECT status FROM project_measurements WHERE id=$1`, [m1])).status === 'SUBMITTED');

  check('evento de submissão emitido na MESMA transação',
    (await one(`SELECT count(*)::int n FROM domain_events
                 WHERE aggregate_id=$1 AND event_type='projects.measurement.submitted'`, [m1])).n === 1);

  // ============================================================
  // ACEITE — o que a Fase 6 mais recusa
  // ============================================================
  console.log('\n=== ACEITE ===');

  check('engenharia (quem preparou) NÃO pode aceitar',
    (await refuses(c, asUser(engineer, `SELECT project_measurement_accept('${m1}','internal_reviewer')`))) !== null);

  check('pessoa de OUTRO inquilino não enxerga a medição',
    /MEASUREMENT_NOT_FOUND/.test(
      await refuses(c, asUser(outsider, `SELECT project_measurement_accept('${m1}','internal_reviewer')`)) ?? ''));

  {
    // Sem `auth.uid()` — é o sistema tentando aceitar.
    const msg = await refuses(c, asSystem(`SELECT project_measurement_accept('${m1}','internal_reviewer')`));
    check('SISTEMA não aceita medição (ACCEPTANCE_NEVER_AUTOMATED)',
      msg !== null && /ACCEPTANCE_NEVER_AUTOMATED/.test(msg), msg);
  }
  {
    const msg = await refuses(c, asSystem(`SELECT project_measurement_accept('${m1}','customer_portal')`));
    check('aceite externo SEM proveniência é recusado',
      msg !== null && /ACCEPTANCE_PROVENANCE_REQUIRED/.test(msg), msg);
  }
  {
    const msg = await refuses(c, asUser(manager, `SELECT project_measurement_accept('${m1}', NULL)`));
    check('aceite sem FONTE é recusado', msg !== null && /ACCEPTANCE_SOURCE_REQUIRED/.test(msg), msg);
  }

  // O ator não é escolhido pelo navegador: a RPC não tem parâmetro para isso.
  {
    const sig = await one(
      `SELECT pg_get_function_arguments(p.oid) a FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='project_measurement_accept'`);
    check('a RPC de aceite NÃO recebe "quem aceitou" (§63)', !/accepted_by_user/.test(sig.a), sig.a);
  }

  // ---- aceite legítimo ----
  await c.query(asUser(manager, `SELECT project_measurement_accept('${m1}','internal_reviewer', NULL, 90000, 'BRL')`));
  {
    const m = await one(`SELECT * FROM project_measurements WHERE id=$1`, [m1]);
    check('medição ACEITA', m.status === 'ACCEPTED');
    check('ator do aceite é quem estava autenticado', m.accepted_by_user_id === manager);
    check('valor aceito congelado', Number(m.accepted_value) === 90000);
    check('evento projects.measurement.accepted emitido',
      (await one(`SELECT count(*)::int n FROM domain_events
                   WHERE aggregate_id=$1 AND event_type='projects.measurement.accepted'`, [m1])).n === 1);
  }

  check('aceite repetido é idempotente e não gera segundo fato',
    (await oneAs(manager, `SELECT (project_measurement_accept('${m1}','internal_reviewer'))->>'idempotent' i`)).i === 'true');
  check('continua havendo UM evento de aceite',
    (await one(`SELECT count(*)::int n FROM domain_events
                 WHERE aggregate_id=$1 AND event_type='projects.measurement.accepted'`, [m1])).n === 1);

  // ---- imutabilidade do fato aceito (§41) ----
  console.log('\n=== IMUTABILIDADE ===');
  for (const [col, val] of [['accepted_value', '1'], ['accepted_quantity', '1'], ['quantity', '1'],
                            ['measured_value', '1'], ['measurement_period_start', "'2020-01-01'"],
                            ['occurrence_key', "'outra'"], ['accepted_at', "now() + interval '1 day'"]]) {
    const msg = await refuses(c, `UPDATE project_measurements SET ${col} = ${val} WHERE id = $1`, [m1]);
    check(`fato aceito imutável: ${col}`, msg !== null && /ACCEPTED_IMMUTABLE/.test(msg), msg);
  }
  check('medição aceita não volta a SUBMITTED',
    (await refuses(c, `UPDATE project_measurements SET status='SUBMITTED' WHERE id=$1`, [m1])) !== null);

  check('história de transição não é reescrita',
    (await refuses(c, `UPDATE project_measurement_history SET to_state='X' WHERE measurement_id=$1`, [m1])) !== null);
  /*
    A 110 separou REESCREVER de APAGAR: o apagamento é recusado À APLICAÇÃO e
    liberado ao caminho privilegiado, que é o que mantém a exclusão de um
    inquilino inteiro possível. Provar isso exige assumir o papel do navegador
    — como dono do banco, o DELETE passa POR DESENHO, e um teste que rodasse
    como dono estaria medindo a coisa errada.
  */
  check('história de transição não é apagada pela aplicação',
    (await refuses(c, `SET LOCAL ROLE authenticated;
                       DELETE FROM project_measurement_history WHERE measurement_id='${m1}'`)) !== null);
  check('medição não é apagada pela aplicação',
    (await refuses(c, `SET LOCAL ROLE authenticated;
                       DELETE FROM project_measurements WHERE id='${m1}'`)) !== null);

  check('pacote de medição finalizada não recebe evidência nova',
    /MEASUREMENT_FINALIZED/.test(
      await refuses(c, `SELECT project_measurement_link_evidence($1,'project_file',$2)`, [m1, file]) ?? ''));

  // ---- supersessão (§40, §73) ----
  {
    const res = await oneAs(manager, `SELECT project_measurement_supersede('${m1}','erro de quantidade apurada') r`);
    const newId = res.r.new_measurement_id;
    const old = await one(`SELECT * FROM project_measurements WHERE id=$1`, [m1]);
    const neu = await one(`SELECT * FROM project_measurements WHERE id=$1`, [newId]);
    check('medição antiga fica SUPERSEDED e preserva o aceite', old.status === 'SUPERSEDED' && old.accepted_at !== null);
    check('revisão nova nasce PLANNED', neu.status === 'PLANNED');
    check('revisão nova NÃO herda aceite', neu.accepted_at === null && neu.acceptance_source === null);
    check('revisão nova incrementa a revisão', neu.revision === old.revision + 1);
    check('supersessão sem motivo é recusada',
      (await refuses(c, asUser(manager, `SELECT project_measurement_supersede('${newId}', '')`))) !== null);
  }

  // ---- rejeição × devolução (§39) ----
  console.log('\n=== REJEIÇÃO × DEVOLUÇÃO ===');
  {
    const m2 = await mkMeasurement({ key: `rej-${sfx}`, status: 'SUBMITTED' });
    await c.query(`UPDATE project_measurements SET submitted_at = now() WHERE id=$1`, [m2]);
    check('devolução sem motivo é recusada',
      (await refuses(c, asUser(manager, `SELECT project_measurement_return('${m2}','')`))) !== null);
    await c.query(asUser(manager, `SELECT project_measurement_return('${m2}','faltou o laudo')`));
    check('devolvida vai para RETURNED_FOR_CORRECTION',
      (await one(`SELECT status FROM project_measurements WHERE id=$1`, [m2])).status === 'RETURNED_FOR_CORRECTION');
    check('fato de devolução é DISTINTO do de rejeição',
      (await one(`SELECT count(*)::int n FROM domain_events
                   WHERE aggregate_id=$1 AND event_type='projects.measurement.returned_for_correction'`, [m2])).n === 1
      && (await one(`SELECT count(*)::int n FROM domain_events
                   WHERE aggregate_id=$1 AND event_type='projects.measurement.rejected'`, [m2])).n === 0);

    const m3 = await mkMeasurement({ key: `rej2-${sfx}`, status: 'SUBMITTED' });
    await c.query(`UPDATE project_measurements SET submitted_at = now() WHERE id=$1`, [m3]);
    await c.query(asUser(manager, `SELECT project_measurement_reject('${m3}','fora do escopo contratual')`));
    check('rejeitada é decisão negativa terminal',
      (await one(`SELECT status FROM project_measurements WHERE id=$1`, [m3])).status === 'REJECTED');
    check('rejeitada não vira aceita',
      (await refuses(c, asUser(manager, `SELECT project_measurement_accept('${m3}','internal_reviewer')`))) !== null);
  }

  // ============================================================
  // PRONTIDÃO — todos os estados
  // ============================================================
  console.log('\n=== PRONTIDÃO ===');
  {
    // UNKNOWN por ocorrência não resolvida
    const mu = await mkMeasurement({ key: `unk-${sfx}`, occState: 'unresolved' });
    const rd = await one(`SELECT project_measurement_readiness($1) r`, [mu]);
    check('ocorrência não resolvida ⇒ UNKNOWN', rd.r.overall === 'UNKNOWN', rd.r.overall);
    check('razão OCCURRENCE_UNRESOLVED presente', JSON.stringify(rd.r.reasons).includes('OCCURRENCE_UNRESOLVED'));
  }
  {
    // UNKNOWN por semântica não declarada (§14)
    const mu = await mkMeasurement({ key: `sem-${sfx}`, basis: 'UNKNOWN', accum: 'UNKNOWN', value: null, currency: null });
    const rd = await one(`SELECT project_measurement_readiness($1) r`, [mu]);
    check('semântica desconhecida ⇒ completude UNKNOWN', rd.r.dimensions.measurement_completeness === 'UNKNOWN');
    check('nunca READY sem semântica', rd.r.overall !== 'READY');
  }
  {
    // UNKNOWN por mapeamento de cronograma ausente (§94)
    const mu = await mkMeasurement({ key: `map-${sfx}`, item: null });
    const rd = await one(`SELECT project_measurement_readiness($1) r`, [mu]);
    check('sem mapeamento de cronograma ⇒ submissão UNKNOWN', rd.r.dimensions.submission === 'UNKNOWN');
    check('razão TIMELINE_MAPPING_UNRESOLVED presente',
      JSON.stringify(rd.r.reasons).includes('TIMELINE_MAPPING_UNRESOLVED'));
  }
  {
    // BLOCKED por obrigação que trava faturamento (§32)
    // A definição da Fase 3 exige proveniência estrutural (cláusula, aditivo ou
    // documento) — não aceita uma referência textual solta. A cláusula abaixo é
    // o mínimo que satisfaz `cod_has_provenance` sem inventar conteúdo.
    const clause = (await one(
      `INSERT INTO contract_clauses (organization_id, contract_id, title, review_status)
       VALUES ($1,$2,'[P6] Cláusula 9 — seguros','draft') RETURNING id`, [org, contract])).id;
    const defn = (await one(
      `INSERT INTO contract_obligation_definitions
         (organization_id, contract_id, title, requirement_text, category, responsible_side,
          source_clause_id, activation_kind, due_kind, recurrence_kind, calendar_basis,
          blocks_billing, status)
       VALUES ($1,$2,'[P6] Seguro','Manter apólice vigente','other','contracting_organization',$3,
               'contract_start','unspecified','one_time','unspecified', true, 'active') RETURNING id`,
      [org, contract, clause])).id;
    await c.query(
      `INSERT INTO contract_obligation_instances
         (organization_id, definition_id, contract_id, occurrence_key, state, activation_state)
       VALUES ($1,$2,$3,'once','OPEN','activated')`, [org, defn, contract]);
    const mb = await mkMeasurement({ key: `blk-${sfx}` });
    const rd = await one(`SELECT project_measurement_readiness($1) r`, [mb]);
    check('obrigação que trava faturamento ⇒ BLOCKED', rd.r.overall === 'BLOCKED', rd.r.overall);
    check('razão OBLIGATION_BLOCKING presente', JSON.stringify(rd.r.reasons).includes('OBLIGATION_BLOCKING'));
    check('a projeção de faturamento é BLOCKED, e não um direito negado',
      rd.r.dimensions.billing_prerequisite === 'BLOCKED');
  }
  {
    // NOT_APPLICABLE quando a regra dispensa tudo
    const r2 = await mkRule(org, contract, {
      title: '[P6] Sem exigências', report_required: false, technical_report_required: false,
      evidence_required: false, tests_inspection_required: false, customer_acceptance_required: false,
    });
    const mn = await mkMeasurement({ key: `na-${sfx}`, rule: r2 });
    await c.query(`SELECT project_measurement_resolve_requirements($1)`, [mn]);
    const st = await one(`SELECT project_measurement_dimension_state($1, ARRAY['TECHNICAL_REPORT','SERVICE_REPORT']) s`, [mn]);
    check('regra que dispensa ⇒ dimensão NOT_APPLICABLE', st.s === 'NOT_APPLICABLE', st.s);
  }
  {
    // Sinalizador NULO na regra ⇒ UNKNOWN, e nunca dispensa
    const r3 = (await one(
      `INSERT INTO contract_measurement_requirements
         (organization_id, contract_id, title, source_reference, cadence, measurement_basis, accumulation_mode)
       VALUES ($1,$2,'[P6] Regra silenciosa','Cl. 1','MONTHLY','MONETARY','INCREMENTAL') RETURNING id`,
      [org, contract])).id;
    const mq = await mkMeasurement({ key: `nul-${sfx}`, rule: r3 });
    await c.query(`SELECT project_measurement_resolve_requirements($1)`, [mq]);
    const u = await one(
      `SELECT count(*)::int n FROM project_measurement_requirements
        WHERE measurement_id=$1 AND satisfaction_state='UNKNOWN'`, [mq]);
    /*
      Cinco, e não seis. DOCUMENT não vem de um sinalizador booleano: vem de
      `required_document_type`, e um tipo de documento AUSENTE não é silêncio
      sobre exigir documento — é a ausência de exigência de documento tipado.
      As outras cinco são booleanos nulos, e nulo ali é silêncio de verdade.
    */
    check('silêncio da regra vira UNKNOWN, não dispensa (§30)', u.n === 5, `${u.n} exigências desconhecidas`);
    const rd = await one(`SELECT project_measurement_readiness($1) r`, [mq]);
    check('regra silenciosa nunca fica READY', rd.r.overall !== 'READY', rd.r.overall);
  }

  // ============================================================
  // MAPEAMENTO DE CRONOGRAMA (§17, §94)
  // ============================================================
  console.log('\n=== MAPEAMENTO DE CRONOGRAMA ===');
  {
    const mapId = (await one(
      `INSERT INTO contract_measurement_rule_timeline_mappings
         (organization_id, contract_id, rule_id, project_id, timeline_item_id, mapping_source, review_state, mapped_by)
       VALUES ($1,$2,$3,$4,$5,'explicit','accepted',$6) RETURNING id`,
      [org, contract, rule, project, item, manager])).id;
    check('mapeamento explícito é aceito', mapId !== null);

    check('mapeamento cross-tenant é recusado',
      (await refuses(c, `INSERT INTO contract_measurement_rule_timeline_mappings
          (organization_id, contract_id, rule_id, project_id, timeline_item_id, mapping_source, review_state)
         VALUES ($1,$2,$3,$4,$5,'explicit','accepted')`, [org, contract, rule, projectB, itemB])) !== null);

    check('proposta de sistema NÃO nasce aceita sem revisor (§17)',
      (await refuses(c, `INSERT INTO contract_measurement_rule_timeline_mappings
          (organization_id, contract_id, rule_id, project_id, timeline_item_id, mapping_source, confidence, review_state)
         VALUES ($1,$2,$3,$4,$5,'system_proposed',0.83,'accepted')`,
        [org, contract, rule, project, await mkTimeline(org, project, '[P6] Etapa proposta')])) !== null);

    const proposed = (await one(
      `INSERT INTO contract_measurement_rule_timeline_mappings
         (organization_id, contract_id, rule_id, project_id, timeline_item_id, mapping_source, confidence, review_state)
       VALUES ($1,$2,$3,$4,$5,'system_proposed',0.83,'proposed') RETURNING id`,
      [org, contract, rule, project, await mkTimeline(org, project, '[P6] Etapa sugerida')])).id;
    check('proposta pendente NÃO entra na visão governada',
      (await one(`SELECT count(*)::int n FROM contract_measurement_rule_timeline_governed WHERE id=$1`, [proposed])).n === 0);

    check('mapeamento explícito NÃO carrega confiança inventada',
      (await refuses(c, `UPDATE contract_measurement_rule_timeline_mappings SET confidence=0.9 WHERE id=$1`, [mapId])) !== null);
  }

  // ============================================================
  // MATERIALIZAÇÃO DE CANDIDATOS (§45, §46)
  // ============================================================
  console.log('\n=== CANDIDATOS ===');
  {
    const before = (await one(`SELECT count(*)::int n FROM project_measurements WHERE organization_id=$1`, [org])).n;
    const r1 = await one(`SELECT project_measurements_materialize($1) r`, [org]);
    const after = (await one(`SELECT count(*)::int n FROM project_measurements WHERE organization_id=$1`, [org])).n;
    check('materialização cria candidato determinístico', after > before, JSON.stringify(r1.r));

    const r2 = await one(`SELECT project_measurements_materialize($1) r`, [org]);
    check('segunda execução NÃO duplica (§46)', r2.r.created === 0, JSON.stringify(r2.r));

    check('nenhum candidato nasce submetido ou aceito',
      (await one(`SELECT count(*)::int n FROM project_measurements
                   WHERE organization_id=$1 AND origin='candidate_materialization'
                     AND status <> 'PLANNED'`, [org])).n === 0);

    // Cadência desconhecida não vira ocorrência.
    check('cadência UNKNOWN não gera chave de ocorrência',
      (await one(`SELECT project_measurement_occurrence_key('UNKNOWN', current_date) k`)).k === null);
    check('cadência ON_EVENT não gera chave de ocorrência',
      (await one(`SELECT project_measurement_occurrence_key('ON_EVENT', current_date) k`)).k === null);
    check('cadência mensal gera chave estável',
      (await one(`SELECT project_measurement_occurrence_key('MONTHLY','2026-03-15') k`)).k === '2026-03');

    check('horizonte fora do intervalo é recusado',
      (await refuses(c, `SELECT project_measurements_materialize($1, current_date, 5000)`, [org])) !== null);
    check('materialização sem inquilino é recusada',
      (await refuses(c, `SELECT project_measurements_materialize(NULL)`)) !== null);
    check('limite nulo no recomputo é recusado (lição da 124)',
      (await refuses(c, `SELECT projects_recompute_measurement_readiness($1, NULL, NULL)`, [org])) !== null);
  }

  // ============================================================
  // PRECEDÊNCIA DO VALOR MEDIDO — o invariante que bloqueia merge
  // ============================================================
  console.log('\n=== PRECEDÊNCIA DO VALOR MEDIDO ===');
  {
    // 3) nem canônico nem legado, MAS com billing_amount ⇒ UNKNOWN
    const r = await one(`SELECT * FROM contract_milestone_measured_amount($1,$2)`, [org, milestone]);
    check('sem medição e sem legado ⇒ UNKNOWN', r.source === 'UNKNOWN' && r.amount === null, JSON.stringify(r));
    check('billing_amount existe e NÃO foi usado', r.detail.billing_amount_present === true);

    // 2) legado
    await c.query(`UPDATE contract_milestones SET measured_amount = 455000 WHERE id=$1`, [milestone]);
    const r2 = await one(`SELECT * FROM contract_milestone_measured_amount($1,$2)`, [org, milestone]);
    check('com measured_amount legado ⇒ legacy_measured_amount',
      r2.source === 'legacy_measured_amount' && Number(r2.amount) === 455000, JSON.stringify(r2));
    check('o legado NÃO é o billing_amount', Number(r2.amount) !== 500000);

    // 1) canônico aceito ganha do legado
    const mc = await mkMeasurement({ key: `amt-${sfx}`, status: 'SUBMITTED', value: 300000 });
    await c.query(`UPDATE project_measurements SET submitted_at=now() WHERE id=$1`, [mc]);
    await c.query(asUser(manager, `SELECT project_measurement_accept('${mc}','internal_reviewer', NULL, 300000,'BRL')`));
    const r3 = await one(`SELECT * FROM contract_milestone_measured_amount($1,$2)`, [org, milestone]);
    check('medição canônica aceita tem PRECEDÊNCIA sobre o legado',
      r3.source === 'canonical_accepted' && Number(r3.amount) === 300000, JSON.stringify(r3));

    // agregação desconhecida ⇒ UNKNOWN, e não uma soma às cegas (§71)
    const rUnk = await mkRule(org, contract, {
      title: '[P6] Agregação desconhecida', aggregation_mode: 'UNKNOWN', milestone_id: milestone });
    const mu2 = await mkMeasurement({ key: `agg-${sfx}`, rule: rUnk, status: 'SUBMITTED', value: 1000 });
    await c.query(`UPDATE project_measurements SET submitted_at=now() WHERE id=$1`, [mu2]);
    await c.query(asUser(manager, `SELECT project_measurement_accept('${mu2}','internal_reviewer', NULL, 1000,'BRL')`));
    const r4 = await one(`SELECT * FROM contract_milestone_measured_amount($1,$2)`, [org, milestone]);
    check('semântica de agregação mista/desconhecida ⇒ UNKNOWN, sem somar às cegas (§71)',
      r4.source === 'UNKNOWN' && r4.detail.reason === 'AGGREGATION_SEMANTICS_UNKNOWN', JSON.stringify(r4));

    // O texto da função não menciona billing_amount como fonte de valor.
    const src = await one(
      `SELECT pg_get_functiondef(p.oid) d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='contract_milestone_measured_amount'`);
    const usesBilling = /(COALESCE|:=|RETURN QUERY SELECT)[^;]*ms\.billing_amount(?!\s+IS\s+NOT\s+NULL)/.test(src.d);
    check('billing_amount NUNCA é fonte de valor medido (§12, §68)', !usesBilling);
  }

  // ============================================================
  // EVENTOS TRANSACIONAIS (§43)
  // ============================================================
  console.log('\n=== EVENTOS ===');
  {
    const types = (await one(
      `SELECT array_agg(DISTINCT event_type ORDER BY event_type) a FROM domain_events
        WHERE organization_id=$1 AND aggregate_type='project_measurement'`, [org])).a ?? [];
    check('vocabulário de medição emitido', types.length > 0, types.join(', '));
    check('todo evento de medição pertence ao inquilino do cenário',
      (await one(`SELECT count(*)::int n FROM domain_events d
                   JOIN project_measurements m ON m.id = d.aggregate_id
                  WHERE d.aggregate_type='project_measurement' AND d.organization_id <> m.organization_id`)).n === 0);

    // Transição que falha não deixa evento: o SAVEPOINT desfaz os dois juntos.
    const mfail = await mkMeasurement({ key: `atom-${sfx}` });
    const evBefore = (await one(`SELECT count(*)::int n FROM domain_events WHERE aggregate_id=$1`, [mfail])).n;
    await refuses(c, asUser(engineer, `SELECT project_measurement_submit('${mfail}')`));
    const evAfter = (await one(`SELECT count(*)::int n FROM domain_events WHERE aggregate_id=$1`, [mfail])).n;
    check('transição recusada NÃO deixa evento órfão', evBefore === evAfter, `${evBefore} → ${evAfter}`);
    check('e o estado não mudou',
      (await one(`SELECT status FROM project_measurements WHERE id=$1`, [mfail])).status === 'PLANNED');
  }

  // ============================================================
  // MOTOR DE APROVAÇÃO — mecanismo sem regra inventada (§33, §100)
  // ============================================================
  console.log('\n=== MOTOR DE APROVAÇÃO ===');
  {
    const m = await mkMeasurement({ key: `apr-${sfx}` });
    const r = await one(`SELECT * FROM approval_subject_resolve($1,'project_measurement',$2)`, [org, m]);
    check('o motor sabe LER uma medição', r.supported === true && r.found === true);
    check('a impressão digital é de conteúdo real', typeof r.fingerprint === 'string' && r.fingerprint.length === 64);

    const fp1 = r.fingerprint;
    await c.query(`UPDATE project_measurements SET measured_value = 999 WHERE id=$1`, [m]);
    const fp2 = (await one(`SELECT project_measurement_fingerprint($1) f`, [m])).f;
    check('mudança MATERIAL invalida a impressão antiga (§64)', fp1 !== fp2);

    await c.query(`UPDATE project_measurements SET acceptance_note = 'nota irrelevante' WHERE id=$1`, [m]);
    check('mudança IRRELEVANTE não invalida a aprovação',
      (await one(`SELECT project_measurement_fingerprint($1) f`, [m])).f === fp2);

    check('NENHUM corte de medição foi ligado (§33)',
      (await one(`SELECT count(*)::int n FROM approval_engine_cutover WHERE subject_type='project_measurement'`)).n === 0);
    check('NENHUMA política de aceite foi inventada (§100)',
      (await one(`SELECT count(*)::int n FROM approval_policy_versions WHERE subject_type='project_measurement'`)).n === 0);
  }

  // ============================================================
  // FRONTEIRA DA FASE 7 — nada de Financeiro/Fiscal
  // ============================================================
  console.log('\n=== FRONTEIRA FASE 7 ===');
  {
    /*
      A varredura é sobre TODA tabela fiscal/financeira que exista, e não sobre
      um nome adivinhado: um teste que consultasse uma tabela inexistente
      passaria por não encontrar nada, que é o pior jeito de passar.
    */
    const fiscalTables = (await c.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_type='BASE TABLE'
          AND (table_name LIKE 'fiscal%' OR table_name LIKE 'finance%')`)).rows.map((r) => r.table_name);
    let fiscalRows = 0;
    for (const tb of fiscalTables) {
      const has = await one(`SELECT count(*)::int n FROM information_schema.columns
                              WHERE table_schema='public' AND table_name=$1 AND column_name='organization_id'`, [tb]);
      if (has.n === 0) continue;
      fiscalRows += (await one(`SELECT count(*)::int n FROM public.${tb} WHERE organization_id = $1`, [org])).n;
    }
    check('nenhuma linha Fiscal/Financeira criada pelo cenário de medição',
      fiscalRows === 0, `${fiscalTables.length} tabelas varridas, ${fiscalRows} linhas`);

    // Nenhuma função da Fase 6 escreve em tabela de Financeiro ou Fiscal.
    const leak = await one(
      `SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
        WHERE ns.nspname='public' AND p.proname LIKE 'project_measurement%'
          AND (pg_get_functiondef(p.oid) ~* 'INSERT INTO public\\.(fiscal_|finance_|ar_)'
            OR pg_get_functiondef(p.oid) ~* 'UPDATE public\\.(fiscal_|finance_|ar_)')`);
    check('nenhuma função de medição escreve Fiscal/Financeiro (§105)', leak.n === 0);

    const billingLeak = await one(
      `SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
        WHERE ns.nspname='public' AND p.proname LIKE 'project_measurement%'
          AND pg_get_functiondef(p.oid) ~ 'billing_amount'`);
    check('nenhuma função de medição sequer lê billing_amount', billingLeak.n === 0);
  }

  // ============================================================
  // ISOLAMENTO DE INQUILINO NA LEITURA
  // ============================================================
  console.log('\n=== ISOLAMENTO ===');
  {
    const rd = await oneAs(outsider, `SELECT project_measurement_readiness('${m1}') r`);
    check('prontidão de outro inquilino não vaza',
      rd.r.overall === 'UNKNOWN' && JSON.stringify(rd.r.reasons).includes('MEASUREMENT_NOT_FOUND'));

    const amt = await oneAs(outsider, `SELECT * FROM contract_milestone_measured_amount('${org}','${milestone}')`);
    check('valor medido de outro inquilino não vaza', amt.source === 'UNKNOWN' && amt.amount === null);
  }

  // ============================================================
  // LEGADO PRESERVADO (§67, §70)
  // ============================================================
  console.log('\n=== LEGADO ===');
  {
    check('contract_milestones.measured_amount continua existindo',
      (await one(`SELECT count(*)::int n FROM information_schema.columns
                   WHERE table_name='contract_milestones' AND column_name='measured_amount'`)).n === 1);
    check('contract_milestones.billing_amount continua existindo (não é destruído, só não é medição)',
      (await one(`SELECT count(*)::int n FROM information_schema.columns
                   WHERE table_name='contract_milestones' AND column_name='billing_amount'`)).n === 1);
    check('nenhum evento histórico de aceite foi fabricado para marco legado',
      (await one(`SELECT count(*)::int n FROM domain_events d
                  WHERE d.event_type='projects.measurement.accepted'
                    AND NOT EXISTS (SELECT 1 FROM project_measurements m
                                     WHERE m.id = d.aggregate_id AND m.status IN ('ACCEPTED','SUPERSEDED'))`)).n === 0);
  }

  return ok;
}
