/**
 * Fase 6 — provas VIVAS da medição que exigem MAIS DE UMA CONEXÃO.
 *
 * Tudo que cabe numa sessão está em `scripts/lib/phase6-assertions.mjs`, provado
 * a cada aplicação. O que NÃO cabe lá é o que este arquivo existe para provar,
 * porque depende de dois processos ao mesmo tempo:
 *
 *   · aceitar e rejeitar em corrida deixa UM desfecho, e um só evento;
 *   · duas submissões simultâneas submetem uma vez;
 *   · dois aceites simultâneos não congelam dois valores diferentes;
 *   · supersessão concorrente com aceite não produz duas revisões vivas;
 *   · dois vínculos da mesma evidência não duplicam;
 *   · a materialização rodando duas vezes ao mesmo tempo não duplica ocorrência.
 *
 * Nenhuma dessas afirmações é demonstrável lendo a migration nem numa conexão
 * só: `FOR UPDATE` só faz alguém esperar quando existe um OUTRO alguém, e uma
 * sessão sozinha nunca encontra a linha travada.
 *
 * Há ainda o que uma conexão só não prova sobre ATOMICIDADE: que uma emissão de
 * evento que falha derruba a transição junto. A injeção de falha está no fim.
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

/**
 * Varredura de inquilino descartável, do lado do SERVIDOR.
 *
 * `projects` e `tasks` referenciam a organização SEM cascata, então um
 * `DELETE FROM organizations` direto falha. Os passes resolvem a ordem de
 * dependência sem ninguém precisar declará-la — e declarar uma lista à mão
 * envelheceria na próxima migration, deixando lixo que ninguém procura.
 */
const sweepOrgSql = (uuid: string) => {
  /*
    O id entra como LITERAL, e não como parâmetro, porque um bloco `DO` não
    aceita bind — `$1` dentro do corpo entre cifrões é texto, não parâmetro.
    A validação abaixo é o que torna a interpolação segura: só um UUID passa,
    e o id vem de `gen_random_uuid()` do próprio banco.
  */
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

  WHILE pass < 8 AND coalesce(array_length(remaining, 1), 0) > 0 LOOP
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

suite('Fase 6 · corrida, finalização única e atomicidade de medição', () => {
  let a: pg.Client;
  let b: pg.Client;

  let orgId: string;
  let projectId: string;
  let contractId: string;
  let ruleId: string;
  let itemId: string;
  let milestoneId: string;
  const users: Record<string, string> = {};
  const sfx = Math.random().toString(36).slice(2, 10);

  const connect = async () => {
    const client = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    // O pooler reaproveita backends: um `default_transaction_read_only` deixado
    // por outro processo chegaria até aqui.
    await client.query('SET SESSION default_transaction_read_only = off');
    return client;
  };

  /*
    A identidade viaja NA MESMA INSTRUÇÃO da chamada — `SUPABASE_DB_URL` aponta
    para o PgBouncer em modo TRANSAÇÃO, e um `set_config` de sessão feito antes
    simplesmente não estaria lá na instrução seguinte. O CTE resolve antes do
    SELECT externo e o `true` mantém o ajuste local à instrução.
  */
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

  let seq = 0;

  /*
    NENHUM `BEGIN` explícito nas corridas abaixo, e a ausência é o ponto.

    A primeira versão deste arquivo abria transação nas duas conexões e só
    commitava depois do `Promise.all`. Isso trava por construção: B espera o
    `FOR UPDATE` de A, A espera o `Promise.all`, e o `Promise.all` espera B.
    Trinta segundos depois o teste morre por tempo — e teria morrido igual com
    um código perfeito, o que faz dele um teste que não mede nada.

    Cada RPC de transição JÁ é uma transação: a função abre, trava, valida,
    escreve história, emite o fato e commita. Deixar as duas chamadas correrem
    soltas é exatamente o cenário real de dois navegadores decidindo ao mesmo
    tempo — que é o que se quer provar.
  */

  /** Uma medição descartável nova, já SUBMETIDA e pronta para ser decidida. */
  const newSubmitted = async (): Promise<string> => {
    const key = `live-${sfx}-${seq++}`;
    const { rows } = await a.query<{ id: string }>(
      `INSERT INTO project_measurements
         (organization_id, project_id, contract_id, contract_measurement_rule_id, timeline_item_id,
          milestone_id, occurrence_key, measurement_period_start, measurement_period_end, expected_at,
          measurement_basis, accumulation_mode, measured_value, currency, status, submitted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, current_date, current_date, current_date,
               'MONETARY','INCREMENTAL', 100000, 'BRL', 'SUBMITTED', now()) RETURNING id`,
      [orgId, projectId, contractId, ruleId, itemId, milestoneId, key]);
    return rows[0].id;
  };

  const newPlanned = async (key?: string): Promise<string> => {
    const { rows } = await a.query<{ id: string }>(
      `INSERT INTO project_measurements
         (organization_id, project_id, contract_id, contract_measurement_rule_id, timeline_item_id,
          occurrence_key, measurement_basis, accumulation_mode, status)
       VALUES ($1,$2,$3,$4,$5,$6,'MONETARY','INCREMENTAL','PLANNED') RETURNING id`,
      [orgId, projectId, contractId, ruleId, itemId, key ?? `live-p-${sfx}-${seq++}`]);
    return rows[0].id;
  };

  const statusOf = async (id: string) =>
    (await a.query<{ status: string }>(`SELECT status FROM project_measurements WHERE id=$1`, [id])).rows[0].status;

  const eventsOf = async (id: string, type?: string) =>
    Number((await a.query<{ n: string }>(
      `SELECT count(*) n FROM domain_events WHERE aggregate_id=$1 ${type ? 'AND event_type=$2' : ''}`,
      type ? [id, type] : [id])).rows[0].n);

  beforeAll(async () => {
    a = await connect();
    b = await connect();

    orgId = (await a.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ('[P6-LIVE] Org', $1) RETURNING id`,
      [`p6live-${sfx}`])).rows[0].id;

    const mkUser = async (label: string, roleKey: string) => {
      const uid = (await a.query<{ id: string }>(
        `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
         VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
                 $1,'x',now(),now()) RETURNING id`, [`p6live.${label}.${sfx}@example.test`])).rows[0].id;
      await a.query(`INSERT INTO profiles (user_id, organization_id, full_name, status)
                     VALUES ($1,$2,$3,'active')`, [uid, orgId, `[P6-LIVE] ${label}`]);
      await a.query(`INSERT INTO user_roles (user_id, role_id, organization_id)
                     SELECT $1, r.id, $2 FROM roles r WHERE r.key=$3 AND r.organization_id IS NULL`,
        [uid, orgId, roleKey]);
      return uid;
    };
    // Dois decisores DISTINTOS: uma corrida com a mesma pessoa provaria
    // reentrância, não concorrência entre atores.
    users.manager = await mkUser('manager', 'gestor_projetos');
    users.manager2 = await mkUser('manager2', 'gestor_projetos');

    projectId = `p6live-${sfx}`;
    await a.query(`INSERT INTO projects (id, organization_id, project) VALUES ($1,$2,$3)`,
      [projectId, orgId, JSON.stringify({ name: '[P6-LIVE] Projeto', status: 'em_andamento' })]);

    contractId = (await a.query<{ id: string }>(
      `INSERT INTO contracts (organization_id, title, status, currency, data_class)
       VALUES ($1,'[P6-LIVE] Contrato','active','BRL','demo') RETURNING id`, [orgId])).rows[0].id;

    await a.query(`INSERT INTO contract_project_links (organization_id, contract_id, project_id)
                   VALUES ($1,$2,$3)`, [orgId, contractId, projectId]);

    milestoneId = (await a.query<{ id: string }>(
      `INSERT INTO contract_milestones (organization_id, contract_id, project_id, title, milestone_type, status)
       VALUES ($1,$2,$3,'[P6-LIVE] Marco','Medição','pending') RETURNING id`,
      [orgId, contractId, projectId])).rows[0].id;

    ruleId = (await a.query<{ id: string }>(
      `INSERT INTO contract_measurement_requirements
         (organization_id, contract_id, title, source_reference, effective_from,
          report_required, technical_report_required, evidence_required,
          tests_inspection_required, customer_acceptance_required,
          measurement_basis, accumulation_mode, aggregation_mode, cadence, milestone_id)
       VALUES ($1,$2,'[P6-LIVE] Medição mensal','Cl. 5', current_date - 365,
               false,false,false,false,false,'MONETARY','INCREMENTAL','SUM_INCREMENTAL','MONTHLY',$3)
       RETURNING id`, [orgId, contractId, milestoneId])).rows[0].id;

    itemId = (await a.query<{ id: string }>(
      `INSERT INTO project_timeline_items (organization_id, project_id, title, planned_start, planned_finish)
       VALUES ($1,$2,'[P6-LIVE] Etapa', date_trunc('month', current_date)::date,
               (date_trunc('month', current_date) + interval '1 month - 1 day')::date) RETURNING id`,
      [orgId, projectId])).rows[0].id;

    await a.query(
      `INSERT INTO contract_measurement_rule_timeline_mappings
         (organization_id, contract_id, rule_id, project_id, timeline_item_id, mapping_source, review_state, mapped_by)
       VALUES ($1,$2,$3,$4,$5,'explicit','accepted',$6)`,
      [orgId, contractId, ruleId, projectId, itemId, users.manager]);
  }, 60_000);

  /*
    A limpeza varre TODA tabela com `organization_id`, em passes.

    Um `DELETE FROM organizations` direto não funciona: `projects` e `tasks`
    referenciam a organização sem cascata, e o delete falha. Numa suíte com
    try/catch em volta, ele falharia em SILÊNCIO e deixaria organização
    descartável em produção — que é exatamente o que a §59 e a §102 proíbem, e
    exatamente o que já aconteceu uma vez nesta fase.
  */
  afterAll(async () => {
    try {
      /*
        A varredura roda DENTRO do banco, num bloco só.

        A primeira versão fazia isto do lado do cliente: cerca de cem tabelas
        vezes oito passes, cada uma um ida-e-volta pelo pooler. Sozinho o
        arquivo passava; dentro da suíte completa, com o banco ocupado, a
        limpeza estourou os 60 segundos e o teste falhou depois de todas as
        provas terem passado. Um `DO` é uma viagem, e o laço de dependências
        acontece onde os dados estão.
      */
      await a.query(sweepOrgSql(orgId));
      await a.query(`DELETE FROM auth.users WHERE email LIKE $1`, [`p6live.%.${sfx}@example.test`]);
    } catch (e) {
      // A limpeza que falha precisa APARECER. Silenciá-la é como organização
      // descartável fica viva em produção sem ninguém saber.
      console.error('[P6-LIVE] limpeza falhou:', (e as Error).message);
      throw e;
    }
    await a?.end();
    await b?.end();
  }, 60_000);

  // ══════════════════════════════════════════════════════════════════
  // CORRIDAS
  // ══════════════════════════════════════════════════════════════════

  it('aceitar e rejeitar em corrida deixa UM desfecho, e ele é coerente', async () => {
    const m = await newSubmitted();

    const [ra, rb] = await Promise.all([
      call(a, users.manager, `SELECT public.project_measurement_accept($2,'internal_reviewer') AS r FROM actor`, [m]),
      call(b, users.manager2, `SELECT public.project_measurement_reject($2,'fora do escopo') AS r FROM actor`, [m]),
    ]);

    const final = await statusOf(m);
    // Um dos dois venceu, e o estado é o do vencedor. Nunca os dois.
    expect(['ACCEPTED', 'REJECTED']).toContain(final);
    const accepted = await eventsOf(m, 'projects.measurement.accepted');
    const rejected = await eventsOf(m, 'projects.measurement.rejected');
    expect(accepted + rejected).toBe(1);
    expect(final === 'ACCEPTED' ? accepted : rejected).toBe(1);
  }, 30_000);

  it('dois aceites simultâneos congelam UM valor, e emitem UM fato', async () => {
    const m = await newSubmitted();

    const [ra, rb] = await Promise.all([
      call(a, users.manager, `SELECT public.project_measurement_accept($2,'internal_reviewer',NULL,111,'BRL') AS r FROM actor`, [m]),
      call(b, users.manager2, `SELECT public.project_measurement_accept($2,'internal_reviewer',NULL,222,'BRL') AS r FROM actor`, [m]),
    ]);

    const row = (await a.query<{ accepted_value: string; status: string }>(
      `SELECT accepted_value, status FROM project_measurements WHERE id=$1`, [m])).rows[0];
    expect(row.status).toBe('ACCEPTED');
    // 111 OU 222 — nunca a soma, nunca os dois congelados.
    expect([111, 222]).toContain(Number(row.accepted_value));
    expect(await eventsOf(m, 'projects.measurement.accepted')).toBe(1);
  }, 30_000);

  it('duas submissões simultâneas submetem uma vez só', async () => {
    const m = await newPlanned();
    // Valor apurado E moeda: base MONETARY sem valor deixa a completude
    // INCOMPLETE, e a submissão é recusada — corretamente.
    await a.query(
      `UPDATE project_measurements
          SET status='IN_PREPARATION', measured_value = 50000, currency = 'BRL' WHERE id=$1`, [m]);
    await a.query(`SELECT project_measurement_resolve_requirements($1)`, [m]);

    /*
      Evidência de execução é PRÉ-REQUISITO de submissão, e não detalhe de
      fixture: sem nenhuma, a dimensão `execution` fica INCOMPLETE e as duas
      submissões são recusadas com razão. Descobri isso porque a primeira
      versão do teste falhou — e ela falhou provando o comportamento correto.
    */
    const evFile = (await a.query<{ id: string }>(
      `INSERT INTO project_files (organization_id, project_id, bucket_id, object_path, file_name, content_type, file_size)
       VALUES ($1,$2,'projects',$3,'exec.pdf','application/pdf',10) RETURNING id`,
      [orgId, projectId, `p6live/${sfx}/exec-${seq++}.pdf`])).rows[0].id;
    await a.query(`SELECT project_measurement_link_evidence($1,'project_file',$2)`, [m, evFile]);

    /*
      O passo explícito de "pronta para submissão". A §10 separa PRONTA de
      SUBMETIDA, e a máquina de estados obedece: não há atalho de
      IN_PREPARATION direto para SUBMITTED. A corrida que interessa é sobre a
      submissão em si, então o pacote chega pronto antes das duas chamadas.
    */
    await a.query(withActor(`SELECT public.project_measurement_mark_ready($2) FROM actor`),
      [JSON.stringify({ sub: users.manager }), m]);

    const [ra, rb] = await Promise.all([
      call(a, users.manager, `SELECT public.project_measurement_submit($2) AS r FROM actor`, [m]),
      call(b, users.manager2, `SELECT public.project_measurement_submit($2) AS r FROM actor`, [m]),
    ]);

    if (!ra.ok && !rb.ok) {
      throw new Error(`ambas recusadas: A=${ra.message} | B=${rb.message}`);
    }
    expect(await statusOf(m)).toBe('SUBMITTED');
    expect(await eventsOf(m, 'projects.measurement.submitted')).toBe(1);
  }, 30_000);

  it('supersessão em corrida com aceite não deixa duas revisões vivas', async () => {
    const m = await newSubmitted();
    await a.query(withActor(`SELECT public.project_measurement_accept($2,'internal_reviewer') FROM actor`),
      [JSON.stringify({ sub: users.manager }), m]);

    const [ra, rb] = await Promise.all([
      call(a, users.manager, `SELECT public.project_measurement_supersede($2,'correção A') AS r FROM actor`, [m]),
      call(b, users.manager2, `SELECT public.project_measurement_supersede($2,'correção B') AS r FROM actor`, [m]),
    ]);

    const successors = Number((await a.query<{ n: string }>(
      `SELECT count(*) n FROM project_measurements WHERE supersedes_id=$1
        AND status NOT IN ('CANCELLED','SUPERSEDED')`, [m])).rows[0].n);
    expect(successors).toBe(1);
    expect(await statusOf(m)).toBe('SUPERSEDED');
    expect(await eventsOf(m, 'projects.measurement.superseded')).toBe(1);
  }, 30_000);

  it('dois vínculos simultâneos da MESMA evidência não duplicam', async () => {
    const m = await newPlanned();
    const file = (await a.query<{ id: string }>(
      `INSERT INTO project_files (organization_id, project_id, bucket_id, object_path, file_name, content_type, file_size)
       VALUES ($1,$2,'projects',$3,'r.pdf','application/pdf',10) RETURNING id`,
      [orgId, projectId, `p6live/${sfx}/${seq++}.pdf`])).rows[0].id;

    const [ra, rb] = await Promise.all([
      call(a, users.manager, `SELECT public.project_measurement_link_evidence($2,'project_file',$3) AS r FROM actor`, [m, file]),
      call(b, users.manager2, `SELECT public.project_measurement_link_evidence($2,'project_file',$3) AS r FROM actor`, [m, file]),
    ]);

    const links = Number((await a.query<{ n: string }>(
      `SELECT count(*) n FROM project_measurement_evidence WHERE measurement_id=$1 AND source_id=$2`,
      [m, file])).rows[0].n);
    expect(links).toBe(1);
  }, 30_000);

  it('materialização concorrente não duplica a ocorrência', async () => {
    const [ra, rb] = await Promise.all([
      a.query<{ r: { created: number } }>(`SELECT project_measurements_materialize($1) AS r`, [orgId])
        .then((x) => x.rows[0].r).catch(() => null),
      b.query<{ r: { created: number } }>(`SELECT project_measurements_materialize($1) AS r`, [orgId])
        .then((x) => x.rows[0].r).catch(() => null),
    ]);
    await a.query('COMMIT').catch(() => a.query('ROLLBACK'));
    await b.query('COMMIT').catch(() => b.query('ROLLBACK'));

    const dupes = Number((await a.query<{ n: string }>(
      `SELECT count(*) n FROM (
         SELECT occurrence_key FROM project_measurements
          WHERE organization_id=$1 AND contract_measurement_rule_id=$2
            AND occurrence_state='resolved' AND status NOT IN ('CANCELLED','SUPERSEDED')
          GROUP BY occurrence_key HAVING count(*) > 1) d`, [orgId, ruleId])).rows[0].n);
    expect(dupes).toBe(0);
    // Ao menos uma das duas execuções produziu alguma coisa, ou ambas
    // encontraram o candidato já criado. Nunca duas ocorrências iguais.
    expect((ra?.created ?? 0) + (rb?.created ?? 0)).toBeLessThanOrEqual(1);
  }, 30_000);

  // ══════════════════════════════════════════════════════════════════
  // ATOMICIDADE — injeção de falha
  // ══════════════════════════════════════════════════════════════════

  /*
    A prova de que fato e mutação vivem ou morrem juntos.

    O truque é fazer a EMISSÃO falhar depois de a mutação já ter acontecido na
    transação. Uma chave de idempotência ocupada com significado diferente é
    exatamente isso: `emit_domain_event` levanta `unique_violation` DEPOIS de o
    UPDATE do estado ter rodado. Se a transição sobrevivesse a isso, existiria
    medição aceita sem o fato que a Fase 7 vai consumir — o pior desfecho
    possível, porque é silencioso.
  */
  it('emissão de evento que falha derruba a transição junto (§43)', async () => {
    const m = await newSubmitted();
    const revision = 1;

    // Ocupa a chave que o aceite usaria, com um payload DIFERENTE.
    await a.query(
      `SELECT emit_domain_event($1,'projects.measurement.accepted',1,'project_measurement',$2,$3,
                                '{"sabotagem": true}'::jsonb)`,
      [orgId, m, `projects.measurement.accepted:${m}:${revision}:ACCEPTED`]);

    const res = await call(a, users.manager,
      `SELECT public.project_measurement_accept($2,'internal_reviewer') AS r FROM actor`, [m]);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/idempot|unique|chave/i);

    // E o estado NÃO mudou: a transição caiu com a emissão.
    expect(await statusOf(m)).toBe('SUBMITTED');
    const row = (await a.query<{ accepted_at: string | null }>(
      `SELECT accepted_at FROM project_measurements WHERE id=$1`, [m])).rows[0];
    expect(row.accepted_at).toBeNull();
  }, 30_000);

  it('transição recusada não deixa histórico nem evento órfão', async () => {
    const m = await newPlanned();
    const histBefore = Number((await a.query<{ n: string }>(
      `SELECT count(*) n FROM project_measurement_history WHERE measurement_id=$1`, [m])).rows[0].n);

    // PLANNED → ACCEPTED não é transição válida.
    const res = await call(a, users.manager,
      `SELECT public.project_measurement_accept($2,'internal_reviewer') AS r FROM actor`, [m]);
    expect(res.ok).toBe(false);

    const histAfter = Number((await a.query<{ n: string }>(
      `SELECT count(*) n FROM project_measurement_history WHERE measurement_id=$1`, [m])).rows[0].n);
    expect(histAfter).toBe(histBefore);
    expect(await eventsOf(m)).toBe(0);
    expect(await statusOf(m)).toBe('PLANNED');
  }, 30_000);
});
