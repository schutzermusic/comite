/**
 * Fase 5 — a bateria estrutural e FUNCIONAL do Motor de Aprovação.
 *
 * Roda dentro da transação que aplicou as migrations, contra uma organização
 * DESCARTÁVEL criada aqui. Duas consequências de desenho:
 *
 *   1. Nenhuma linha de política, pedido ou decisão toca a organização real.
 *      A §34 e a §62 proíbem fabricar governança em inquilino de produção, e a
 *      forma de obedecer não é "tomar cuidado", é não ter acesso ao caso real.
 *   2. O ensaio exercita o MESMO caminho que o modo aplicar. Um ensaio que só
 *      criasse tabelas provaria que o DDL roda, e nada sobre o motor.
 *
 * O que NÃO cabe aqui, por precisar de duas conexões simultâneas — corrida de
 * decisão, dupla finalização, retentativa concorrente — está em
 * `tests/integration/platform-approval-engine-live.test.ts`.
 */

/** Levanta se o SQL NÃO falhar, e devolve a mensagem quando falha. */
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

export async function runPhase5Assertions(c, { must, one }) {
  let ok = true;
  const check = (label, pass, detail) => { must(label, pass, detail); if (!pass) ok = false; };

  // ============================================================
  // ESTRUTURA
  // ============================================================
  console.log('\n=== ESTRUTURA ===');
  const TABLES = ['approval_policies', 'approval_policy_versions', 'approval_policy_stages',
    'approval_policy_steps', 'approval_requests', 'approval_request_stages',
    'approval_request_steps', 'approval_decisions', 'approval_delegations',
    'approval_engine_cutover'];

  for (const t of TABLES) {
    const r = await one(
      `SELECT to_regclass('public.'||$1) IS NOT NULL AS exists,
              (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.'||$1)::regclass) AS rls,
              (SELECT count(*)::int FROM information_schema.columns
                WHERE table_schema='public' AND table_name=$1 AND column_name='organization_id') AS org`, [t]);
    check(`${t}: existe, org-scoped, RLS ligada`, r.exists && r.rls && r.org === 1);
  }

  // §40 — a regressão de TRUNCATE, verificada no CATÁLOGO e não relendo a 118.
  const trunc = await one(
    `SELECT count(*)::int n FROM information_schema.role_table_grants
      WHERE table_schema='public' AND privilege_type='TRUNCATE' AND grantee IN ('anon','authenticated')`);
  check('nenhum TRUNCATE para anon/authenticated em TODA a public', trunc.n === 0, `${trunc.n} concessões`);

  // O navegador não escreve pedido, etapa nem decisão — só lê (§38).
  const wr = await one(
    `SELECT count(*)::int n FROM information_schema.role_table_grants
      WHERE table_schema='public' AND grantee IN ('anon','authenticated')
        AND privilege_type IN ('INSERT','UPDATE','DELETE')
        AND table_name IN ('approval_requests','approval_request_stages','approval_request_steps',
                           'approval_decisions','approval_engine_cutover')`);
  check('navegador NÃO tem INSERT/UPDATE/DELETE em pedidos, etapas, decisões e corte', wr.n === 0, `${wr.n}`);

  // §39 — toda função nova é SECURITY DEFINER com search_path fixo, ou não é DEFINER.
  const sp = await one(
    `SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
      WHERE ns.nspname='public' AND p.proname LIKE 'approval%' AND p.prosecdef
        AND (p.proconfig IS NULL OR NOT EXISTS (
              SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search_path=%'))`);
  check('toda função SECURITY DEFINER do motor fixa search_path', sp.n === 0, `${sp.n} sem`);

  // ============================================================
  // CENÁRIO DESCARTÁVEL
  // ============================================================
  console.log('\n=== CENÁRIO DESCARTÁVEL ===');
  const suffix = Math.random().toString(36).slice(2, 10);
  const org = (await one(
    `INSERT INTO organizations (name, slug) VALUES ('[P5] Org', $1) RETURNING id`, [`p5-${suffix}`])).id;
  const orgB = (await one(
    `INSERT INTO organizations (name, slug) VALUES ('[P5] Org B', $1) RETURNING id`, [`p5b-${suffix}`])).id;

  const mkUser = async (label, orgId, roleKey) => {
    const uid = (await one(
      `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
       VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated','authenticated',
               $1,'x',now(),now()) RETURNING id`, [`p5.${label}.${suffix}@example.test`])).id;
    await c.query(`INSERT INTO profiles (user_id, organization_id, full_name, status)
                   VALUES ($1,$2,$3,'active')`, [uid, orgId, `[P5] ${label}`]);
    if (roleKey) await c.query(
      `INSERT INTO user_roles (user_id, role_id, organization_id)
       SELECT $1, r.id, $2 FROM roles r WHERE r.key=$3 AND r.organization_id IS NULL`, [uid, orgId, roleKey]);
    return uid;
  };

  // Papéis distintos de propósito: provar SoD com uma pessoa que acumula dois
  // papéis provaria a acumulação, não a regra.
  const requester = await mkUser('requester', org, 'juridico_contratos');
  const legal     = await mkUser('legal',     org, 'juridico_contratos');
  const finance   = await mkUser('finance',   org, 'financeiro');
  const director  = await mkUser('director',  org, 'ceo_diretoria');
  // Um SEGUNDO titular de cada papel de decisão. Sem ele, o pedido aberto pelo
  // próprio diretor não teria aprovador para a etapa de diretoria — e o motor
  // recusaria criá-lo, com razão (NO_ELIGIBLE_APPROVER, §37). Papel com um
  // único titular não é fixture de segregação de funções: é o caso degenerado.
  const director2 = await mkUser('director2', org, 'ceo_diretoria');
  const finance2  = await mkUser('finance2',  org, 'financeiro');
  const legal2    = await mkUser('legal2',    org, 'juridico_contratos');
  const admin     = await mkUser('admin',     org, 'owner_admin');
  const outsider  = await mkUser('outsider',  orgB, 'owner_admin');

  const contract = (await one(
    `INSERT INTO contracts (organization_id, title, contract_number, status, risk_level, currency,
                            total_value, data_class, created_by, owner_user_id)
     VALUES ($1,'[P5] Contrato de prova','P5-001','negotiation','medium','BRL',50000,'demo',$2,$2)
     RETURNING id`, [org, requester])).id;

  // Segundo contrato, criado pelo APROVADOR, para a SoD de autoria do objeto.
  const contractByLegal = (await one(
    `INSERT INTO contracts (organization_id, title, contract_number, status, risk_level, currency,
                            total_value, data_class, created_by, owner_user_id)
     VALUES ($1,'[P5] Contrato do jurídico','P5-002','negotiation','medium','BRL',50000,'demo',$2,$2)
     RETURNING id`, [org, legal])).id;

  /*
    Fábrica de contrato descartável. Cada cenário abaixo ganha o SEU contrato
    porque a regra de "um pedido ativo por ação" (§27) é real: reaproveitar o
    mesmo contrato entre cenários faria o segundo esbarrar no índice parcial —
    que é o comportamento certo, e não o que aquele teste quer medir.
  */
  let contractSeq = 0;
  const mkContract = async (createdBy, o = {}) => (await one(
    `INSERT INTO contracts (organization_id, title, contract_number, status, risk_level, currency,
                            total_value, data_class, created_by, owner_user_id)
     VALUES ($1,$2,$3,'negotiation','medium',$4,$5,'demo',$6,$6) RETURNING id`,
    [org, `[P5] ${o.label ?? 'contrato'} ${contractSeq}`, `P5-${String(contractSeq++).padStart(3,'0')}`,
     o.currency ?? 'BRL', o.value === undefined ? 50000 : o.value, createdBy])).id;

  // A fronteira de corte, ligada SÓ nesta organização descartável. É o que
  // permite exercitar o piloto sem cortar nada de verdade (§34, §63).
  await c.query(
    `INSERT INTO approval_engine_cutover (organization_id, business_domain, subject_type, action_type, justification)
     VALUES ($1,'contracts','contract','approve','Organização descartável da bateria da Fase 5.')`, [org]);
  check('fronteira de corte registrada na organização descartável', true);

  /** Política descartável com dois estágios. Nada disto é regra de negócio real. */
  const mkPolicy = async (key, build) => {
    const pid = (await one(
      `INSERT INTO approval_policies (organization_id, policy_key, name, business_domain)
       VALUES ($1,$2,$3,'contracts') RETURNING id`, [org, key, `[P5] ${key}`])).id;
    return build(pid);
  };

  // ---- política do piloto: estágio 1 jurídico, estágio 2 financeiro + diretoria (quórum 2)
  const policyId = (await one(
    `INSERT INTO approval_policies (organization_id, policy_key, name, business_domain)
     VALUES ($1,'contracts.approve.disposable','[P5] Política descartável','contracts') RETURNING id`, [org])).id;

  const mkVersion = async (opts = {}) => (await one(
    `INSERT INTO approval_policy_versions (organization_id, policy_id, version_no, subject_type, action_type,
       decision_purpose, precedence, request_expires_after, allow_delegation, currency, min_amount, max_amount)
     VALUES ($1,$2,$3,'contract','approve','APPROVAL',$4,$5,$6,$7,$8,$9) RETURNING id`,
    [org, policyId, opts.versionNo ?? 1, opts.precedence ?? 0, opts.expires ?? null,
     opts.delegation ?? true, opts.currency ?? null, opts.min ?? null, opts.max ?? null])).id;

  const v1 = await mkVersion({ versionNo: 1, delegation: true });

  const s1 = (await one(
    `INSERT INTO approval_policy_stages (organization_id, policy_version_id, stage_no, name, quorum_required)
     VALUES ($1,$2,1,'Jurídico',NULL) RETURNING id`, [org, v1])).id;
  const s2 = (await one(
    `INSERT INTO approval_policy_stages (organization_id, policy_version_id, stage_no, name, quorum_required)
     VALUES ($1,$2,2,'Financeiro + Diretoria',2) RETURNING id`, [org, v1])).id;

  const mkStep = async (versionId, stageId, key, o = {}) => (await one(
    `INSERT INTO approval_policy_steps (organization_id, policy_version_id, policy_stage_id, step_key, name,
       decision_purpose, eligibility_mode, permission_key, role_key, named_user_id,
       authority_required, authority_max_amount, authority_currency,
       sod_forbid_requester, sod_forbid_subject_creator, sod_group, delegation_allowed,
       reason_requirement, step_expires_after)
     VALUES ($1,$2,$3,$4,$5,'APPROVAL',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
    [org, versionId, stageId, key, `[P5] ${key}`, o.mode ?? 'ROLE', o.perm ?? null,
     o.mode === 'ROLE' || !o.mode ? (o.role ?? 'juridico_contratos') : null,
     o.named ?? null, o.authority ?? false, o.limit ?? null, o.limitCur ?? null,
     o.sodRequester ?? true, o.sodCreator ?? false, o.sodGroup ?? null, o.delegation ?? false,
     o.reason ?? 'REQUIRED_ON_NEGATIVE', o.stepExpires ?? null])).id;

  await mkStep(v1, s1, 'juridico', { mode: 'ROLE', role: 'juridico_contratos', sodCreator: true,
                                     sodGroup: 'contract_line', delegation: true });
  await mkStep(v1, s2, 'financeiro', { mode: 'ROLE', role: 'financeiro', sodGroup: 'contract_line',
                                       authority: true, limit: 100000, limitCur: 'BRL' });
  await mkStep(v1, s2, 'diretoria',  { mode: 'ROLE', role: 'ceo_diretoria', sodGroup: 'contract_line' });

  // ============================================================
  // §37 — VALIDAÇÃO E ATIVAÇÃO
  // ============================================================
  console.log('\n=== §37 VALIDAÇÃO / ATIVAÇÃO ===');
  const probs = (await c.query(`SELECT code FROM approval_policy_version_problems($1)`, [v1])).rows;
  check('versão desenhada é válida', probs.length === 0, probs.map(p => p.code).join(','));

  // Versão sem etapa: o defeito que faria um pedido nascer aprovado.
  const empty = (await one(
    `INSERT INTO approval_policy_versions (organization_id, policy_id, version_no, subject_type, action_type, decision_purpose)
     VALUES ($1,$2,99,'contract','approve','APPROVAL') RETURNING id`, [org, policyId])).id;
  const emptyProbs = (await c.query(`SELECT code FROM approval_policy_version_problems($1)`, [empty])).rows.map(r => r.code);
  check('versão SEM etapa é recusada (NO_STEPS)', emptyProbs.includes('NO_STEPS'));
  check('ativar versão inválida falha',
    (await refuses(c, `SELECT approval_policy_activate($1)`, [empty])) !== null);

  await c.query(`SELECT approval_policy_activate($1)`, [v1]);
  const v1row = await one(`SELECT status, validated_at IS NOT NULL v FROM approval_policy_versions WHERE id=$1`, [v1]);
  check('v1 ativa e validada', v1row.status === 'ACTIVE' && v1row.v);

  // §9 — a versão ATIVA é imutável na regra.
  const mut = await refuses(c, `UPDATE approval_policy_versions SET precedence = 5 WHERE id=$1`, [v1]);
  check('regra de versão ATIVA é imutável', mut !== null, mut ? '' : 'aceitou UPDATE');
  const mutStep = await refuses(c,
    `UPDATE approval_policy_steps SET authority_max_amount = 1 WHERE policy_version_id=$1`, [v1]);
  check('plano de etapas de versão ATIVA é imutável', mutStep !== null);

  // §10 — ambiguidade barrada na ativação.
  const amb = (await one(
    `INSERT INTO approval_policy_versions (organization_id, policy_id, version_no, subject_type, action_type, decision_purpose, precedence)
     VALUES ($1,$2,1,'contract','approve','APPROVAL',0) RETURNING id`,
    [org, (await one(`INSERT INTO approval_policies (organization_id, policy_key, name, business_domain)
                      VALUES ($1,'contracts.approve.rival','[P5] Rival','contracts') RETURNING id`, [org])).id])).id;
  const ambStage = (await one(
    `INSERT INTO approval_policy_stages (organization_id, policy_version_id, stage_no, name)
     VALUES ($1,$2,1,'Rival') RETURNING id`, [org, amb])).id;
  await mkStep(amb, ambStage, 'rival', { mode: 'ROLE', role: 'juridico_contratos' });
  const ambMsg = await refuses(c, `SELECT approval_policy_activate($1, false)`, [amb]);
  check('duas políticas igualmente autoritativas: ativação BARRADA como ambígua',
    ambMsg !== null && /ambigu/i.test(ambMsg), ambMsg ?? 'ATIVOU SEM RECLAMAR');

  // (continua abaixo)

  // ============================================================
  // O ATOR — auth.uid(), nunca parâmetro
  // ============================================================
  /*
    `asUser` fixa `request.jwt.claims`, que é de onde `auth.uid()` lê. É assim
    que a bateria exerce identidade sem inventar um parâmetro de ator: se
    houvesse um, o teste passaria e a produção estaria furada exatamente onde a
    §36 diz que não pode estar.
  */
  const asUser = async (uid) => c.query(
    `SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid })]);
  const asNobody = async () => c.query(`SELECT set_config('request.jwt.claims','',true)`);

  const createRequest = async (uid, contractId, extra = {}) => {
    await asUser(uid);
    return (await one(
      `SELECT approval_request_create($1,'contract',$2,'approve','APPROVAL',$3,'{}'::jsonb,$4) AS r`,
      [org, contractId, extra.reason ?? 'prova da Fase 5', extra.idem ?? null])).r;
  };
  const stepsOf = async (reqId) => (await c.query(
    `SELECT id, step_key, stage_no, status FROM approval_request_steps
      WHERE request_id=$1 ORDER BY stage_no, step_key`, [reqId])).rows;
  const stepBy = async (reqId, key) => (await stepsOf(reqId)).find(s => s.step_key === key);
  const reqStatus = async (reqId) => (await one(
    `SELECT status, current_stage_no FROM approval_requests WHERE id=$1`, [reqId]));
  const decide = async (uid, stepId, decision, o = {}) => {
    await asUser(uid);
    return (await one(`SELECT approval_decide($1,$2,$3,$4,$5,$6) AS r`,
      [stepId, decision, o.idem ?? `idem-${Math.random().toString(36).slice(2)}`,
       o.reason ?? null, o.delegation ?? null, o.expected ?? null])).r;
  };
  const decideFails = async (uid, stepId, decision, o = {}) => {
    await asUser(uid);
    return refuses(c, `SELECT approval_decide($1,$2,$3,$4,$5,$6)`,
      [stepId, decision, o.idem ?? `idem-${Math.random().toString(36).slice(2)}`,
       o.reason ?? null, o.delegation ?? null, o.expected ?? null]);
  };

  // ============================================================
  // §11/§12/§27 — CRIAÇÃO DO PEDIDO
  // ============================================================
  console.log('\n=== §11/§12/§27 CRIAÇÃO ===');
  const r1 = await createRequest(requester, contract);
  check('pedido criado sob a política ativa', r1.status === 'CREATED' && r1.policy_version_id === v1,
    JSON.stringify(r1).slice(0, 160));
  const req1 = r1.request_id;

  const snap = await one(
    `SELECT policy_key, policy_version_no, subject_fingerprint, subject_amount, subject_currency,
            requested_by, status, current_stage_no, subject_created_by
       FROM approval_requests WHERE id=$1`, [req1]);
  check('pedido congelou política, versão, valor, moeda e autoria do objeto',
    snap.policy_version_no === 1 && snap.subject_amount === '50000.00'
    && snap.subject_currency === 'BRL' && snap.requested_by === requester
    && snap.subject_created_by === requester && snap.current_stage_no === 1);

  const inst = await stepsOf(req1);
  check('3 etapas instanciadas; estágio 1 OPEN, estágio 2 WAITING',
    inst.length === 3 && inst.filter(s => s.status === 'OPEN').length === 1
    && inst.filter(s => s.status === 'WAITING').length === 2);

  // §27 — o mesmo clique de novo não abre um segundo processo.
  const again = await createRequest(requester, contract);
  check('repetir a criação devolve o MESMO pedido, não um segundo',
    again.status === 'EXISTING' && again.request_id === req1);

  // Índice parcial: mesmo com chave de idempotência diferente, dois pedidos
  // ativos para a mesma ação não coexistem.
  const dup = await refuses(c,
    `SELECT approval_request_create($1,'contract',$2,'approve','APPROVAL',null,'{}'::jsonb,$3)`,
    [org, contract, `forcado-${suffix}`]);
  check('segundo pedido ATIVO para a mesma ação é barrado pelo banco', dup !== null);

  // §10 — sem política casando, resposta EXPLÍCITA, nunca "aprovado".
  await asUser(requester);
  const noPol = (await one(
    `SELECT approval_request_create($1,'contract',$2,'renew','APPROVAL') AS r`, [org, contract])).r;
  check('ação sem política devolve NO_POLICY explícito', noPol.status === 'NO_POLICY');

  const badSubject = (await one(
    `SELECT approval_request_create($1,'invoice',$2,'approve','APPROVAL') AS r`, [org, contract])).r;
  check('sujeito não registrado devolve SUBJECT_TYPE_UNSUPPORTED',
    badSubject.status === 'SUBJECT_TYPE_UNSUPPORTED');

  // ============================================================
  // §17 — SEGREGAÇÃO DE FUNÇÕES
  // ============================================================
  console.log('\n=== §17 SEGREGAÇÃO DE FUNÇÕES ===');
  const legalStep = await stepBy(req1, 'juridico');

  // O requerente TEM o papel `juridico_contratos`. Sem SoD ele aprovaria.
  const selfMsg = await decideFails(requester, legalStep.id, 'APPROVED');
  check('requerente NÃO aprova o próprio pedido', selfMsg !== null && /SOD_REQUESTER/.test(selfMsg));

  // §17 — administrador não dispensa SoD por ser administrador.
  const adminMsg = await decideFails(admin, legalStep.id, 'APPROVED');
  check('owner_admin NÃO aprova por ser admin (SoD e elegibilidade valem)',
    adminMsg !== null, adminMsg ? adminMsg.slice(0, 80) : 'ADMIN APROVOU');

  // Autoria do OBJETO: no contrato criado pelo jurídico, o jurídico não decide.
  const r2 = await createRequest(director, contractByLegal, { idem: `creator-${suffix}` });
  const legalStep2 = await stepBy(r2.request_id, 'juridico');
  const creatorMsg = await decideFails(legal, legalStep2.id, 'APPROVED');
  check('quem cadastrou o CONTRATO não decide a etapa que proíbe o autor',
    creatorMsg !== null && /SOD_SUBJECT_CREATOR/.test(creatorMsg));

  // ============================================================
  // §15/§50 — ORDEM DOS ESTÁGIOS
  // ============================================================
  console.log('\n=== §15/§50 ORDEM ===');
  const finStep = await stepBy(req1, 'financeiro');
  const earlyMsg = await decideFails(finance, finStep.id, 'APPROVED');
  check('etapa de estágio FUTURO não pode ser aprovada antes da hora',
    earlyMsg !== null && /Ordem de aprovação/.test(earlyMsg));

  const d1 = await decide(legal, legalStep.id, 'APPROVED');
  check('estágio 1 aprovado', d1.status === 'RECORDED' && d1.request_status === 'PENDING');
  check('estágio 2 abriu', (await reqStatus(req1)).current_stage_no === 2);
  const afterOpen = await stepsOf(req1);
  check('as duas etapas do estágio 2 abriram em PARALELO',
    afterOpen.filter(s => s.stage_no === 2 && s.status === 'OPEN').length === 2);

  // Etapa já decidida não decide de novo.
  const redoMsg = await decideFails(legal, legalStep.id, 'REJECTED', { reason: 'x' });
  check('etapa já finalizada NÃO decide de novo', redoMsg !== null);

  // ============================================================
  // §16/§51 — PARALELO E QUÓRUM
  // ============================================================
  console.log('\n=== §16/§51 QUÓRUM ===');
  const dirStep = await stepBy(req1, 'diretoria');
  await decide(finance, finStep.id, 'APPROVED');
  check('quórum 2/2: com UMA aprovação o pedido continua PENDENTE',
    (await reqStatus(req1)).status === 'PENDING');

  // §17 — o mesmo ator não cumpre duas etapas incompatíveis do mesmo grupo.
  const bothMsg = await decideFails(finance, dirStep.id, 'APPROVED');
  check('o MESMO ator não satisfaz duas etapas incompatíveis (sod_group)',
    bothMsg !== null && /SOD_INCOMPATIBLE_STEP/.test(bothMsg));

  await decide(director, dirStep.id, 'APPROVED');
  const fin = await reqStatus(req1);
  check('com o quórum completo o pedido finaliza APPROVED', fin.status === 'APPROVED');

  // §22 — decisão depois do estado final é recusada.
  const afterFinal = await decideFails(director, dirStep.id, 'APPROVED');
  check('decisão APÓS finalização é recusada', afterFinal !== null);

  // ============================================================
  // §23 — IDEMPOTÊNCIA
  // ============================================================
  console.log('\n=== §23 IDEMPOTÊNCIA ===');
  const r3 = await createRequest(director, contract, { idem: `idem-scenario-${suffix}` });
  const st3 = await stepBy(r3.request_id, 'juridico');
  const key = `retry-${suffix}`;
  const a1 = await decide(legal, st3.id, 'APPROVED', { idem: key });
  const a2 = await decide(legal, st3.id, 'APPROVED', { idem: key });
  check('retentativa com a MESMA chave devolve a MESMA decisão',
    a2.status === 'IDEMPOTENT_REPLAY' && a2.decision_id === a1.decision_id);
  const nDec = await one(
    `SELECT count(*)::int n FROM approval_decisions WHERE request_step_id=$1`, [st3.id]);
  check('a retentativa NÃO duplicou o histórico', nDec.n === 1);

  const conflict = await decideFails(legal, st3.id, 'REJECTED', { idem: key, reason: 'outro' });
  check('a mesma chave com decisão DIFERENTE é recusada', conflict !== null);

  // §23 — o histórico é append-only, sempre.
  const upd = await refuses(c, `UPDATE approval_decisions SET decision='REJECTED' WHERE id=$1`, [a1.decision_id]);
  check('APPROVED não vira REJECTED por UPDATE', upd !== null && /append-only/i.test(upd));
  /*
    A fronteira de apagamento é a MESMA que a 110 desenhou: a APLICAÇÃO não
    apaga história; o caminho privilegiado (exclusão do inquilino inteiro)
    continua aberto. Por isso o teste roda sob o papel do navegador — rodá-lo
    como dono do banco mediria o caminho errado e passaria a afirmar algo falso.
  */
  await c.query('SAVEPOINT erase_probe');
  await c.query(`SET LOCAL ROLE authenticated`);
  const del = await refuses(c, `DELETE FROM approval_decisions WHERE id=$1`, [a1.decision_id]);
  await c.query(`RESET ROLE`);
  await c.query('ROLLBACK TO SAVEPOINT erase_probe');
  check('a APLICAÇÃO não apaga decisão', del !== null);

  // ============================================================
  // §18/§53 — ALÇADA
  // ============================================================
  console.log('\n=== §18/§53 ALÇADA ===');
  // A etapa `financeiro` tem alçada de BRL 100.000. O contrato vale 50.000.
  const finStep3 = await stepBy(r3.request_id, 'financeiro');
  const okAuth = await decide(finance, finStep3.id, 'APPROVED');
  const prov = await one(
    `SELECT authority_source, authority_basis, authority_limit_amount, authority_currency,
            subject_amount, subject_currency FROM approval_decisions WHERE id=$1`, [okAuth.decision_id]);
  check('valor DENTRO da alçada decide e grava a proveniência',
    prov.authority_limit_amount === '100000.00' && prov.authority_currency === 'BRL'
    && prov.subject_amount === '50000.00' && prov.authority_source === 'ROLE');

  // Contrato ACIMA do limite: recusa.
  const bigContract = (await one(
    `INSERT INTO contracts (organization_id, title, contract_number, status, risk_level, currency,
                            total_value, data_class, created_by, owner_user_id)
     VALUES ($1,'[P5] Contrato acima da alçada','P5-003','negotiation','medium','BRL',250000,'demo',$2,$2)
     RETURNING id`, [org, director])).id;
  const rBig = await createRequest(director, bigContract, { idem: `big-${suffix}` });
  await decide(legal, (await stepBy(rBig.request_id, 'juridico')).id, 'APPROVED');
  const overMsg = await decideFails(finance, (await stepBy(rBig.request_id, 'financeiro')).id, 'APPROVED');
  check('valor ACIMA da alçada é recusado',
    overMsg !== null && /AUTHORITY_LIMIT_EXCEEDED/.test(overMsg));

  // Moeda incompatível: bloqueia, e não converte.
  const usdContract = (await one(
    `INSERT INTO contracts (organization_id, title, contract_number, status, risk_level, currency,
                            total_value, data_class, created_by, owner_user_id)
     VALUES ($1,'[P5] Contrato em dólar','P5-004','negotiation','medium','USD',1000,'demo',$2,$2)
     RETURNING id`, [org, director])).id;
  const rUsd = await createRequest(director, usdContract, { idem: `usd-${suffix}` });
  await decide(legal, (await stepBy(rUsd.request_id, 'juridico')).id, 'APPROVED');
  const curMsg = await decideFails(finance, (await stepBy(rUsd.request_id, 'financeiro')).id, 'APPROVED');
  check('moeda incompatível BLOQUEIA (nenhuma conversão inventada)',
    curMsg !== null && /AUTHORITY_CURRENCY_MISMATCH/.test(curMsg));

  // Valor DESCONHECIDO bloqueia — nunca vira "dentro do limite".
  const nullContract = (await one(
    `INSERT INTO contracts (organization_id, title, contract_number, status, risk_level, currency,
                            total_value, data_class, created_by, owner_user_id)
     VALUES ($1,'[P5] Contrato sem valor','P5-005','negotiation','medium','BRL',NULL,'demo',$2,$2)
     RETURNING id`, [org, director])).id;
  const rNull = await createRequest(director, nullContract, { idem: `nullv-${suffix}` });
  await decide(legal, (await stepBy(rNull.request_id, 'juridico')).id, 'APPROVED');
  const unkMsg = await decideFails(finance, (await stepBy(rNull.request_id, 'financeiro')).id, 'APPROVED');
  check('valor DESCONHECIDO bloqueia a etapa com alçada',
    unkMsg !== null && /AUTHORITY_AMOUNT_UNKNOWN/.test(unkMsg));

  // ============================================================
  // §20/§54 — DELEGAÇÃO
  // ============================================================
  console.log('\n=== §20/§54 DELEGAÇÃO ===');
  const cDel = await mkContract(legal, { label: 'delegacao-sod' });
  const rDel = await createRequest(director, cDel, { idem: `del-${suffix}` });
  const delStep = await stepBy(rDel.request_id, 'juridico');
  // `juridico` é a única etapa com delegação permitida na política v1.
  const mkDelegation = async (from, to, o = {}) => (await one(
    `INSERT INTO approval_delegations (organization_id, delegator_user_id, delegate_user_id,
       max_amount, currency, effective_from, effective_until, reason, created_by, scope_subject_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'prova da Fase 5',$2,$8) RETURNING id`,
    [org, from, to, o.max ?? null, o.cur ?? null,
     o.from ?? new Date(Date.now() - 3600e3).toISOString(),
     o.until ?? new Date(Date.now() + 3600e3).toISOString(), o.scope ?? null])).id;

  // O jurídico é o AUTOR do contrato e está barrado por SoD de autoria; delegar
  // para o financeiro não pode contornar isso.
  const delToFinance = await mkDelegation(legal, finance);
  const sodDelMsg = await decideFails(finance, delStep.id, 'APPROVED', { delegation: delToFinance });
  check('delegação NÃO contorna a SoD do delegante',
    sodDelMsg !== null && /SOD_SUBJECT_CREATOR/.test(sodDelMsg));

  // Delegação válida num pedido em que o delegante não está barrado.
  const cDel2 = await mkContract(director, { label: 'delegacao-ok' });
  const rDel2 = await createRequest(director, cDel2, { idem: `del2-${suffix}` });
  const delStep2 = await stepBy(rDel2.request_id, 'juridico');
  const goodDel = await mkDelegation(legal, finance);
  const dOk = await decide(finance, delStep2.id, 'APPROVED', { delegation: goodDel });
  const dProv = await one(
    `SELECT authority_source, on_behalf_of_user_id, delegation_id, authority_basis
       FROM approval_decisions WHERE id=$1`, [dOk.decision_id]);
  check('delegação válida decide e grava a PROVENIÊNCIA (delegado + delegante)',
    dProv.authority_source === 'DELEGATED' && dProv.on_behalf_of_user_id === legal
    && dProv.delegation_id === goodDel && /delegation:/.test(dProv.authority_basis));

  // Delegação EXPIRADA e REVOGADA.
  const cDel3 = await mkContract(director, { label: 'delegacao-invalida' });
  const rDel3 = await createRequest(director, cDel3, { idem: `del3-${suffix}` });
  const dStep3 = await stepBy(rDel3.request_id, 'juridico');
  const expired = await mkDelegation(director, finance, {
    from: new Date(Date.now() - 7200e3).toISOString(), until: new Date(Date.now() - 3600e3).toISOString() });
  const expMsg = await decideFails(finance, dStep3.id, 'APPROVED', { delegation: expired });
  check('delegação EXPIRADA não decide', expMsg !== null && /DELEGATION_EXPIRED/.test(expMsg));

  const revoked = await mkDelegation(director, finance);
  await c.query(`UPDATE approval_delegations SET revoked_at=now(), revoked_by=$2 WHERE id=$1`, [revoked, director]);
  const revMsg = await decideFails(finance, dStep3.id, 'APPROVED', { delegation: revoked });
  check('delegação REVOGADA não decide', revMsg !== null && /DELEGATION_REVOKED/.test(revMsg));

  // Delegação de OUTRO inquilino.
  const foreignDel = await refuses(c,
    `INSERT INTO approval_delegations (organization_id, delegator_user_id, delegate_user_id,
       effective_until, reason, created_by)
     VALUES ($1,$2,$3,now()+interval '1 day','x',$2)`, [org, outsider, finance]);
  const foreignId = foreignDel === null ? null : null;
  const crossDel = (await one(
    `INSERT INTO approval_delegations (organization_id, delegator_user_id, delegate_user_id,
       effective_until, reason, created_by)
     VALUES ($1,$2,$3,now()+interval '1 day','cross',$2) RETURNING id`, [orgB, outsider, finance])).id;
  const crossMsg = await decideFails(finance, dStep3.id, 'APPROVED', { delegation: crossDel });
  check('delegação de OUTRO inquilino é recusada, com mensagem genérica',
    crossMsg !== null && /DELEGATION_INVALID/.test(crossMsg) && !/organiz/i.test(crossMsg.split('\n')[0]));

  // Teto do delegante limita o delegado.
  // Objeto criado pelo ADMIN e pedido aberto pelo DIRETOR, para que a etapa
  // jurídica não esbarre nem na autoria do objeto nem na SoD do requerente —
  // o que este bloco mede é só a delegação onde a política a proíbe.
  const cDel4 = await mkContract(admin, { label: 'delegacao-proibida' });
  const rDel4 = await createRequest(director, cDel4, { idem: `del4-${suffix}` });
  await decide(legal, (await stepBy(rDel4.request_id, 'juridico')).id, 'APPROVED');
  check('delegação não é aceita em etapa que a política não permite',
    (await decideFails(director, (await stepBy(rDel4.request_id, 'financeiro')).id, 'APPROVED',
      { delegation: goodDel })) !== null);

  // §20 — sem encadeamento: o delegante precisa satisfazer a etapa POR SI.
  const cChain = await mkContract(admin, { label: 'sem-encadeamento' });
  // Pedido aberto pelo ADMIN: o diretor precisa chegar à etapa sem esbarrar
  // antes na SoD do requerente, senão o teste mediria a SoD e não a cadeia.
  const rChain = await createRequest(admin, cChain, { idem: `chain-${suffix}` });
  const chainStep = await stepBy(rChain.request_id, 'juridico');
  // `finance` NÃO tem `juridico_contratos`. Delegar de finance para director
  // não empresta ao director um papel que o finance também não tem.
  const chainDel = await mkDelegation(finance, director);
  const chainMsg = await decideFails(director, chainStep.id, 'APPROVED', { delegation: chainDel });
  check('delegado NÃO ganha autoridade que o delegante não tinha',
    chainMsg !== null && /MISSING_ROLE/.test(chainMsg));

  // ============================================================
  // §26/§58 — IMPRESSÃO DIGITAL
  // ============================================================
  console.log('\n=== §26/§58 IMPRESSÃO DIGITAL ===');
  const cFp = await mkContract(director, { label: 'impressao-digital' });
  const rFp = await createRequest(director, cFp, { idem: `fp-${suffix}` });
  const fpStep = await stepBy(rFp.request_id, 'diretoria');
  const fpLegal = await stepBy(rFp.request_id, 'juridico');
  const fpBefore = (await one(`SELECT subject_fingerprint f FROM approval_requests WHERE id=$1`, [rFp.request_id])).f;

  // Mudança IRRELEVANTE não invalida.
  await c.query(`UPDATE contracts SET health_score = 42 WHERE id=$1`, [cFp]);
  const fpSame = (await one(`SELECT contract_approval_fingerprint($1) f`, [cFp])).f;
  check('mudança que não é conteúdo (health_score) NÃO invalida a aprovação', fpSame === fpBefore);
  const okFp = await decide(legal, fpLegal.id, 'APPROVED');
  check('conteúdo inalterado permite decidir', okFp.status === 'RECORDED');

  // Mudança MATERIAL invalida.
  await c.query(`UPDATE contracts SET total_value = 999999 WHERE id=$1`, [cFp]);
  const changedMsg = await decideFails(finance, (await stepBy(rFp.request_id, 'financeiro')).id, 'APPROVED');
  check('objeto ALTERADO bloqueia a decisão pendente (SUBJECT_CHANGED)',
    changedMsg !== null && /SUBJECT_CHANGED/.test(changedMsg));
  await c.query(`UPDATE contracts SET total_value = 50000 WHERE id=$1`, [cFp]);

  /*
    §26 — a revisão do ADITIVO é o sujeito exato, não o contêiner mutável.

    Duas afirmações aqui, e as duas importam:
      1. aditar o contrato MUDA a impressão digital dele — aprovar o contrato
         de ontem não pode autorizar o contrato já aditado de hoje;
      2. a revisão do aditivo é sujeito de primeira classe, com impressão
         própria, porque `contract_amendments` é editável e a revisão não é.
  */
  const cAmd = await mkContract(admin, { label: 'aditivo' });
  const fpBeforeAmd = (await one(`SELECT contract_approval_fingerprint($1) f`, [cAmd])).f;
  check('impressão digital do contrato é um sha256 estável',
    typeof fpBeforeAmd === 'string' && fpBeforeAmd.length === 64);

  const amendmentId = (await one(
    `INSERT INTO contract_amendments (organization_id, contract_id, amendment_number, title,
                                      status, value_delta, created_by)
     VALUES ($1,$2,'1','[P5] Aditivo de prova','draft',10000,$3) RETURNING id`,
    [org, cAmd, admin])).id;
  // A revisão NÃO é criada aqui: a linhagem da Fase 2 (migration 108) já a
  // grava por gatilho. Inserir uma à mão criaria uma segunda verdade sobre a
  // mesma revisão — e foi a restrição única dela que apontou isso.
  const revId = (await one(
    `SELECT id FROM contract_amendment_revisions
      WHERE amendment_id=$1 ORDER BY revision DESC LIMIT 1`, [amendmentId])).id;
  const fpAfterAmd = (await one(`SELECT contract_approval_fingerprint($1) f`, [cAmd])).f;
  check('uma revisão NOVA de aditivo muda a impressão digital do contrato',
    fpAfterAmd !== fpBeforeAmd);

  const revSubj = await one(
    `SELECT supported, found, fingerprint, amount, label
       FROM approval_subject_resolve($1,'contract_amendment_revision',$2)`, [org, revId]);
  check('a REVISÃO do aditivo é sujeito de primeira classe, com impressão própria',
    revSubj.supported && revSubj.found && revSubj.fingerprint.length === 64
    && revSubj.fingerprint !== fpAfterAmd);
  const revForeign = await one(
    `SELECT supported, found FROM approval_subject_resolve($1,'contract_amendment_revision',$2)`, [orgB, revId]);
  check('a mesma revisão vista de OUTRO inquilino não é encontrada',
    revForeign.supported && !revForeign.found);

  // ============================================================
  // §25/§57 — DEVOLUÇÃO, CANCELAMENTO, EXPIRAÇÃO, SUCESSÃO
  // ============================================================
  console.log('\n=== §25/§57 CICLO DE VIDA ===');
  const cRet = await mkContract(director, { label: 'devolucao' });
  const rRet = await createRequest(director, cRet, { idem: `ret-${suffix}` });
  const retStep = await stepBy(rRet.request_id, 'juridico');
  check('devolver SEM motivo é recusado',
    (await decideFails(legal, retStep.id, 'RETURNED_FOR_CORRECTION')) !== null);
  const retOk = await decide(legal, retStep.id, 'RETURNED_FOR_CORRECTION', { reason: 'faltou anexo' });
  check('devolução para correção é estado PRÓPRIO, distinto de rejeição',
    retOk.request_status === 'RETURNED_FOR_CORRECTION');
  const retDec = await one(`SELECT decision FROM approval_decisions WHERE request_step_id=$1`, [retStep.id]);
  check('a decisão registrada é RETURNED_FOR_CORRECTION, não REJECTED',
    retDec.decision === 'RETURNED_FOR_CORRECTION');
  check('pedido devolvido não aceita mais decisão',
    (await decideFails(finance, (await stepBy(rRet.request_id, 'financeiro')).id, 'APPROVED')) !== null);

  // Rejeição.
  const cRej = await mkContract(director, { label: 'rejeicao' });
  const rRej = await createRequest(director, cRej, { idem: `rej-${suffix}` });
  const rejOk = await decide(legal, (await stepBy(rRej.request_id, 'juridico')).id, 'REJECTED', { reason: 'fora do escopo' });
  check('rejeição finaliza o pedido como REJECTED', rejOk.request_status === 'REJECTED');

  // Cancelamento.
  const cCan = await mkContract(director, { label: 'cancelamento' });
  const rCan = await createRequest(director, cCan, { idem: `can-${suffix}` });
  await asUser(director);
  const canOk = (await one(`SELECT approval_request_cancel($1,'desistiu') AS r`, [rCan.request_id])).r;
  check('cancelamento autorizado funciona', canOk.status === 'CANCELLED');
  check('cancelar depois de finalizado é recusado',
    (await refuses(c, `SELECT approval_request_cancel($1,'de novo')`, [rCan.request_id])) !== null);
  const canDecisions = await one(
    `SELECT count(*)::int n FROM approval_decisions WHERE request_id=$1`, [rCan.request_id]);
  check('cancelar NÃO apaga nada (nenhuma decisão removida)', canDecisions.n === 0);
  await asUser(legal);
  const canDenied = await refuses(c, `SELECT approval_request_cancel($1,'x')`, [req1]);
  check('quem não pediu e não administra NÃO cancela', canDenied !== null);

  // Expiração.
  console.log('   -- expiração --');
  const vExp = (await one(
    `INSERT INTO approval_policy_versions (organization_id, policy_id, version_no, subject_type, action_type,
       decision_purpose, request_expires_after)
     VALUES ($1,$2,1,'contract','expire_probe','APPROVAL', interval '1 hour') RETURNING id`,
    [org, (await one(`INSERT INTO approval_policies (organization_id, policy_key, name, business_domain)
                      VALUES ($1,'contracts.expire.probe','[P5] Expiração','contracts') RETURNING id`, [org])).id])).id;
  const expStage = (await one(
    `INSERT INTO approval_policy_stages (organization_id, policy_version_id, stage_no, name)
     VALUES ($1,$2,1,'Único') RETURNING id`, [org, vExp])).id;
  await mkStep(vExp, expStage, 'unico', { mode: 'ROLE', role: 'juridico_contratos' });
  await c.query(`SELECT approval_policy_activate($1)`, [vExp]);
  const cExp = await mkContract(director, { label: 'expiracao' });
  await asUser(director);
  const rExp = (await one(
    `SELECT approval_request_create($1,'contract',$2,'expire_probe','APPROVAL') AS r`, [org, cExp])).r;
  check('pedido com prazo nasce com expires_at',
    (await one(`SELECT expires_at IS NOT NULL e FROM approval_requests WHERE id=$1`, [rExp.request_id])).e);
  // Empurra o prazo para o passado, como o relógio faria.
  await c.query(`UPDATE approval_requests SET expires_at = now() - interval '1 minute' WHERE id=$1`, [rExp.request_id]);
  const expStepRow = await stepBy(rExp.request_id, 'unico');
  const decExpMsg = await decideFails(legal, expStepRow.id, 'APPROVED');
  check('decisão APÓS o prazo é recusada mesmo sem o agendador ter rodado',
    decExpMsg !== null && /expirado/i.test(decExpMsg));
  check('antes da varredura o pedido ainda está PENDING na projeção',
    (await reqStatus(rExp.request_id)).status === 'PENDING');
  const nExpired = (await one(`SELECT approval_requests_expire_due(500) AS n`)).n;
  check('a varredura materializa a expiração', nExpired >= 1, `${nExpired}`);
  check('e o desfecho é EXPIRED — nunca REJECTED',
    (await reqStatus(rExp.request_id)).status === 'EXPIRED');
  check('a varredura é idempotente (segunda passada não expira nada)',
    (await one(`SELECT approval_requests_expire_due(500) AS n`)).n === 0);
  check('varredura com limite inválido é recusada (lição da 124)',
    (await refuses(c, `SELECT approval_requests_expire_due(NULL)`)) !== null);

  // Sucessão.
  console.log('   -- sucessão --');
  const cSup = await mkContract(director, { label: 'sucessao' });
  const rSup = await createRequest(director, cSup, { idem: `sup-a-${suffix}` });
  await asUser(director);
  const rSup2 = (await one(
    `SELECT approval_request_create($1,'contract',$2,'approve','APPROVAL','substitui','{}'::jsonb,$3,null,$4) AS r`,
    [org, cSup, `sup-b-${suffix}`, rSup.request_id])).r;
  check('novo pedido criado como sucessor', rSup2.status === 'CREATED');
  check('o pedido antigo ficou SUPERSEDED', (await reqStatus(rSup.request_id)).status === 'SUPERSEDED');
  check('pedido substituído NÃO é mais decidível',
    (await decideFails(legal, (await stepBy(rSup.request_id, 'juridico')).id, 'APPROVED')) !== null);
  const supRow = await one(`SELECT status, finalized_at IS NOT NULL f FROM approval_requests WHERE id=$1`, [rSup.request_id]);
  check('e continua existindo, imutável, com desfecho registrado', supRow.f);

  // ============================================================
  // §28/§59 — EVENTOS TRANSACIONAIS
  // ============================================================
  console.log('\n=== §28/§59 EVENTOS ===');
  const evs = (await c.query(
    `SELECT event_type, count(*)::int n FROM domain_events
      WHERE organization_id=$1 AND event_type LIKE 'approval.%' GROUP BY 1 ORDER BY 1`, [org])).rows;
  const evMap = Object.fromEntries(evs.map(e => [e.event_type, e.n]));
  for (const t of ['approval.request.created', 'approval.stage.opened', 'approval.decision.recorded',
                   'approval.request.approved', 'approval.request.rejected',
                   'approval.request.returned_for_correction', 'approval.request.cancelled',
                   'approval.request.expired', 'approval.request.superseded']) {
    check(`evento emitido: ${t}`, (evMap[t] ?? 0) > 0, `${evMap[t] ?? 0}`);
  }
  const evOrg = await one(
    `SELECT count(*)::int n FROM domain_events e
      WHERE e.event_type LIKE 'approval.%' AND e.causation_event_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM domain_events p
                         WHERE p.id = e.causation_event_id AND p.organization_id = e.organization_id)`);
  check('toda causação de evento de aprovação é do MESMO inquilino', evOrg.n === 0);

  const decEv = await one(
    `SELECT count(*)::int n FROM approval_decisions d
      WHERE d.organization_id=$1
        AND NOT EXISTS (SELECT 1 FROM domain_events e
                         WHERE e.idempotency_key = 'approval-decision:'||d.id::text
                           AND e.organization_id = d.organization_id)`, [org]);
  check('TODA decisão gravada tem o seu fato — nenhuma sem evento', decEv.n === 0);

  // §30 — APPROVED é decisão, não execução.
  const dsPayload = await one(
    `SELECT payload->>'downstream_execution' AS d FROM domain_events
      WHERE organization_id=$1 AND event_type='approval.request.approved' LIMIT 1`, [org]);
  check('o fato de aprovação declara a execução a jusante como NÃO iniciada',
    dsPayload.d === 'not_started');

  // ============================================================
  // §55 — INJEÇÃO DE FALHA: a decisão é atômica ou não é
  // ============================================================
  console.log('\n=== §55 INJEÇÃO DE FALHA ===');
  const cAtom = await mkContract(director, { label: 'atomicidade' });
  const rAtom = await createRequest(director, cAtom, { idem: `atom-${suffix}` });
  const atomStep = await stepBy(rAtom.request_id, 'juridico');

  // Falha FORÇADA na emissão do evento, com um gatilho temporário. Se a decisão
  // e o evento não estivessem na mesma transação, a decisão sobreviveria.
  // CREATE OR REPLACE porque `pg_temp` é da SESSÃO, e o pooler reaproveita
  // backends: uma execução anterior pode ter deixado a função aqui.
  await c.query(`
    CREATE OR REPLACE FUNCTION pg_temp.p5_break_event() RETURNS trigger LANGUAGE plpgsql AS $x$
    BEGIN RAISE EXCEPTION 'falha injetada na emissão do evento'; END $x$;`);
  await c.query(`DROP TRIGGER IF EXISTS p5_break_event ON public.domain_events`);
  await c.query(`
    CREATE TRIGGER p5_break_event BEFORE INSERT ON public.domain_events
    FOR EACH ROW WHEN (NEW.event_type = 'approval.decision.recorded')
    EXECUTE FUNCTION pg_temp.p5_break_event();`);
  const injected = await decideFails(legal, atomStep.id, 'APPROVED');
  await c.query(`DROP TRIGGER p5_break_event ON public.domain_events`);
  check('falha na emissão do evento DERRUBA a decisão inteira',
    injected !== null && /falha injetada/.test(injected));
  const leftover = await one(
    `SELECT (SELECT count(*)::int FROM approval_decisions WHERE request_step_id=$1) dec,
            (SELECT status FROM approval_request_steps WHERE id=$1) st,
            (SELECT status FROM approval_requests WHERE id=$2) rq`, [atomStep.id, rAtom.request_id]);
  check('nada sobrou: sem decisão, etapa ainda OPEN, pedido ainda PENDING',
    leftover.dec === 0 && leftover.st === 'OPEN' && leftover.rq === 'PENDING');
  // E o caminho normal volta a funcionar depois — a falha não deixou resíduo.
  check('depois da falha, a MESMA etapa decide normalmente',
    (await decide(legal, atomStep.id, 'APPROVED')).status === 'RECORDED');

  // ============================================================
  // §38/§48 — INQUILINO
  // ============================================================
  console.log('\n=== §38/§48 INQUILINO ===');
  const crossFk = await refuses(c,
    `INSERT INTO approval_requests (organization_id, policy_version_id, policy_id, policy_key,
       policy_version_no, subject_type, subject_id, action_type, decision_purpose,
       subject_fingerprint, idempotency_key)
     VALUES ($1,$2,$3,'x',1,'contract',$4,'approve','APPROVAL','f',$5)`,
    [orgB, v1, policyId, contract, `cross-${suffix}`]);
  check('pedido de um inquilino apontando para política de OUTRO é barrado pela FK composta',
    crossFk !== null);

  const crossDec = await refuses(c,
    `INSERT INTO approval_decisions (organization_id, request_id, request_step_id, step_key, stage_no,
       decision, decision_purpose, actor_user_id, authority_source, subject_fingerprint, idempotency_key)
     VALUES ($1,$2,$3,'x',1,'APPROVED','APPROVAL',$4,'ROLE','f',$5)`,
    [orgB, req1, legalStep.id, outsider, `crossd-${suffix}`]);
  check('decisão de outro inquilino sobre pedido alheio é barrada', crossDec !== null);

  // O papel do navegador não escreve decisão — nem com todas as permissões.
  await c.query('SAVEPOINT role_probe');
  await c.query(`SET LOCAL ROLE authenticated`);
  await asUser(legal);
  const browserWrite = await refuses(c,
    `INSERT INTO approval_decisions (organization_id, request_id, request_step_id, step_key, stage_no,
       decision, decision_purpose, actor_user_id, authority_source, subject_fingerprint, idempotency_key)
     VALUES ($1,$2,$3,'x',1,'APPROVED','APPROVAL',$4,'ROLE','f',$5)`,
    [org, req1, legalStep.id, legal, `browser-${suffix}`]);
  check('papel do NAVEGADOR não insere decisão nem com sessão válida', browserWrite !== null);
  const browserReq = await refuses(c,
    `UPDATE approval_requests SET status='APPROVED' WHERE id=$1`, [req1]);
  check('papel do NAVEGADOR não muda o status de um pedido', browserReq !== null);
  // Oráculo de elegibilidade fechado POR CONSTRUÇÃO: a função com parâmetro de
  // ator não é alcançável pelo navegador, e a que ele alcança não tem o parâmetro.
  const probe = await refuses(c, `SELECT * FROM approval_step_eligibility($1,$2)`, [legalStep.id, director]);
  check('navegador NÃO alcança a elegibilidade com parâmetro de ator', probe !== null);
  const ownProbe = await refuses(c, `SELECT * FROM approval_step_eligibility_for_viewer($1)`, [legalStep.id]);
  check('mas consulta a PRÓPRIA elegibilidade normalmente', ownProbe === null, ownProbe ?? '');
  await c.query(`RESET ROLE`);
  await c.query('ROLLBACK TO SAVEPOINT role_probe');

  // ============================================================
  // §9/§49 — VERSIONAMENTO NÃO REESCREVE HISTÓRIA
  // ============================================================
  console.log('\n=== §9/§49 VERSÃO NÃO REESCREVE ===');
  const cV1 = await mkContract(director, { label: 'versao-v1' });
  const rV1 = await createRequest(director, cV1, { idem: `vtest-${suffix}` });
  const v2 = await mkVersion({ versionNo: 2, delegation: false });
  const v2s1 = (await one(
    `INSERT INTO approval_policy_stages (organization_id, policy_version_id, stage_no, name)
     VALUES ($1,$2,1,'Só diretoria') RETURNING id`, [org, v2])).id;
  await mkStep(v2, v2s1, 'diretoria', { mode: 'ROLE', role: 'ceo_diretoria' });
  await c.query(`SELECT approval_policy_activate($1)`, [v2]);

  const stillV1 = await one(
    `SELECT policy_version_id, policy_version_no FROM approval_requests WHERE id=$1`, [rV1.request_id]);
  check('pedido criado sob a v1 CONTINUA na v1 depois de a v2 ficar ativa',
    stillV1.policy_version_id === v1 && stillV1.policy_version_no === 1);
  const stillSteps = await stepsOf(rV1.request_id);
  check('e a rota dele continua sendo a da v1 (3 etapas), não a da v2', stillSteps.length === 3);

  const cV2 = await mkContract(director, { label: 'versao-v2' });
  const rV2 = await createRequest(legal, cV2, { idem: `vtest2-${suffix}` });
  const v2row = await one(`SELECT policy_version_no FROM approval_requests WHERE id=$1`, [rV2.request_id]);
  check('pedido NOVO nasce sob a v2', v2row.policy_version_no === 2);
  check('a v1 ficou SUPERSEDED',
    (await one(`SELECT status FROM approval_policy_versions WHERE id=$1`, [v1])).status === 'SUPERSEDED');

  // ============================================================
  // §32/§60 — LEGADO E FRONTEIRA DE CORTE
  // ============================================================
  console.log('\n=== §32/§60 LEGADO / CORTE ===');
  const legacyRows = await one(
    `SELECT count(*)::int n, count(*) FILTER (WHERE provenance='LEGACY_CONTRACT_APPROVALS')::int p,
            count(policy_version_id)::int fabricated
       FROM contract_approvals_legacy_history`);
  check('história legada continua legível', legacyRows.n === 3, `${legacyRows.n} linhas`);
  check('e declarada como LEGADO em toda linha', legacyRows.p === legacyRows.n);
  check('nenhum campo do motor novo foi FABRICADO no legado', legacyRows.fabricated === 0);

  // A organização REAL não foi cortada: o caminho legado continua escrevendo.
  const realOrg = (await one(`SELECT organization_id o FROM contract_approvals LIMIT 1`)).o;
  check('organização REAL não está cortada',
    !(await one(`SELECT approval_is_cut_over($1,'contract','approve') c`, [realOrg])).c);
  const realContract = (await one(`SELECT contract_id c FROM contract_approvals LIMIT 1`)).c;
  // Uma etapa NÃO terminal: a trava de segregação da Fase 0 só olha decisão
  // terminal, e escolher uma linha `approved` mediria aquela trava, não o corte.
  const legacyWrite = await refuses(c,
    `UPDATE contract_approvals SET comments='sonda da Fase 5'
      WHERE contract_id=$1 AND status='pending'`, [realContract]);
  check('e por isso o caminho LEGADO continua escrevendo normalmente lá', legacyWrite === null);

  // Na organização descartável, que ESTÁ cortada, o legado é somente-leitura.
  const cutWrite = await refuses(c,
    `INSERT INTO contract_approvals (organization_id, contract_id, step_name, status, reviewer_user_id)
     VALUES ($1,$2,'juridico','pending',$3)`, [org, contract, legal]);
  check('onde HÁ corte, o motor legado recusa escrita nova',
    cutWrite !== null && /somente-leitura/.test(cutWrite));

  // E o inverso: sem corte, o motor compartilhado recusa abrir pedido.
  const noCut = await refuses(c,
    `INSERT INTO approval_requests (organization_id, policy_version_id, policy_id, policy_key,
       policy_version_no, subject_type, subject_id, action_type, decision_purpose,
       subject_fingerprint, idempotency_key)
     VALUES ($1,$2,$3,'x',1,'contract',$4,'approve','APPROVAL','f',$5)`,
    [realOrg, v1, policyId, realContract, `nocut-${suffix}`]);
  check('onde NÃO há corte, o motor compartilhado recusa abrir pedido (um só motor de escrita)',
    noCut !== null);

  // ============================================================
  // §34/§63 — NENHUMA POLÍTICA REAL SEMEADA
  // ============================================================
  console.log('\n=== §34/§63 NENHUMA GOVERNANÇA INVENTADA ===');
  const realPolicies = await one(
    `SELECT count(*)::int n FROM approval_policies WHERE organization_id <> $1 AND organization_id <> $2`,
    [org, orgB]);
  check('ZERO políticas de aprovação em organização real', realPolicies.n === 0);
  const realRequests = await one(
    `SELECT count(*)::int n FROM approval_requests WHERE organization_id <> $1 AND organization_id <> $2`,
    [org, orgB]);
  check('ZERO pedidos de aprovação em organização real', realRequests.n === 0);
  const realCut = await one(
    `SELECT count(*)::int n FROM approval_engine_cutover WHERE organization_id <> $1`, [org]);
  check('ZERO cortes registrados em organização real', realCut.n === 0);

  // ============================================================
  // §41 — MODELO DE LEITURA
  // ============================================================
  console.log('\n=== §41 MODELO DE LEITURA ===');
  const rm = await one(
    `SELECT policy_key, policy_version_no, status, provenance,
            jsonb_array_length(stages) st, jsonb_array_length(steps) sp, jsonb_array_length(decisions) de
       FROM approval_request_read_model WHERE request_id=$1`, [req1]);
  check('modelo de leitura resolve política, versão, estágios, etapas e decisões',
    rm.policy_key === 'contracts.approve.disposable' && rm.policy_version_no === 1
    && rm.st === 2 && rm.sp === 3 && rm.de === 3 && rm.provenance === 'SHARED_ENGINE');

  // ============================================================
  // §36 — IA E SISTEMA NÃO DECIDEM
  // ============================================================
  console.log('\n=== §36 ATOR ===');
  await asNobody();
  const noActor = await refuses(c, `SELECT approval_decide($1,'APPROVED',$2)`,
    [(await stepBy(rV1.request_id, 'juridico')).id, `noactor-${suffix}`]);
  check('sem identidade autenticada NÃO há decisão (sistema/IA não aprovam)',
    noActor !== null && /identidade autenticada/.test(noActor));
  const noActorArg = await one(
    `SELECT count(*)::int n FROM information_schema.parameters
      WHERE specific_schema='public' AND specific_name LIKE 'approval_decide%'
        AND parameter_name IN ('p_actor_user_id','p_approved_by','p_user_id')`);
  check('a RPC de decisão NÃO tem parâmetro de ator na assinatura', noActorArg.n === 0);
  await asUser(director);

  // ============================================================
  // LIMPEZA — o descartável não sobrevive ao COMMIT
  // ============================================================
  /*
    Sem isto, o modo `--apply` cometeria junto com o schema as duas
    organizações de prova, os usuários sintéticos e todos os pedidos — e a
    §62 é explícita: nada de fabricar história de aprovação em produção. Um
    ensaio que desfaz por ROLLBACK e um apply que deixa resíduo são dois
    comportamentos diferentes, e o segundo é o que chega ao banco de verdade.
  */
  console.log('\n=== LIMPEZA DO DESCARTÁVEL ===');
  await asNobody();
  for (const disposable of [org, orgB]) {
    // A FK de `contract_amendment_revisions.organization_id` não tem
    // ON DELETE CASCADE — defeito ANTERIOR à Fase 4, já registrado nos itens
    // deferidos. Ele bloqueia a exclusão do inquilino, então a linhagem sai
    // antes. Corrigir a FK não é escopo desta fase.
    await c.query(`DELETE FROM contract_amendment_revisions WHERE organization_id=$1`, [disposable]);
    await c.query(`DELETE FROM organizations WHERE id=$1`, [disposable]);
  }
  await c.query(`DELETE FROM auth.users WHERE email LIKE $1`, [`p5.%.${suffix}@example.test`]);

  const residue = await one(`SELECT
      (SELECT count(*)::int FROM approval_policies)  p,
      (SELECT count(*)::int FROM approval_requests)  r,
      (SELECT count(*)::int FROM approval_decisions) d,
      (SELECT count(*)::int FROM approval_delegations) g,
      (SELECT count(*)::int FROM approval_engine_cutover) c,
      (SELECT count(*)::int FROM domain_events WHERE event_type LIKE 'approval.%') e`);
  check('nenhuma política, pedido, decisão, delegação, corte ou evento sobrou',
    residue.p === 0 && residue.r === 0 && residue.d === 0 && residue.g === 0
    && residue.c === 0 && residue.e === 0, JSON.stringify(residue));
  const orgsLeft = await one(`SELECT count(*)::int n FROM organizations WHERE slug LIKE 'p5%'`);
  check('nenhuma organização descartável sobrou', orgsLeft.n === 0);
  const contractsLeft = await one(
    `SELECT count(*)::int n FROM contracts WHERE contract_number LIKE 'P5-%'`);
  check('nenhum contrato de prova sobrou', contractsLeft.n === 0);

  return ok;
}
