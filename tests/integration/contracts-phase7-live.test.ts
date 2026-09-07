/**
 * Fase 7 — provas VIVAS da cadeia contrato-a-caixa que exigem MAIS DE UMA CONEXÃO.
 *
 * Tudo que cabe numa sessão está em `scripts/lib/phase7-assertions.mjs`, provado
 * a cada aplicação. O que NÃO cabe lá é o que este arquivo existe para provar,
 * porque depende de dois processos ao mesmo tempo:
 *
 *   · duas liberações simultâneas liberam UMA vez, e emitem UM fato;
 *   · liberar e cancelar em corrida deixam UM desfecho coerente;
 *   · duas criações de Contas a Receber pela mesma nota criam UM título;
 *   · duas liquidações disputando o mesmo saldo não estouram o saldo aberto;
 *   · liquidar e estornar em corrida não deixam saldo negativo;
 *   · dois consumidores do mesmo aceite criam UM candidato;
 *   · duas importações da mesma transação bancária criam UMA evidência.
 *
 * Nenhuma dessas afirmações é demonstrável lendo a migration nem numa conexão
 * só: `FOR UPDATE` só faz alguém esperar quando existe um OUTRO alguém, e uma
 * sessão sozinha nunca encontra a linha travada.
 *
 * Há ainda o que uma conexão só não prova sobre ATOMICIDADE: que uma emissão de
 * evento que falha derruba a mutação junto. A injeção de falha está no fim.
 *
 * Os dados são descartáveis e a organização é apagada no final. Sem
 * `SUPABASE_DB_URL` a suíte é pulada — em CI sem banco ela não falha, e não
 * finge ter passado.
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

/** Varredura de inquilino descartável, do lado do SERVIDOR. Ver Fase 6. */
const sweepOrgSql = (uuid: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) throw new Error(`id de organização inválido: ${uuid}`);
  return `
DO $sweep$
DECLARE
  t text; remaining text[]; next_round text[]; pass integer := 0;
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
      EXCEPTION WHEN others THEN
        next_round := next_round || t;
      END;
    END LOOP;
    remaining := next_round; pass := pass + 1;
  END LOOP;

  DELETE FROM public.organizations WHERE id = '${uuid}';
END $sweep$;`;
};

const DB_URL = process.env.SUPABASE_DB_URL;
const suite = DB_URL ? describe : describe.skip;

type Attempt = { ok: true; body: Record<string, unknown> } | { ok: false; message: string };

suite('Fase 7 · corrida, idempotência e atomicidade da cadeia contrato-a-caixa', () => {
  let a: pg.Client;
  let b: pg.Client;

  let orgId: string;
  let projectId: string;
  let contractId: string;
  let partyId: string;
  let establishmentId: string;
  let ruleId: string;
  let milestoneId: string;
  const users: Record<string, string> = {};
  const sfx = Math.random().toString(36).slice(2, 10);
  let seq = 0;

  const connect = async () => {
    const client = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    await client.query('SET SESSION default_transaction_read_only = off');
    return client;
  };

  /* A identidade viaja NA MESMA INSTRUÇÃO: o pooler está em modo transação. */
  const withActor = (sql: string) =>
    `WITH actor AS (SELECT set_config('request.jwt.claims', $1, true)) ${sql}`;

  const call = async (
    client: pg.Client, userId: string, sql: string, params: unknown[] = [],
  ): Promise<Attempt> => {
    try {
      const { rows } = await client.query<{ r: Record<string, unknown> }>(
        withActor(sql), [JSON.stringify({ sub: userId, role: 'authenticated' }), ...params]);
      return { ok: true, body: rows[0]?.r ?? {} };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  };

  /*
    NENHUM `BEGIN` explícito nas corridas. Cada RPC JÁ é uma transação: abre,
    trava com `FOR UPDATE`, valida, escreve, emite e commita. Abrir transação
    do lado do cliente travaria por construção — B esperando o lock de A, A
    esperando o `Promise.all`, e o teste morrendo por tempo mesmo com o código
    perfeito.
  */

  /** Uma medição aceita nova, com o fato de aceite já emitido. */
  const newAcceptedMeasurement = async (): Promise<{ measurementId: string; eventId: string }> => {
    const key = `p7live-${sfx}-${seq++}`;
    const { rows } = await a.query<{ id: string }>(
      `INSERT INTO project_measurements
         (organization_id, project_id, contract_id, contract_measurement_rule_id, milestone_id,
          occurrence_key, occurrence_state, measurement_basis, accumulation_mode, quantity,
          measured_value, currency, status, accepted_at, acceptance_source,
          accepted_quantity, accepted_value, accepted_currency, accepted_external_ref, origin)
       VALUES ($1,$2,$3,$4,$5,$6,'resolved','MONETARY','INCREMENTAL',1,
               100000,'BRL','ACCEPTED', now(), 'signed_bulletin', 1, 100000, 'BRL', 'BOL', 'manual')
       RETURNING id`,
      [orgId, projectId, contractId, ruleId, milestoneId, key]);
    const measurementId = rows[0].id;
    const ev = await a.query<{ id: string }>(
      `SELECT emit_domain_event($1::uuid,'projects.measurement.accepted',1,'project_measurement',
                                $2::uuid,'p7live-accept:'||$2::uuid::text,'{}'::jsonb) AS id`,
      [orgId, measurementId]);
    return { measurementId, eventId: ev.rows[0].id };
  };

  /** Um faturamento LIBERADO, pronto para as corridas a jusante. */
  const newReleasedBilling = async (): Promise<string> => {
    const { eventId } = await newAcceptedMeasurement();
    const created = await a.query<{ r: Record<string, unknown> }>(
      `SELECT contract_billing_apply_measurement_accepted($1) AS r`, [eventId]);
    const billingId = String(created.rows[0].r.billing_event_id);
    const released = await call(a, users.commercial,
      `SELECT contract_billing_release($2, 'live') AS r FROM actor`, [billingId]);
    if (!released.ok) throw new Error(`liberação de apoio falhou: ${released.message}`);
    return billingId;
  };

  /** Uma nota AUTORIZADA vinculada a um faturamento, com o fato emitido. */
  const newAuthorizedDocument = async (billingEventId: string): Promise<string> => {
    const key = `p7live-doc-${sfx}-${seq++}`;
    const { rows } = await a.query<{ id: string }>(
      `INSERT INTO fiscal_documents
         (organization_id, establishment_id, party_id, contract_id, competence_date, issue_date,
          due_date, series, service_amount_cents, withheld_total_cents, net_amount_cents,
          service_location_ibge, description, issuer_snapshot, recipient_snapshot,
          service_snapshot, tax_snapshot, idempotency_key, status)
       VALUES ($1,$2,$3,$4, current_date, current_date, current_date + 30, '1',
               1000000, 0, 1000000, '3550308','[P7-LIVE] Serviço',
               '{}','{}','{}','{}',$5,'draft') RETURNING id`,
      [orgId, establishmentId, partyId, contractId, key]);
    const documentId = rows[0].id;
    await a.query(`SELECT contract_billing_link_fiscal_document($1,$2,NULL)`,
      [billingEventId, documentId]);
    await a.query(
      `UPDATE fiscal_documents SET status='authorized', authorized_at=now(), document_number=$2
        WHERE id=$1`, [documentId, `NF-${seq}`]);
    return documentId;
  };

  const authorizedEventOf = async (documentId: string): Promise<string> =>
    (await a.query<{ id: string }>(
      `SELECT id FROM domain_events WHERE organization_id=$1
        AND event_type='fiscal.document.authorized' AND aggregate_id=$2`,
      [orgId, documentId])).rows[0].id;

  const countRows = async (sql: string, params: unknown[]) =>
    Number((await a.query<{ n: string }>(sql, params)).rows[0].n);

  beforeAll(async () => {
    a = await connect();
    b = await connect();

    orgId = (await a.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ('[P7-LIVE] Org', $1) RETURNING id`,
      [`p7live-${sfx}`])).rows[0].id;

    const mkUser = async (label: string, roleKey: string) => {
      const uid = (await a.query<{ id: string }>(
        `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
         VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
                 $1,'x',now(),now()) RETURNING id`, [`p7live.${label}.${sfx}@example.test`])).rows[0].id;
      await a.query(`INSERT INTO profiles (user_id, organization_id, full_name, status)
                     VALUES ($1,$2,$3,'active')`, [uid, orgId, `[P7-LIVE] ${label}`]);
      await a.query(`INSERT INTO user_roles (user_id, role_id, organization_id)
                     SELECT $1, r.id, $2 FROM roles r WHERE r.key=$3 AND r.organization_id IS NULL`,
        [uid, orgId, roleKey]);
      return uid;
    };
    // Dois liberadores DISTINTOS: uma corrida com a mesma pessoa provaria
    // reentrância, não concorrência entre atores.
    users.commercial = await mkUser('commercial', 'juridico_contratos');
    users.commercial2 = await mkUser('commercial2', 'juridico_contratos');
    users.finance = await mkUser('finance', 'financeiro');
    users.finance2 = await mkUser('finance2', 'financeiro');

    projectId = `p7live-${sfx}`;
    await a.query(`INSERT INTO projects (id, organization_id, project) VALUES ($1,$2,$3)`,
      [projectId, orgId, JSON.stringify({ name: '[P7-LIVE] Projeto', status: 'em_andamento' })]);

    partyId = (await a.query<{ id: string }>(
      `INSERT INTO parties (organization_id, kind, legal_name, document_type, document_number)
       VALUES ($1,'organization','[P7-LIVE] Cliente','cnpj','11222333000181') RETURNING id`,
      [orgId])).rows[0].id;

    contractId = (await a.query<{ id: string }>(
      `INSERT INTO contracts (organization_id, title, status, currency, data_class,
                              counterparty_party_id, project_id)
       VALUES ($1,'[P7-LIVE] Contrato','active','BRL','demo',$2,$3) RETURNING id`,
      [orgId, partyId, projectId])).rows[0].id;

    await a.query(`INSERT INTO contract_project_links (organization_id, contract_id, project_id)
                   VALUES ($1,$2,$3)`, [orgId, contractId, projectId]);

    milestoneId = (await a.query<{ id: string }>(
      `INSERT INTO contract_milestones (organization_id, contract_id, project_id, title, status)
       VALUES ($1,$2,$3,'[P7-LIVE] Marco','pending') RETURNING id`,
      [orgId, contractId, projectId])).rows[0].id;

    ruleId = (await a.query<{ id: string }>(
      `INSERT INTO contract_measurement_requirements
         (organization_id, contract_id, title, source_reference, effect, milestone_id,
          measurement_basis, measurement_currency, accumulation_mode, aggregation_mode, cadence)
       VALUES ($1,$2,'[P7-LIVE] Regra','Cl. 4','added',$3,
               'MONETARY','BRL','INCREMENTAL','SUM_INCREMENTAL','MONTHLY') RETURNING id`,
      [orgId, contractId, milestoneId])).rows[0].id;

    establishmentId = (await a.query<{ id: string }>(
      `INSERT INTO fiscal_establishments
         (organization_id, legal_name, cnpj, municipal_registration, tax_regime, municipality_ibge,
          municipality_name, uf, postal_code, street, street_number, district, environment, nfse_series)
       VALUES ($1,'[P7-LIVE] Emissor','11222333000181','IM1','simples_nacional','3550308',
               'São Paulo','SP','01001000','Rua Teste','1','Centro','homologation','1') RETURNING id`,
      [orgId])).rows[0].id;

    /*
      A BASE DO VALOR é declarada explicitamente para esta organização
      descartável, porque sem ela o recebível não nasce — que é o
      comportamento que a §40 exige e que a bateria de aplicação já prova. Aqui
      a base precisa existir para que as corridas a jusante tenham o que
      disputar. `GROSS_SERVICE_AMOUNT` é escolha do CENÁRIO, não um padrão do
      sistema: nenhuma organização real recebe base por omissão.
    */
    await a.query(
      `INSERT INTO finance_receivable_basis_policies
         (organization_id, basis, justification, declared_by)
       VALUES ($1,'GROSS_SERVICE_AMOUNT','[P7-LIVE] cenário descartável', $2)`,
      [orgId, users.finance]);
  }, 90_000);

  afterAll(async () => {
    try {
      await a.query(sweepOrgSql(orgId));
      await a.query(`DELETE FROM auth.users WHERE email LIKE $1`, [`p7live.%.${sfx}@example.test`]);
    } catch (e) {
      // A limpeza que falha precisa APARECER. Silenciá-la é como organização
      // descartável fica viva em produção sem ninguém saber.
      console.error('[P7-LIVE] limpeza falhou:', (e as Error).message);
      throw e;
    }
    await a?.end();
    await b?.end();
  }, 90_000);

  // ══════════════════════════════════════════════════════════════════
  // CORRIDAS — faturamento
  // ══════════════════════════════════════════════════════════════════

  it('dois consumidores do MESMO aceite criam UM candidato', async () => {
    const { eventId, measurementId } = await newAcceptedMeasurement();

    const [ra, rb] = await Promise.all([
      a.query<{ r: Record<string, unknown> }>(
        `SELECT contract_billing_apply_measurement_accepted($1) AS r`, [eventId]).catch(() => null),
      b.query<{ r: Record<string, unknown> }>(
        `SELECT contract_billing_apply_measurement_accepted($1) AS r`, [eventId]).catch(() => null),
    ]);

    const alive = await countRows(
      `SELECT count(*) n FROM contract_billing_events
        WHERE organization_id=$1 AND source_measurement_id=$2
          AND release_state NOT IN ('CANCELLED','SUPERSEDED')`, [orgId, measurementId]);
    expect(alive).toBe(1);

    const created = [ra, rb].filter((r) => r?.rows[0]?.r?.created === true).length;
    expect(created).toBeLessThanOrEqual(1);
  }, 60_000);

  it('duas liberações simultâneas liberam UMA vez, e emitem UM fato', async () => {
    const { eventId } = await newAcceptedMeasurement();
    const billingId = String((await a.query<{ r: Record<string, unknown> }>(
      `SELECT contract_billing_apply_measurement_accepted($1) AS r`, [eventId])).rows[0].r.billing_event_id);

    const [ra, rb] = await Promise.all([
      call(a, users.commercial, `SELECT contract_billing_release($2,'A') AS r FROM actor`, [billingId]),
      call(b, users.commercial2, `SELECT contract_billing_release($2,'B') AS r FROM actor`, [billingId]),
    ]);

    // Uma das duas pode falhar por deadlock ou por já estar liberado; o que
    // não pode é haver duas liberações.
    expect([ra, rb].some((r) => r.ok)).toBe(true);

    const row = (await a.query<{ release_state: string; released_by: string | null }>(
      `SELECT release_state, released_by FROM contract_billing_events WHERE id=$1`,
      [billingId])).rows[0];
    expect(row.release_state).toBe('RELEASED');
    // O ator é UM, e é um dos dois — nunca uma mistura.
    expect([users.commercial, users.commercial2]).toContain(row.released_by);

    const facts = await countRows(
      `SELECT count(*) n FROM domain_events
        WHERE organization_id=$1 AND event_type='contracts.billing.released' AND aggregate_id=$2`,
      [orgId, billingId]);
    expect(facts).toBe(1);
  }, 60_000);

  it('liberar e cancelar em corrida deixam UM desfecho coerente', async () => {
    const { eventId } = await newAcceptedMeasurement();
    const billingId = String((await a.query<{ r: Record<string, unknown> }>(
      `SELECT contract_billing_apply_measurement_accepted($1) AS r`, [eventId])).rows[0].r.billing_event_id);

    await Promise.all([
      call(a, users.commercial, `SELECT contract_billing_release($2,'A') AS r FROM actor`, [billingId]),
      call(b, users.commercial2, `SELECT contract_billing_cancel($2,'desistência') AS r FROM actor`, [billingId]),
    ]);

    const row = (await a.query<{ release_state: string; released_at: string | null }>(
      `SELECT release_state, released_at FROM contract_billing_events WHERE id=$1`,
      [billingId])).rows[0];
    expect(['RELEASED', 'CANCELLED']).toContain(row.release_state);
    // Coerência: cancelado que passou por liberação MANTÉM o instante — a
    // história não é apagada para caber num estado (§57).
    if (row.release_state === 'RELEASED') expect(row.released_at).not.toBeNull();
  }, 60_000);

  // ══════════════════════════════════════════════════════════════════
  // CORRIDAS — Contas a Receber e liquidação
  // ══════════════════════════════════════════════════════════════════

  it('duas criações de AR pela MESMA nota criam UM título', async () => {
    const billingId = await newReleasedBilling();
    const documentId = await newAuthorizedDocument(billingId);
    const authEvent = await authorizedEventOf(documentId);

    await Promise.all([
      a.query(`SELECT finance_receivable_create_from_fiscal_document($1)`, [authEvent]).catch(() => null),
      b.query(`SELECT finance_receivable_create_from_fiscal_document($1)`, [authEvent]).catch(() => null),
    ]);

    const titles = await countRows(
      `SELECT count(*) n FROM finance_receivables
        WHERE organization_id=$1 AND fiscal_document_id=$2 AND lifecycle_state='ACTIVE'`,
      [orgId, documentId]);
    expect(titles).toBe(1);

    // E as parcelas conservam o total, mesmo com a corrida (§80).
    const drift = await countRows(
      `SELECT count(*) n FROM finance_receivables r
        WHERE r.fiscal_document_id=$1
          AND r.original_amount_cents <> (SELECT coalesce(sum(i.original_amount_cents),0)
                                            FROM finance_receivable_installments i
                                           WHERE i.receivable_id = r.id)`, [documentId]);
    expect(drift).toBe(0);
  }, 60_000);

  it('duas liquidações disputando o mesmo saldo NÃO estouram o aberto', async () => {
    const billingId = await newReleasedBilling();
    const documentId = await newAuthorizedDocument(billingId);
    const authEvent = await authorizedEventOf(documentId);
    await a.query(`SELECT finance_receivable_create_from_fiscal_document($1)`, [authEvent]);
    const receivableId = (await a.query<{ id: string }>(
      `SELECT id FROM finance_receivables WHERE fiscal_document_id=$1`, [documentId])).rows[0].id;

    // O título vale 1.000.000. Duas tentativas de 600.000 somariam 1.200.000.
    const [ra, rb] = await Promise.all([
      call(a, users.finance,
        `SELECT finance_settlement_record($2, 600000, current_date, 'MANUAL_ENTRY', NULL, 'A', NULL) AS r FROM actor`,
        [receivableId]),
      call(b, users.finance2,
        `SELECT finance_settlement_record($2, 600000, current_date, 'MANUAL_ENTRY', NULL, 'B', NULL) AS r FROM actor`,
        [receivableId]),
    ]);

    // Exatamente uma passa; a outra é recusada por exceder o saldo (§47).
    const okCount = [ra, rb].filter((r) => r.ok).length;
    expect(okCount).toBe(1);

    const bal = (await a.query<{ paid: string; open: string; status: string }>(
      `SELECT paid_amount_cents paid, open_amount_cents open, derived_status status
         FROM finance_receivable_balances WHERE receivable_id=$1`, [receivableId])).rows[0];
    expect(Number(bal.paid)).toBe(600000);
    expect(Number(bal.open)).toBe(400000);
    // O invariante central da §47: nunca negativo.
    expect(Number(bal.open)).toBeGreaterThanOrEqual(0);
    expect(bal.status).toBe('PARTIAL');
  }, 60_000);

  it('liquidar e estornar em corrida não deixam saldo negativo', async () => {
    const billingId = await newReleasedBilling();
    const documentId = await newAuthorizedDocument(billingId);
    const authEvent = await authorizedEventOf(documentId);
    await a.query(`SELECT finance_receivable_create_from_fiscal_document($1)`, [authEvent]);
    const receivableId = (await a.query<{ id: string }>(
      `SELECT id FROM finance_receivables WHERE fiscal_document_id=$1`, [documentId])).rows[0].id;

    const first = await call(a, users.finance,
      `SELECT finance_settlement_record($2, 400000, current_date, 'MANUAL_ENTRY', NULL, 'primeiro', NULL) AS r FROM actor`,
      [receivableId]);
    expect(first.ok).toBe(true);
    const settlementId = (await a.query<{ id: string }>(
      `SELECT id FROM finance_settlements WHERE receivable_id=$1 AND external_reference='primeiro'`,
      [receivableId])).rows[0].id;

    await Promise.all([
      call(a, users.finance,
        `SELECT finance_settlement_record($2, 600000, current_date, 'MANUAL_ENTRY', NULL, 'segundo', NULL) AS r FROM actor`,
        [receivableId]),
      call(b, users.finance2,
        `SELECT finance_settlement_reverse($2, 'devolução') AS r FROM actor`, [settlementId]),
    ]);

    const bal = (await a.query<{ paid: string; open: string }>(
      `SELECT paid_amount_cents paid, open_amount_cents open
         FROM finance_receivable_balances WHERE receivable_id=$1`, [receivableId])).rows[0];
    expect(Number(bal.open)).toBeGreaterThanOrEqual(0);
    expect(Number(bal.paid)).toBeLessThanOrEqual(1000000);
    // A liquidação estornada continua NA HISTÓRIA, qualquer que tenha sido a
    // ordem em que as duas chamadas ganharam o lock (§57, §82).
    expect(await countRows(
      `SELECT count(*) n FROM finance_settlements WHERE id=$1`, [settlementId])).toBe(1);
  }, 60_000);

  it('duas importações da MESMA transação bancária criam UMA evidência', async () => {
    const [ra, rb] = await Promise.all([
      call(a, users.finance,
        `SELECT finance_payment_source_import($2::uuid,'OFX', 12345, current_date, 'TXN-RACE',
           NULL, NULL, NULL, NULL, 'BRL') AS r FROM actor`, [orgId]),
      call(b, users.finance2,
        `SELECT finance_payment_source_import($2::uuid,'OFX', 12345, current_date, 'TXN-RACE',
           NULL, NULL, NULL, NULL, 'BRL') AS r FROM actor`, [orgId]),
    ]);
    expect([ra, rb].some((r) => r.ok)).toBe(true);

    expect(await countRows(
      `SELECT count(*) n FROM finance_payment_sources
        WHERE organization_id=$1 AND external_transaction_id='TXN-RACE'`, [orgId])).toBe(1);
  }, 60_000);

  // ══════════════════════════════════════════════════════════════════
  // ATOMICIDADE — injeção de falha
  // ══════════════════════════════════════════════════════════════════

  /*
    A prova de que fato e mutação vivem ou morrem juntos.

    O truque é fazer a EMISSÃO falhar depois de a mutação já ter acontecido na
    transação. Uma chave de idempotência ocupada com significado diferente é
    exatamente isso: `emit_domain_event` levanta `unique_violation` DEPOIS de o
    UPDATE ter rodado. Se a liberação sobrevivesse a isso, existiria
    faturamento liberado sem o fato que o Fiscal consome — o pior desfecho
    possível, porque é silencioso: ninguém emite a nota e ninguém sabe por quê.
  */
  it('emissão que falha derruba a LIBERAÇÃO junto (§116)', async () => {
    const { eventId } = await newAcceptedMeasurement();
    const billingId = String((await a.query<{ r: Record<string, unknown> }>(
      `SELECT contract_billing_apply_measurement_accepted($1) AS r`, [eventId])).rows[0].r.billing_event_id);

    // A chave que a liberação usaria é a impressão digital dos fatos exatos.
    const fingerprint = (await a.query<{ fp: string }>(
      `SELECT contract_billing_fingerprint($1) AS fp`, [billingId])).rows[0].fp;
    await a.query(
      `SELECT emit_domain_event($1::uuid,'contracts.billing.released',1,'contract_billing_event',
                                $2::uuid,$3,'{"sabotagem": true}'::jsonb)`,
      [orgId, billingId, `contracts.billing.released:${billingId}:${fingerprint}`]);

    const res = await call(a, users.commercial,
      `SELECT contract_billing_release($2,'vai falhar') AS r FROM actor`, [billingId]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/idempot|unique|chave/i);

    // E o estado NÃO mudou: a liberação caiu com a emissão.
    const row = (await a.query<{ release_state: string; released_at: string | null }>(
      `SELECT release_state, released_at FROM contract_billing_events WHERE id=$1`,
      [billingId])).rows[0];
    expect(row.release_state).not.toBe('RELEASED');
    expect(row.released_at).toBeNull();
  }, 60_000);

  it('emissão que falha derruba a LIQUIDAÇÃO junto (§116)', async () => {
    const billingId = await newReleasedBilling();
    const documentId = await newAuthorizedDocument(billingId);
    const authEvent = await authorizedEventOf(documentId);
    await a.query(`SELECT finance_receivable_create_from_fiscal_document($1)`, [authEvent]);
    const receivableId = (await a.query<{ id: string }>(
      `SELECT id FROM finance_receivables WHERE fiscal_document_id=$1`, [documentId])).rows[0].id;

    /*
      A chave da liquidação carrega o id da linha, que ainda não existe — não
      dá para ocupá-la de fora. O que se ocupa é a chave do fato DERIVADO
      `finance.receivable.paid`, que só é emitido quando o saldo zera: uma
      liquidação integral passa a falhar na emissão depois de já ter gravado a
      linha, que é exatamente a janela a provar.
    */
    await a.query(
      `SELECT emit_domain_event($1::uuid,'finance.receivable.paid',1,'finance_receivable',
                                $2::uuid,$3,'{"sabotagem": true}'::jsonb)`,
      [orgId, receivableId, `finance-receivable-paid:${receivableId}`]);

    const res = await call(a, users.finance,
      `SELECT finance_settlement_record($2, 1000000, current_date, 'MANUAL_ENTRY', NULL, 'integral', NULL) AS r FROM actor`,
      [receivableId]);
    expect(res.ok).toBe(false);

    // Nenhuma liquidação sobreviveu ao fato que falhou.
    expect(await countRows(
      `SELECT count(*) n FROM finance_settlements WHERE receivable_id=$1`, [receivableId])).toBe(0);
    const bal = (await a.query<{ paid: string; open: string }>(
      `SELECT paid_amount_cents paid, open_amount_cents open
         FROM finance_receivable_balances WHERE receivable_id=$1`, [receivableId])).rows[0];
    expect(Number(bal.paid)).toBe(0);
    expect(Number(bal.open)).toBe(1000000);
  }, 60_000);

  /*
    O outro lado da §116: a falha do LANÇAMENTO CONTÁBIL não pode derrubar a
    verdade de Contas a Receber. São requisitos separados (§130, §131), e o
    título continua valendo mesmo que ninguém saiba em que conta lançá-lo.
  */
  it('lançamento contábil bloqueado NÃO derruba o Contas a Receber (§116)', async () => {
    const billingId = await newReleasedBilling();
    const documentId = await newAuthorizedDocument(billingId);
    const authEvent = await authorizedEventOf(documentId);
    await a.query(`SELECT finance_receivable_create_from_fiscal_document($1)`, [authEvent]);
    const receivableId = (await a.query<{ id: string }>(
      `SELECT id FROM finance_receivables WHERE fiscal_document_id=$1`, [documentId])).rows[0].id;

    const posting = (await a.query<{ r: Record<string, unknown> }>(
      `SELECT finance_ledger_post_receivable($1) AS r`, [receivableId])).rows[0].r;
    expect(posting.posted).toBe(false);
    expect(posting.state).toBe('PENDING_CONFIGURATION');

    const row = (await a.query<{ lifecycle_state: string; ledger_posting_state: string }>(
      `SELECT lifecycle_state, ledger_posting_state FROM finance_receivables WHERE id=$1`,
      [receivableId])).rows[0];
    expect(row.lifecycle_state).toBe('ACTIVE');
    expect(row.ledger_posting_state).toBe('PENDING_CONFIGURATION');
    // E nenhum lançamento inventado entrou no razão.
    expect(await countRows(
      `SELECT count(*) n FROM ledger_entry WHERE organization_id=$1`, [orgId])).toBe(0);
  }, 60_000);
});
