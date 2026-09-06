/**
 * Fase 5 — provas VIVAS do Motor de Aprovação que exigem MAIS DE UMA CONEXÃO.
 *
 * Tudo que cabe numa sessão está em `scripts/lib/phase5-assertions.mjs`, provado
 * a cada aplicação. O que NÃO cabe lá é o que este arquivo existe para provar,
 * porque depende de dois processos ao mesmo tempo:
 *
 *   · duas decisões simultâneas sobre a MESMA etapa produzem UM resultado;
 *   · aprovar e rejeitar em corrida finaliza o pedido UMA vez, num desfecho só;
 *   · duas etapas paralelas distintas podem ambas ser decididas;
 *   · o quórum não fecha duas vezes, nem abre dois estágios seguintes;
 *   · a retentativa concorrente com a mesma chave não duplica história.
 *
 * Nenhuma dessas afirmações é demonstrável lendo a migration nem numa conexão
 * só: `FOR UPDATE` só faz alguém esperar quando existe um OUTRO alguém, e uma
 * sessão sozinha nunca encontra a linha travada.
 *
 * Os dados são descartáveis e as organizações são apagadas no final. Sem
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

const DB_URL = process.env.SUPABASE_DB_URL;
const suite = DB_URL ? describe : describe.skip;

/** Uma decisão tentada por uma conexão: ou o resultado, ou o erro. */
type Attempt = { ok: true; body: Record<string, unknown> } | { ok: false; message: string };

suite('Fase 5 · decisão concorrente, quórum e finalização única', () => {
  /** A conexão A. Também monta e desmonta o cenário. */
  let a: pg.Client;
  /** A conexão B — a segunda sessão, que é o ponto do arquivo. */
  let b: pg.Client;

  let orgId: string;
  let policyId: string;
  let versionId: string;
  const users: Record<string, string> = {};
  const suffix = Math.random().toString(36).slice(2, 10);

  const connect = async () => {
    const client = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    // O pooler reaproveita backends: um `default_transaction_read_only` deixado
    // por outro processo chegaria até aqui.
    await client.query('SET SESSION default_transaction_read_only = off');
    return client;
  };

  /*
    A identidade viaja NA MESMA INSTRUÇÃO da chamada, e isso não é estilo.

    `SUPABASE_DB_URL` aponta para o PgBouncer em modo TRANSAÇÃO (porta 6543):
    cada instrução pode cair num backend diferente, e um `set_config` de SESSÃO
    feito antes simplesmente não estaria lá na chamada seguinte. O sintoma é
    cruel porque não é um erro de conexão — é `auth.uid()` devolvendo OUTRA
    pessoa, e o motor recusando com toda a razão (`NOT_ACTIVE_MEMBER`,
    `MISSING_ROLE`). Foi assim que este teste encontrou o problema.

    O CTE resolve antes do SELECT externo, e o `true` faz o ajuste ser LOCAL à
    transação implícita da própria instrução — nada vaza para o próximo uso do
    backend, que é justamente o risco num pool compartilhado.
  */
  const withActor = (sql: string) =>
    `WITH actor AS (SELECT set_config('request.jwt.claims', $1, true)) ${sql}`;

  const decide = async (
    client: pg.Client, userId: string, stepId: string, decision: string, idem: string, reason?: string,
  ): Promise<Attempt> => {
    try {
      const { rows } = await client.query<{ r: Record<string, unknown> }>(
        withActor(`SELECT public.approval_decide($2,$3,$4,$5) AS r FROM actor`),
        [JSON.stringify({ sub: userId }), stepId, decision, idem, reason ?? null]);
      return { ok: true, body: rows[0].r };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  };

  const stepId = async (requestId: string, key: string): Promise<string> =>
    (await a.query<{ id: string }>(
      `SELECT id FROM approval_request_steps WHERE request_id=$1 AND step_key=$2`,
      [requestId, key])).rows[0].id;

  const requestStatus = async (requestId: string) =>
    (await a.query<{ status: string; current_stage_no: number | null }>(
      `SELECT status, current_stage_no FROM approval_requests WHERE id=$1`, [requestId])).rows[0];

  /** Um contrato descartável novo por cenário: a regra de "um pedido ativo" é real. */
  let seq = 0;
  const newContract = async (createdBy: string): Promise<string> =>
    (await a.query<{ id: string }>(
      `INSERT INTO contracts (organization_id, title, contract_number, status, risk_level,
                              currency, total_value, data_class, created_by, owner_user_id)
       VALUES ($1,$2,$3,'negotiation','medium','BRL',50000,'demo',$4,$4) RETURNING id`,
      [orgId, `[P5-LIVE] contrato ${seq}`, `P5L-${seq++}`, createdBy])).rows[0].id;

  const newRequest = async (requestedBy: string, contractId: string): Promise<string> => {
    const { rows } = await a.query<{ r: { request_id: string; status: string } }>(
      withActor(`SELECT public.approval_request_create($2,'contract',$3,'approve','APPROVAL') AS r FROM actor`),
      [JSON.stringify({ sub: requestedBy }), orgId, contractId]);
    expect(rows[0].r.status).toBe('CREATED');
    return rows[0].r.request_id;
  };

  beforeAll(async () => {
    a = await connect();
    b = await connect();

    orgId = (await a.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ('[P5-LIVE] Org', $1) RETURNING id`,
      [`p5-live-${suffix}`])).rows[0].id;

    const mkUser = async (label: string, roleKey: string) => {
      const uid = (await a.query<{ id: string }>(
        `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
         VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
                 $1,'x',now(),now()) RETURNING id`,
        [`p5live.${label}.${suffix}@example.test`])).rows[0].id;
      await a.query(`INSERT INTO profiles (user_id, organization_id, full_name, status)
                     VALUES ($1,$2,$3,'active')`, [uid, orgId, `[P5-LIVE] ${label}`]);
      await a.query(
        `INSERT INTO user_roles (user_id, role_id, organization_id)
         SELECT $1, r.id, $2 FROM roles r WHERE r.key=$3 AND r.organization_id IS NULL`,
        [uid, orgId, roleKey]);
      users[label] = uid;
      return uid;
    };

    /*
      DOIS titulares de cada papel. Com um só, o pedido aberto pelo próprio
      titular não teria aprovador e o motor recusaria criá-lo — corretamente.
      Papel com titular único não é fixture de decisão concorrente.
    */
    await mkUser('requester', 'owner_admin');
    await mkUser('legalA', 'juridico_contratos');
    await mkUser('legalB', 'juridico_contratos');
    await mkUser('financeA', 'financeiro');
    await mkUser('directorA', 'ceo_diretoria');

    // A fronteira de corte, ligada SÓ nesta organização descartável.
    await a.query(
      `INSERT INTO approval_engine_cutover (organization_id, business_domain, subject_type, action_type, justification)
       VALUES ($1,'contracts','contract','approve','Organização descartável do teste vivo da Fase 5.')`,
      [orgId]);

    policyId = (await a.query<{ id: string }>(
      `INSERT INTO approval_policies (organization_id, policy_key, name, business_domain)
       VALUES ($1,'contracts.approve.live','[P5-LIVE] Política descartável','contracts') RETURNING id`,
      [orgId])).rows[0].id;

    versionId = (await a.query<{ id: string }>(
      `INSERT INTO approval_policy_versions (organization_id, policy_id, version_no, subject_type,
         action_type, decision_purpose) VALUES ($1,$2,1,'contract','approve','APPROVAL') RETURNING id`,
      [orgId, policyId])).rows[0].id;

    // Estágio 1: uma etapa. Estágio 2: DUAS etapas paralelas, quórum 2 de 2.
    const s1 = (await a.query<{ id: string }>(
      `INSERT INTO approval_policy_stages (organization_id, policy_version_id, stage_no, name)
       VALUES ($1,$2,1,'Jurídico') RETURNING id`, [orgId, versionId])).rows[0].id;
    const s2 = (await a.query<{ id: string }>(
      `INSERT INTO approval_policy_stages (organization_id, policy_version_id, stage_no, name, quorum_required)
       VALUES ($1,$2,2,'Financeiro + Diretoria',2) RETURNING id`, [orgId, versionId])).rows[0].id;

    const mkStep = async (stageId: string, key: string, role: string) => a.query(
      `INSERT INTO approval_policy_steps (organization_id, policy_version_id, policy_stage_id,
         step_key, name, decision_purpose, eligibility_mode, role_key, sod_forbid_requester)
       VALUES ($1,$2,$3,$4,$5,'APPROVAL','ROLE',$6,true)`,
      [orgId, versionId, stageId, key, `[P5-LIVE] ${key}`, role]);

    await mkStep(s1, 'juridico', 'juridico_contratos');
    await mkStep(s2, 'financeiro', 'financeiro');
    await mkStep(s2, 'diretoria', 'ceo_diretoria');

    await a.query(`SELECT public.approval_policy_activate($1)`, [versionId]);
  }, 60_000);

  afterAll(async () => {
    // Apagar a organização leva junto tudo o que este arquivo criou. Os
    // usuários sintéticos ficam em `auth.users` e são inertes sem perfil.
    if (orgId) await a.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    await a?.end(); await b?.end();
  });

  it('duas decisões simultâneas sobre a MESMA etapa produzem um resultado só', async () => {
    const requestId = await newRequest(users.requester, await newContract(users.requester));
    const step = await stepId(requestId, 'juridico');


    /*
      As duas conexões disparam a decisão ao mesmo tempo, cada uma em sua
      própria transação implícita — que é como o PostgREST chama a RPC. O
      `FOR UPDATE` sobre o pedido põe uma delas para esperar; quando ela acorda,
      a primeira JÁ cometeu, a etapa não está mais `OPEN`, e a decisão é
      recusada.

      Envolver as duas em BEGIN/COMMIT explícitos e esperar as duas antes de
      cometer travaria por construção: a segunda esperaria um commit que só
      viria depois de ela responder. O impasse seria do teste, não do motor.

      Sem o travão as duas leriam `OPEN`, as duas escreveriam, e a restrição
      única `adec_one_per_step` salvaria a integridade — mas com um erro de
      chave duplicada em vez de uma recusa de negócio explicável.
    */
    const [ra, rb] = await Promise.all([
      decide(a, users.legalA, step, 'APPROVED', `race-a-${suffix}`),
      decide(b, users.legalB, step, 'APPROVED', `race-b-${suffix}`),
    ]);

    expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1);

    const { rows } = await a.query<{ n: string }>(
      `SELECT count(*) n FROM approval_decisions WHERE request_step_id=$1`, [step]);
    expect(Number(rows[0].n)).toBe(1);
  }, 60_000);

  it('aprovar e rejeitar em corrida deixa UM desfecho, e é determinístico', async () => {
    const requestId = await newRequest(users.requester, await newContract(users.requester));
    const step = await stepId(requestId, 'juridico');


    const [ra, rb] = await Promise.all([
      decide(a, users.legalA, step, 'APPROVED', `mix-a-${suffix}`),
      decide(b, users.legalB, step, 'REJECTED', `mix-b-${suffix}`, 'recusa concorrente'),
    ]);

    const winners = [ra, rb].filter((r): r is Extract<Attempt, { ok: true }> => r.ok);
    expect(winners).toHaveLength(1);

    const status = await requestStatus(requestId);
    // Aprovar o estágio 1 abre o 2 (pedido segue PENDENTE); rejeitar finaliza.
    // Qualquer das duas é um desfecho ÚNICO e coerente com quem venceu.
    if (winners[0].body.decision === 'APPROVED') {
      expect(status.status).toBe('PENDING');
      expect(status.current_stage_no).toBe(2);
    } else {
      expect(status.status).toBe('REJECTED');
    }

    const { rows } = await a.query<{ n: string }>(
      `SELECT count(*) n FROM approval_decisions WHERE request_id=$1`, [requestId]);
    expect(Number(rows[0].n)).toBe(1);
  }, 60_000);

  it('duas etapas PARALELAS distintas podem ser decididas, e o quórum fecha uma vez só', async () => {
    const requestId = await newRequest(users.requester, await newContract(users.requester));

    const first = await decide(a, users.legalA, await stepId(requestId, 'juridico'), 'APPROVED', `par-1-${suffix}`);
    expect(first.ok).toBe(true);
    expect((await requestStatus(requestId)).current_stage_no).toBe(2);

    const finStep = await stepId(requestId, 'financeiro');
    const dirStep = await stepId(requestId, 'diretoria');


    const [ra, rb] = await Promise.all([
      decide(a, users.financeA, finStep, 'APPROVED', `par-fin-${suffix}`),
      decide(b, users.directorA, dirStep, 'APPROVED', `par-dir-${suffix}`),
    ]);

    // Etapas DIFERENTES: as duas valem. Elas serializam no travão do pedido,
    // não se anulam — é essa a diferença entre "seguro" e "sequencial".
    expect(ra.ok ? 'ok' : ra.message).toBe('ok');
    expect(rb.ok ? 'ok' : rb.message).toBe('ok');

    const status = await requestStatus(requestId);
    expect(status.status).toBe('APPROVED');

    // Uma finalização só, e um fato de aprovação só.
    const { rows } = await a.query<{ n: string }>(
      `SELECT count(*) n FROM domain_events
        WHERE organization_id=$1 AND event_type='approval.request.approved'
          AND aggregate_id=$2`, [orgId, requestId]);
    expect(Number(rows[0].n)).toBe(1);
  }, 60_000);

  it('retentativa concorrente com a MESMA chave não duplica o histórico', async () => {
    const requestId = await newRequest(users.requester, await newContract(users.requester));
    const step = await stepId(requestId, 'juridico');
    const key = `retry-live-${suffix}`;


    const [ra, rb] = await Promise.all([
      decide(a, users.legalA, step, 'APPROVED', key),
      decide(b, users.legalA, step, 'APPROVED', key),
    ]);

    // Pelo menos uma passa. A outra ou repete o mesmo resultado (viu o commit
    // da primeira) ou é recusada — o que NÃO pode é haver duas linhas.
    expect([ra, rb].some((r) => r.ok)).toBe(true);

    const { rows } = await a.query<{ n: string }>(
      `SELECT count(*) n FROM approval_decisions WHERE request_step_id=$1`, [step]);
    expect(Number(rows[0].n)).toBe(1);
  }, 60_000);

  it('nenhuma etapa do estágio 2 é decidida antes de o estágio 1 fechar', async () => {
    const requestId = await newRequest(users.requester, await newContract(users.requester));
    const legalStep = await stepId(requestId, 'juridico');
    const finStep = await stepId(requestId, 'financeiro');

    const [ra, rb] = await Promise.all([
      decide(a, users.legalA, legalStep, 'APPROVED', `ooo-a-${suffix}`),
      decide(b, users.financeA, finStep, 'APPROVED', `ooo-b-${suffix}`),
    ]);

    expect(ra.ok ? 'ok' : ra.message).toBe('ok');

    /*
      A afirmação verificável aqui NÃO é "a segunda falha".

      As duas partem juntas, e se a aprovação do estágio 1 cometer primeiro, o
      estágio 2 abre e a segunda decisão passa a ser legítima — pela ordem
      correta, não apesar dela. Exigir a falha seria fixar um resultado de
      CRONOMETRAGEM, e o teste passaria ou não conforme a latência do dia. Foi
      exatamente assim que esta asserção falhou da primeira vez.

      A invariante real é temporal: se a etapa do estágio 2 foi decidida, a do
      estágio 1 já tinha sido decidida ANTES. Fora disso, a única resposta
      admissível é a recusa por ordem.
    */
    if (rb.ok) {
      const { rows } = await a.query<{ step_key: string; decided_at: string }>(
        `SELECT step_key, decided_at FROM approval_decisions
          WHERE request_id=$1 ORDER BY decided_at`, [requestId]);
      expect(rows[0].step_key).toBe('juridico');
      expect(rows).toHaveLength(2);
    } else {
      expect(rb.message).toMatch(/Ordem de aprovação/);
      const { rows } = await a.query<{ n: string }>(
        `SELECT count(*) n FROM approval_decisions WHERE request_step_id=$1`, [finStep]);
      expect(Number(rows[0].n)).toBe(0);
    }
  }, 60_000);
});
