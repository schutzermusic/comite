/**
 * Fase 7 — correção: fronteira de inquilino das funções SECURITY DEFINER e
 * autoridade de liberação de faturamento.
 *
 * ─── O que esta bateria existe para impedir ───────────────────────────────
 *
 * Duas coisas que a Fase 7 entregou erradas e que passaram pela bateria
 * original justamente porque ela não as procurava:
 *
 *   1. funções SECURITY DEFINER que iam à linha pelo UUID sem conferir o
 *      inquilino do chamador — um oráculo de LEITURA e, em dois casos, de
 *      ESCRITA entre organizações;
 *   2. autoridade de liberação deduzida do NOME de papéis globais, com desvio
 *      de administrador e liberação direta quando o Motor de Aprovação não
 *      tinha política.
 *
 * A prova do item 1 é feita com DOIS inquilinos descartáveis e chamadas
 * emitidas como `authenticated` de verdade — trocar só a reivindicação JWT
 * deixaria RLS, GRANT e gatilhos inteiramente de fora, e a bateria passaria
 * sem exercitar nada.
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

const asUser = (uid, sql) =>
  `SET LOCAL ROLE authenticated;`
  + ` SELECT set_config('request.jwt.claims', json_build_object('sub','${uid}','role','authenticated')::text, true);`
  + ` ${sql}; RESET ROLE;`;

export async function runPhase7CorrectionAssertions(c, { must, one }) {
  let ok = true;
  const check = (label, pass, detail) => { must(label, pass, detail); if (!pass) ok = false; };
  const oneAs = async (uid, sql) => {
    const res = await c.query(asUser(uid, sql));
    const list = Array.isArray(res) ? res : [res];
    return list[list.length - 2].rows[0];
  };

  // ============================================================
  // PRIVILÉGIO — o ACL padrão do schema não pode reabrir a porta
  // ============================================================
  console.log('\n=== PRIVILÉGIO DE EXECUÇÃO ===');
  /*
    `REVOKE ... FROM PUBLIC` NÃO bastava: o projeto concede EXECUTE a `anon` e
    `authenticated` por ALTER DEFAULT PRIVILEGES quando a função nasce. As duas
    abaixo estavam executáveis por `anon` em produção.
  */
  const INTERNAL = [
    'contract_billing_fingerprint', 'contract_billing_recompute_eligibility',
    'contract_billing_emit', 'approval_subject_resolve', 'fiscal_documents_emit_lifecycle',
    'contract_billing_events_guard_browser', 'contract_billing_events_guard_cutover',
    'contract_billing_events_guard_released', 'contract_billing_history_immutable',
    'finance_installments_conserve_total', 'finance_settlements_no_rewrite',
    'apex_caller_is_browser', 'apex_browser_organization',
    'contract_billing_release_authority_for', 'contract_billing_release_authority_guard',
    'contract_billing_release_authority_immutable',
  ];
  for (const fn of INTERNAL) {
    const r = await one(
      `SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
        WHERE ns.nspname='public' AND p.proname=$1
          AND (has_function_privilege('anon', p.oid, 'EXECUTE')
            OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))`, [fn]);
    check(`${fn} fora do alcance de navegador`, r.n === 0, `${r.n} assinatura(s) expostas`);
  }

  // ============================================================
  // MUNDO DESCARTÁVEL — dois inquilinos
  // ============================================================
  console.log('\n=== DOIS INQUILINOS DESCARTÁVEIS ===');
  const sfx = Math.random().toString(36).slice(2, 10);
  const mkOrg = async (n, slug) =>
    (await one(`INSERT INTO organizations (name, slug) VALUES ($1,$2) RETURNING id`,
      [`[P7X] ${n}`, `p7x-${slug}-${sfx}`])).id;
  const victimOrg = await mkOrg('Vítima', 'v');
  const attackerOrg = await mkOrg('Atacante', 'a');

  const mkUser = async (label, orgId, roleKey) => {
    const uid = (await one(
      `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
       VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
               $1,'x',now(),now()) RETURNING id`, [`p7x.${label}.${sfx}@example.test`])).id;
    await c.query(`INSERT INTO profiles (user_id, organization_id, full_name, status) VALUES ($1,$2,$3,'active')`,
      [uid, orgId, `[P7X] ${label}`]);
    if (roleKey) await c.query(
      `INSERT INTO user_roles (user_id, role_id, organization_id)
       SELECT $1, r.id, $2 FROM roles r WHERE r.key=$3 AND r.organization_id IS NULL`, [uid, orgId, roleKey]);
    return uid;
  };
  // O atacante é ADMINISTRADOR na organização DELE. É o pior caso realista:
  // privilégio máximo do lado errado da fronteira.
  const attacker = await mkUser('attacker', attackerOrg, 'owner_admin');
  const victimAdmin = await mkUser('victim-admin', victimOrg, 'owner_admin');
  const victimDeclarer = await mkUser('victim-declarer', victimOrg, 'owner_admin');
  const victimViewer = await mkUser('victim-viewer', victimOrg, 'juridico_contratos');

  const mkWorld = async (orgId, tag) => {
    const project = `p7x-${tag}-${sfx}`;
    await c.query(`INSERT INTO projects (id, organization_id, project) VALUES ($1,$2,$3)`,
      [project, orgId, JSON.stringify({ name: `[P7X] ${tag}`, status: 'em_andamento' })]);
    const party = (await one(
      `INSERT INTO parties (organization_id, kind, legal_name, document_type, document_number)
       VALUES ($1,'organization',$2,'cnpj',$3) RETURNING id`,
      [orgId, `[P7X] Parte ${tag}`, tag === 'v' ? '11222333000181' : '11222333000262'])).id;
    const contract = (await one(
      `INSERT INTO contracts (organization_id, title, status, currency, data_class,
                              counterparty_party_id, project_id)
       VALUES ($1,$2,'active','BRL','demo',$3,$4) RETURNING id`,
      [orgId, `[P7X] Contrato SIGILOSO ${tag}`, party, project])).id;
    await c.query(`INSERT INTO contract_project_links (organization_id, contract_id, project_id)
                   VALUES ($1,$2,$3)`, [orgId, contract, project]);
    const milestone = (await one(
      `INSERT INTO contract_milestones (organization_id, contract_id, project_id, title, status)
       VALUES ($1,$2,$3,'[P7X] Marco','pending') RETURNING id`, [orgId, contract, project])).id;
    const billing = (await one(
      `INSERT INTO contract_billing_events
         (organization_id, contract_id, milestone_id, title, amount, currency, status,
          source_kind, entitlement_key, amount_source, eligibility_state, release_state)
       VALUES ($1,$2,$3,'[P7X] Faturamento SIGILOSO', 987654.32, 'BRL','pendente',
               'MANUAL', $4, 'LEGACY_MEASURED_AMOUNT','UNKNOWN','NOT_ELIGIBLE') RETURNING id`,
      [orgId, contract, milestone, `p7x-${tag}-${sfx}`])).id;
    return { project, party, contract, milestone, billing };
  };
  const victim = await mkWorld(victimOrg, 'v');

  // Título, liquidação e conciliação da VÍTIMA, para os oráculos de Finanças.
  const estab = (await one(
    `INSERT INTO fiscal_establishments
       (organization_id, legal_name, cnpj, municipal_registration, tax_regime, municipality_ibge,
        municipality_name, uf, postal_code, street, street_number, district, environment, nfse_series)
     VALUES ($1,'[P7X] Emissor','11222333000181','IM1','simples_nacional','3550308','São Paulo','SP',
             '01001000','Rua Teste','1','Centro','homologation','1') RETURNING id`, [victimOrg])).id;
  const doc = (await one(
    `INSERT INTO fiscal_documents
       (organization_id, establishment_id, party_id, contract_id, competence_date, issue_date,
        due_date, series, service_amount_cents, withheld_total_cents, net_amount_cents,
        service_location_ibge, description, issuer_snapshot, recipient_snapshot,
        service_snapshot, tax_snapshot, idempotency_key, status)
     VALUES ($1,$2,$3,$4, current_date, current_date, current_date + 30, '1',
             1000000, 0, 1000000, '3550308','[P7X] Serviço','{}','{}','{}','{}',$5,'draft')
     RETURNING id`, [victimOrg, estab, victim.party, victim.contract, `p7x-doc-${sfx}`])).id;
  const receivable = (await one(
    `INSERT INTO finance_receivables
       (organization_id, party_id, contract_id, project_id, billing_event_id, fiscal_document_id,
        currency, amount_basis, original_amount_cents, gross_amount_cents, issue_date)
     VALUES ($1,$2,$3,$4,$5,$6,'BRL','GROSS_SERVICE_AMOUNT',1000000,1000000,current_date)
     RETURNING id`,
    [victimOrg, victim.party, victim.contract, victim.project, victim.billing, doc])).id;
  await c.query(
    `INSERT INTO finance_receivable_installments
       (organization_id, receivable_id, sequence, due_date, original_amount_cents, currency, due_date_source)
     VALUES ($1,$2,1,current_date + 30,1000000,'BRL','FISCAL_DOCUMENT_DUE_DATE')`,
    [victimOrg, receivable]);
  const settlement = (await one(
    `INSERT INTO finance_settlements
       (organization_id, receivable_id, kind, amount_cents, currency, effective_date, source)
     VALUES ($1,$2,'PAYMENT',400000,'BRL',current_date,'MANUAL_ENTRY') RETURNING id`,
    [victimOrg, receivable])).id;
  const paymentSource = (await one(
    `INSERT INTO finance_payment_sources
       (organization_id, source_kind, external_transaction_id, fingerprint, amount_cents,
        currency, value_date)
     VALUES ($1,'OFX','P7X-TXN',$2,400000,'BRL',current_date) RETURNING id`,
    [victimOrg, `p7x-fp-${sfx}`])).id;
  const reconciliation = (await one(
    `INSERT INTO finance_reconciliations
       (organization_id, settlement_id, payment_source_id, state, match_kind, matched_amount_cents)
     VALUES ($1,$2,$3,'RECONCILED','DETERMINISTIC_SOURCE_ID',400000) RETURNING id`,
    [victimOrg, settlement, paymentSource])).id;

  // ============================================================
  // ORÁCULO DE LEITURA
  // ============================================================
  console.log('\n=== ORÁCULO DE LEITURA ENTRE INQUILINOS ===');
  /*
    Cada sonda usa um UUID da VÍTIMA e é emitida pelo ATACANTE. "Vazou" é
    qualquer resposta que descreva a linha alheia; a resposta correta é a
    MESMA que a ausência genuína produz.
  */
  const readProbe = async (label, sql, leaked) => {
    await c.query('SAVEPOINT rp');
    let verdict;
    try {
      const row = await oneAs(attacker, sql);
      verdict = leaked(row) ? `VAZOU: ${JSON.stringify(row).slice(0, 140)}` : null;
    } catch (e) {
      verdict = /not_found|inexistente|NOT_FOUND|TENANT_UNRESOLVED|denied|negad|permission/i.test(e.message)
        ? null : `erro inesperado: ${e.message.slice(0, 100)}`;
    }
    await c.query('ROLLBACK TO SAVEPOINT rp');
    check(label, verdict === null, verdict ?? '');
  };

  await readProbe('elegibilidade de faturamento alheio não vaza',
    `SELECT contract_billing_eligibility_resolve('${victim.billing}') AS r`,
    (row) => (row.r?.reasons ?? []).every((x) => x.code !== 'BILLING_EVENT_NOT_FOUND'));

  await readProbe('prontidão fiscal de faturamento alheio não vaza',
    `SELECT contract_billing_fiscal_readiness('${victim.billing}') AS r`,
    (row) => (row.r?.blockers ?? []).every((x) => x.code !== 'BILLING_EVENT_NOT_FOUND'));

  await readProbe('sujeito de aprovação alheio não vaza (organização forjada)',
    `SELECT to_jsonb(t) AS r FROM approval_subject_resolve(
       '${victimOrg}','contract_billing_event','${victim.billing}') t`,
    (row) => row.r?.found === true);

  await readProbe('sujeito CONTRATO alheio não vaza (defeito herdado da Fase 5)',
    `SELECT to_jsonb(t) AS r FROM approval_subject_resolve(
       '${victimOrg}','contract','${victim.contract}') t`,
    (row) => row.r?.found === true);

  await readProbe('impressão digital de faturamento alheio não vaza',
    `SELECT contract_billing_fingerprint('${victim.billing}') AS r`,
    (row) => row.r !== null && row.r !== undefined);

  // Leitura por tabela/visão, que é o outro caminho de vazamento.
  for (const [label, sql] of [
    ['modelo de leitura', `SELECT count(*)::int AS r FROM contract_to_cash_read_model WHERE billing_event_id='${victim.billing}'`],
    ['recebível',          `SELECT count(*)::int AS r FROM finance_receivables WHERE id='${receivable}'`],
    ['liquidação',         `SELECT count(*)::int AS r FROM finance_settlements WHERE id='${settlement}'`],
    ['conciliação',        `SELECT count(*)::int AS r FROM finance_reconciliations WHERE id='${reconciliation}'`],
    ['evidência de caixa', `SELECT count(*)::int AS r FROM finance_payment_sources WHERE id='${paymentSource}'`],
    ['autoridade de liberação', `SELECT count(*)::int AS r FROM contract_billing_release_authorities WHERE organization_id='${victimOrg}'`],
  ]) {
    await readProbe(`${label} alheio não é legível`, sql, (row) => Number(row.r) !== 0);
  }

  // ============================================================
  // ORÁCULO DE ESCRITA
  // ============================================================
  console.log('\n=== ORÁCULO DE ESCRITA ENTRE INQUILINOS ===');
  const writeProbe = async (label, sql, stillIntact) => {
    const msg = await refuses(c, asUser(attacker, sql));
    let detail = msg === null ? 'A CHAMADA PASSOU' : msg.slice(0, 80);
    let intact = true;
    if (stillIntact) intact = await stillIntact();
    check(label, msg !== null && intact, detail + (intact ? '' : ' — ESTADO ALHEIO MUDOU'));
  };

  const billingUntouched = async () =>
    (await one(`SELECT eligibility_computed_at IS NULL AS pristine
                  FROM contract_billing_events WHERE id=$1`, [victim.billing])).pristine;

  await writeProbe('recomputo de elegibilidade alheia é recusado',
    `SELECT contract_billing_recompute_eligibility('${victim.billing}')`, billingUntouched);
  await writeProbe('liberação de faturamento alheio é recusada',
    `SELECT contract_billing_release('${victim.billing}', 'ataque')`, billingUntouched);
  await writeProbe('cancelamento de faturamento alheio é recusado',
    `SELECT contract_billing_cancel('${victim.billing}', 'ataque')`, billingUntouched);
  await writeProbe('supersessão de faturamento alheio é recusada',
    `SELECT contract_billing_supersede('${victim.billing}', 'ataque')`, billingUntouched);
  await writeProbe('criação de faturamento a partir de marco alheio é recusada',
    `SELECT contract_billing_create_from_milestone('${victim.milestone}', 'ataque')`);

  const receivableActive = async () =>
    (await one(`SELECT lifecycle_state = 'ACTIVE' AS alive FROM finance_receivables WHERE id=$1`,
      [receivable])).alive;

  await writeProbe('reversão de recebível alheio é recusada',
    `SELECT finance_receivable_reverse('${receivable}', 'ataque', 'CANCELLED')`, receivableActive);
  await writeProbe('liquidação de recebível alheio é recusada',
    `SELECT finance_settlement_record('${receivable}', 1000, current_date, 'MANUAL_ENTRY', NULL, 'ataque', NULL)`,
    async () => (await one(`SELECT count(*)::int n FROM finance_settlements WHERE receivable_id=$1`,
      [receivable])).n === 1);
  await writeProbe('estorno de liquidação alheia é recusado',
    `SELECT finance_settlement_reverse('${settlement}', 'ataque')`,
    async () => (await one(`SELECT count(*)::int n FROM finance_settlements WHERE reversal_of=$1`,
      [settlement])).n === 0);
  await writeProbe('importação de evidência para organização alheia é recusada',
    `SELECT finance_payment_source_import('${victimOrg}','OFX', 5555, current_date, 'P7X-ATAQUE',
       NULL, NULL, NULL, NULL, 'BRL')`,
    async () => (await one(`SELECT count(*)::int n FROM finance_payment_sources
                             WHERE organization_id=$1 AND external_transaction_id='P7X-ATAQUE'`,
      [victimOrg])).n === 0);
  await writeProbe('conciliação de liquidação alheia é recusada',
    `SELECT finance_reconciliation_record('${settlement}','${paymentSource}','MANUAL_GOVERNED',NULL,NULL)`,
    async () => (await one(`SELECT count(*)::int n FROM finance_reconciliations
                             WHERE settlement_id=$1`, [settlement])).n === 1);
  await writeProbe('reversão de conciliação alheia é recusada',
    `SELECT finance_reconciliation_reverse('${reconciliation}', 'ataque')`,
    async () => (await one(`SELECT count(*)::int n FROM finance_reconciliations
                             WHERE reversal_of=$1`, [reconciliation])).n === 0);
  await writeProbe('declarar autoridade de liberação em organização alheia é recusado',
    `INSERT INTO contract_billing_release_authorities
       (organization_id, grantee_kind, grantee_user_id, source_kind, source_reference, justification)
     VALUES ('${victimOrg}','USER','${attacker}','BOARD_RESOLUTION','forjada','ataque')`,
    async () => (await one(`SELECT count(*)::int n FROM contract_billing_release_authorities
                             WHERE organization_id=$1`, [victimOrg])).n === 0);

  // ============================================================
  // AUTORIDADE DE LIBERAÇÃO
  // ============================================================
  console.log('\n=== AUTORIDADE DE LIBERAÇÃO ===');
  check('nenhuma concessão automática de contracts.billing.* a papel global',
    (await one(`SELECT count(*)::int n FROM role_permissions rp
                  JOIN roles r ON r.id = rp.role_id
                  JOIN permissions p ON p.id = rp.permission_id
                 WHERE r.organization_id IS NULL AND p.key LIKE 'contracts.billing.%'`)).n === 0);
  check('o VOCABULÁRIO das permissões permanece',
    (await one(`SELECT count(*)::int n FROM permissions
                 WHERE key IN ('contracts.billing.release','contracts.billing.adjust')`)).n === 2);
  check('a tabela de autoridade nasce VAZIA',
    (await one(`SELECT count(*)::int n FROM contract_billing_release_authorities`)).n === 0);
  check('nenhuma política de aprovação foi fabricada',
    (await one(`SELECT count(*)::int n FROM approval_policies`)).n === 0);

  // Um faturamento ELEGÍVEL na organização da vítima, para exercitar a liberação.
  const rule = (await one(
    `INSERT INTO contract_measurement_requirements
       (organization_id, contract_id, title, source_reference, effect, milestone_id,
        measurement_basis, measurement_currency, accumulation_mode, aggregation_mode, cadence)
     VALUES ($1,$2,'[P7X] Regra','Cl. 4','added',$3,'MONETARY','BRL','INCREMENTAL','SUM_INCREMENTAL','MONTHLY')
     RETURNING id`, [victimOrg, victim.contract, victim.milestone])).id;
  const measurement = (await one(
    `INSERT INTO project_measurements
       (organization_id, project_id, contract_id, contract_measurement_rule_id, milestone_id,
        occurrence_key, occurrence_state, measurement_basis, accumulation_mode, quantity,
        measured_value, currency, status, accepted_at, acceptance_source, accepted_quantity,
        accepted_value, accepted_currency, accepted_external_ref, origin)
     VALUES ($1,$2,$3,$4,$5,'2026-02','resolved','MONETARY','INCREMENTAL',1,100000,'BRL','ACCEPTED',
             now(),'signed_bulletin',1,100000,'BRL','BOL','manual') RETURNING id`,
    [victimOrg, victim.project, victim.contract, rule, victim.milestone])).id;
  const accEvent = (await one(
    `SELECT emit_domain_event($1::uuid,'projects.measurement.accepted',1,'project_measurement',
              $2::uuid,'p7x-accept:'||$2::uuid::text,'{}'::jsonb) AS id`,
    [victimOrg, measurement])).id;
  const candidate = (await one(
    `SELECT contract_billing_apply_measurement_accepted($1) AS r`, [accEvent])).r;
  const eligibleBilling = candidate.billing_event_id;
  check('candidato elegível preparado para a prova de autoridade',
    candidate.eligibility === 'ELIGIBLE', JSON.stringify(candidate.eligibility));

  /*
    O ADMINISTRADOR da própria organização, sem permissão e sem autoridade.
    Antes da correção, `current_user_is_admin()` bastava.
  */
  const adminRelease = await refuses(c, asUser(victimAdmin,
    `SELECT contract_billing_release('${eligibleBilling}', 'admin tenta')`));
  check('ADMINISTRADOR não libera faturamento por ser administrador',
    adminRelease !== null && /PERMISSION_DENIED|RELEASE_AUTHORITY_NOT_CONFIGURED/.test(adminRelease),
    (adminRelease || 'LIBEROU').slice(0, 90));

  // Com a CAPACIDADE concedida, mas sem AUTORIDADE declarada.
  await c.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT r.id, p.id FROM roles r, permissions p
      WHERE r.key='owner_admin' AND r.organization_id IS NULL
        AND p.key='contracts.billing.release' ON CONFLICT DO NOTHING`);
  const noAuthority = await refuses(c, asUser(victimAdmin,
    `SELECT contract_billing_release('${eligibleBilling}', 'com permissão')`));
  check('permissão SEM autoridade declarada NÃO libera',
    noAuthority !== null && /RELEASE_AUTHORITY_NOT_CONFIGURED/.test(noAuthority),
    (noAuthority || 'LIBEROU').slice(0, 110));
  check('NO_POLICY não virou RELEASED em silêncio',
    (await one(`SELECT release_state FROM contract_billing_events WHERE id=$1`,
      [eligibleBilling])).release_state !== 'RELEASED');
  /*
    A recusa não deixa linha de história — não pode: o RAISE desfaz a transação
    inteira, INSERT incluído. O que se confere é que o estado NÃO andou e que a
    tela tem como explicar o motivo sem tentar liberar.
  */
  check('a recusa não inventa histórico de algo que não aconteceu',
    (await one(`SELECT count(*)::int n FROM contract_billing_event_history
                 WHERE billing_event_id=$1 AND transition IN ('released','release_requested')`,
      [eligibleBilling])).n === 0);

  check('o modelo de leitura declara a governança AUSENTE',
    (await one(`SELECT release_governance_state FROM contract_to_cash_read_model
                 WHERE billing_event_id=$1`, [eligibleBilling])).release_governance_state
      === 'NOT_CONFIGURED');

  const selfDeclaration = await refuses(c, asUser(victimAdmin,
    `SELECT contract_billing_release_authority_declare(
       '${victimOrg}',NULL,'USER',NULL,'${victimAdmin}','UNLIMITED',NULL,NULL,
       'BOARD_RESOLUTION','Ata auto',NULL,'auto-outorga',current_date,NULL)`));
  check('auto-outorga USER é recusada',
    selfDeclaration !== null && /AUTHORITY_SELF_DECLARATION_FORBIDDEN/.test(selfDeclaration),
    (selfDeclaration || 'AUTO-OUTORGOU').slice(0, 100));

  const missingScope = await refuses(c, asUser(victimDeclarer,
    `SELECT contract_billing_release_authority_declare(
       '${victimOrg}',NULL,'USER',NULL,'${victimViewer}',NULL,NULL,NULL,
       'BOARD_RESOLUTION','Ata sem escopo',NULL,'sem escopo',current_date,NULL)`));
  check('escopo ausente nunca vira ilimitado', missingScope !== null,
    (missingScope || 'ACEITOU NULL').slice(0, 100));

  // Autoridade UNLIMITED declarada explicitamente por OUTRA pessoa.
  const authorityId = (await oneAs(victimDeclarer,
    `SELECT contract_billing_release_authority_declare(
       '${victimOrg}',NULL,'USER',NULL,'${victimAdmin}','UNLIMITED',NULL,NULL,
       'BOARD_RESOLUTION','Ata 12/2026 art. 3º',NULL,
       '[P7X] delegação de alçada comercial',current_date,NULL) AS r`)).r;
  const declared = await one(
    `SELECT declared_by,amount_scope,max_amount,currency FROM contract_billing_release_authorities WHERE id=$1`,
    [authorityId]);
  check('declared_by é o auth.uid() da declaradora, nunca entrada do chamador',
    declared.declared_by === victimDeclarer && declared.declared_by !== victimAdmin,
    String(declared.declared_by));
  check('UNLIMITED é explícito e não carrega teto/moeda',
    declared.amount_scope === 'UNLIMITED' && declared.max_amount === null && declared.currency === null);

  for (const [label, sql] of [
    ['INSERT direto com declared_by forjado',
      `INSERT INTO contract_billing_release_authorities
         (organization_id,grantee_kind,grantee_user_id,amount_scope,source_kind,
          source_reference,justification,declared_by)
       VALUES ('${victimOrg}','USER','${victimViewer}','UNLIMITED','BOARD_RESOLUTION',
               'forjada','forjada','${victimAdmin}')`],
    ['UPDATE direto',
      `UPDATE contract_billing_release_authorities SET justification='forjada'
        WHERE id='${authorityId}'`],
    ['DELETE direto',
      `DELETE FROM contract_billing_release_authorities WHERE id='${authorityId}'`],
  ]) {
    const refused = await refuses(c, asUser(victimDeclarer, sql));
    check(`${label} por navegador é recusado`, refused !== null,
      (refused || 'ESCREVEU').slice(0, 100));
  }

  const ownerRole = (await one(
    `SELECT id FROM roles WHERE key='owner_admin' AND organization_id IS NULL`)).id;
  const roleSelf = await refuses(c, asUser(victimDeclarer,
    `SELECT contract_billing_release_authority_declare(
       '${victimOrg}',NULL,'ROLE','${ownerRole}',NULL,'UNLIMITED',NULL,NULL,
       'BOARD_RESOLUTION','Ata papel',NULL,'auto-outorga indireta',current_date,NULL)`));
  check('membro do papel não declara autoridade para o próprio papel',
    roleSelf !== null && /AUTHORITY_ROLE_SELF_DECLARATION_FORBIDDEN/.test(roleSelf),
    (roleSelf || 'AUTO-OUTORGOU PAPEL').slice(0, 100));

  check('o modelo de leitura passa a declarar autoridade configurada',
    (await one(`SELECT release_governance_state FROM contract_to_cash_read_model
                 WHERE billing_event_id=$1`, [eligibleBilling])).release_governance_state
      === 'DECLARED_AUTHORITY');

  const viewerCapability = await oneAs(victimViewer,
    `SELECT release_capability FROM contract_to_cash_read_model
      WHERE billing_event_id='${eligibleBilling}'`);
  check('visualizador não autorizado não recebe capacidade acionável',
    viewerCapability.release_capability === 'NOT_AUTHORIZED', viewerCapability.release_capability);

  const actorCapability = await oneAs(victimAdmin,
    `SELECT release_capability FROM contract_to_cash_read_model
      WHERE billing_event_id='${eligibleBilling}'`);
  check('outorgado recebe capacidade DIRECT_RELEASE',
    actorCapability.release_capability === 'DIRECT_RELEASE', actorCapability.release_capability);

  const released = (await oneAs(victimAdmin,
    `SELECT contract_billing_release('${eligibleBilling}', 'com autoridade') AS r`)).r;
  check('com autoridade DECLARADA a liberação acontece', released.release_state === 'RELEASED',
    JSON.stringify(released.governance));
  check('a liberação registra POR QUAL autoridade se liberou',
    typeof released.release_authority_id === 'string' && released.governance === 'DECLARED_AUTHORITY');

  const rewrite = await refuses(c,
    `UPDATE contract_billing_release_authorities SET justification='reescrita' WHERE id='${authorityId}'`);
  check('fatos centrais não podem ser reescritos depois de justificar liberação',
    rewrite !== null && /AUTHORITY_CORE_IMMUTABLE/.test(rewrite),
    (rewrite || 'REESCREVEU').slice(0, 100));

  const revoked = (await oneAs(victimDeclarer,
    `SELECT contract_billing_release_authority_revoke(
       '${authorityId}','fim da delegação') AS r`)).r;
  const preserved = await one(
    `SELECT count(*)::int n, bool_and(NOT active AND revoked_at IS NOT NULL
       AND revoked_by=$2 AND declared_by=$2 AND amount_scope='UNLIMITED') preserved
       FROM contract_billing_release_authorities WHERE id=$1`, [authorityId, victimDeclarer]);
  check('revogação governada preserva a declaração original',
    revoked.status === 'REVOKED' && preserved.n === 1 && preserved.preserved === true);

  // ---- teto de valor DECLARADO ----
  /*
    O segundo candidato nasce do mesmo jeito que o primeiro — medição aceita,
    procedência real — porque um faturamento sintético cairia em INCOMPLETE por
    falta de fonte e a recusa viria pelo motivo errado. O teste tem de provar
    que o TETO barrou, não que o valor era desconhecido.
  */
  const measurement2 = (await one(
    `INSERT INTO project_measurements
       (organization_id, project_id, contract_id, contract_measurement_rule_id, milestone_id,
        occurrence_key, occurrence_state, measurement_basis, accumulation_mode, quantity,
        measured_value, currency, status, accepted_at, acceptance_source, accepted_quantity,
        accepted_value, accepted_currency, accepted_external_ref, origin)
     VALUES ($1,$2,$3,$4,$5,'2026-03','resolved','MONETARY','INCREMENTAL',1,100000,'BRL','ACCEPTED',
             now(),'signed_bulletin',1,100000,'BRL','BOL-2','manual') RETURNING id`,
    [victimOrg, victim.project, victim.contract, rule, victim.milestone])).id;
  const accEvent2 = (await one(
    `SELECT emit_domain_event($1::uuid,'projects.measurement.accepted',1,'project_measurement',
              $2::uuid,'p7x-accept2:'||$2::uuid::text,'{}'::jsonb) AS id`,
    [victimOrg, measurement2])).id;
  const candidate2 = (await one(
    `SELECT contract_billing_apply_measurement_accepted($1) AS r`, [accEvent2])).r;
  const cappedBilling = candidate2.billing_event_id;

  const cappedLow = (await oneAs(victimDeclarer,
    `SELECT contract_billing_release_authority_declare(
       '${victimOrg}',NULL,'USER',NULL,'${victimAdmin}','CAPPED',50000,'BRL',
       'BOARD_RESOLUTION','Ata 13/2026',NULL,'teto baixo',current_date,NULL) AS r`)).r;
  const overLimit = await refuses(c, asUser(victimAdmin,
    `SELECT contract_billing_release('${cappedBilling}', 'acima do teto')`));
  check('valor acima do TETO declarado não libera',
    overLimit !== null && /RELEASE_AUTHORITY_NOT_CONFIGURED/.test(overLimit),
    (overLimit || 'LIBEROU').slice(0, 90));
  check('e o faturamento barrado pelo teto continua não liberado',
    (await one(`SELECT release_state FROM contract_billing_events WHERE id=$1`,
      [cappedBilling])).release_state !== 'RELEASED');

  await oneAs(victimDeclarer,
    `SELECT contract_billing_release_authority_revoke('${cappedLow}','substituída') AS r`);
  await oneAs(victimDeclarer,
    `SELECT contract_billing_release_authority_declare(
       '${victimOrg}',NULL,'USER',NULL,'${victimAdmin}','CAPPED',200000,'BRL',
       'BOARD_RESOLUTION','Ata 14/2026',NULL,'teto suficiente',current_date,NULL) AS r`);
  // Dentro do teto, uma nova declaração libera; a antiga não foi editada.
  const withinLimit = (await oneAs(victimAdmin,
    `SELECT contract_billing_release('${cappedBilling}', 'dentro do teto') AS r`)).r;
  check('dentro do teto declarado a liberação acontece',
    withinLimit.release_state === 'RELEASED', JSON.stringify(withinLimit.governance));

  // Autoridade de OUTRA organização não serve.
  const foreignAuthority = await one(
    `SELECT contract_billing_release_authority_for($1,$2,$3,NULL,NULL) AS r`,
    [attackerOrg, victim.contract, victimAdmin]);
  check('autoridade não atravessa organização', foreignAuthority.r === null);

  return ok;
}
