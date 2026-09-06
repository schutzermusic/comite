-- ============================================================
-- Provas funcionais da Fase 4, contra o banco REAL, com dado descartável.
--
-- Roda DENTRO da transação do aplicador. Tudo que este arquivo cria some no
-- ROLLBACK do ensaio, e no modo aplicar some junto num SAVEPOINT próprio: a
-- prova usa a base de verdade e não deixa linha nenhuma para trás.
--
-- O que NÃO está aqui, por não caber em uma sessão: a disjunção entre dois
-- trabalhadores concorrentes (exige duas conexões). Isso é provado em
-- tests/integration/platform-event-graph-live.test.ts.
-- ============================================================

DO $$
DECLARE
  org_a  uuid := gen_random_uuid();
  org_b  uuid := gen_random_uuid();
  con_a  uuid;
  con_b  uuid;
  doc_a  uuid;
  def_a  uuid;   -- one_time, ativação por evento externo
  def_m  uuid;   -- mensal, ativação por evento externo
  def_x  uuid;   -- ativação por regra (contract_start) — não aceita vínculo
  ev1    uuid;
  ev2    uuid;
  ev3    uuid;
  job1   uuid;
  tok    uuid;
  n      integer;
  txt    text;
  res    jsonb;
  rec    record;
BEGIN
  -- ══════════════════════════════════════════════════════════════
  -- Cenário descartável
  -- ══════════════════════════════════════════════════════════════
  INSERT INTO organizations (id, name, slug) VALUES
    (org_a, '[PHASE4] Org A', 'phase4-org-a-' || substr(org_a::text,1,8)),
    (org_b, '[PHASE4] Org B', 'phase4-org-b-' || substr(org_b::text,1,8));

  INSERT INTO contracts (organization_id, title, start_date, end_date)
    VALUES (org_a, '[PHASE4] Contrato A', '2026-01-01', '2026-12-31') RETURNING id INTO con_a;
  INSERT INTO contracts (organization_id, title, start_date, end_date)
    VALUES (org_b, '[PHASE4] Contrato B', '2026-01-01', '2026-12-31') RETURNING id INTO con_b;

  INSERT INTO contract_documents (organization_id, contract_id, title, file_path, document_type)
    VALUES (org_a, con_a, '[PHASE4] Documento', 'phase4/contrato.pdf', 'contract') RETURNING id INTO doc_a;

  INSERT INTO contract_obligation_definitions
    (organization_id, contract_id, title, source_document_id, activation_kind,
     activation_event_text, due_kind, due_offset_days, calendar_basis, recurrence_kind)
  VALUES (org_a, con_a, '[PHASE4] Relatório após aceite', doc_a, 'external_event',
          'mediante o aceite formal do Contratante', 'days_after_activation', 10,
          'calendar_days', 'one_time')
  RETURNING id INTO def_a;

  INSERT INTO contract_obligation_definitions
    (organization_id, contract_id, title, source_document_id, effective_from,
     activation_kind, activation_event_text, due_kind, due_offset_days,
     calendar_basis, recurrence_kind)
  VALUES (org_a, con_a, '[PHASE4] Medição mensal', doc_a, '2026-01-01', 'external_event',
          'a cada medição aceita', 'days_after_activation', 5, 'calendar_days', 'monthly')
  RETURNING id INTO def_m;

  INSERT INTO contract_obligation_definitions
    (organization_id, contract_id, title, source_document_id, activation_kind,
     due_kind, recurrence_kind)
  VALUES (org_a, con_a, '[PHASE4] Seguro na assinatura', doc_a, 'contract_start',
          'same_day_as_activation', 'one_time')
  RETURNING id INTO def_x;

  -- ══════════════════════════════════════════════════════════════
  -- 1 · O evento
  -- ══════════════════════════════════════════════════════════════
  ev1 := public.emit_domain_event(
    org_a, 'projects.measurement.accepted', 1, 'project_measurement', gen_random_uuid(),
    'phase4-test:medicao:1', jsonb_build_object('occurrence_key','2026-03'),
    '2026-03-10T12:00:00Z'::timestamptz, 'system');
  ASSERT ev1 IS NOT NULL, 'emissão devolveu nulo';

  -- retentativa IDÊNTICA devolve o mesmo evento
  ASSERT public.emit_domain_event(
    org_a, 'projects.measurement.accepted', 1, 'project_measurement',
    (SELECT aggregate_id FROM domain_events WHERE id = ev1),
    'phase4-test:medicao:1', jsonb_build_object('occurrence_key','2026-03'),
    '2026-03-10T12:00:00Z'::timestamptz, 'system') = ev1,
    'retentativa idêntica criou um segundo evento';
  SELECT count(*) INTO n FROM domain_events WHERE organization_id = org_a
    AND idempotency_key = 'phase4-test:medicao:1';
  ASSERT n = 1, format('idempotência falhou: %s linhas', n);

  -- mesma chave, OUTRO significado → recusada
  BEGIN
    PERFORM public.emit_domain_event(
      org_a, 'projects.measurement.accepted', 1, 'project_measurement', gen_random_uuid(),
      'phase4-test:medicao:1', jsonb_build_object('occurrence_key','2026-04'));
    RAISE EXCEPTION 'chave reusada com outro significado foi ACEITA';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- organização obrigatória
  BEGIN
    PERFORM public.emit_domain_event(NULL, 'contracts.amendment.created', 1, 'x', gen_random_uuid(), 'k');
    RAISE EXCEPTION 'evento sem organização foi ACEITO';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- versão de schema tem de ser positiva
  BEGIN
    PERFORM public.emit_domain_event(org_a, 'contracts.amendment.created', 0, 'x', gen_random_uuid(), 'k0');
    RAISE EXCEPTION 'versão de schema zero foi ACEITA';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- tipo de evento vazio / fora do formato
  BEGIN
    PERFORM public.emit_domain_event(org_a, '', 1, 'x', gen_random_uuid(), 'kv');
    RAISE EXCEPTION 'tipo de evento vazio foi ACEITO';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- causação do MESMO inquilino: aceita, e herda a correlação
  ev2 := public.emit_domain_event(
    org_a, 'contracts.amendment.created', 1, 'contract_amendment', gen_random_uuid(),
    'phase4-test:causal:1', '{}'::jsonb, NULL, 'system', NULL, NULL, ev1);
  SELECT correlation_id INTO tok FROM domain_events WHERE id = ev1;
  ASSERT (SELECT correlation_id FROM domain_events WHERE id = ev2) = tok,
    'a correlação não foi herdada do evento causador';

  -- causação CRUZADA: recusada, com a MESMA mensagem de inexistente
  BEGIN
    PERFORM public.emit_domain_event(
      org_b, 'contracts.amendment.created', 1, 'contract_amendment', gen_random_uuid(),
      'phase4-test:causal:cross', '{}'::jsonb, NULL, 'system', NULL, NULL, ev1);
    RAISE EXCEPTION 'causação cross-tenant foi ACEITA';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS txt = MESSAGE_TEXT;
    ASSERT txt = 'Evento causador inválido.', format('mensagem reveladora: %s', txt);
  END;

  BEGIN
    PERFORM public.emit_domain_event(
      org_b, 'contracts.amendment.created', 1, 'contract_amendment', gen_random_uuid(),
      'phase4-test:causal:ghost', '{}'::jsonb, NULL, 'system', NULL, NULL, gen_random_uuid());
    RAISE EXCEPTION 'causação inexistente foi ACEITA';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS txt = MESSAGE_TEXT;
    ASSERT txt = 'Evento causador inválido.',
      format('inexistente e alheio dão mensagens diferentes: %s', txt);
  END;

  -- segredo no payload: recusado em qualquer profundidade
  BEGIN
    PERFORM public.emit_domain_event(org_a, 'contracts.amendment.created', 1, 'x',
      gen_random_uuid(), 'phase4-test:secret',
      '{"provider": {"api_key": "sk-live-abc"}}'::jsonb);
    RAISE EXCEPTION 'payload com api_key foi ACEITO';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- fato é imutável
  BEGIN
    UPDATE domain_events SET payload = '{"reescrito": true}'::jsonb WHERE id = ev1;
    RAISE EXCEPTION 'payload de evento foi REESCRITO';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE domain_events SET occurred_at = now() WHERE id = ev1;
    RAISE EXCEPTION 'occurred_at foi REESCRITO';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- metadado de roteamento evolui
  UPDATE domain_events SET route_count = 0 WHERE id = ev1;

  -- ══════════════════════════════════════════════════════════════
  -- 2 · Caixa de saída transacional
  -- ══════════════════════════════════════════════════════════════
  -- Um aditivo criado emite o fato na MESMA instrução.
  SELECT count(*) INTO n FROM domain_events WHERE event_type = 'contracts.amendment.created';
  INSERT INTO contract_amendments (organization_id, contract_id, amendment_number, status, effective_date)
    VALUES (org_a, con_a, 'TA-PH4', 'active', '2026-05-01');
  ASSERT (SELECT count(*) FROM domain_events WHERE event_type = 'contracts.amendment.created') = n + 1,
    'aditivo criado não emitiu fato';
  ASSERT EXISTS (SELECT 1 FROM domain_events
                  WHERE organization_id = org_a AND event_type = 'contracts.amendment.created'
                    AND idempotency_key LIKE 'amendment:%:created'
                    AND occurred_at::date = '2026-05-01'),
    'o fato do aditivo não usou a data de vigência como tempo do negócio';

  -- Mutação de domínio que FALHA não deixa fato. O aditivo abaixo viola a FK
  -- de inquilino; nem a linha nem o evento sobrevivem.
  SELECT count(*) INTO n FROM domain_events WHERE organization_id = org_b;
  BEGIN
    INSERT INTO contract_amendments (organization_id, contract_id, amendment_number, status)
      VALUES (org_b, con_a, 'TA-CROSS', 'active');
    RAISE EXCEPTION 'aditivo cross-tenant foi ACEITO';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  ASSERT (SELECT count(*) FROM domain_events WHERE organization_id = org_b) = n,
    'mutação de domínio recusada deixou um fato para trás';

  -- ══════════════════════════════════════════════════════════════
  -- 3 · Vínculo explícito
  -- ══════════════════════════════════════════════════════════════
  -- Descritor de texto SOZINHO não ativa nada: sem vínculo, o evento não rota.
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.contracts_obligation_activation_routes(ev1) WHERE job_type IS NOT NULL),
    'evento sem vínculo produziu rota';

  -- Definição com ativação POR REGRA não aceita vínculo.
  BEGIN
    INSERT INTO contract_obligation_event_bindings
      (organization_id, contract_id, definition_id, event_type, schema_version, occurrence_strategy)
      VALUES (org_a, con_a, def_x, 'projects.measurement.accepted', 1, 'single');
    RAISE EXCEPTION 'vínculo em definição de ativação por regra foi ACEITO';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- `single` exige one_time.
  BEGIN
    INSERT INTO contract_obligation_event_bindings
      (organization_id, contract_id, definition_id, event_type, schema_version, occurrence_strategy)
      VALUES (org_a, con_a, def_m, 'projects.measurement.accepted', 1, 'single');
    RAISE EXCEPTION 'estratégia `single` foi aceita numa série recorrente';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  INSERT INTO contract_obligation_event_bindings
    (organization_id, contract_id, definition_id, event_type, schema_version, occurrence_strategy)
    VALUES (org_a, con_a, def_a, 'projects.measurement.accepted', 1, 'single');
  INSERT INTO contract_obligation_event_bindings
    (organization_id, contract_id, definition_id, event_type, schema_version,
     occurrence_strategy, occurrence_key_field)
    VALUES (org_a, con_a, def_m, 'projects.measurement.accepted', 1,
            'payload_occurrence_key', 'occurrence_key');

  -- Vínculo não é retroalvejado.
  BEGIN
    UPDATE contract_obligation_event_bindings SET definition_id = def_m
     WHERE definition_id = def_a;
    RAISE EXCEPTION 'vínculo foi RETROALVEJADO';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ══════════════════════════════════════════════════════════════
  -- 4 · Roteamento
  -- ══════════════════════════════════════════════════════════════
  -- ev1 ainda está PENDING e agora casa com dois vínculos → UM trabalho.
  SELECT * INTO rec FROM public.apex_route_pending_events(100);
  ASSERT rec.events_routed >= 1, 'nenhum evento foi roteado';
  ASSERT (SELECT routing_state FROM domain_events WHERE id = ev1) = 'ROUTED',
    'o evento com vínculo não foi marcado como roteado';
  ASSERT (SELECT route_count FROM domain_events WHERE id = ev1) = 1,
    'um evento com dois vínculos deveria produzir UM trabalho';
  SELECT count(*) INTO n FROM apex_jobs WHERE event_id = ev1;
  ASSERT n = 1, format('trabalhos criados para ev1: %s', n);

  -- Evento SEM consumidor finaliza limpo, com contagem zero.
  ASSERT (SELECT routing_state FROM domain_events WHERE id = ev2) = 'ROUTED'
     AND (SELECT route_count FROM domain_events WHERE id = ev2) = 0,
    'evento sem consumidor não finalizou como zero-consumidor';

  -- Rerroteamento não duplica: devolver o evento a PENDING e rodar de novo.
  UPDATE domain_events SET routing_state='PENDING', routed_at=NULL WHERE id = ev1;
  PERFORM public.apex_route_pending_events(100);
  SELECT count(*) INTO n FROM apex_jobs WHERE event_id = ev1;
  ASSERT n = 1, format('rerroteamento DUPLICOU trabalho: %s linhas', n);

  -- Versão não suportada não some em silêncio.
  ev3 := public.emit_domain_event(
    org_a, 'projects.measurement.accepted', 2, 'project_measurement', gen_random_uuid(),
    'phase4-test:medicao:v2', '{}'::jsonb);
  PERFORM public.apex_route_pending_events(100);
  ASSERT (SELECT routing_state FROM domain_events WHERE id = ev3) = 'FAILED'
     AND (SELECT routing_error_code FROM domain_events WHERE id = ev3) = 'unsupported_schema_version',
    'evento de versão sem consumidor foi finalizado como se não tivesse consumidor';

  -- Roteamento não toca no fato.
  ASSERT (SELECT payload FROM domain_events WHERE id = ev1) = jsonb_build_object('occurrence_key','2026-03'),
    'o roteamento alterou o payload do fato';

  -- ══════════════════════════════════════════════════════════════
  -- 5 · Reivindicação, concessão e ceifa
  -- ══════════════════════════════════════════════════════════════
  SELECT id INTO job1 FROM apex_jobs WHERE event_id = ev1;

  -- Trabalho com run_after no futuro NÃO é reivindicado.
  UPDATE apex_jobs SET run_after = now() + interval '1 hour' WHERE id = job1;
  ASSERT NOT EXISTS (SELECT 1 FROM public.apex_jobs_claim('t-futuro', 10, 300)),
    'um trabalho agendado para o futuro foi reivindicado';
  UPDATE apex_jobs SET run_after = now() WHERE id = job1;

  SELECT lock_token INTO tok FROM public.apex_jobs_claim('t-1', 10, 300) WHERE id = job1;
  ASSERT tok IS NOT NULL, 'a reivindicação não gerou token';
  SELECT * INTO rec FROM apex_jobs WHERE id = job1;
  ASSERT rec.status = 'PROCESSING' AND rec.locked_by = 't-1'
     AND rec.locked_at IS NOT NULL AND rec.lease_expires_at IS NOT NULL
     AND rec.attempt_count = 1,
    'a reivindicação não gravou posse completa';

  -- Já reivindicado: não sai de novo.
  ASSERT NOT EXISTS (SELECT 1 FROM public.apex_jobs_claim('t-2', 10, 300) WHERE id = job1),
    'um trabalho PROCESSING foi reivindicado de novo';

  -- Token errado NÃO conclui.
  ASSERT public.apex_jobs_complete(job1, gen_random_uuid()) = false,
    'um token inválido concluiu o trabalho';
  ASSERT (SELECT status FROM apex_jobs WHERE id = job1) = 'PROCESSING',
    'o trabalho mudou de estado com token inválido';

  -- ---- concessão vencida ----
  -- Concessão FRESCA não é ceifada.
  SELECT * INTO rec FROM public.apex_jobs_reap(100, 60);
  ASSERT rec.released = 0 AND rec.dead_lettered = 0,
    'o ceifador roubou uma concessão viva';

  -- Vencida: devolvida, com o token INVALIDADO.
  UPDATE apex_jobs SET lease_expires_at = now() - interval '1 minute' WHERE id = job1;
  SELECT * INTO rec FROM public.apex_jobs_reap(100, 0);
  ASSERT rec.released = 1, format('a ceifa não devolveu o trabalho: %s', rec.released);
  SELECT * INTO rec FROM apex_jobs WHERE id = job1;
  ASSERT rec.status = 'PENDING' AND rec.lock_token IS NULL AND rec.attempt_count = 1,
    'a ceifa não devolveu o trabalho corretamente ou mexeu na contagem de tentativas';

  -- O trabalhador antigo acorda e tenta concluir: RECUSADO.
  ASSERT public.apex_jobs_complete(job1, tok) = false,
    'o trabalhador da concessão expirada CONCLUIU o trabalho';

  -- Outro trabalhador reivindica e conclui com o token CORRENTE.
  UPDATE apex_jobs SET run_after = now() WHERE id = job1;
  SELECT lock_token INTO tok FROM public.apex_jobs_claim('t-3', 10, 300) WHERE id = job1;
  ASSERT public.apex_jobs_complete(job1, tok) = true, 'o token corrente não concluiu';
  SELECT * INTO rec FROM apex_jobs WHERE id = job1;
  ASSERT rec.status = 'COMPLETED' AND rec.completed_at IS NOT NULL AND rec.lock_token IS NULL,
    'a conclusão não deixou o trabalho coerente';

  -- ══════════════════════════════════════════════════════════════
  -- 6 · Retentativa e carta morta
  -- ══════════════════════════════════════════════════════════════
  job1 := public.apex_jobs_enqueue(org_a, 'contracts.obligations.materialize',
    'phase4-test:retry', jsonb_build_object('as_of','2026-03-10','horizon_days',30), 1, now(), 2);

  SELECT lock_token INTO tok FROM public.apex_jobs_claim('t-r', 10, 300) WHERE id = job1;
  ASSERT public.apex_jobs_fail(job1, tok, 'http_429', 'provedor pediu para esperar', true, 30, 3600)
         = 'PENDING', 'falha transitória não agendou retentativa';
  SELECT * INTO rec FROM apex_jobs WHERE id = job1;
  ASSERT rec.run_after > now(), 'a retentativa foi agendada para o passado';
  ASSERT rec.last_error_code = 'http_429', 'o código de erro seguro não foi gravado';

  -- Segunda tentativa esgota max_attempts = 2 → carta morta.
  UPDATE apex_jobs SET run_after = now() WHERE id = job1;
  SELECT lock_token INTO tok FROM public.apex_jobs_claim('t-r', 10, 300) WHERE id = job1;
  ASSERT public.apex_jobs_fail(job1, tok, 'http_429', 'de novo', true, 30, 3600) = 'DEAD_LETTER',
    'tentativas esgotadas não viraram carta morta';

  -- Falha DETERMINÍSTICA vai direto para carta morta, na primeira tentativa.
  job1 := public.apex_jobs_enqueue(org_a, 'contracts.obligations.materialize',
    'phase4-test:terminal', jsonb_build_object('as_of','2026-03-10','horizon_days',30), 1, now(), 5);
  SELECT lock_token INTO tok FROM public.apex_jobs_claim('t-t', 10, 300) WHERE id = job1;
  ASSERT public.apex_jobs_fail(job1, tok, 'invalid_payload', 'payload não casa com o schema', false)
         = 'DEAD_LETTER', 'falha determinística foi reagendada';
  ASSERT (SELECT attempt_count FROM apex_jobs WHERE id = job1) = 1,
    'a carta morta determinística gastou mais de uma tentativa';

  -- Reprocessamento manual devolve à fila SEM apagar a falha.
  ASSERT public.apex_jobs_replay(job1, 2) = true, 'o reprocessamento não devolveu o trabalho';
  SELECT * INTO rec FROM apex_jobs WHERE id = job1;
  ASSERT rec.status = 'PENDING' AND rec.last_error_code = 'invalid_payload',
    'o reprocessamento apagou a história do erro';

  -- Idempotência de trabalho.
  ASSERT public.apex_jobs_enqueue(org_a, 'contracts.obligations.materialize',
    'phase4-test:terminal', '{}'::jsonb) = job1,
    'a mesma chave de trabalho criou um segundo trabalho';

  -- Vínculo trabalho↔evento cruzado é recusado.
  BEGIN
    PERFORM public.apex_jobs_enqueue(org_b, 'contracts.obligations.materialize',
      'phase4-test:cross', '{}'::jsonb, 1, now(), 5, ev1);
    RAISE EXCEPTION 'trabalho da Org B apontou para evento da Org A';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ══════════════════════════════════════════════════════════════
  -- 7 · Ativação por evento externo
  -- ══════════════════════════════════════════════════════════════
  res := public.contract_obligations_apply_external_activation(ev1);
  ASSERT (res->>'activated')::int = 2,
    format('ativações esperadas 2, obtidas %s (%s)', res->>'activated', res::text);

  -- A obrigação única foi ativada na data do FATO (10/03), não na de hoje.
  SELECT * INTO rec FROM contract_obligation_instances
    WHERE definition_id = def_a AND occurrence_key = 'single';
  ASSERT rec.state = 'OPEN' AND rec.activation_state = 'activated'
     AND rec.activated_at = DATE '2026-03-10',
    format('ativação errada: estado %s, data %s', rec.state, rec.activated_at);
  -- O prazo derivou da ativação real: 10 dias corridos depois.
  ASSERT rec.due_date = DATE '2026-03-20' AND rec.due_confidence = 'known',
    format('prazo derivado errado: %s (%s)', rec.due_date, rec.due_confidence);

  -- A série mensal ativou a ocorrência que o PAYLOAD nomeou, e só ela.
  ASSERT (SELECT state FROM contract_obligation_instances
           WHERE definition_id = def_m AND occurrence_key = '2026-03') = 'OPEN',
    'a ocorrência nomeada pelo payload não foi ativada';
  SELECT count(*) INTO n FROM contract_obligation_instances
    WHERE definition_id = def_m AND state = 'OPEN';
  ASSERT n = 1, format('a ativação alcançou %s ocorrências da série; deveria alcançar 1', n);

  -- O fato de ativação foi emitido, com CAUSAÇÃO no evento de origem.
  ASSERT EXISTS (
    SELECT 1 FROM domain_events
     WHERE event_type = 'contracts.obligation.instance_activated'
       AND causation_event_id = ev1 AND organization_id = org_a
       AND occurred_at::date = DATE '2026-03-10'),
    'a ativação não emitiu fato causal com o tempo do negócio';
  ASSERT (SELECT count(DISTINCT correlation_id) FROM domain_events
           WHERE id = ev1 OR causation_event_id = ev1) = 1,
    'a cadeia causal não preservou a correlação';

  -- Reentrega do MESMO evento não duplica história nem fato.
  SELECT count(*) INTO n FROM contract_obligation_instance_history
    WHERE instance_id IN (SELECT id FROM contract_obligation_instances WHERE definition_id = def_a);
  res := public.contract_obligations_apply_external_activation(ev1);
  ASSERT (res->>'activated')::int = 0 AND (res->>'already_activated')::int = 2,
    format('a reentrega ativou de novo: %s', res::text);
  ASSERT (SELECT count(*) FROM contract_obligation_instance_history
           WHERE instance_id IN (SELECT id FROM contract_obligation_instances WHERE definition_id = def_a)) = n,
    'a reentrega duplicou o histórico';

  -- Ocorrência ambígua fica NÃO RESOLVIDA — não vira palpite.
  ev3 := public.emit_domain_event(
    org_a, 'projects.measurement.accepted', 1, 'project_measurement', gen_random_uuid(),
    'phase4-test:sem-chave', '{}'::jsonb, '2026-04-10T00:00:00Z'::timestamptz);
  res := public.contract_obligations_apply_external_activation(ev3);
  ASSERT (res->>'unresolved')::int >= 1,
    format('evento sem chave de ocorrência não ficou não-resolvido: %s', res::text);
  ASSERT res::text LIKE '%occurrence_unresolved%', 'a razão do não-resolvido não foi registrada';

  -- Evento de OUTRO inquilino não alcança o vínculo da Org A.
  ev3 := public.emit_domain_event(
    org_b, 'projects.measurement.accepted', 1, 'project_measurement', gen_random_uuid(),
    'phase4-test:orgb', jsonb_build_object('occurrence_key','2026-03'),
    '2026-03-10T12:00:00Z'::timestamptz);
  res := public.contract_obligations_apply_external_activation(ev3);
  ASSERT (res->>'activated')::int = 0 AND (res->>'unresolved')::int = 0,
    format('um evento da Org B alcançou obrigação da Org A: %s', res::text);

  -- Definição REMOVIDA não é ativada.
  UPDATE contract_obligation_definitions SET status = 'removed' WHERE id = def_a;
  ev3 := public.emit_domain_event(
    org_a, 'projects.measurement.accepted', 1, 'project_measurement', gen_random_uuid(),
    'phase4-test:removida', jsonb_build_object('occurrence_key','2026-05'),
    '2026-05-10T00:00:00Z'::timestamptz);
  res := public.contract_obligations_apply_external_activation(ev3);
  ASSERT res::text LIKE '%definition_removed%',
    format('definição removida não foi ignorada: %s', res::text);
  UPDATE contract_obligation_definitions SET status = 'active' WHERE id = def_a;

  -- ══════════════════════════════════════════════════════════════
  -- 8 · Materialização agendada
  -- ══════════════════════════════════════════════════════════════
  PERFORM public.contracts_enqueue_obligation_materialization(DATE '2026-03-10', 180);
  SELECT count(*) INTO n FROM apex_jobs
    WHERE job_type = 'contracts.obligations.materialize'
      AND idempotency_key = 'contracts-obligation-materialize:' || org_a::text || ':2026-03-10';
  ASSERT n = 1, format('o produtor criou %s trabalhos para o mesmo dia', n);

  -- Rodar de novo no mesmo dia não cria segundo trabalho.
  PERFORM public.contracts_enqueue_obligation_materialization(DATE '2026-03-10', 180);
  SELECT count(*) INTO n FROM apex_jobs
    WHERE job_type = 'contracts.obligations.materialize'
      AND idempotency_key = 'contracts-obligation-materialize:' || org_a::text || ':2026-03-10';
  ASSERT n = 1, 'o produtor duplicou o trabalho do dia';

  -- Horizonte é limitado.
  BEGIN
    PERFORM public.contracts_run_obligation_materialization(org_a, DATE '2026-03-10', 5000);
    RAISE EXCEPTION 'horizonte de 5000 dias foi ACEITO';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- A execução usa a função da Fase 3 e é idempotente.
  res := public.contracts_run_obligation_materialization(org_a, DATE '2026-03-10', 180);
  ASSERT (res->>'occurrences_created')::int > 0, 'a materialização não criou ocorrência nenhuma';
  res := public.contracts_run_obligation_materialization(org_a, DATE '2026-03-10', 180);
  ASSERT (res->>'occurrences_created')::int = 0,
    format('a segunda execução criou ocorrências: %s', res::text);

  -- Âncora desconhecida continua desconhecida; dia útil sem calendário também.
  ASSERT NOT EXISTS (
    SELECT 1 FROM contract_obligation_instances i
      JOIN contract_obligation_definitions d ON d.id = i.definition_id
     WHERE d.calendar_basis = 'business_days' AND i.due_confidence = 'known'
       AND d.due_kind IN ('days_after_activation','days_before_contract_end')),
    'dia útil sem calendário virou data conhecida';

  -- ══════════════════════════════════════════════════════════════
  -- 9 · Extração de cláusulas enfileirada
  -- ══════════════════════════════════════════════════════════════
  res := public.contract_clause_extraction_request(org_a, con_a, doc_a, NULL);
  ASSERT res->>'status' = 'QUEUED' AND (res->>'reused')::boolean = false,
    format('o primeiro pedido não foi enfileirado: %s', res::text);
  ASSERT EXISTS (SELECT 1 FROM apex_jobs
                  WHERE id = (res->>'job_id')::uuid
                    AND job_type = 'contracts.clause_extraction.execute'),
    'o pedido não criou trabalho durável';

  -- Pedido repetido REUSA — o provedor não é chamado duas vezes.
  txt := res->>'request_id';
  res := public.contract_clause_extraction_request(org_a, con_a, doc_a, NULL);
  ASSERT (res->>'reused')::boolean = true AND res->>'request_id' = txt,
    format('o pedido repetido criou trabalho novo: %s', res::text);
  SELECT count(*) INTO n FROM apex_jobs WHERE job_type = 'contracts.clause_extraction.execute';
  ASSERT n = 1, format('pedidos repetidos criaram %s trabalhos', n);

  -- Portão de evidência: documento que não é PDF não vira trabalho.
  INSERT INTO contract_documents (organization_id, contract_id, title, file_path, document_type)
    VALUES (org_a, con_a, '[PHASE4] Planilha', 'phase4/planilha.xlsx', 'contract') RETURNING id INTO doc_a;
  BEGIN
    PERFORM public.contract_clause_extraction_request(org_a, con_a, doc_a, NULL);
    RAISE EXCEPTION 'documento não-PDF foi enfileirado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Documento de OUTRO contrato não é alcançável.
  BEGIN
    PERFORM public.contract_clause_extraction_request(org_b, con_b, doc_a, NULL);
    RAISE EXCEPTION 'documento de outro inquilino foi enfileirado';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;

  RAISE NOTICE '[FASE 4] todas as provas funcionais passaram.';

  -- Limpeza do cenário descartável. As duas organizações levam tudo junto por
  -- cascata — é o mesmo caminho privilegiado de apagamento de inquilino que a
  -- 110 desenhou, e prová-lo aqui prova que ele alcança as tabelas novas.
  --
  -- `contract_amendment_revisions.organization_id` é uma FK ANTERIOR a esta
  -- fase, sem ON DELETE CASCADE. Ela bloqueia o apagamento do inquilino desde
  -- antes da Fase 4 e não é escopo desta migration corrigi-la — está anotada
  -- em deferred-items.md. Aqui ela é removida à mão para que o resto da
  -- cascata possa ser PROVADO.
  DELETE FROM contract_amendment_revisions WHERE organization_id IN (org_a, org_b);
  DELETE FROM organizations WHERE id IN (org_a, org_b);
  ASSERT (SELECT count(*) FROM domain_events WHERE organization_id IN (org_a, org_b)) = 0,
    'o apagamento privilegiado do inquilino não alcançou domain_events';
  ASSERT (SELECT count(*) FROM apex_jobs WHERE organization_id IN (org_a, org_b)) = 0,
    'o apagamento privilegiado do inquilino não alcançou apex_jobs';
END $$;

-- ══════════════════════════════════════════════════════════════
-- 10 · Postura estrutural
-- ══════════════════════════════════════════════════════════════
DO $$
DECLARE n integer; t text;
BEGIN
  -- Regressão da 118: nenhuma tabela nova nasce com TRUNCATE de navegador.
  SELECT count(*) INTO n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND grantee IN ('anon','authenticated')
     AND privilege_type = 'TRUNCATE'
     AND table_name IN ('domain_events','apex_jobs','apex_event_routes',
       'apex_dynamic_route_providers','contract_obligation_event_bindings',
       'contract_clause_extraction_requests');
  ASSERT n = 0, format('TRUNCATE concedido ao navegador em %s tabela(s) da Fase 4', n);

  -- Nenhuma escrita de navegador nas tabelas novas.
  SELECT count(*) INTO n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND grantee IN ('anon','authenticated')
     AND privilege_type IN ('INSERT','UPDATE','DELETE')
     AND table_name IN ('domain_events','apex_jobs','apex_event_routes',
       'apex_dynamic_route_providers','contract_obligation_event_bindings',
       'contract_clause_extraction_requests');
  ASSERT n = 0, format('escrita concedida ao navegador em %s tabela(s) da Fase 4', n);

  -- A infraestrutura não é sequer legível pelo navegador.
  SELECT count(*) INTO n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND grantee IN ('anon','authenticated')
     AND table_name IN ('domain_events','apex_jobs','apex_event_routes','apex_dynamic_route_providers');
  ASSERT n = 0, format('a fila/grafo ficou visível ao navegador em %s grant(s)', n);

  -- Nenhuma função nova da Fase 4 é executável pelo navegador.
  FOREACH t IN ARRAY ARRAY[
    'public.emit_domain_event(uuid,text,integer,text,uuid,text,jsonb,timestamptz,text,uuid,uuid,uuid)',
    'public.apex_jobs_enqueue(uuid,text,text,jsonb,integer,timestamptz,integer,uuid,uuid)',
    'public.apex_jobs_claim(text,integer,integer)',
    'public.apex_jobs_complete(uuid,uuid)',
    'public.apex_jobs_fail(uuid,uuid,text,text,boolean,integer,integer)',
    'public.apex_jobs_reap(integer,integer)',
    'public.apex_route_pending_events(integer)',
    'public.apex_jobs_health()',
    'public.apex_jobs_dead_letters(integer)',
    'public.apex_jobs_replay(uuid,integer)',
    'public.contract_obligations_apply_external_activation(uuid)',
    'public.contracts_enqueue_obligation_materialization(date,integer)',
    'public.contracts_run_obligation_materialization(uuid,date,integer)',
    'public.contract_clause_extraction_request(uuid,uuid,uuid,uuid)']
  LOOP
    ASSERT NOT has_function_privilege('authenticated', t, 'EXECUTE'),
      format('authenticated executa %s', t);
    ASSERT NOT has_function_privilege('anon', t, 'EXECUTE'), format('anon executa %s', t);
    ASSERT has_function_privilege('service_role', t, 'EXECUTE'),
      format('service_role NÃO executa %s — o trabalhador não roda', t);
  END LOOP;

  -- Toda função nova tem search_path fixo.
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('emit_domain_event','apex_jobs_enqueue','apex_jobs_claim',
       'apex_jobs_complete','apex_jobs_fail','apex_jobs_reap','apex_route_pending_events',
       'apex_jobs_health','apex_jobs_dead_letters','apex_jobs_replay',
       'contract_obligations_apply_external_activation','contracts_enqueue_obligation_materialization',
       'contracts_run_obligation_materialization','contract_clause_extraction_request',
       'contract_obligations_emit_transition_event','contract_obligations_emit_evidence_event',
       'contracts_emit_amendment_created_event','contracts_obligation_activation_routes')
     AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%');
  ASSERT n = 0, format('%s função(ões) da Fase 4 sem search_path fixo', n);

  -- Nenhuma política irrestrita nas tabelas novas.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('domain_events','apex_jobs','apex_event_routes',
       'apex_dynamic_route_providers','contract_obligation_event_bindings',
       'contract_clause_extraction_requests')
     AND (qual = 'true' OR with_check = 'true');
  ASSERT n = 0, 'há política irrestrita em tabela da Fase 4';

  RAISE NOTICE '[FASE 4] postura estrutural conferida.';
END $$;
