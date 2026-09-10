/**
 * As provas VIVAS do refactor de operacionalização — contra o banco real.
 *
 * O que este arquivo prova é o que nenhuma leitura de código prova: que os
 * gatilhos, as políticas e as funções estão APLICADOS e se comportam como
 * prometido. Ele não fabrica ato humano nenhum — só verifica que o banco
 * recusa quem tenta.
 *
 * Tudo roda dentro de uma transação desfeita ao final. Nenhuma linha
 * sobrevive, inclusive as descartáveis criadas para as provas.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import dotenv from 'dotenv';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const SKIP = !process.env.SUPABASE_DB_URL
  ? 'SUPABASE_DB_URL ausente — provas vivas puladas'
  : null;

describe.skipIf(!!SKIP)('operacionalização de contratos — provas vivas', () => {
  let client: InstanceType<typeof import('pg').Client>;
  let organizationId: string | null = null;
  let contractId: string | null = null;
  let documentId: string | null = null;

  const one = async (sql: string, params: unknown[] = []) =>
    (await client.query(sql, params)).rows[0];

  /** Espera que a operação FALHE, e devolve a mensagem para conferência. */
  const rejects = async (sql: string, params: unknown[] = []): Promise<string> => {
    await client.query('SAVEPOINT probe');
    try {
      await client.query(sql, params);
      await client.query('ROLLBACK TO SAVEPOINT probe');
      return '__ACEITOU__';
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT probe');
      return error instanceof Error ? error.message : String(error);
    }
  };

  beforeAll(async () => {
    const pg = await import('pg');
    client = new pg.default.Client({
      connectionString: process.env.SUPABASE_DB_URL,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    await client.query('SET SESSION default_transaction_read_only = off');
    await client.query('BEGIN');

    organizationId = (await one('SELECT id FROM public.organizations ORDER BY created_at LIMIT 1'))?.id ?? null;
    if (!organizationId) return;

    // Um calendário declarado, para que a conta em dias úteis seja possível.
    await client.query(
      `INSERT INTO public.organization_business_calendars (organization_id) VALUES ($1)
       ON CONFLICT (organization_id) DO NOTHING`, [organizationId]);

    contractId = (await one(
      `INSERT INTO public.contracts (organization_id, title, contract_number, status, start_date, end_date)
       VALUES ($1, '[TESTE] Operacionalização', '[TESTE] OPS', 'active', DATE '2026-01-01', DATE '2026-12-31')
       RETURNING id`, [organizationId]))?.id ?? null;
    documentId = (await one(
      `INSERT INTO public.contract_documents (organization_id, contract_id, title, file_path, document_type)
       VALUES ($1, $2, 'Contrato original', 'teste/ops.pdf', 'contract') RETURNING id`,
      [organizationId, contractId]))?.id ?? null;
  });

  afterAll(async () => {
    await client?.query('ROLLBACK').catch(() => undefined);
    await client?.end().catch(() => undefined);
  });

  // ─────────────────────────────────────────────────────────────────────────
  it('leitura bem evidenciada é estruturada sozinha — sem entrar em fila', async () => {
    const row = await one(
      `INSERT INTO public.contract_clauses
         (organization_id, contract_id, title, clause_type, content, risk_level,
          source_document_id, source_page, source_excerpt, ai_flagged, review_status,
          ai_confidence, ai_provider, ai_model)
       VALUES ($1, $2, 'Prazo de pagamento', 'pagamento', 'Pagamento em 30 dias', 'low',
               $3, 12, 'o pagamento será efetuado em até 30 (trinta) dias', true, 'draft',
               0.94, 'anthropic', 'claude-sonnet-5')
       RETURNING interpretation_state, attention_reasons, attention_policy_version`,
      [organizationId, contractId, documentId]);

    expect(row.interpretation_state).toBe('structured');
    expect(row.attention_reasons).toBeNull();
    expect(row.attention_policy_version).toBe('contract-attention-policy/1.0.0');
  });

  it('exposição material e risco alto continuam pedindo uma pessoa', async () => {
    const row = await one(
      `INSERT INTO public.contract_clauses
         (organization_id, contract_id, title, clause_type, content, risk_level,
          source_document_id, source_page, source_excerpt, amount,
          ai_flagged, review_status, ai_confidence, ai_provider, ai_model)
       VALUES ($1, $2, 'Multa por inadimplemento', 'penalidade', 'Multa de 20%', 'high',
               $3, 44, 'multa de 20% sobre o valor total do contrato', 500000,
               true, 'draft', 0.97, 'anthropic', 'claude-sonnet-5')
       RETURNING interpretation_state, attention_reasons, attention_exposure`,
      [organizationId, contractId, documentId]);

    expect(row.interpretation_state).toBe('requires_attention');
    expect(row.attention_reasons).toEqual(
      expect.arrayContaining([
        'material_contractual_risk', 'material_financial_exposure', 'possible_legal_commitment',
      ]),
    );
    expect(Number(row.attention_exposure)).toBe(500000);
  });

  it('service role não confirma interpretação nem baixa atenção', async () => {
    const clause = await one(
      `SELECT id FROM public.contract_clauses WHERE contract_id = $1 LIMIT 1`, [contractId]);

    expect(await rejects(
      `UPDATE public.contract_clauses SET interpretation_state = 'human_confirmed' WHERE id = $1`,
      [clause.id],
    )).toMatch(/GOVERNANCE VIOLATION/);

    expect(await rejects(
      `UPDATE public.contract_clauses
          SET attention_resolved_by = $2, attention_resolved_at = now() WHERE id = $1`,
      [clause.id, '00000000-0000-0000-0000-000000000001'],
    )).toMatch(/GOVERNANCE VIOLATION/);
  });

  it('a função de decisão humana recusa conexão sem sessão', async () => {
    const clause = await one(
      `SELECT id FROM public.contract_clauses WHERE contract_id = $1 LIMIT 1`, [contractId]);
    expect(await rejects(
      `SELECT public.contract_clause_resolve_attention($1, 'confirm')`, [clause.id],
    )).toMatch(/authenticated tenant|sessão autenticada/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  it('regra ancorada em agenda nasce sem data — e diz por quê', async () => {
    const definition = await one(
      `INSERT INTO public.contract_obligation_definitions
         (organization_id, contract_id, title, responsible_side, source_document_id,
          effective_from, activation_kind, due_kind, calendar_basis,
          schedule_anchor, schedule_anchor_offset_days, recurrence_kind)
       VALUES ($1, $2, 'Documentos antes da medição', 'contracting_organization', $3,
               DATE '2026-01-01', 'schedule_anchor', 'days_before_schedule_anchor', 'business_days',
               'measurement', 5, 'one_time')
       RETURNING id`, [organizationId, contractId, documentId]);

    const created = await one(
      `SELECT public.contract_obligations_materialize($1, DATE '2026-12-31', $2) AS n`,
      [definition.id, organizationId]);
    expect(Number(created.n)).toBe(1);

    const instance = await one(
      `SELECT date_state, due_date, due_confidence, schedule_anchor, due_basis
         FROM public.contract_obligation_instances WHERE definition_id = $1`, [definition.id]);
    expect(instance.date_state).toBe('AWAITING_SCHEDULE_ANCHOR');
    expect(instance.due_date).toBeNull();
    expect(instance.due_confidence).toBe('unknown');
    expect(instance.schedule_anchor).toBe('measurement');
    expect(instance.due_basis).toMatch(/ainda não agendado/);

    // Rodar de novo não duplica.
    const again = await one(
      `SELECT public.contract_obligations_materialize($1, DATE '2026-12-31', $2) AS n`,
      [definition.id, organizationId]);
    expect(Number(again.n)).toBe(0);
  });

  it('quando Projetos agenda, o prazo real aparece e a exigência passa a valer', async () => {
    const definition = await one(
      `SELECT id FROM public.contract_obligation_definitions
        WHERE contract_id = $1 AND schedule_anchor = 'measurement' LIMIT 1`, [contractId]);

    const rule = await one(
      `INSERT INTO public.contract_measurement_requirements
         (organization_id, contract_id, title, source_document_id, effective_from)
       VALUES ($1, $2, 'Medição mensal', $3, DATE '2026-01-01') RETURNING id`,
      [organizationId, contractId, documentId]);

    let project = await one(
      `SELECT id FROM public.projects WHERE organization_id = $1 LIMIT 1`, [organizationId]);
    if (!project) {
      project = await one(
        `INSERT INTO public.projects (id, organization_id, project)
         VALUES ('TESTE-OPS', $1, '{"codigo":"TESTE-OPS","nome":"[TESTE] operacionalização"}'::jsonb)
         RETURNING id`, [organizationId]);
    }
    await client.query(
      `INSERT INTO public.contract_project_links (organization_id, contract_id, project_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [organizationId, contractId, project.id]);

    // 30/09/2026 é uma quarta-feira.
    const measurement = await one(
      `INSERT INTO public.project_measurements
         (organization_id, project_id, contract_id, contract_measurement_rule_id,
          occurrence_key, expected_at, status)
       VALUES ($1, $2, $3, $4, '2026-09', DATE '2026-09-30', 'PLANNED') RETURNING id`,
      [organizationId, project.id, contractId, rule.id]);

    const applied = await one(
      `SELECT public.contract_obligations_apply_schedule_anchor($1, $2) AS n`,
      [measurement.id, organizationId]);
    expect(Number(applied.n)).toBe(1);

    const resolved = await one(
      `SELECT date_state, due_date, due_confidence, state, schedule_anchor_date
         FROM public.contract_obligation_instances WHERE definition_id = $1`, [definition.id]);
    expect(resolved.date_state).toBe('RESOLVED');
    expect(resolved.due_confidence).toBe('known');
    expect(resolved.state).toBe('OPEN');
    // Cinco dias ÚTEIS antes de 30/09/2026 é 23/09/2026 — não 25/09 (corridos).
    expect(new Date(resolved.due_date).toISOString().slice(0, 10)).toBe('2026-09-23');

    // Aplicar de novo não muda nada.
    const reapplied = await one(
      `SELECT public.contract_obligations_apply_schedule_anchor($1, $2) AS n`,
      [measurement.id, organizationId]);
    expect(Number(reapplied.n)).toBe(0);
  });

  it('sem calendário declarado, dia útil continua sem resposta', async () => {
    const foreign = await one(`SELECT gen_random_uuid() AS id`);
    const shifted = await one(
      `SELECT public.organization_shift_business_days($1, DATE '2026-09-30', -5) AS d`, [foreign.id]);
    expect(shifted.d).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────
  it('o Apex abre acompanhamento; ele não designa nem verifica sozinho', async () => {
    const followup = await one(
      `INSERT INTO public.apex_followups
         (organization_id, source_kind, source_id, contract_id, goal, responsible_text,
          state, cadence_days, due_date)
       VALUES ($1, 'contract', $2, $2, 'Renovar CND', 'Contraparte', 'ACTIVE', 7, CURRENT_DATE - 1)
       RETURNING id, state`, [organizationId, contractId]);
    expect(followup.state).toBe('ACTIVE');

    expect(await rejects(
      `UPDATE public.apex_followups SET assigned_by = $2, assigned_at = now() WHERE id = $1`,
      [followup.id, '00000000-0000-0000-0000-000000000001'],
    )).toMatch(/GOVERNANCE VIOLATION/);

    expect(await rejects(
      `UPDATE public.apex_followups SET verified_by = $2, verified_at = now() WHERE id = $1`,
      [followup.id, '00000000-0000-0000-0000-000000000001'],
    )).toMatch(/GOVERNANCE VIOLATION/);

    expect(await rejects(
      `SELECT public.apex_followup_assign($1, NULL, NULL, 'Fulano')`, [followup.id],
    )).toMatch(/authenticated tenant|sessão autenticada/);
    expect(await rejects(
      `SELECT public.apex_followup_confirm_completion($1)`, [followup.id],
    )).toMatch(/authenticated tenant|sessão autenticada/);
  });

  it('aguardando a contraparte, o Apex não cobra antes da data esperada', async () => {
    const followup = await one(
      `SELECT id FROM public.apex_followups WHERE contract_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [contractId]);

    const overdue = await client.query(
      `SELECT id FROM public.apex_followup_due_nudges($1, CURRENT_DATE)`, [organizationId]);
    expect(overdue.rows.some((r) => r.id === followup.id)).toBe(true);

    await client.query(
      `UPDATE public.apex_followups
          SET state = 'WAITING_EXTERNAL_PARTY',
              next_expected_event = 'Resposta do cliente',
              next_expected_event_at = CURRENT_DATE + 6
        WHERE id = $1`, [followup.id]);

    const quiet = await client.query(
      `SELECT id FROM public.apex_followup_due_nudges($1, CURRENT_DATE)`, [organizationId]);
    expect(quiet.rows.some((r) => r.id === followup.id)).toBe(false);

    const later = await client.query(
      `SELECT id FROM public.apex_followup_due_nudges($1, CURRENT_DATE + 6)`, [organizationId]);
    expect(later.rows.some((r) => r.id === followup.id)).toBe(true);
  });

  it('aguardar a contraparte sem data esperada é recusado pelo banco', async () => {
    expect(await rejects(
      `INSERT INTO public.apex_followups
         (organization_id, source_kind, source_id, contract_id, goal, responsible_text, state)
       VALUES ($1, 'contract', $2, $2, 'Sem data', 'Fulano', 'WAITING_EXTERNAL_PARTY')`,
      [organizationId, contractId],
    )).toMatch(/af_waiting_has_expectation/);
  });

  it('fechar por evidência exige verificação determinística e a evidência', async () => {
    expect(await rejects(
      `INSERT INTO public.apex_followups
         (organization_id, source_kind, source_id, contract_id, goal, responsible_text,
          state, closure_basis, closed_at, verification_mode, verification_evidence_id)
       VALUES ($1, 'contract', $2, $2, 'Meta', 'Fulano', 'COMPLETED', 'verified_evidence',
               now(), 'human_confirmation', gen_random_uuid())`,
      [organizationId, contractId],
    )).toMatch(/GOVERNANCE VIOLATION/);

    expect(await rejects(
      `INSERT INTO public.apex_followups
         (organization_id, source_kind, source_id, contract_id, goal, responsible_text,
          state, closure_basis, closed_at, verification_mode)
       VALUES ($1, 'contract', $2, $2, 'Meta', 'Fulano', 'COMPLETED', 'verified_evidence',
               now(), 'deterministic_evidence')`,
      [organizationId, contractId],
    )).toMatch(/requires verified evidence|requires the evidence/);
  });

  it('acompanhamento sem responsável não existe', async () => {
    expect(await rejects(
      `INSERT INTO public.apex_followups
         (organization_id, source_kind, source_id, contract_id, goal, state)
       VALUES ($1, 'contract', $2, $2, 'Sem dono', 'ACTIVE')`,
      [organizationId, contractId],
    )).toMatch(/af_has_responsible/);
  });

  it('o histórico do acompanhamento é append-only', async () => {
    const event = await one(
      `SELECT id FROM public.apex_followup_events
        WHERE organization_id = $1 ORDER BY occurred_at DESC LIMIT 1`, [organizationId]);
    if (!event) return;
    expect(await rejects(
      `UPDATE public.apex_followup_events SET note = 'reescrito' WHERE id = $1`, [event.id],
    )).toMatch(/append-only/);
    expect(await rejects(
      `DELETE FROM public.apex_followup_events WHERE id = $1`, [event.id],
    )).toMatch(/append-only/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  it('as tabelas novas têm RLS ligada e não são graváveis pelo navegador', async () => {
    for (const table of [
      'apex_followups', 'apex_followup_events',
      'organization_business_calendars', 'organization_non_business_days',
    ]) {
      const rls = await one(
        `SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || $1)::regclass`, [table]);
      expect(rls.relrowsecurity, `${table} sem RLS`).toBe(true);

      const writes = await one(
        `SELECT count(*)::int AS n FROM information_schema.role_table_grants
          WHERE table_name = $1 AND grantee IN ('authenticated','anon')
            AND privilege_type IN ('INSERT','UPDATE','DELETE')`, [table]);
      expect(writes.n, `${table} gravável pelo navegador`).toBe(0);
    }
  });

  it('o acompanhamento não vaza entre inquilinos — a FK composta recusa', async () => {
    const other = await one(
      `SELECT id FROM public.organizations WHERE id <> $1 ORDER BY created_at LIMIT 1`,
      [organizationId]);
    if (!other) return;
    // Um acompanhamento de OUTRA organização apontando para ESTE contrato.
    const message = await rejects(
      `INSERT INTO public.apex_followups
         (organization_id, source_kind, source_id, contract_id, goal, responsible_text)
       VALUES ($1, 'contract', $2, $2, 'Travessia', 'Fulano')`,
      [other.id, contractId]);
    expect(message).toMatch(/af_contract_tenant|violates foreign key/i);
  });

  it('a materialização recusa definição de outra organização', async () => {
    const definition = await one(
      `SELECT id FROM public.contract_obligation_definitions WHERE contract_id = $1 LIMIT 1`,
      [contractId]);
    const other = await one(
      `SELECT id FROM public.organizations WHERE id <> $1 ORDER BY created_at LIMIT 1`,
      [organizationId]);
    if (!other || !definition) return;
    expect(await rejects(
      `SELECT public.contract_obligations_materialize($1, DATE '2026-12-31', $2)`,
      [definition.id, other.id],
    )).toMatch(/não pertence à organização/);
  });
});
