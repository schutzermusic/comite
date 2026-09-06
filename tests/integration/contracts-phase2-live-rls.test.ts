/**
 * Fase 2 — provas VIVAS contra o Postgres real.
 *
 * O foco é o buraco que a revisão pré-merge encontrou: `contracts_clause_is_referenced`
 * é SECURITY DEFINER (precisa ser — o gatilho tem de enxergar as referências
 * passando por cima da RLS) e a 110 concedeu EXECUTE a `authenticated`. Com
 * direitos de dono, a função respondia sobre QUALQUER cláusula de QUALQUER
 * organização, e os três resultados eram distinguíveis:
 *
 *   cláusula de outro inquilino, referenciada ..... true
 *   cláusula de outro inquilino, sem referência ... false
 *   UUID que não é cláusula ....................... false
 *
 * Nenhuma linha vazava, mas a RELAÇÃO vazava — e com ela a existência da
 * cláusula. Ler a política nunca provaria isso: a função ignora RLS por
 * definição. Só executar prova.
 *
 * A 111 é aplicada SEMPRE (é `CREATE OR REPLACE` + grants, idempotente), para
 * que a suíte prove o arquivo como ele está escrito. As 108–110 só são
 * aplicadas se ainda não estiverem nesta base. Tudo roda dentro de uma
 * transação e some no ROLLBACK.
 *
 * Sem `SUPABASE_DB_URL` a suíte é pulada — em CI sem banco ela não falha, e não
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

const DB_URL = process.env.SUPABASE_DB_URL;
const suite = DB_URL ? describe : describe.skip;

const ORG_B = '00000000-0000-4000-8000-0000000000c2';
/** UUID que não nomeia cláusula nenhuma — o controle do teste de sondagem. */
const NAO_EXISTE = '00000000-0000-4000-8000-0000000000ff';

const inlineable = (f: string) =>
  readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), 'utf8')
    .replace(/^\s*BEGIN;\s*$/gm, '').replace(/^\s*COMMIT;\s*$/gm, '');

suite('Fase 2 · sondagem cross-tenant, apagamento privilegiado e reescrita', () => {
  let client: pg.Client;
  let orgA: string;
  let userA: string;
  /** owner_admin da organização B — o vizinho que conhece o UUID e não pode nada. */
  let userB: string;
  let contratoA: string;
  /** Outro contrato da MESMA organização — o destino inválido do reparentamento. */
  let contratoIrmaoA: string;
  /** Cláusula da Org A alcançada por um aditivo: história referenciada. */
  let clausulaRefA: string;
  /** Cláusula da Org A sem nenhuma referência. */
  let clausulaSoltaA: string;
  let aditivoA: string;

  /** Executa como usuário autenticado — com RLS valendo — e LIMPA o JWT ao sair. */
  async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
    try {
      return await fn();
    } finally {
      await client.query('RESET ROLE');
      // Sem isto o claim sobrevive à saída e as provas privilegiadas abaixo
      // rodariam com um inquilino colado na sessão.
      await client.query(`SELECT set_config('request.jwt.claims', '', true)`);
    }
  }

  /** Tenta a operação e devolve `{ code, message }` da recusa, ou null se passou. */
  async function refusal(fn: () => Promise<unknown>): Promise<{ code: string; message: string } | null> {
    await client.query('SAVEPOINT attempt');
    try {
      await fn();
      await client.query('ROLLBACK TO SAVEPOINT attempt');
      return null;
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT attempt');
      const e = err as { code?: string; message?: string };
      return { code: e.code ?? '', message: e.message ?? String(err) };
    }
  }

  const probe = (userId: string, clauseId: string) =>
    refusal(() => client.query('SELECT public.contracts_clause_is_referenced($1) AS v', [clauseId]))
      .then(async (r) => r ?? {
        code: 'OK',
        message: String((await client.query(
          'SELECT public.contracts_clause_is_referenced($1) AS v', [clauseId])).rows[0].v),
      })
      .then((r) => r);

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    // O pooler reaproveita backends: um `default_transaction_read_only` deixado
    // por outro processo chegaria até aqui.
    await client.query('SET SESSION default_transaction_read_only = off');
    await client.query('BEGIN');

    const jaAplicada = (await client.query(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema='public' AND table_name='contract_instrument_lineage'`)).rows[0].n > 0;
    for (const f of jaAplicada ? [] : [
      '108_contract_temporal_lineage.sql',
      '109_contract_structured_definitions.sql',
      '110_contract_history_erasure_boundary.sql',
    ]) await client.query(inlineable(f));
    // Sempre: prova o arquivo da 111 como ele está escrito.
    await client.query(inlineable('111_clause_reference_probe_tenant_scope.sql'));

    orgA = (await client.query(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`)).rows[0].id;
    await client.query(
      `INSERT INTO organizations (id, name, slug) VALUES ($1, '[PHASE2] Org B', 'phase2-org-b')`, [ORG_B]);

    const mkUser = async (label: string, org: string) => {
      const { rows } = await client.query(
        `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
         VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
                 $1, 'x', now(), now())
         RETURNING id`, [`phase2.${label}@example.test`]);
      const userId: string = rows[0].id;
      await client.query(
        `INSERT INTO profiles (user_id, organization_id, full_name) VALUES ($1, $2, $3)`,
        [userId, org, `[PHASE2] ${label}`]);
      await client.query(
        `INSERT INTO user_roles (user_id, role_id, organization_id)
         SELECT $1, r.id, $2 FROM roles r WHERE r.key = 'owner_admin' AND r.organization_id IS NULL`,
        [userId, org]);
      return userId;
    };
    userA = await mkUser('org-a-admin', orgA);
    userB = await mkUser('org-b-admin', ORG_B);

    const one = async (sql: string, params: unknown[]) => (await client.query(sql, params)).rows[0].id;
    contratoA = await one(
      `INSERT INTO contracts (organization_id, title, total_value, start_date, end_date)
       VALUES ($1, '[PHASE2] Contrato da Org A', 1000, '2026-01-01', '2026-12-31') RETURNING id`, [orgA]);
    contratoIrmaoA = await one(
      `INSERT INTO contracts (organization_id, title)
       VALUES ($1, '[PHASE2] Contrato irmão da Org A') RETURNING id`, [orgA]);
    clausulaRefA = await one(
      `INSERT INTO contract_clauses (organization_id, contract_id, title, content)
       VALUES ($1, $2, '[PHASE2] Cláusula referenciada', 'redação original') RETURNING id`, [orgA, contratoA]);
    clausulaSoltaA = await one(
      `INSERT INTO contract_clauses (organization_id, contract_id, title, content)
       VALUES ($1, $2, '[PHASE2] Cláusula solta', 'sem referência') RETURNING id`, [orgA, contratoA]);
    aditivoA = await one(
      `INSERT INTO contract_amendments (organization_id, contract_id, amendment_number, status, effective_date)
       VALUES ($1, $2, 'TA-PH2', 'active', '2026-06-01') RETURNING id`, [orgA, contratoA]);
    await client.query(
      `INSERT INTO contract_amendment_clauses (organization_id, amendment_id, clause_id, effect)
       VALUES ($1, $2, $3, 'altered')`, [orgA, aditivoA, clausulaRefA]);
  }, 120_000);

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end().catch(() => undefined);
  });

  // ═══════════════════════════════════════════════════════════════════
  // 1 · A sondagem cross-tenant
  // ═══════════════════════════════════════════════════════════════════

  it('1 · a Org B não distingue cláusula alheia referenciada, alheia solta e inexistente', async () => {
    const referenciada = await asUser(userB, () => probe(userB, clausulaRefA));
    const solta = await asUser(userB, () => probe(userB, clausulaSoltaA));
    const inexistente = await asUser(userB, () => probe(userB, NAO_EXISTE));

    // Recusada — não respondida.
    expect(referenciada.code).toBe('42501');
    /*
      O ponto do teste não é "deu erro": é que os TRÊS resultados são o MESMO
      resultado. Se a cláusula referenciada recusasse e a inexistente devolvesse
      `false`, a diferença entre as duas respostas continuaria sendo o oráculo —
      só que mais discreto.
    */
    expect(solta).toEqual(referenciada);
    expect(inexistente).toEqual(referenciada);
  });

  it('2 · saber o UUID não ajuda: nenhuma das respostas é um valor booleano', async () => {
    for (const id of [clausulaRefA, clausulaSoltaA, NAO_EXISTE]) {
      const r = await asUser(userB, () => probe(userB, id));
      expect(r.code).not.toBe('OK');
      expect(r.message).not.toMatch(/true|false/);
    }
  });

  it('3 · a Org B também não enxerga a cláusula por leitura direta', async () => {
    const visiveis = await asUser(userB, async () => (await client.query(
      `SELECT count(*)::int AS n FROM contract_clauses WHERE id = ANY($1)`,
      [[clausulaRefA, clausulaSoltaA]])).rows[0].n);
    expect(visiveis).toBe(0);
  });

  it('4 · a própria organização continua sendo respondida, com a verdade', async () => {
    expect(await asUser(userA, () => probe(userA, clausulaRefA))).toEqual({ code: 'OK', message: 'true' });
    expect(await asUser(userA, () => probe(userA, clausulaSoltaA))).toEqual({ code: 'OK', message: 'false' });
  });

  it('5 · `anon` não pode nem fazer a pergunta', async () => {
    const acl = (await client.query(
      `SELECT has_function_privilege('anon', 'public.contracts_clause_is_referenced(uuid)', 'EXECUTE') AS v`
    )).rows[0].v;
    expect(acl).toBe(false);
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2 · A proteção que o buraco não podia custar
  // ═══════════════════════════════════════════════════════════════════

  it('6 · a cláusula referenciada continua protegida contra apagamento pela aplicação', async () => {
    const r = await asUser(userA, () =>
      refusal(() => client.query(`DELETE FROM contract_clauses WHERE id = $1`, [clausulaRefA])));
    expect(r?.code).toBe('23514');
    expect(r?.message).toMatch(/historical truth/i);
  });

  it('7 · reescrever cláusula referenciada é impossível — inclusive para o papel privilegiado', async () => {
    const pelaAplicacao = await asUser(userA, () =>
      refusal(() => client.query(`UPDATE contract_clauses SET content='reescrita' WHERE id=$1`, [clausulaRefA])));
    expect(pelaAplicacao?.code).toBe('23514');

    // `postgres`, sem JWT: o caminho que APAGA pode apagar, e ainda assim não reescreve.
    const privilegiada = await refusal(() =>
      client.query(`UPDATE contract_clauses SET content='reescrita' WHERE id=$1`, [clausulaRefA]));
    expect(privilegiada?.code).toBe('23514');
    expect(privilegiada?.message).toMatch(/Append a replacement clause/i);

    const intacta = (await client.query(
      `SELECT content FROM contract_clauses WHERE id=$1`, [clausulaRefA])).rows[0].content;
    expect(intacta).toBe('redação original');
  });

  it('8 · o valor e o prazo originais continuam protegidos onde há aditivo', async () => {
    const r = await refusal(() =>
      client.query(`UPDATE contracts SET total_value = 9999 WHERE id = $1`, [contratoA]));
    expect(r?.code).toBe('23514');
    expect(r?.message).toMatch(/amendment instead of rewriting/i);
  });

  it('9 · o aditivo continua sendo história: nem reparentado, nem apagado pela aplicação', async () => {
    const reparent = await refusal(() =>
      client.query(`UPDATE contract_amendments SET contract_id=$1 WHERE id=$2`, [contratoIrmaoA, aditivoA]));
    expect(reparent?.code).toBe('23514');

    const apagar = await asUser(userA, () =>
      refusal(() => client.query(`DELETE FROM contract_amendments WHERE id=$1`, [aditivoA])));
    expect(apagar?.code).toBe('23514');
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3 · O apagamento privilegiado
  // ═══════════════════════════════════════════════════════════════════

  it('10 · apagar o contrato inteiro pelo caminho privilegiado ainda funciona e leva a subárvore', async () => {
    await client.query('SAVEPOINT purge');
    // Nenhuma ordem heroica: o apagamento alcança a subárvore por cascata.
    await client.query(`DELETE FROM contract_amendment_clauses WHERE contract_id = $1`, [contratoA]);
    await client.query(`DELETE FROM contract_clauses WHERE contract_id = $1`, [contratoA]);
    await client.query(`DELETE FROM contracts WHERE id = $1`, [contratoA]);

    const sobrou = (await client.query(
      `SELECT (SELECT count(*) FROM contracts WHERE id=$1)
            + (SELECT count(*) FROM contract_amendments WHERE contract_id=$1)
            + (SELECT count(*) FROM contract_amendment_revisions WHERE contract_id=$1)
            + (SELECT count(*) FROM contract_clauses WHERE contract_id=$1)
            + (SELECT count(*) FROM contract_instrument_lineage WHERE contract_id=$1) AS n`,
      [contratoA])).rows[0].n;
    expect(Number(sobrou)).toBe(0);
    await client.query('ROLLBACK TO SAVEPOINT purge');
  });

  it('11 · a fronteira do apagamento vale para toda tabela contratual da fase', async () => {
    const semGrant = (await client.query(
      `SELECT count(*)::int AS n FROM information_schema.role_table_grants
        WHERE table_schema='public' AND grantee IN ('authenticated','anon')
          AND privilege_type IN ('UPDATE','DELETE')
          AND table_name IN ('contract_instrument_lineage','contract_amendment_revisions','contract_guarantees',
            'contract_insurance_requirements','contract_indexation_rules','contract_billing_conditions',
            'contract_measurement_requirements')`)).rows[0].n;
    expect(semGrant).toBe(0);

    // A barreira é COMPARTILHADA: a Fase 2 instalou nove gatilhos, e a Fase 3
    // pendurou os dela na mesma função em vez de criar uma barreira paralela.
    // Contar o total exato aqui faria toda fase seguinte quebrar um teste da
    // fase anterior; o que importa é que as nove da Fase 2 continuem lá.
    const daFase2 = (await client.query(
      `SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal
         AND tgfoid='public.contracts_reject_history_erasure()'::regprocedure
         AND tgrelid::regclass::text IN ('contract_amendment_clauses','contract_amendment_revisions',
           'contract_amendments','contract_instrument_lineage','contract_guarantees',
           'contract_insurance_requirements','contract_indexation_rules','contract_billing_conditions',
           'contract_measurement_requirements')`)).rows[0].n;
    expect(daFase2).toBe(9);
  });
});
