/**
 * Fase 4 — provas VIVAS que exigem MAIS DE UMA CONEXÃO.
 *
 * Tudo que cabe numa sessão está em `scripts/assert-contracts-v2-phase4.sql`,
 * provado a cada aplicação. O que NÃO cabe lá é o que este arquivo existe para
 * provar, porque depende de dois processos ao mesmo tempo:
 *
 *   · dois trabalhadores concorrentes recebem conjuntos DISJUNTOS;
 *   · um trabalhador travado não faz o outro esperar (SKIP LOCKED);
 *   · uma passagem perdida no meio devolve o trabalho, sem duplicar;
 *   · o roteamento concorrente não cria dois trabalhos para o mesmo fato;
 *   · o papel do navegador não enxerga nem toca a fila.
 *
 * Nenhuma dessas afirmações é demonstrável lendo a migration: `SKIP LOCKED` só
 * pula linha que OUTRA sessão travou, e uma sessão só nunca tem a outra.
 *
 * Os dados são descartáveis e a organização é apagada no final. Sem
 * `SUPABASE_DB_URL` a suíte é pulada — em CI sem banco ela não falha, e não
 * finge ter passado.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

interface ClaimedRow { id: string; lock_token: string; attempt_count: number }

suite('Fase 4 · concorrência real, recuperação e fronteira do navegador', () => {
  /** O trabalhador A. Também é quem monta e desmonta o cenário. */
  let a: pg.Client;
  /** O trabalhador B — a segunda sessão, que é o ponto do arquivo. */
  let b: pg.Client;
  let orgId: string;
  let contractId: string;
  let definitionId: string;

  const connect = async () => {
    const client = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    // O pooler reaproveita backends: um `default_transaction_read_only` deixado
    // por outro processo chegaria até aqui.
    await client.query('SET SESSION default_transaction_read_only = off');
    return client;
  };

  const claim = async (client: pg.Client, worker: string, limit: number, lease = 300) =>
    (await client.query<ClaimedRow>(
      'SELECT id, lock_token, attempt_count FROM public.apex_jobs_claim($1, $2, $3)',
      [worker, limit, lease])).rows;

  /**
   * Enfileira N trabalhos descartáveis, COMETIDOS, e devolve os ids.
   *
   * `run_after` fica um dia no passado de propósito. A reivindicação é
   * PLATAFORMA INTEIRA — é isso que ela deve ser — e ordena por `run_after`.
   * Datar os nossos como os mais antigos garante que o trabalhador do teste
   * pegue os nossos primeiro, em vez de o teste depender de a fila real estar
   * vazia. Os ids voltam porque toda asserção abaixo é filtrada por eles: um
   * trabalho legítimo de outro inquilino não pode fazer este teste mentir em
   * nenhuma das duas direções.
   */
  const seedJobs = async (n: number, prefix: string): Promise<Set<string>> => {
    const ids = new Set<string>();
    for (let i = 0; i < n; i += 1) {
      const { rows } = await a.query<{ id: string }>(
        `SELECT public.apex_jobs_enqueue($1, 'contracts.obligations.materialize', $2,
           jsonb_build_object('as_of','2026-03-10','horizon_days',30), 1,
           now() - interval '1 day' + make_interval(secs => $3), 5) AS id`,
        [orgId, `${prefix}:${i}`, i]);
      ids.add(rows[0].id);
    }
    return ids;
  };

  /** Só o que ESTE teste semeou. */
  const mine = (rows: ClaimedRow[], ids: Set<string>) => rows.filter((r) => ids.has(r.id));

  beforeAll(async () => {
    a = await connect();
    b = await connect();

    orgId = (await a.query(
      `INSERT INTO organizations (name, slug) VALUES ('[PHASE4-LIVE] Org', $1) RETURNING id`,
      [`phase4-live-${Date.now()}`])).rows[0].id;
    contractId = (await a.query(
      `INSERT INTO contracts (organization_id, title, start_date, end_date)
       VALUES ($1, '[PHASE4-LIVE] Contrato', '2026-01-01', '2026-12-31') RETURNING id`,
      [orgId])).rows[0].id;
    const documentId = (await a.query(
      `INSERT INTO contract_documents (organization_id, contract_id, title, file_path, document_type)
       VALUES ($1, $2, '[PHASE4-LIVE] Doc', 'phase4-live/contrato.pdf', 'contract') RETURNING id`,
      [orgId, contractId])).rows[0].id;
    definitionId = (await a.query(
      `INSERT INTO contract_obligation_definitions
         (organization_id, contract_id, title, source_document_id, activation_kind,
          activation_event_text, due_kind, recurrence_kind)
       VALUES ($1, $2, '[PHASE4-LIVE] Obrigação', $3, 'external_event',
               'mediante aceite', 'same_day_as_activation', 'one_time') RETURNING id`,
      [orgId, contractId, documentId])).rows[0].id;
    await a.query(
      `INSERT INTO contract_obligation_event_bindings
         (organization_id, contract_id, definition_id, event_type, schema_version, occurrence_strategy)
       VALUES ($1, $2, $3, 'projects.measurement.accepted', 1, 'single')`,
      [orgId, contractId, definitionId]);
  }, 120_000);

  beforeEach(async () => {
    // Um teste que falha no meio deixa a transação aberta, e o próximo rodaria
    // dentro dela — vendo dado que não foi cometido, ou num estado abortado.
    await a.query('ROLLBACK').catch(() => undefined);
    await b.query('ROLLBACK').catch(() => undefined);
    /*
      A fila deste inquilino começa vazia em cada teste. Sem isto, o trabalho
      que o teste anterior semeou e devolveu à fila (por ROLLBACK, que é
      justamente o que ele prova) seria mais ANTIGO que o do teste seguinte —
      e a reivindicação, que ordena por `run_after`, entregaria o do vizinho.
      O teste falharia por contaminação entre testes, não por defeito no
      mecanismo.
    */
    if (orgId) await a.query('DELETE FROM apex_jobs WHERE organization_id = $1', [orgId]);
  });

  afterAll(async () => {
    if (a) {
      // Cascata da organização leva evento, trabalho, vínculo e obrigação.
      await a.query('ROLLBACK').catch(() => undefined);
      if (orgId) {
        await a.query('DELETE FROM contract_amendment_revisions WHERE organization_id = $1', [orgId])
          .catch(() => undefined);
        await a.query('DELETE FROM organizations WHERE id = $1', [orgId]).catch(() => undefined);
      }
      await a.end().catch(() => undefined);
    }
    if (b) { await b.query('ROLLBACK').catch(() => undefined); await b.end().catch(() => undefined); }
  }, 60_000);

  // ═══════════════════════════════════════════════════════════════════
  // 1 · Dois trabalhadores, conjuntos disjuntos
  // ═══════════════════════════════════════════════════════════════════

  it('1 · dois trabalhadores concorrentes nunca recebem o mesmo trabalho', async () => {
    const seeded = await seedJobs(8, `disjunto:${Date.now()}`);

    await a.query('BEGIN');
    const byA = mine(await claim(a, 'live-A', 4), seeded);
    // B reivindica ENQUANTO A ainda segura as linhas dele.
    await b.query('BEGIN');
    const byB = mine(await claim(b, 'live-B', 8), seeded);

    /*
      Se `SKIP LOCKED` não estivesse ali, B ficaria BLOQUEADO esperando A, e o
      teste terminaria por tempo esgotado em vez de por correção. Se a
      reivindicação fosse SELECT-depois-UPDATE, B receberia as MESMAS linhas de
      A e o handler rodaria duas vezes sobre cada uma.

      O que se afirma, então, são as duas metades: B avançou, e não pisou em
      nada de A.
    */
    expect(byA.length).toBe(4);
    expect(byB.length).toBe(4);

    const idsA = new Set(byA.map((r) => r.id));
    expect(byB.filter((r) => idsA.has(r.id))).toEqual([]);

    // Os oito, cada um numa mão só.
    expect(new Set([...byA, ...byB].map((r) => r.id)).size).toBe(8);
    // Tokens diferentes: a posse é individual, não um sinalizador compartilhado.
    expect(new Set([...byA, ...byB].map((r) => r.lock_token)).size).toBe(8);

    await a.query('ROLLBACK');
    await b.query('ROLLBACK');
  }, 60_000);

  it('2 · a passagem perdida no meio devolve o trabalho, sem gastar tentativa fantasma', async () => {
    const prefix = `perdida:${Date.now()}`;
    const seeded = await seedJobs(1, prefix);

    // A reivindica e MORRE antes de cometer — o equivalente a uma função
    // reciclada entre a reivindicação e o handler.
    await a.query('BEGIN');
    expect(mine(await claim(a, 'live-morre', 5), seeded).length).toBe(1);
    await a.query('ROLLBACK');

    const { rows } = await b.query(
      `SELECT status, attempt_count, lock_token FROM apex_jobs
        WHERE organization_id = $1 AND idempotency_key = $2`, [orgId, `${prefix}:0`]);
    /*
      A reivindicação e o incremento de tentativa foram desfeitos JUNTOS. Um
      desenho que gravasse a tentativa fora da transação deixaria o contador
      andando a cada queda, e o trabalho chegaria a carta morta sem nunca ter
      sido executado uma vez sequer.
    */
    expect(rows[0].status).toBe('PENDING');
    expect(rows[0].attempt_count).toBe(0);
    expect(rows[0].lock_token).toBeNull();
  }, 60_000);

  it('3 · o trabalhador da concessão expirada não conclui o que outro assumiu', async () => {
    const prefix = `concessao:${Date.now()}`;
    const seeded = await seedJobs(1, prefix);

    // A pega com concessão de 1 segundo e "trava".
    const [meu] = mine(await claim(a, 'live-lento', 5, 1), seeded);
    expect(meu).toBeDefined();
    await a.query(`UPDATE apex_jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1`,
      [meu.id]);

    // O ceifador de OUTRA sessão devolve o trabalho.
    await b.query('SELECT * FROM public.apex_jobs_reap(100, 0)');
    const devolvido = await b.query('SELECT status, lock_token FROM apex_jobs WHERE id = $1', [meu.id]);
    expect(devolvido.rows[0].status).toBe('PENDING');
    expect(devolvido.rows[0].lock_token).toBeNull();

    // B reivindica de verdade.
    await b.query(`UPDATE apex_jobs SET run_after = now() - interval '1 day' WHERE id = $1`, [meu.id]);
    const [theirs] = (await b.query<ClaimedRow>(
      `SELECT id, lock_token, attempt_count FROM public.apex_jobs_claim('live-B2', 50, 300)
        WHERE id = $1`, [meu.id])).rows;
    expect(theirs).toBeDefined();
    expect(theirs.lock_token).not.toBe(meu.lock_token);

    // A acorda e tenta concluir com o token velho.
    const stale = await a.query('SELECT public.apex_jobs_complete($1, $2) AS ok', [meu.id, meu.lock_token]);
    expect(stale.rows[0].ok).toBe(false);
    // ...e o trabalho continua sendo de B.
    const state = await b.query('SELECT status, locked_by FROM apex_jobs WHERE id = $1', [meu.id]);
    expect(state.rows[0].status).toBe('PROCESSING');
    expect(state.rows[0].locked_by).toBe('live-B2');

    // B conclui com o token corrente.
    const fresh = await b.query('SELECT public.apex_jobs_complete($1, $2) AS ok', [meu.id, theirs.lock_token]);
    expect(fresh.rows[0].ok).toBe(true);
  }, 60_000);

  // ═══════════════════════════════════════════════════════════════════
  // 2 · Roteamento sob concorrência e sob queda
  // ═══════════════════════════════════════════════════════════════════

  it('4 · roteamento concorrente não cria dois trabalhos para o mesmo fato', async () => {
    const key = `live:rota:${Date.now()}`;
    const eventId = (await a.query(
      `SELECT public.emit_domain_event($1, 'projects.measurement.accepted', 1,
        'project_measurement', gen_random_uuid(), $2, '{}'::jsonb,
        '2026-03-10T12:00:00Z'::timestamptz) AS id`, [orgId, key])).rows[0].id;

    // Duas batidas simultâneas: GitHub Actions e `after()`, por exemplo.
    await a.query('BEGIN');
    await b.query('BEGIN');
    const [ra, rb] = await Promise.all([
      a.query('SELECT * FROM public.apex_route_pending_events(200)'),
      b.query('SELECT * FROM public.apex_route_pending_events(200)'),
    ]);
    await a.query('COMMIT');
    await b.query('COMMIT');

    // Uma das duas roteou o evento; a outra o pulou (SKIP LOCKED no evento).
    const routed = Number(ra.rows[0].events_routed) + Number(rb.rows[0].events_routed);
    expect(routed).toBeGreaterThanOrEqual(1);

    const jobs = await a.query(
      'SELECT count(*)::int AS n FROM apex_jobs WHERE event_id = $1', [eventId]);
    expect(jobs.rows[0].n).toBe(1);
    const ev = await a.query('SELECT routing_state, route_count FROM domain_events WHERE id = $1', [eventId]);
    expect(ev.rows[0].routing_state).toBe('ROUTED');
    expect(ev.rows[0].route_count).toBe(1);
  }, 60_000);

  it('5 · queda entre inserir o trabalho e marcar roteado não perde nem duplica', async () => {
    const key = `live:queda:${Date.now()}`;
    const eventId = (await a.query(
      `SELECT public.emit_domain_event($1, 'projects.measurement.accepted', 1,
        'project_measurement', gen_random_uuid(), $2, '{}'::jsonb,
        '2026-03-11T12:00:00Z'::timestamptz) AS id`, [orgId, key])).rows[0].id;

    // Passagem que insere o trabalho e é perdida antes do COMMIT.
    await a.query('BEGIN');
    await a.query('SELECT * FROM public.apex_route_pending_events(200)');
    const midFlight = await a.query(
      'SELECT count(*)::int AS n FROM apex_jobs WHERE event_id = $1', [eventId]);
    expect(midFlight.rows[0].n).toBe(1); // o trabalho existe DENTRO da transação
    await a.query('ROLLBACK');

    /*
      Depois da queda: nem trabalho órfão, nem evento marcado como tratado. O
      fato continua PENDING, que é a única leitura honesta — o Apex ainda deve
      trabalho por ele.
    */
    const after = await b.query(
      `SELECT (SELECT count(*)::int FROM apex_jobs WHERE event_id = $1) AS jobs,
              (SELECT routing_state FROM domain_events WHERE id = $1) AS state`, [eventId]);
    expect(after.rows[0].jobs).toBe(0);
    expect(after.rows[0].state).toBe('PENDING');

    // A próxima batida faz o trabalho — uma vez.
    await b.query('SELECT * FROM public.apex_route_pending_events(200)');
    const done = await b.query(
      `SELECT (SELECT count(*)::int FROM apex_jobs WHERE event_id = $1) AS jobs,
              (SELECT routing_state FROM domain_events WHERE id = $1) AS state`, [eventId]);
    expect(done.rows[0].jobs).toBe(1);
    expect(done.rows[0].state).toBe('ROUTED');
  }, 60_000);

  it('6 · o efeito idempotente sobrevive à queda ANTES da conclusão', async () => {
    /*
      Injeção no ponto mais desconfortável: o handler já mudou o estado do
      DOMÍNIO (a obrigação foi ativada) e o processo cai antes de gravar o
      COMPLETED. O trabalho volta, roda de novo — e a segunda passada não pode
      ativar de novo nem escrever história duas vezes.
    */
    const key = `live:idem:${Date.now()}`;
    const eventId = (await a.query(
      `SELECT public.emit_domain_event($1, 'projects.measurement.accepted', 1,
        'project_measurement', gen_random_uuid(), $2, '{}'::jsonb,
        '2026-03-12T12:00:00Z'::timestamptz) AS id`, [orgId, key])).rows[0].id;

    const first = await a.query(
      'SELECT public.contract_obligations_apply_external_activation($1) AS r', [eventId]);
    expect(first.rows[0].r.activated).toBe(1);

    const history = await a.query(
      `SELECT count(*)::int AS n FROM contract_obligation_instance_history h
        JOIN contract_obligation_instances i ON i.id = h.instance_id
       WHERE i.definition_id = $1`, [definitionId]);

    // A "segunda entrega" do mesmo trabalho.
    const second = await a.query(
      'SELECT public.contract_obligations_apply_external_activation($1) AS r', [eventId]);
    expect(second.rows[0].r.activated).toBe(0);
    expect(second.rows[0].r.already_activated).toBe(1);

    const historyAfter = await a.query(
      `SELECT count(*)::int AS n FROM contract_obligation_instance_history h
        JOIN contract_obligation_instances i ON i.id = h.instance_id
       WHERE i.definition_id = $1`, [definitionId]);
    expect(historyAfter.rows[0].n).toBe(history.rows[0].n);

    // E um fato de ativação, não dois.
    const facts = await a.query(
      `SELECT count(*)::int AS n FROM domain_events
        WHERE organization_id = $1 AND event_type = 'contracts.obligation.instance_activated'
          AND causation_event_id = $2`, [orgId, eventId]);
    expect(facts.rows[0].n).toBe(1);
  }, 60_000);

  // ═══════════════════════════════════════════════════════════════════
  // 3 · A fronteira do navegador
  // ═══════════════════════════════════════════════════════════════════

  it('7 · o papel do navegador não lê, não escreve e não executa a fila', async () => {
    const denials: Record<string, string> = {};
    const attempt = async (label: string, sql: string, params: unknown[] = []) => {
      await a.query('SAVEPOINT probe');
      try {
        await a.query(sql, params);
        denials[label] = 'PERMITIDO';
      } catch (err) {
        denials[label] = (err as { code?: string }).code ?? 'erro';
      }
      await a.query('ROLLBACK TO SAVEPOINT probe');
    };

    await a.query('BEGIN');
    await a.query('SET LOCAL ROLE authenticated');
    await attempt('ler domain_events', 'SELECT 1 FROM domain_events LIMIT 1');
    await attempt('ler apex_jobs', 'SELECT 1 FROM apex_jobs LIMIT 1');
    await attempt('escrever domain_events',
      `INSERT INTO domain_events (organization_id, event_type, schema_version, aggregate_type,
         aggregate_id, idempotency_key) VALUES ($1,'x.y.z',1,'a',gen_random_uuid(),'k')`, [orgId]);
    await attempt('esvaziar domain_events', 'TRUNCATE domain_events');
    await attempt('esvaziar apex_jobs', 'TRUNCATE apex_jobs');
    await attempt('emitir fato',
      `SELECT public.emit_domain_event($1,'x.y.z',1,'a',gen_random_uuid(),'k')`, [orgId]);
    await attempt('reivindicar trabalho', `SELECT * FROM public.apex_jobs_claim('invasor', 1, 60)`);
    await attempt('drenar rotas', 'SELECT * FROM public.apex_route_pending_events(1)');
    await a.query('RESET ROLE');
    await a.query('ROLLBACK');

    // Todas recusadas — e por PRIVILÉGIO ausente (42501), não por RLS que não
    // casou linha. A fronteira é a falta de grant; a RLS é a segunda camada.
    for (const [label, code] of Object.entries(denials)) {
      expect(`${label}=${code}`).toBe(`${label}=42501`);
    }
  }, 60_000);

  it('8 · a leitura do vínculo de obrigação é escopada pela organização do chamador', async () => {
    await a.query('BEGIN');
    await a.query('SET LOCAL ROLE authenticated');
    // Sem JWT não há organização; a política não casa nenhuma linha, e a
    // resposta é vazio — nunca a linha de outro inquilino.
    const visible = await a.query('SELECT count(*)::int AS n FROM contract_obligation_event_bindings');
    await a.query('RESET ROLE');
    await a.query('ROLLBACK');
    expect(visible.rows[0].n).toBe(0);
  }, 60_000);
});
