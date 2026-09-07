/**
 * Fase 7 — correção: prova VIVA da fronteira de inquilino e da autoridade de
 * liberação, com DUAS organizações e chamadas emitidas como `authenticated`.
 *
 * ─── Por que este arquivo existe ──────────────────────────────────────────
 *
 * A Fase 7 entregou seis funções SECURITY DEFINER que buscavam a linha pelo
 * UUID sem conferir o inquilino do chamador. Duas delas ESCREVIAM. A bateria
 * original não pegou porque não procurava — ela provava que o inquilino certo
 * consegue, nunca que o errado não consegue.
 *
 * A regra que este arquivo guarda, e que vale para toda RPC nova da fase:
 *
 *   conhecer o UUID de outra organização não pode render NADA — nem o dado,
 *   nem a confirmação de que ele existe.
 *
 * ─── Por que `SET LOCAL ROLE authenticated` ───────────────────────────────
 *
 * A suíte conecta como `postgres`, que tem BYPASSRLS. Trocar apenas
 * `request.jwt.claims` faria `auth.uid()` responder certo e deixaria RLS,
 * GRANT e gatilhos inteiramente de fora — a prova passaria sem exercitar nada.
 *
 * Sem `SUPABASE_DB_URL` a suíte é pulada — em CI sem banco ela não falha, e
 * não finge ter passado.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import pg from 'pg';

for (const file of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* arquivo ausente é um caso normal */ }
}

const DB_URL = process.env.SUPABASE_DB_URL;
const suite = DB_URL ? describe : describe.skip;

const sweepOrgSql = (uuid: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) throw new Error(`id de organização inválido: ${uuid}`);
  return `
DO $sweep$
DECLARE t text; remaining text[]; next_round text[]; pass integer := 0;
BEGIN
  SELECT array_agg(c.table_name ORDER BY c.table_name) INTO remaining
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
   WHERE c.table_schema = 'public' AND c.column_name = 'organization_id'
     AND tb.table_type = 'BASE TABLE';
  WHILE pass < 10 AND coalesce(array_length(remaining, 1), 0) > 0 LOOP
    next_round := ARRAY[]::text[];
    FOREACH t IN ARRAY remaining LOOP
      BEGIN
        EXECUTE format('DELETE FROM public.%I WHERE organization_id = %L', t, '${uuid}');
      EXCEPTION WHEN others THEN next_round := next_round || t;
      END;
    END LOOP;
    remaining := next_round; pass := pass + 1;
  END LOOP;
  DELETE FROM public.organizations WHERE id = '${uuid}';
END $sweep$;`;
};

/** O valor e o título que NÃO podem aparecer do outro lado da fronteira. */
const SECRET_AMOUNT = '987654.32';
const SECRET_MARK = 'SIGILOSO';

suite('Fase 7 · fronteira de inquilino das RPCs e autoridade de liberação', () => {
  let db: pg.Client;
  const sfx = Math.random().toString(36).slice(2, 10);

  let victimOrg: string; let attackerOrg: string;
  let attacker: string; let victimAdmin: string;
  let victimContract: string; let victimMilestone: string; let victimBilling: string;
  let victimReceivable: string; let victimSettlement: string;
  let victimPaymentSource: string; let victimReconciliation: string;

  /* A identidade e o PAPEL viajam na mesma instrução: pooler em modo transação. */
  const asRole = (uid: string, sql: string) =>
    `SET LOCAL ROLE authenticated;`
    + ` SELECT set_config('request.jwt.claims', json_build_object('sub','${uid}','role','authenticated')::text, true);`
    + ` ${sql}; RESET ROLE;`;

  /** Executa como a pessoa; devolve a linha da chamada (o último é o RESET). */
  const callAs = async (uid: string, sql: string): Promise<Record<string, unknown>> => {
    const res = await db.query(asRole(uid, sql));
    const list = Array.isArray(res) ? res : [res];
    return (list[list.length - 2].rows[0] ?? {}) as Record<string, unknown>;
  };

  /**
   * Devolve a mensagem quando a chamada FALHA, e null quando ela passa.
   *
   * Sem SAVEPOINT: cada consulta aqui roda em autocommit, e a instrução
   * múltipla que `asRole` monta já é uma transação implícita — o erro desfaz
   * o `SET LOCAL ROLE` junto com o resto. Um SAVEPOINT fora de bloco
   * transacional é justamente o que o PostgreSQL recusa.
   */
  const refusedAs = async (uid: string, sql: string): Promise<string | null> => {
    try {
      await db.query(asRole(uid, sql));
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };

  const scalar = async (sql: string, params: unknown[] = []) =>
    (await db.query(sql, params)).rows[0];

  beforeAll(async () => {
    db = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await db.connect();
    await db.query('SET SESSION default_transaction_read_only = off');

    const mkOrg = async (name: string, slug: string) => (await scalar(
      `INSERT INTO organizations (name, slug) VALUES ($1,$2) RETURNING id`,
      [`[P7XT] ${name}`, `p7xt-${slug}-${sfx}`])).id;
    victimOrg = await mkOrg('Vítima', 'v');
    attackerOrg = await mkOrg('Atacante', 'a');

    const mkUser = async (label: string, orgId: string, roleKey: string) => {
      const uid = (await scalar(
        `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
         VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
                 $1,'x',now(),now()) RETURNING id`, [`p7xt.${label}.${sfx}@example.test`])).id;
      await db.query(`INSERT INTO profiles (user_id, organization_id, full_name, status)
                      VALUES ($1,$2,$3,'active')`, [uid, orgId, `[P7XT] ${label}`]);
      await db.query(`INSERT INTO user_roles (user_id, role_id, organization_id)
                      SELECT $1, r.id, $2 FROM roles r WHERE r.key=$3 AND r.organization_id IS NULL`,
        [uid, orgId, roleKey]);
      return uid;
    };
    // O atacante é ADMINISTRADOR da organização dele: pior caso realista.
    attacker = await mkUser('attacker', attackerOrg, 'owner_admin');
    victimAdmin = await mkUser('victim-admin', victimOrg, 'owner_admin');

    const project = `p7xt-${sfx}`;
    await db.query(`INSERT INTO projects (id, organization_id, project) VALUES ($1,$2,$3)`,
      [project, victimOrg, JSON.stringify({ name: '[P7XT] Projeto', status: 'em_andamento' })]);
    const party = (await scalar(
      `INSERT INTO parties (organization_id, kind, legal_name, document_type, document_number)
       VALUES ($1,'organization','[P7XT] Parte','cnpj','11222333000181') RETURNING id`,
      [victimOrg])).id;
    victimContract = (await scalar(
      `INSERT INTO contracts (organization_id, title, status, currency, data_class,
                              counterparty_party_id, project_id)
       VALUES ($1,$2,'active','BRL','demo',$3,$4) RETURNING id`,
      [victimOrg, `[P7XT] Contrato ${SECRET_MARK}`, party, project])).id;
    await db.query(`INSERT INTO contract_project_links (organization_id, contract_id, project_id)
                    VALUES ($1,$2,$3)`, [victimOrg, victimContract, project]);
    victimMilestone = (await scalar(
      `INSERT INTO contract_milestones (organization_id, contract_id, project_id, title, status)
       VALUES ($1,$2,$3,'[P7XT] Marco','pending') RETURNING id`,
      [victimOrg, victimContract, project])).id;
    victimBilling = (await scalar(
      `INSERT INTO contract_billing_events
         (organization_id, contract_id, milestone_id, title, amount, currency, status,
          source_kind, entitlement_key, amount_source, eligibility_state, release_state)
       VALUES ($1,$2,$3,$4,${SECRET_AMOUNT},'BRL','pendente','MANUAL',$5,
               'LEGACY_MEASURED_AMOUNT','UNKNOWN','NOT_ELIGIBLE') RETURNING id`,
      [victimOrg, victimContract, victimMilestone,
       `[P7XT] Faturamento ${SECRET_MARK}`, `p7xt-${sfx}`])).id;

    const estab = (await scalar(
      `INSERT INTO fiscal_establishments
         (organization_id, legal_name, cnpj, municipal_registration, tax_regime, municipality_ibge,
          municipality_name, uf, postal_code, street, street_number, district, environment, nfse_series)
       VALUES ($1,'[P7XT] Emissor','11222333000181','IM1','simples_nacional','3550308','São Paulo','SP',
               '01001000','Rua Teste','1','Centro','homologation','1') RETURNING id`,
      [victimOrg])).id;
    const doc = (await scalar(
      `INSERT INTO fiscal_documents
         (organization_id, establishment_id, party_id, contract_id, competence_date, issue_date,
          due_date, series, service_amount_cents, withheld_total_cents, net_amount_cents,
          service_location_ibge, description, issuer_snapshot, recipient_snapshot,
          service_snapshot, tax_snapshot, idempotency_key, status)
       VALUES ($1,$2,$3,$4, current_date, current_date, current_date + 30, '1',
               1000000, 0, 1000000, '3550308','[P7XT] Serviço','{}','{}','{}','{}',$5,'draft')
       RETURNING id`, [victimOrg, estab, party, victimContract, `p7xt-doc-${sfx}`])).id;
    victimReceivable = (await scalar(
      `INSERT INTO finance_receivables
         (organization_id, party_id, contract_id, billing_event_id, fiscal_document_id,
          currency, amount_basis, original_amount_cents, gross_amount_cents, issue_date)
       VALUES ($1,$2,$3,$4,$5,'BRL','GROSS_SERVICE_AMOUNT',1000000,1000000,current_date)
       RETURNING id`, [victimOrg, party, victimContract, victimBilling, doc])).id;
    await db.query(
      `INSERT INTO finance_receivable_installments
         (organization_id, receivable_id, sequence, due_date, original_amount_cents, currency, due_date_source)
       VALUES ($1,$2,1,current_date + 30,1000000,'BRL','FISCAL_DOCUMENT_DUE_DATE')`,
      [victimOrg, victimReceivable]);
    victimSettlement = (await scalar(
      `INSERT INTO finance_settlements
         (organization_id, receivable_id, kind, amount_cents, currency, effective_date, source)
       VALUES ($1,$2,'PAYMENT',400000,'BRL',current_date,'MANUAL_ENTRY') RETURNING id`,
      [victimOrg, victimReceivable])).id;
    victimPaymentSource = (await scalar(
      `INSERT INTO finance_payment_sources
         (organization_id, source_kind, external_transaction_id, fingerprint, amount_cents,
          currency, value_date)
       VALUES ($1,'OFX',$2,$3,400000,'BRL',current_date) RETURNING id`,
      [victimOrg, `P7XT-${sfx}`, `p7xt-fp-${sfx}`])).id;
    victimReconciliation = (await scalar(
      `INSERT INTO finance_reconciliations
         (organization_id, settlement_id, payment_source_id, state, match_kind, matched_amount_cents)
       VALUES ($1,$2,$3,'RECONCILED','DETERMINISTIC_SOURCE_ID',400000) RETURNING id`,
      [victimOrg, victimSettlement, victimPaymentSource])).id;
  }, 120_000);

  afterAll(async () => {
    try {
      await db.query(sweepOrgSql(victimOrg));
      await db.query(sweepOrgSql(attackerOrg));
      await db.query(`DELETE FROM auth.users WHERE email LIKE $1`, [`p7xt.%.${sfx}@example.test`]);
      // A prova de autoridade concede a permissão a um papel GLOBAL; ela sai
      // junto, ou o produto ficaria com a concessão que a 141 removeu.
      await db.query(
        `DELETE FROM role_permissions rp USING roles r, permissions p
          WHERE rp.role_id = r.id AND rp.permission_id = p.id
            AND r.organization_id IS NULL AND p.key LIKE 'contracts.billing.%'`);
    } catch (e) {
      console.error('[P7XT] limpeza falhou:', (e as Error).message);
      throw e;
    }
    await db?.end();
  }, 120_000);

  // ══════════════════════════════════════════════════════════════════
  // PRIVILÉGIO
  // ══════════════════════════════════════════════════════════════════

  it('nenhuma função interna da Fase 7 é executável por navegador', async () => {
    const { rows } = await db.query<{ sig: string }>(`
      SELECT p.oid::regprocedure::text sig
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('contract_billing_fingerprint','contract_billing_recompute_eligibility',
                           'contract_billing_emit','approval_subject_resolve',
                           'fiscal_documents_emit_lifecycle','apex_caller_is_browser',
                           'apex_browser_organization','contract_billing_release_authority_for')
         AND (has_function_privilege('anon', p.oid, 'EXECUTE')
           OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))`);
    expect(rows.map((r) => r.sig)).toEqual([]);
  });

  it('nenhuma função SECURITY DEFINER exposta ficou sem guarda de inquilino', async () => {
    const { rows } = await db.query<{ sig: string }>(`
      SELECT p.oid::regprocedure::text sig
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.prosecdef
         AND (p.proname LIKE 'contract_billing%' OR p.proname LIKE 'finance_%')
         AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
         AND p.prosrc !~ 'apex_browser_organization\\(\\)|current_user_organization_id\\(\\)'`);
    expect(rows.map((r) => r.sig)).toEqual([]);
  });

  // ══════════════════════════════════════════════════════════════════
  // ORÁCULO DE LEITURA
  // ══════════════════════════════════════════════════════════════════

  it('elegibilidade alheia responde EXATAMENTE como um UUID inexistente', async () => {
    const foreign = await callAs(attacker,
      `SELECT contract_billing_eligibility_resolve('${victimBilling}') AS r`);
    const ghost = await callAs(attacker,
      `SELECT contract_billing_eligibility_resolve(gen_random_uuid()) AS r`);
    // Respostas IDÊNTICAS: a diferença entre "não é seu" e "não existe" não é
    // observável, que é o que fecha o oráculo.
    expect(foreign.r).toEqual(ghost.r);
    expect(JSON.stringify(foreign.r)).not.toContain(SECRET_MARK);
    expect(JSON.stringify(foreign.r)).not.toContain(SECRET_AMOUNT);
  }, 60_000);

  it('prontidão fiscal alheia responde EXATAMENTE como um UUID inexistente', async () => {
    const foreign = await callAs(attacker,
      `SELECT contract_billing_fiscal_readiness('${victimBilling}') AS r`);
    const ghost = await callAs(attacker,
      `SELECT contract_billing_fiscal_readiness(gen_random_uuid()) AS r`);
    expect(foreign.r).toEqual(ghost.r);
    expect(JSON.stringify(foreign.r)).not.toContain(SECRET_MARK);
  }, 60_000);

  it('impressão digital e sujeito de aprovação estão fora do alcance', async () => {
    expect(await refusedAs(attacker,
      `SELECT contract_billing_fingerprint('${victimBilling}')`)).toMatch(/permission denied/i);
    expect(await refusedAs(attacker,
      `SELECT * FROM approval_subject_resolve('${victimOrg}','contract','${victimContract}')`))
      .toMatch(/permission denied/i);
  }, 60_000);

  it('nenhuma tabela nem visão da fase entrega linha alheia', async () => {
    const probes: Array<[string, string]> = [
      ['modelo de leitura', `SELECT count(*)::int AS r FROM contract_to_cash_read_model WHERE billing_event_id='${victimBilling}'`],
      ['faturamento',       `SELECT count(*)::int AS r FROM contract_billing_events WHERE id='${victimBilling}'`],
      ['recebível',         `SELECT count(*)::int AS r FROM finance_receivables WHERE id='${victimReceivable}'`],
      ['parcela',           `SELECT count(*)::int AS r FROM finance_receivable_installments WHERE receivable_id='${victimReceivable}'`],
      ['liquidação',        `SELECT count(*)::int AS r FROM finance_settlements WHERE id='${victimSettlement}'`],
      ['saldo derivado',    `SELECT count(*)::int AS r FROM finance_receivable_balances WHERE receivable_id='${victimReceivable}'`],
      ['conciliação',       `SELECT count(*)::int AS r FROM finance_reconciliations WHERE id='${victimReconciliation}'`],
      ['evidência de caixa',`SELECT count(*)::int AS r FROM finance_payment_sources WHERE id='${victimPaymentSource}'`],
      ['autoridade',        `SELECT count(*)::int AS r FROM contract_billing_release_authorities WHERE organization_id='${victimOrg}'`],
      ['título legado',     `SELECT count(*)::int AS r FROM apar_title WHERE organization_id='${victimOrg}'`],
    ];
    for (const [label, sql] of probes) {
      const row = await callAs(attacker, sql);
      expect(Number(row.r), label).toBe(0);
    }
  }, 90_000);

  // ══════════════════════════════════════════════════════════════════
  // ORÁCULO DE ESCRITA
  // ══════════════════════════════════════════════════════════════════

  it('nenhuma RPC da fase muta estado de outra organização', async () => {
    const writes: Array<[string, string]> = [
      ['recomputo',            `SELECT contract_billing_recompute_eligibility('${victimBilling}')`],
      ['liberação',            `SELECT contract_billing_release('${victimBilling}','ataque')`],
      ['cancelamento',         `SELECT contract_billing_cancel('${victimBilling}','ataque')`],
      ['supersessão',          `SELECT contract_billing_supersede('${victimBilling}','ataque')`],
      ['faturar marco alheio', `SELECT contract_billing_create_from_milestone('${victimMilestone}','ataque')`],
      ['reverter recebível',   `SELECT finance_receivable_reverse('${victimReceivable}','ataque','CANCELLED')`],
      ['liquidar',             `SELECT finance_settlement_record('${victimReceivable}',1000,current_date,'MANUAL_ENTRY',NULL,'ataque',NULL)`],
      ['estornar liquidação',  `SELECT finance_settlement_reverse('${victimSettlement}','ataque')`],
      ['importar evidência',   `SELECT finance_payment_source_import('${victimOrg}','OFX',5555,current_date,'P7XT-ATAQUE',NULL,NULL,NULL,NULL,'BRL')`],
      ['conciliar',            `SELECT finance_reconciliation_record('${victimSettlement}','${victimPaymentSource}','MANUAL_GOVERNED',NULL,NULL)`],
      ['reverter conciliação', `SELECT finance_reconciliation_reverse('${victimReconciliation}','ataque')`],
      ['postar razão',         `SELECT finance_ledger_post_receivable('${victimReceivable}')`],
    ];
    for (const [label, sql] of writes) {
      const msg = await refusedAs(attacker, sql);
      expect(msg, `${label} PASSOU`).not.toBeNull();
      // A recusa nunca revela o motivo verdadeiro ("é de outro inquilino").
      expect(msg, label).toMatch(/not_found|inexistente|denied|negad|TENANT_UNRESOLVED|MISMATCH/i);
    }

    // E o estado da vítima permanece intocado, item por item.
    const after = await scalar(
      `SELECT (SELECT eligibility_computed_at IS NULL FROM contract_billing_events WHERE id=$1) pristine,
              (SELECT release_state FROM contract_billing_events WHERE id=$1) rel,
              (SELECT lifecycle_state FROM finance_receivables WHERE id=$2) life,
              (SELECT count(*)::int FROM finance_settlements WHERE receivable_id=$2) settles,
              (SELECT count(*)::int FROM finance_reconciliations WHERE settlement_id=$3) recons,
              (SELECT count(*)::int FROM ledger_entry WHERE organization_id=$4) ledger,
              (SELECT count(*)::int FROM finance_payment_sources
                WHERE organization_id=$4 AND external_transaction_id='P7XT-ATAQUE') forged`,
      [victimBilling, victimReceivable, victimSettlement, victimOrg]);
    expect(after.pristine).toBe(true);
    expect(after.rel).toBe('NOT_ELIGIBLE');
    expect(after.life).toBe('ACTIVE');
    expect(after.settles).toBe(1);
    expect(after.recons).toBe(1);
    expect(after.ledger).toBe(0);
    expect(after.forged).toBe(0);
  }, 120_000);

  it('escrita direta por navegador nas tabelas da fase continua impossível', async () => {
    for (const sql of [
      `INSERT INTO finance_settlements (organization_id, receivable_id, kind, amount_cents,
         currency, effective_date, source)
       VALUES ('${victimOrg}','${victimReceivable}','PAYMENT',1,'BRL',current_date,'MANUAL_ENTRY')`,
      `UPDATE finance_receivables SET lifecycle_state='CANCELLED' WHERE id='${victimReceivable}'`,
      `DELETE FROM finance_settlements WHERE id='${victimSettlement}'`,
    ]) {
      expect(await refusedAs(attacker, sql)).not.toBeNull();
    }
  }, 60_000);

  // ══════════════════════════════════════════════════════════════════
  // AUTORIDADE DE LIBERAÇÃO
  // ══════════════════════════════════════════════════════════════════

  it('nenhum papel global carrega autoridade de faturamento por padrão', async () => {
    const row = await scalar(
      `SELECT count(*)::int n FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE r.organization_id IS NULL AND p.key LIKE 'contracts.billing.%'`);
    expect(row.n).toBe(0);
    // O vocabulário fica: capacidade não é autoridade.
    const vocab = await scalar(
      `SELECT count(*)::int n FROM permissions
        WHERE key IN ('contracts.billing.release','contracts.billing.adjust')`);
    expect(vocab.n).toBe(2);
  });

  it('administrador NÃO libera faturamento por ser administrador', async () => {
    const billing = await prepareEligibleBilling();
    const msg = await refusedAs(victimAdmin,
      `SELECT contract_billing_release('${billing}','admin tenta')`);
    expect(msg).toMatch(/PERMISSION_DENIED/);
    expect((await scalar(
      `SELECT release_state FROM contract_billing_events WHERE id=$1`, [billing])).release_state)
      .not.toBe('RELEASED');
  }, 90_000);

  it('NO_POLICY sem autoridade declarada NÃO libera', async () => {
    const billing = await prepareEligibleBilling();
    await db.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id FROM roles r, permissions p
        WHERE r.key='owner_admin' AND r.organization_id IS NULL
          AND p.key='contracts.billing.release' ON CONFLICT DO NOTHING`);

    expect((await scalar(`SELECT count(*)::int n FROM approval_policies WHERE organization_id=$1`,
      [victimOrg])).n).toBe(0);

    const msg = await refusedAs(victimAdmin,
      `SELECT contract_billing_release('${billing}','com permissão, sem autoridade')`);
    expect(msg).toMatch(/RELEASE_AUTHORITY_NOT_CONFIGURED/);
    expect((await scalar(
      `SELECT release_state FROM contract_billing_events WHERE id=$1`, [billing])).release_state)
      .not.toBe('RELEASED');

    // E a tela tem como explicar sem tentar liberar.
    expect((await scalar(
      `SELECT release_governance_state g FROM contract_to_cash_read_model WHERE billing_event_id=$1`,
      [billing])).g).toBe('NOT_CONFIGURED');
  }, 90_000);

  it('com autoridade DECLARADA a liberação acontece, e registra qual', async () => {
    const billing = await prepareEligibleBilling();
    await db.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id FROM roles r, permissions p
        WHERE r.key='owner_admin' AND r.organization_id IS NULL
          AND p.key='contracts.billing.release' ON CONFLICT DO NOTHING`);
    const authority = (await scalar(
      `INSERT INTO contract_billing_release_authorities
         (organization_id, grantee_kind, grantee_user_id, source_kind, source_reference,
          justification, declared_by)
       VALUES ($1,'USER',$2,'BOARD_RESOLUTION','Ata 12/2026 art. 3º',
               '[P7XT] delegação de alçada comercial',$2) RETURNING id`,
      [victimOrg, victimAdmin])).id;

    expect((await scalar(
      `SELECT release_governance_state g FROM contract_to_cash_read_model WHERE billing_event_id=$1`,
      [billing])).g).toBe('DECLARED_AUTHORITY');

    const out = await callAs(victimAdmin,
      `SELECT contract_billing_release('${billing}','com autoridade') AS r`);
    const body = out.r as Record<string, unknown>;
    expect(body.release_state).toBe('RELEASED');
    expect(body.governance).toBe('DECLARED_AUTHORITY');
    expect(body.release_authority_id).toBe(authority);
  }, 90_000);

  it('autoridade declarada em outra organização não vale aqui', async () => {
    const row = await scalar(
      `SELECT contract_billing_release_authority_for($1,$2,$3,NULL,NULL) AS r`,
      [attackerOrg, victimContract, victimAdmin]);
    expect(row.r).toBeNull();
  });

  /** Um faturamento ELEGÍVEL na organização da vítima, com procedência real. */
  async function prepareEligibleBilling(): Promise<string> {
    const key = `p7xt-${Math.random().toString(36).slice(2, 8)}`;
    const rule = (await scalar(
      `INSERT INTO contract_measurement_requirements
         (organization_id, contract_id, title, source_reference, effect, milestone_id,
          measurement_basis, measurement_currency, accumulation_mode, aggregation_mode, cadence)
       VALUES ($1,$2,'[P7XT] Regra','Cl. 4','added',$3,
               'MONETARY','BRL','INCREMENTAL','SUM_INCREMENTAL','MONTHLY') RETURNING id`,
      [victimOrg, victimContract, victimMilestone])).id;
    const measurement = (await scalar(
      `INSERT INTO project_measurements
         (organization_id, project_id, contract_id, contract_measurement_rule_id, milestone_id,
          occurrence_key, occurrence_state, measurement_basis, accumulation_mode, quantity,
          measured_value, currency, status, accepted_at, acceptance_source, accepted_quantity,
          accepted_value, accepted_currency, accepted_external_ref, origin)
       VALUES ($1,$2,$3,$4,$5,$6,'resolved','MONETARY','INCREMENTAL',1,100000,'BRL','ACCEPTED',
               now(),'signed_bulletin',1,100000,'BRL','BOL','manual') RETURNING id`,
      [victimOrg, `p7xt-${sfx}`, victimContract, rule, victimMilestone, key])).id;
    const ev = (await scalar(
      `SELECT emit_domain_event($1::uuid,'projects.measurement.accepted',1,'project_measurement',
                $2::uuid,'p7xt:'||$2::uuid::text,'{}'::jsonb) AS id`,
      [victimOrg, measurement])).id;
    const candidate = (await scalar(
      `SELECT contract_billing_apply_measurement_accepted($1) AS r`, [ev])).r;
    expect(candidate.eligibility).toBe('ELIGIBLE');
    return candidate.billing_event_id as string;
  }
});
