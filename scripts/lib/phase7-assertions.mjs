/**
 * Fase 7 — a bateria ESTRUTURAL e FUNCIONAL da cadeia contrato-a-caixa.
 *
 * Roda dentro da transação que aplicou as migrations, contra organizações
 * DESCARTÁVEIS criadas aqui. A consequência de desenho é a mesma das fases 5 e
 * 6: o caso real não é tocado porque este código não tem acesso a ele, e não
 * porque alguém tomou cuidado.
 *
 * O que NÃO cabe aqui, por precisar de duas conexões simultâneas — duas
 * liberações em corrida, duas liquidações disputando o mesmo saldo, criação
 * concorrente de Contas a Receber — está em
 * `tests/integration/contracts-phase7-live.test.ts`.
 */

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

/*
  ─── Por que `SET LOCAL ROLE authenticated`, e não só a reivindicação JWT ───

  O runner conecta como `postgres`, que tem BYPASSRLS. Trocar apenas
  `request.jwt.claims` faria `auth.uid()` responder certo e deixaria RLS,
  GRANTs e os gatilhos de fronteira de navegador INTEIRAMENTE de fora — as
  provas de isolamento de inquilino passariam sem exercitar nada, que é o pior
  resultado possível para um portão de segurança.

  Com a troca de PAPEL, `current_user` passa a ser `authenticated` de verdade:
  a RLS decide as linhas, a ausência de GRANT decide as tabelas, e os gatilhos
  que perguntam `current_user IN ('authenticated','anon')` disparam. As funções
  SECURITY DEFINER continuam rodando como dono, que é a fronteira desenhada.

  `RESET ROLE` devolve o papel privilegiado para o preparo seguinte. Num
  caminho que falha, o `ROLLBACK TO SAVEPOINT` do `refuses` desfaz o
  `SET LOCAL` junto — o papel não vaza para a asserção seguinte.
*/
const asUser = (uid, sql) =>
  `SET LOCAL ROLE authenticated;`
  + ` SELECT set_config('request.jwt.claims', json_build_object('sub','${uid}','role','authenticated')::text, true);`
  + ` ${sql}; RESET ROLE;`;

/** Sem pessoa autenticada — é o sistema, a rotina, a IA. Papel privilegiado. */
const asSystem = (sql) => `SELECT set_config('request.jwt.claims', '', true); ${sql}`;

export async function runPhase7Assertions(c, { must, one }) {
  let ok = true;
  const check = (label, pass, detail) => { must(label, pass, detail); if (!pass) ok = false; };
  // O ÚLTIMO resultado é o `RESET ROLE`; o penúltimo é a chamada de verdade.
  const oneAs = async (uid, sql) => {
    const res = await c.query(asUser(uid, sql));
    const list = Array.isArray(res) ? res : [res];
    return list[list.length - 2].rows[0];
  };
  const oneSys = async (sql) => {
    const res = await c.query(asSystem(sql));
    return (Array.isArray(res) ? res[res.length - 1] : res).rows[0];
  };

  // ============================================================
  // ESTRUTURA
  // ============================================================
  console.log('\n=== ESTRUTURA ===');
  const TABLES = [
    'contract_billing_entitlement_rules', 'contract_billing_event_history',
    'contract_billing_adjustments', 'contract_billing_fiscal_requests',
    'contract_billing_fiscal_allocations', 'finance_receivable_basis_policies',
    'finance_posting_rules', 'finance_receivables', 'finance_receivable_installments',
    'finance_payment_sources', 'finance_settlements', 'finance_reconciliations',
    'finance_reconciliation_candidates'];
  for (const t of TABLES) {
    check(`tabela ${t}`, (await one(`SELECT to_regclass('public.${t}') AS r`)).r !== null);
  }
  for (const v of ['finance_receivable_balances', 'contract_to_cash_read_model', 'contract_to_cash_health']) {
    check(`visão ${v}`, (await one(
      `SELECT count(*)::int n FROM pg_views WHERE schemaname='public' AND viewname='${v}'`)).n === 1);
  }
  const FNS = ['contract_billing_resolve_amount', 'contract_billing_eligibility_resolve',
    'contract_billing_recompute_eligibility', 'contract_billing_release',
    'contract_billing_cancel', 'contract_billing_supersede',
    'contract_billing_apply_measurement_accepted', 'contract_billing_apply_approval',
    'contract_billing_fingerprint', 'contract_billing_fiscal_readiness',
    'contract_billing_open_fiscal_request', 'contract_billing_link_fiscal_document',
    'finance_receivable_create_from_fiscal_document', 'finance_settlement_record',
    'finance_settlement_reverse', 'finance_payment_source_import',
    'finance_reconciliation_record', 'finance_reconciliation_reverse',
    'finance_ledger_post_receivable', 'finance_receivable_reverse',
    'finance_apply_fiscal_cancellation'];
  for (const f of FNS) {
    check(`função ${f}`, (await one(
      `SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
        WHERE ns.nspname='public' AND p.proname='${f}'`)).n >= 1);
  }

  // ---- endurecimento de inquilino das Finanças (§7, §105) ----
  console.log('\n=== ENDURECIMENTO DE INQUILINO DAS FINANÇAS ===');
  for (const t of ['apar_title', 'ledger_entry', 'period_close', 'finance_audit_log']) {
    check(`${t} tem organization_id`, (await one(
      `SELECT count(*)::int n FROM information_schema.columns
        WHERE table_schema='public' AND table_name='${t}' AND column_name='organization_id'
          AND is_nullable='NO'`)).n === 1);
  }
  check('fechamento de período deixou de ser global',
    (await one(`SELECT count(*)::int n FROM pg_constraint
                 WHERE conrelid='public.period_close'::regclass AND contype='u'
                   AND pg_get_constraintdef(oid) = 'UNIQUE (organization_id, period_key)'`)).n === 1);
  check('nenhuma política de Finanças ficou sem recorte de organização',
    (await one(`SELECT count(*)::int n FROM pg_policies
                 WHERE schemaname='public'
                   AND tablename IN ('apar_title','ledger_entry','period_close','finance_audit_log',
                                     'finance_receivables','finance_settlements','finance_reconciliations',
                                     'finance_receivable_installments','finance_payment_sources')
                   AND COALESCE(qual,'') || COALESCE(with_check,'') NOT LIKE '%current_user_organization_id%'`)).n === 0);

  // ---- o navegador não escreve história financeira (§69, §118) ----
  console.log('\n=== FRONTEIRA DE ESCRITA DO NAVEGADOR ===');
  const WRITE_FORBIDDEN = ['finance_receivables', 'finance_receivable_installments',
    'finance_settlements', 'finance_reconciliations', 'finance_reconciliation_candidates',
    'finance_payment_sources', 'contract_billing_fiscal_requests',
    'contract_billing_fiscal_allocations', 'contract_billing_event_history',
    'contract_billing_adjustments'];
  check('nenhuma escrita direta de navegador nas tabelas financeiras da fase',
    (await one(`SELECT count(*)::int n FROM information_schema.role_table_grants
                 WHERE table_schema='public' AND grantee IN ('anon','authenticated')
                   AND privilege_type IN ('INSERT','UPDATE','DELETE')
                   AND table_name = ANY($1)`, [WRITE_FORBIDDEN])).n === 0);
  check('TRUNCATE de navegador continua ZERO',
    (await one(`SELECT count(*)::int n FROM information_schema.role_table_grants
                 WHERE table_schema='public' AND privilege_type='TRUNCATE'
                   AND grantee IN ('anon','authenticated')`)).n === 0);

  // ---- as 5 linhas legadas ficaram classificadas, não reescritas (§125, §126) ----
  console.log('\n=== LEGADO ===');
  const legacy = await one(
    `SELECT count(*)::int total,
            count(*) FILTER (WHERE legacy_row)::int marcadas,
            count(*) FILTER (WHERE amount_source='LEGACY_UNKNOWN')::int sem_procedencia,
            count(*) FILTER (WHERE status IN ('pendente','pago'))::int status_intacto
       FROM contract_billing_events WHERE legacy_row`);
  check('linhas de faturamento anteriores à Fase 7 marcadas como legado',
    legacy.total === legacy.marcadas && legacy.total === legacy.sem_procedencia, JSON.stringify(legacy));
  check('status histórico em português NÃO foi reclassificado (§126)',
    legacy.status_intacto === legacy.total, `${legacy.status_intacto}/${legacy.total}`);

  // ============================================================
  // MUNDO DESCARTÁVEL
  // ============================================================
  console.log('\n=== MUNDO DESCARTÁVEL ===');
  const sfx = Math.random().toString(36).slice(2, 10);
  const org  = (await one(`INSERT INTO organizations (name, slug) VALUES ('[P7] Org', $1) RETURNING id`, [`p7-${sfx}`])).id;
  const orgB = (await one(`INSERT INTO organizations (name, slug) VALUES ('[P7] Org B', $1) RETURNING id`, [`p7b-${sfx}`])).id;

  const mkUser = async (label, orgId, roleKey) => {
    const uid = (await one(
      `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
       VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
               $1,'x',now(),now()) RETURNING id`, [`p7.${label}.${sfx}@example.test`])).id;
    await c.query(`INSERT INTO profiles (user_id, organization_id, full_name, status) VALUES ($1,$2,$3,'active')`,
      [uid, orgId, `[P7] ${label}`]);
    if (roleKey) await c.query(
      `INSERT INTO user_roles (user_id, role_id, organization_id)
       SELECT $1, r.id, $2 FROM roles r WHERE r.key=$3 AND r.organization_id IS NULL`, [uid, orgId, roleKey]);
    return uid;
  };
  // `engenharia_pcp` mede e submete; NÃO libera faturamento. É a separação que
  // a seed da 136 estabelece, e ela é provada logo abaixo.
  const engineer = await mkUser('engineer', org, 'engenharia_pcp');
  const commercial = await mkUser('commercial', org, 'juridico_contratos');
  const finance = await mkUser('finance', org, 'financeiro');
  const admin = await mkUser('admin', org, 'owner_admin');
  const outsider = await mkUser('outsider', orgB, 'owner_admin');

  await c.query(`INSERT INTO projects (id, organization_id, project) VALUES ($1,$2,$3)`,
    [`p7-proj-${sfx}`, org, JSON.stringify({ name: '[P7] Projeto', status: 'em_andamento' })]);
  const project = `p7-proj-${sfx}`;

  const party = (await one(
    `INSERT INTO parties (organization_id, kind, legal_name, document_type, document_number)
     VALUES ($1,'organization','[P7] Cliente','cnpj','11222333000181') RETURNING id`, [org])).id;
  const partyB = (await one(
    `INSERT INTO parties (organization_id, kind, legal_name, document_type, document_number)
     VALUES ($1,'organization','[P7] Cliente B','cnpj','11222333000262') RETURNING id`, [orgB])).id;

  const contract = (await one(
    `INSERT INTO contracts (organization_id, title, status, currency, data_class, counterparty_party_id, project_id)
     VALUES ($1,'[P7] Contrato','active','BRL','demo',$2,$3) RETURNING id`, [org, party, project])).id;
  const contractB = (await one(
    `INSERT INTO contracts (organization_id, title, status, currency, data_class, counterparty_party_id)
     VALUES ($1,'[P7] Contrato B','active','BRL','demo',$2) RETURNING id`, [orgB, partyB])).id;

  // A Fase 6 exige vínculo Projeto↔Contrato ESTRUTURAL para existir medição.
  await c.query(
    `INSERT INTO contract_project_links (organization_id, contract_id, project_id) VALUES ($1,$2,$3)`,
    [org, contract, project]);

  const milestone = (await one(
    `INSERT INTO contract_milestones (organization_id, contract_id, project_id, title, due_date,
                                      billing_amount, status)
     VALUES ($1,$2,$3,'[P7] Marco', current_date + 30, 480000, 'pending') RETURNING id`,
    [org, contract, project])).id;

  // ============================================================
  // §11/§12/§108 — PROCEDÊNCIA DO VALOR
  // ============================================================
  console.log('\n=== PROCEDÊNCIA DO VALOR ===');
  let src = await one(
    `SELECT * FROM contract_billing_resolve_amount($1,$2,$3,NULL,NULL)`, [org, contract, milestone]);
  check('marco só com billing_amount NÃO produz valor', src.amount === null && src.amount_source === 'UNKNOWN',
    `${src.amount_source} / ${src.amount}`);
  check('previsão presente é DECLARADA como ignorada, não usada',
    src.detail.billing_amount_present_and_ignored === true, JSON.stringify(src.detail));

  await c.query(`UPDATE contract_milestones SET measured_amount = 455000 WHERE id=$1`, [milestone]);
  src = await one(`SELECT * FROM contract_billing_resolve_amount($1,$2,$3,NULL,NULL)`, [org, contract, milestone]);
  check('measured_amount legado produz LEGACY_MEASURED_AMOUNT',
    src.amount_source === 'LEGACY_MEASURED_AMOUNT' && Number(src.amount) === 455000,
    `${src.amount_source} / ${src.amount}`);
  check('nunca 480000: billing_amount jamais vira valor medido', Number(src.amount) !== 480000);

  // ---- direito contratual FIXO exige regra com origem contratual (§11) ----
  const noProvenance = await refuses(c,
    `INSERT INTO contract_billing_entitlement_rules (organization_id, contract_id, fixed_amount, currency)
     VALUES ($1,$2,100000,'BRL')`, [org, contract]);
  check('regra de direito fixo SEM origem contratual é recusada', noProvenance !== null,
    (noProvenance || '').slice(0, 60));

  // ============================================================
  // §21/§22 — PONTE DA FASE 6: MEDIÇÃO ACEITA VIRA CANDIDATO
  // ============================================================
  console.log('\n=== MEDIÇÃO ACEITA → CANDIDATO ===');
  /*
    A regra de medição é obrigatória em `project_measurements` desde a Fase 6, e
    o modo de AGREGAÇÃO dela é o que decide como várias medições aceitas somam
    num marco. `SUM_INCREMENTAL` é declarado aqui porque o cenário tem uma só —
    deixá-lo UNKNOWN faria a precedência devolver UNKNOWN com razão, que é
    correto e não é o que este trecho quer exercitar.
  */
  const rule = (await one(
    `INSERT INTO contract_measurement_requirements
       (organization_id, contract_id, title, source_reference, effect, milestone_id,
        measurement_basis, measurement_currency, accumulation_mode, aggregation_mode, cadence)
     VALUES ($1,$2,'[P7] Regra de medição','Cláusula 4','added',$3,
             'MONETARY','BRL','INCREMENTAL','SUM_INCREMENTAL','MONTHLY') RETURNING id`,
    [org, contract, milestone])).id;

  const measurement = (await one(
    `INSERT INTO project_measurements
       (organization_id, project_id, contract_id, contract_measurement_rule_id, milestone_id,
        occurrence_key, occurrence_state, measurement_basis, accumulation_mode, quantity,
        measured_value, currency, status, accepted_at, acceptance_source, accepted_quantity,
        accepted_value, accepted_currency, accepted_external_ref, origin)
     VALUES ($1,$2,$3,$4,$5,'2026-01','resolved','MONETARY','INCREMENTAL',1,455000,'BRL','ACCEPTED',
             now(),'signed_bulletin',1,455000,'BRL','BOL-1','manual') RETURNING id`,
    [org, project, contract, rule, milestone])).id;

  const accEvent = (await one(
    `SELECT emit_domain_event($1::uuid,'projects.measurement.accepted',1,'project_measurement',$2::uuid,
              'p7-accept:'||$2::uuid::text,'{}'::jsonb) AS id`, [org, measurement])).id;

  let bridge = (await one(`SELECT contract_billing_apply_measurement_accepted($1) AS r`, [accEvent])).r;
  check('medição aceita cria UM candidato', bridge.created === true, JSON.stringify(bridge));
  const billingEvent = bridge.billing_event_id;
  check('candidato NÃO nasce liberado (§14, §21)', bridge.released === false);

  bridge = (await one(`SELECT contract_billing_apply_measurement_accepted($1) AS r`, [accEvent])).r;
  check('reentrega do MESMO aceite não cria segundo candidato (§22)',
    bridge.created === false && bridge.idempotent === true, JSON.stringify(bridge));
  check('exatamente um direito vivo para a medição',
    (await one(`SELECT count(*)::int n FROM contract_billing_events
                 WHERE organization_id=$1 AND source_measurement_id=$2
                   AND release_state NOT IN ('CANCELLED','SUPERSEDED')`, [org, measurement])).n === 1);

  const ev = await one(`SELECT * FROM contract_billing_events WHERE id=$1`, [billingEvent]);
  check('valor do candidato vem da medição ACEITA, com procedência',
    ev.amount_source === 'ACCEPTED_MEASUREMENT' && Number(ev.amount) === 455000,
    `${ev.amount_source} / ${ev.amount}`);
  check('moeda preservada (§78)', ev.currency === 'BRL');

  // ============================================================
  // §15/§16/§107 — ELEGIBILIDADE
  // ============================================================
  console.log('\n=== ELEGIBILIDADE ===');
  let elig = (await one(`SELECT contract_billing_eligibility_resolve($1) AS r`, [billingEvent])).r;
  check('elegibilidade devolve MOTIVOS legíveis por máquina, não booleano',
    Array.isArray(elig.reasons), JSON.stringify(elig.state));
  check('com medição aceita e contraparte canônica, o direito é ELEGÍVEL',
    elig.state === 'ELIGIBLE', `${elig.state} ${JSON.stringify(elig.reasons)}`);
  check('perfil fiscal ausente é motivo INFORMATIVO, não bloqueio de direito',
    elig.reasons.some((r) => r.code === 'FISCAL_PROFILE_INCOMPLETE' && r.blocking === false),
    JSON.stringify(elig.reasons.map((r) => `${r.code}:${r.blocking}`)));

  // ---- obrigação que bloqueia faturamento (§16) ----
  const contractDoc = (await one(
    `INSERT INTO contract_documents (organization_id, contract_id, title, file_path, document_type)
     VALUES ($1,$2,'[P7] Contrato assinado','p7/contrato.pdf','contract') RETURNING id`,
    [org, contract])).id;
  const oblDef = (await one(
    `INSERT INTO contract_obligation_definitions
       (organization_id, contract_id, title, requirement_text, category, responsible_side,
        source_document_id, source_excerpt, activation_kind, due_kind, blocks_billing,
        status, change_effect)
     VALUES ($1,$2,'[P7] ART obrigatória','ART','compliance','counterparty',$3,'Cláusula 5',
             'contract_start','unspecified',true,'active','added') RETURNING id`,
    [org, contract, contractDoc])).id;
  await c.query(
    `INSERT INTO contract_obligation_instances
       (organization_id, definition_id, contract_id, occurrence_key, sequence, activation_state,
        state, due_date, due_confidence)
     VALUES ($1,$2,$3,'2026-01',1,'activated','OPEN', current_date - 5, 'known')`,
    [org, oblDef, contract]);
  elig = (await one(`SELECT contract_billing_eligibility_resolve($1) AS r`, [billingEvent])).r;
  check('obrigação com blocks_billing aberta BLOQUEIA a elegibilidade',
    elig.state !== 'ELIGIBLE' && elig.reasons.some((r) => r.code === 'OBLIGATION_BLOCKING'),
    `${elig.state}`);

  // ---- liberar bloqueado é recusado (§17) ----
  await c.query(`SELECT contract_billing_recompute_eligibility($1)`, [billingEvent]);
  const blockedRelease = await refuses(c, asUser(commercial, `SELECT contract_billing_release('${billingEvent}', 'tentativa')`));
  check('faturamento bloqueado NÃO libera', blockedRelease !== null, (blockedRelease || '').slice(0, 70));

  await c.query(`UPDATE contract_obligation_instances
                    SET state='SATISFIED', satisfied_at=now(), satisfaction_basis='explicit_completion'
                  WHERE organization_id=$1 AND definition_id=$2`, [org, oblDef]);
  const rec = (await one(`SELECT contract_billing_recompute_eligibility($1) AS r`, [billingEvent])).r;
  check('obrigação satisfeita devolve a elegibilidade', rec.state === 'ELIGIBLE', rec.state);

  // ---- elegível NÃO é liberado (§14) ----
  const stateNow = await one(`SELECT release_state FROM contract_billing_events WHERE id=$1`, [billingEvent]);
  check('ELEGÍVEL e LIBERADO são estados distintos (§14)', stateNow.release_state === 'ELIGIBLE',
    stateNow.release_state);

  // ============================================================
  // §17/§18/§70/§98 — LIBERAÇÃO
  // ============================================================
  console.log('\n=== LIBERAÇÃO ===');
  const sysRelease = await refuses(c, asSystem(`SELECT contract_billing_release('${billingEvent}', 'sistema')`));
  check('SEM pessoa autenticada não há liberação (§17, §98)', sysRelease !== null,
    (sysRelease || '').slice(0, 70));
  const engRelease = await refuses(c, asUser(engineer, `SELECT contract_billing_release('${billingEvent}', 'eng')`));
  check('quem MEDE não libera cobrança', engRelease !== null, (engRelease || '').slice(0, 60));
  const outRelease = await refuses(c, asUser(outsider, `SELECT contract_billing_release('${billingEvent}', 'fora')`));
  check('outro inquilino não libera, e a mensagem não confirma existência',
    outRelease !== null && /inexistente/i.test(outRelease || ''), (outRelease || '').slice(0, 60));

  const released = (await oneAs(commercial, `SELECT contract_billing_release('${billingEvent}', 'ok') AS r`)).r;
  check('liberação governada por permissão funciona', released.release_state === 'RELEASED',
    JSON.stringify(released));
  check('liberação amarra impressão digital dos fatos exatos (§19)',
    typeof released.release_fingerprint === 'string' && released.release_fingerprint.length === 64);
  const relAgain = (await oneAs(commercial, `SELECT contract_billing_release('${billingEvent}', 'de novo') AS r`)).r;
  check('liberar de novo devolve a liberação existente, não uma segunda',
    relAgain.idempotent === true);

  check('fato contracts.billing.released emitido na MESMA transação (§20)',
    (await one(`SELECT count(*)::int n FROM domain_events
                 WHERE organization_id=$1 AND event_type='contracts.billing.released'
                   AND aggregate_id=$2`, [org, billingEvent])).n === 1);

  // ---- valor liberado não muda em silêncio (§19) ----
  const mutate = await refuses(c,
    `UPDATE contract_billing_events SET amount = 999999 WHERE id=$1`, [billingEvent]);
  check('valor de faturamento LIBERADO não se reescreve (§19)', mutate !== null,
    (mutate || '').slice(0, 70));

  // ---- o navegador não forja liberação (§69, §70) ----
  const forge = await refuses(c, asUser(commercial,
    `UPDATE contract_billing_events SET release_state='RELEASED', released_by='${admin}'
      WHERE id='${billingEvent}'`));
  check('navegador não forja liberação nem ator (§69, §70)', forge !== null, (forge || '').slice(0, 70));
  const forgeInsert = await refuses(c, asUser(commercial,
    `INSERT INTO contract_billing_events (organization_id, contract_id, title, amount, status, release_state)
     VALUES ('${org}','${contract}','forjado',1,'pendente','RELEASED')`));
  check('navegador não insere faturamento já liberado', forgeInsert !== null, (forgeInsert || '').slice(0, 70));

  // ---- corte: sem escrita dupla no mesmo marco (§129) ----
  const dual = await refuses(c, asUser(commercial,
    `INSERT INTO contract_billing_events (organization_id, contract_id, milestone_id, title, amount, status)
     VALUES ('${org}','${contract}','${milestone}','manual paralelo',455000,'pendente')`));
  check('caminho legado não cria faturamento concorrente para marco governado (§129)',
    dual !== null, (dual || '').slice(0, 70));

  // ============================================================
  // §29/§30/§109 — PONTE FISCAL
  // ============================================================
  console.log('\n=== PONTE FISCAL ===');
  const relEvent = (await one(
    `SELECT id FROM domain_events WHERE organization_id=$1 AND event_type='contracts.billing.released'
      AND aggregate_id=$2`, [org, billingEvent])).id;
  let fiscalReq = (await one(`SELECT contract_billing_open_fiscal_request($1) AS r`, [relEvent])).r;
  check('liberação abre pedido fiscal durável', fiscalReq.opened === true, JSON.stringify(fiscalReq));
  check('SEM configuração fiscal o pedido é BLOCKED_BY_CONFIGURATION, não fingido (§30)',
    fiscalReq.state === 'BLOCKED_BY_CONFIGURATION', fiscalReq.state);
  fiscalReq = (await one(`SELECT contract_billing_open_fiscal_request($1) AS r`, [relEvent])).r;
  check('reentrega do fato de liberação não abre segundo pedido (§109)',
    fiscalReq.idempotent === true);
  check('nenhum documento fiscal foi criado por Contratos (§29)',
    (await one(`SELECT count(*)::int n FROM fiscal_documents WHERE organization_id=$1`, [org])).n === 0);

  // ---- portão de produção intacto (§30, §106) ----
  check('gatilho fiscal_guard_production continua ativo',
    (await one(`SELECT count(*)::int n FROM pg_trigger
                 WHERE tgrelid='public.fiscal_establishments'::regclass
                   AND tgname LIKE 'fiscal_guard_production%' AND NOT tgisinternal`)).n >= 2);
  const estab = (await one(
    `INSERT INTO fiscal_establishments
       (organization_id, legal_name, cnpj, municipal_registration, tax_regime, municipality_ibge,
        municipality_name, uf, postal_code, street, street_number, district, environment, nfse_series)
     VALUES ($1,'[P7] Emissor','11222333000181','IM1','simples_nacional','3550308','São Paulo','SP',
             '01001000','Rua Teste','1','Centro','homologation','1') RETURNING id`, [org])).id;
  const prod = await refuses(c,
    `UPDATE fiscal_establishments SET production_enabled = true WHERE id=$1`, [estab]);
  check('produção fiscal continua BLOQUEADA sem o portão (§30, §102)', prod !== null,
    (prod || '').slice(0, 70));

  // ============================================================
  // §38/§40/§110 — FISCAL AUTORIZADO → CONTAS A RECEBER
  // ============================================================
  console.log('\n=== FISCAL AUTORIZADO → CONTAS A RECEBER ===');
  const mkDoc = async (orgId, estabId, partyId, contractId, key) => (await one(
    `INSERT INTO fiscal_documents
       (organization_id, establishment_id, party_id, contract_id, competence_date, issue_date, due_date,
        series, service_amount_cents, withheld_total_cents, deductions_cents,
        unconditional_discount_cents, net_amount_cents, service_location_ibge, description,
        issuer_snapshot, recipient_snapshot, service_snapshot, tax_snapshot, idempotency_key, status)
     VALUES ($1,$2,$3,$4, current_date, current_date, current_date + 30, '1',
             45500000, 500000, 0, 0, 45000000, '3550308','[P7] Serviço',
             '{}','{}','{}','{}',$5,'draft') RETURNING id`,
    [orgId, estabId, partyId, contractId, key])).id;
  const doc = await mkDoc(org, estab, party, contract, `p7-doc-${sfx}`);
  await c.query(`SELECT contract_billing_link_fiscal_document($1,$2,NULL)`, [billingEvent, doc]);
  check('vínculo faturamento↔nota é DECLARADO, não casado por valor/data (§31)',
    (await one(`SELECT count(*)::int n FROM contract_billing_fiscal_allocations
                 WHERE organization_id=$1 AND billing_event_id=$2 AND fiscal_document_id=$3
                   AND state='ACTIVE'`, [org, billingEvent, doc])).n === 1);

  await c.query(`UPDATE fiscal_documents SET status='authorized', authorized_at=now(),
                        document_number='NF-1' WHERE id=$1`, [doc]);
  const authEvent = await one(
    `SELECT id FROM domain_events WHERE organization_id=$1 AND event_type='fiscal.document.authorized'
      AND aggregate_id=$2`, [org, doc]);
  check('autorização emite fato na MESMA transação, por gatilho (§65)', !!authEvent, String(authEvent?.id));

  // ---- SEM política de base, nada é criado (§40) ----
  let ar = (await one(`SELECT finance_receivable_create_from_fiscal_document($1) AS r`, [authEvent.id])).r;
  check('SEM política de base de valor, o recebível NÃO é criado (§40)',
    ar.created === false && ar.reason === 'AR_BASIS_UNCONFIGURED', JSON.stringify(ar));
  check('documento fiscal passa a declarar pending_configuration (§130)',
    (await one(`SELECT finance_status FROM fiscal_documents WHERE id=$1`, [doc])).finance_status
      === 'pending_configuration');
  check('nenhum recebível foi criado por suposição',
    (await one(`SELECT count(*)::int n FROM finance_receivables WHERE organization_id=$1`, [org])).n === 0);

  // ---- base DECLARADA: agora sim ----
  await c.query(
    `INSERT INTO finance_receivable_basis_policies (organization_id, basis, justification, declared_by)
     VALUES ($1,'NET_OF_WITHHOLDING','[P7] Cliente retém ISS na fonte; caixa é o líquido.',$2)`,
    [org, finance]);
  ar = (await one(`SELECT finance_receivable_create_from_fiscal_document($1) AS r`, [authEvent.id])).r;
  check('com base DECLARADA, o recebível é criado', ar.created === true, JSON.stringify(ar));
  const receivable = ar.receivable_id;
  check('base do valor fica EXPLÍCITA na linha (§40)', ar.amount_basis === 'NET_OF_WITHHOLDING');
  check('valor segue a base declarada: bruto menos retenção',
    Number(ar.original_amount_cents) === 45500000 - 500000, String(ar.original_amount_cents));

  const arAgain = (await one(`SELECT finance_receivable_create_from_fiscal_document($1) AS r`, [authEvent.id])).r;
  check('reentrega da autorização NÃO duplica Contas a Receber (§38)',
    arAgain.created === false && arAgain.idempotent === true, JSON.stringify(arAgain));

  const arRow = await one(`SELECT * FROM finance_receivables WHERE id=$1`, [receivable]);
  check('contraparte é a parte CANÔNICA (§8)', arRow.party_id === party);
  check('recebível é estruturalmente do inquilino (§37)', arRow.organization_id === org);
  check('vencimento vem do documento fiscal, não de texto livre (§39)',
    (await one(`SELECT due_date_source FROM finance_receivable_installments WHERE receivable_id=$1`,
      [receivable])).due_date_source === 'FISCAL_DOCUMENT_DUE_DATE');
  check('parcelas conservam o total (§80)',
    (await one(`SELECT sum(original_amount_cents)::bigint s FROM finance_receivable_installments
                 WHERE receivable_id=$1`, [receivable])).s === arRow.original_amount_cents);

  // ---- lançamento contábil bloqueado por configuração (§42) ----
  const post = (await one(`SELECT finance_ledger_post_receivable($1) AS r`, [receivable])).r;
  check('SEM mapeamento contábil o lançamento é BLOQUEADO, não inventado (§42)',
    post.posted === false && post.state === 'PENDING_CONFIGURATION', JSON.stringify(post));
  check('nenhum lançamento de razão foi criado por suposição',
    (await one(`SELECT count(*)::int n FROM ledger_entry WHERE organization_id=$1`, [org])).n === 0);
  check('AR existir NÃO marca o fiscal como posted (§130)',
    (await one(`SELECT finance_status FROM fiscal_documents WHERE id=$1`, [doc])).finance_status !== 'posted');

  // ---- inquilino cruzado é estruturalmente impossível (§72, §117) ----
  const crossParty = await refuses(c,
    `UPDATE finance_receivables SET party_id=$1 WHERE id=$2`, [partyB, receivable]);
  check('recebível não aceita parte de outro inquilino (§72)', crossParty !== null,
    (crossParty || '').slice(0, 60));
  const crossContract = await refuses(c,
    `UPDATE finance_receivables SET contract_id=$1 WHERE id=$2`, [contractB, receivable]);
  check('recebível não aceita contrato de outro inquilino', crossContract !== null,
    (crossContract || '').slice(0, 60));

  // ============================================================
  // §46/§47/§111 — LIQUIDAÇÃO E PAGAMENTO PARCIAL
  // ============================================================
  console.log('\n=== LIQUIDAÇÃO ===');
  const total = Number(arRow.original_amount_cents);
  const bal0 = await one(`SELECT * FROM finance_receivable_balances WHERE receivable_id=$1`, [receivable]);
  check('título nasce OPEN com pago ZERO derivado', bal0.derived_status === 'OPEN'
    && Number(bal0.paid_amount_cents) === 0 && Number(bal0.open_amount_cents) === total);

  const s1 = (await oneAs(finance,
    `SELECT finance_settlement_record('${receivable}', ${Math.round(total * 0.4)}, current_date,
       'MANUAL_ENTRY', NULL, 'REC-1', NULL) AS r`)).r;
  check('pagamento PARCIAL registra e o saldo é derivado (§46)',
    s1.derived_status === 'PARTIAL' && Number(s1.open_amount_cents) === total - Math.round(total * 0.4),
    JSON.stringify(s1));

  const over = await refuses(c, asUser(finance,
    `SELECT finance_settlement_record('${receivable}', ${total}, current_date, 'MANUAL_ENTRY', NULL, NULL, NULL)`));
  check('recebimento acima do saldo é RECUSADO, não aceito em silêncio (§47)',
    over !== null && /OVERPAYMENT_REVIEW_REQUIRED/.test(over || ''), (over || '').slice(0, 80));

  const s2 = (await oneAs(finance,
    `SELECT finance_settlement_record('${receivable}', ${total - Math.round(total * 0.4)}, current_date,
       'MANUAL_ENTRY', NULL, 'REC-2', NULL) AS r`)).r;
  check('completar o saldo leva a PAID, sem deriva de centavo (§46, §80)',
    s2.derived_status === 'PAID' && Number(s2.open_amount_cents) === 0
      && Number(s2.paid_amount_cents) === total, JSON.stringify(s2));

  const neg = await one(`SELECT open_amount_cents FROM finance_receivable_balances WHERE receivable_id=$1`,
    [receivable]);
  check('saldo aberto NUNCA fica negativo (§47)', Number(neg.open_amount_cents) >= 0);

  // ---- pago é DERIVADO, não coluna mutável (§45) ----
  check('finance_receivables não tem coluna de valor pago mutável (§45)',
    (await one(`SELECT count(*)::int n FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='finance_receivables'
                   AND column_name IN ('paid_amount_cents','paid_at','status')`)).n === 0);

  // ---- liquidação é append-only (§44) ----
  const upd = await refuses(c, `UPDATE finance_settlements SET amount_cents = 1 WHERE receivable_id=$1`,
    [receivable]);
  check('liquidação não se reescreve (§44)', upd !== null, (upd || '').slice(0, 60));
  // Apagamento estreita para o caminho privilegiado, como a 110 desenhou: a
  // aplicação não apaga liquidação, e a exclusão de inquilino inteiro segue
  // possível para quem opera o banco.
  const del = await refuses(c, asUser(finance, `DELETE FROM finance_settlements WHERE receivable_id='${receivable}'`));
  check('a aplicação não apaga liquidação (§44, §57)', del !== null, (del || '').slice(0, 60));

  // ---- estorno reabre o saldo (§113) ----
  const settlement2 = (await one(
    `SELECT id FROM finance_settlements WHERE receivable_id=$1 AND external_reference='REC-2'`,
    [receivable])).id;
  const reversed = (await oneAs(finance,
    `SELECT finance_settlement_reverse('${settlement2}', 'devolução bancária') AS r`)).r;
  check('estorno de pagamento REABRE o saldo (§113)',
    reversed.derived_status === 'PARTIAL' && Number(reversed.open_amount_cents) > 0,
    JSON.stringify(reversed));
  check('a liquidação estornada CONTINUA na história (§57, §82)',
    (await one(`SELECT count(*)::int n FROM finance_settlements WHERE id=$1`, [settlement2])).n === 1);
  const revAgain = (await oneAs(finance,
    `SELECT finance_settlement_reverse('${settlement2}', 'de novo') AS r`)).r;
  check('estornar de novo devolve o estorno existente', revAgain.idempotent === true);

  // ============================================================
  // §49/§52/§53/§112 — CONCILIAÇÃO
  // ============================================================
  console.log('\n=== CONCILIAÇÃO ===');
  const settlement1 = (await one(
    `SELECT id FROM finance_settlements WHERE receivable_id=$1 AND external_reference='REC-1'`,
    [receivable])).id;
  const paidCents = Math.round(total * 0.4);
  let ps = (await oneAs(finance,
    `SELECT finance_payment_source_import('${org}','OFX', ${paidCents}, current_date, 'TXN-1',
       'CLIENTE X', NULL, 'BR-REF', NULL, 'BRL') AS r`)).r;
  const source1 = ps.payment_source_id;
  const psAgain = (await oneAs(finance,
    `SELECT finance_payment_source_import('${org}','OFX', ${paidCents}, current_date, 'TXN-1',
       'CLIENTE X', NULL, 'BR-REF', NULL, 'BRL') AS r`)).r;
  check('reimportar a MESMA transação bancária não duplica evidência (§52)',
    psAgain.idempotent === true && psAgain.payment_source_id === source1);

  const fuzzy = await refuses(c, asUser(finance,
    `SELECT finance_reconciliation_record('${settlement1}','${source1}','FUZZY_PROPOSAL',NULL,NULL)`));
  check('casamento por semelhança NÃO fecha conciliação (§53)',
    fuzzy !== null && /FUZZY_CANNOT_FINALIZE/.test(fuzzy || ''), (fuzzy || '').slice(0, 70));

  const recon = (await oneAs(finance,
    `SELECT finance_reconciliation_record('${settlement1}','${source1}','DETERMINISTIC_SOURCE_ID',
       'OFX 2026-01','ok') AS r`)).r;
  check('casamento por id estável de fonte concilia (§52)', recon.state === 'RECONCILED',
    JSON.stringify(recon));
  const reconAgain = (await oneAs(finance,
    `SELECT finance_reconciliation_record('${settlement1}','${source1}','DETERMINISTIC_SOURCE_ID',NULL,NULL) AS r`)).r;
  check('conciliar de novo não duplica', reconAgain.idempotent === true);

  // ---- divergência fica em revisão, não vira verdade ----
  const ps2 = (await oneAs(finance,
    `SELECT finance_payment_source_import('${org}','OFX', ${paidCents + 12345}, current_date, 'TXN-2',
       'CLIENTE X', NULL, 'BR-REF-2', NULL, 'BRL') AS r`)).r;
  const s3 = (await oneAs(finance,
    `SELECT finance_settlement_record('${receivable}', 100000, current_date, 'BANK_IMPORT',
       '${ps2.payment_source_id}', 'REC-3', NULL) AS r`)).r;
  const mism = (await oneAs(finance,
    `SELECT finance_reconciliation_record((SELECT id FROM finance_settlements
        WHERE receivable_id='${receivable}' AND external_reference='REC-3'),
       '${ps2.payment_source_id}','DETERMINISTIC_SOURCE_ID',NULL,NULL) AS r`)).r;
  check('evidência MAIOR que a liquidação fica em REVIEW_REQUIRED (§49)',
    mism.state === 'REVIEW_REQUIRED', JSON.stringify(mism));

  check('pagamento e conciliação são dimensões DISTINTAS (§49)',
    (await one(`SELECT count(*)::int n FROM finance_settlements WHERE receivable_id=$1`, [receivable])).n
      > (await one(`SELECT count(*)::int n FROM finance_reconciliations rc
                     JOIN finance_settlements s ON s.id=rc.settlement_id
                    WHERE s.receivable_id=$1 AND rc.state='RECONCILED'`, [receivable])).n);

  // ---- conciliação manual exige ator (§70) ----
  const sysRecon = await refuses(c, asSystem(
    `SELECT finance_reconciliation_record('${settlement1}','${ps2.payment_source_id}','MANUAL_GOVERNED',NULL,NULL)`));
  check('conciliação manual SEM pessoa autenticada é recusada (§70)', sysRecon !== null,
    (sysRecon || '').slice(0, 70));

  // ============================================================
  // §34/§57/§113 — CANCELAMENTO E SUBSTITUIÇÃO
  // ============================================================
  console.log('\n=== CANCELAMENTO / SUBSTITUIÇÃO ===');
  await c.query(`UPDATE fiscal_documents SET status='cancelled', cancelled_at=now(),
                        cancellation_reason='[P7] teste' WHERE id=$1`, [doc]);
  const cancelEvent = (await one(
    `SELECT id FROM domain_events WHERE organization_id=$1 AND event_type='fiscal.document.cancelled'
      AND aggregate_id=$2`, [org, doc])).id;
  const applied = (await one(`SELECT finance_apply_fiscal_cancellation($1) AS r`, [cancelEvent])).r;
  check('cancelamento de nota derruba o título correspondente (§34)',
    applied.applied === true && applied.receivable_affected === true, JSON.stringify(applied));
  check('alocação antiga PERMANECE, fechada como CANCELLED (§34)',
    (await one(`SELECT count(*)::int n FROM contract_billing_fiscal_allocations
                 WHERE fiscal_document_id=$1 AND state='CANCELLED'`, [doc])).n === 1);
  check('liquidações do título cancelado PERMANECEM: o dinheiro entrou (§57)',
    (await one(`SELECT count(*)::int n FROM finance_settlements WHERE receivable_id=$1`, [receivable])).n > 0);
  check('nenhum recebível foi apagado',
    (await one(`SELECT lifecycle_state FROM finance_receivables WHERE id=$1`, [receivable])).lifecycle_state
      === 'CANCELLED');

  // ---- faturamento cancelado não some (§57) ----
  const hardDelete = await refuses(c, asUser(admin,
    `DELETE FROM contract_billing_events WHERE id='${billingEvent}'`));
  check('faturamento não se apaga pela aplicação (§57)', hardDelete !== null,
    (hardDelete || '').slice(0, 60));

  // ---- supersessão preserva o antigo (§95) ----
  const sup = (await oneAs(commercial, `SELECT contract_billing_supersede('${billingEvent}','renegociação') AS r`)).r;
  check('supersessão cria sucessor e PRESERVA o antigo (§95)',
    typeof sup.successor_id === 'string'
      && (await one(`SELECT release_state FROM contract_billing_events WHERE id=$1`, [billingEvent])).release_state
         === 'SUPERSEDED', JSON.stringify(sup));
  check('lineage antigo↔novo é navegável nos dois sentidos',
    (await one(`SELECT count(*)::int n FROM contract_billing_events
                 WHERE id=$1 AND supersedes_id=$2`, [sup.successor_id, billingEvent])).n === 1);

  // ============================================================
  // §61/§62/§119 — MODELO DE LEITURA
  // ============================================================
  console.log('\n=== MODELO DE LEITURA ===');
  const rm = await one(`SELECT * FROM contract_to_cash_read_model WHERE billing_event_id=$1`, [billingEvent]);
  check('modelo de leitura expõe a PROCEDÊNCIA do valor (§108)',
    rm.amount_source === 'ACCEPTED_MEASUREMENT', String(rm.amount_source));
  check('retenção, glosa e disputa saem como NOT_APPLICABLE (§114)',
    rm.retention_state === 'NOT_APPLICABLE' && rm.glosa_state === 'NOT_APPLICABLE'
      && rm.dispute_state === 'NOT_APPLICABLE');
  check('nota cancelada não é apresentada como cobrável (§119)',
    rm.receivable_lifecycle_state === 'CANCELLED', String(rm.receivable_lifecycle_state));

  // ---- ausência NÃO é zero (§62) ----
  const bare = (await one(
    `INSERT INTO contract_billing_events (organization_id, contract_id, title, amount, status)
     VALUES ($1,$2,'[P7] Sem vínculo', 1000, 'pendente') RETURNING id`, [org, contract])).id;
  const rmBare = await one(`SELECT * FROM contract_to_cash_read_model WHERE billing_event_id=$1`, [bare]);
  check('sem título de Finanças, RECEBIDO é DESCONHECIDO e não R$ 0 (§62)',
    rmBare.paid_amount_cents === null && rmBare.finance_link_state === 'UNKNOWN',
    `${rmBare.paid_amount_cents} / ${rmBare.finance_link_state}`);

  // ============================================================
  // §117 — ISOLAMENTO DE INQUILINO NA LEITURA
  // ============================================================
  console.log('\n=== ISOLAMENTO DE INQUILINO ===');
  const outsiderSees = await oneAs(outsider,
    `SELECT count(*)::int n FROM contract_to_cash_read_model WHERE organization_id='${org}'`);
  check('outro inquilino não lê a cadeia contrato-a-caixa alheia', outsiderSees.n === 0, String(outsiderSees.n));
  const outsiderAr = await oneAs(outsider,
    `SELECT count(*)::int n FROM finance_receivables WHERE organization_id='${org}'`);
  check('outro inquilino não lê Contas a Receber alheio', outsiderAr.n === 0, String(outsiderAr.n));
  const outsiderSettle = await oneAs(outsider,
    `SELECT count(*)::int n FROM finance_settlements WHERE organization_id='${org}'`);
  check('outro inquilino não lê liquidação alheia', outsiderSettle.n === 0, String(outsiderSettle.n));
  const outsiderApar = await oneAs(outsider,
    `SELECT count(*)::int n FROM apar_title WHERE organization_id='${org}'`);
  check('apar_title endurecida: outro inquilino não lê título alheio', outsiderApar.n === 0);

  // ============================================================
  // ROTAS E VOCABULÁRIO
  // ============================================================
  console.log('\n=== ROTAS E VOCABULÁRIO ===');
  for (const [et, jt] of [
    ['projects.measurement.accepted', 'contracts.billing.candidate_from_measurement'],
    ['contracts.billing.released', 'contracts.billing.request_fiscal_document'],
    ['fiscal.document.authorized', 'finance.receivable.create_from_fiscal'],
    ['fiscal.document.cancelled', 'finance.receivable.apply_fiscal_cancellation'],
    ['fiscal.document.replaced', 'finance.receivable.apply_fiscal_cancellation'],
  ]) {
    check(`rota ${et} → ${jt}`, (await one(
      `SELECT count(*)::int n FROM apex_event_routes
        WHERE event_type=$1 AND job_type=$2 AND enabled`, [et, jt])).n === 1);
  }
  check('transmissão fiscal NÃO migrou para apex_jobs (§66, §123)',
    (await one(`SELECT count(*)::int n FROM apex_event_routes WHERE job_type LIKE 'fiscal.%transmit%'`)).n === 0);
  check('cadeia causal preservada com a MESMA correlação (§68)',
    (await one(`SELECT count(DISTINCT correlation_id)::int n FROM domain_events
                 WHERE organization_id=$1 AND event_type IN
                   ('projects.measurement.accepted','contracts.billing.released')`, [org])).n === 1);

  // ============================================================
  // AUSÊNCIA DE FATO FABRICADO
  // ============================================================
  console.log('\n=== NENHUM FATO FABRICADO ===');
  check('nenhuma política de aprovação foi semeada (§18)',
    (await one(`SELECT count(*)::int n FROM approval_policies`)).n === 0);
  check('nenhuma regra de direito FIXO foi semeada (§11)',
    (await one(`SELECT count(*)::int n FROM contract_billing_entitlement_rules`)).n === 0);
  check('nenhuma política de base de valor foi semeada fora do descartável (§40)',
    (await one(`SELECT count(*)::int n FROM finance_receivable_basis_policies
                 WHERE organization_id NOT IN ($1,$2)`, [org, orgB])).n === 0);
  check('nenhuma regra de lançamento contábil foi semeada (§42)',
    (await one(`SELECT count(*)::int n FROM finance_posting_rules`)).n === 0);
  check('nenhum portão de produção fiscal foi semeado (§102)',
    (await one(`SELECT count(*)::int n FROM fiscal_production_gates`)).n === 0);

  return ok;
}
