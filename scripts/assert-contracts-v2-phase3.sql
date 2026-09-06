-- ============================================================
-- Provas FUNCIONAIS do motor de obrigações (Fase 3).
--
-- Cada prova exercita a regra com dado descartável e falha se o banco NÃO
-- recusar o que deveria recusar. Um teste que passa porque o comando não fez
-- nada seria pior que nenhum teste.
-- ============================================================
DO $$
DECLARE
  org_a uuid; org_b uuid;
  ct_a uuid; ct_a2 uuid; ct_b uuid;
  doc_a uuid; doc_a2 uuid; cl_a uuid;
  party_a uuid; party_b uuid;
  d1 uuid; d2 uuid; d3 uuid; d_b uuid; d_rec uuid; d_unknown uuid; d_bizdays uuid;
  i1 uuid; i_b uuid;
  ex1 uuid;
  n integer; m integer;
  failed boolean;
BEGIN
  -- ---------- cenário ----------
  INSERT INTO organizations (name, slug) VALUES ('Obrig A', 'obrig-a-' || substr(gen_random_uuid()::text,1,8)) RETURNING id INTO org_a;
  INSERT INTO organizations (name, slug) VALUES ('Obrig B', 'obrig-b-' || substr(gen_random_uuid()::text,1,8)) RETURNING id INTO org_b;

  INSERT INTO contracts (organization_id, title, contract_number, counterparty_name, status, start_date, end_date)
    VALUES (org_a, 'Contrato A', 'A-1', 'Contraparte A', 'active', DATE '2026-01-01', DATE '2026-12-31') RETURNING id INTO ct_a;
  INSERT INTO contracts (organization_id, title, contract_number, counterparty_name, status, start_date, end_date)
    VALUES (org_a, 'Contrato A2', 'A-2', 'Contraparte A', 'active', DATE '2026-01-01', DATE '2026-12-31') RETURNING id INTO ct_a2;
  INSERT INTO contracts (organization_id, title, contract_number, counterparty_name, status)
    VALUES (org_b, 'Contrato B', 'B-1', 'Contraparte B', 'active') RETURNING id INTO ct_b;

  INSERT INTO contract_documents (organization_id, contract_id, title, file_path, document_type)
    VALUES (org_a, ct_a, 'Contrato assinado.pdf', 'org/a.pdf', 'contract') RETURNING id INTO doc_a;
  INSERT INTO contract_documents (organization_id, contract_id, title, file_path, document_type)
    VALUES (org_a, ct_a2, 'Contrato A2.pdf', 'org/a2.pdf', 'contract') RETURNING id INTO doc_a2;
  INSERT INTO contract_clauses (organization_id, contract_id, clause_type, title, content, source_document_id, source_page)
    VALUES (org_a, ct_a, 'obligation', 'Cláusula 5.1', 'Relatório mensal de segurança.', doc_a, 12) RETURNING id INTO cl_a;

  INSERT INTO parties (organization_id, kind, legal_name, document_type, document_number)
    VALUES (org_a, 'organization', 'Seguradora A', 'cnpj', '11222333000181') RETURNING id INTO party_a;
  INSERT INTO parties (organization_id, kind, legal_name, document_type, document_number)
    VALUES (org_b, 'organization', 'Seguradora B', 'cnpj', '11222333000262') RETURNING id INTO party_b;

  -- ═══════════ 1. PROVENIÊNCIA ═══════════
  -- Obrigação sem nenhuma origem é afirmação sem fonte.
  failed := false;
  BEGIN
    INSERT INTO contract_obligation_definitions (organization_id, contract_id, title)
    VALUES (org_a, ct_a, 'Sem proveniência');
  EXCEPTION WHEN check_violation THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: definição sem proveniência foi aceita.'; END IF;

  INSERT INTO contract_obligation_definitions
    (organization_id, contract_id, title, requirement_text, responsible_side, source_clause_id, source_page,
     effective_from, activation_kind, due_kind, due_offset_days, calendar_basis, recurrence_kind, blocks_billing)
  VALUES (org_a, ct_a, 'Relatório mensal de segurança', 'Entregar relatório até o dia 5.',
     'contracting_organization', cl_a, 12, DATE '2026-01-01', 'contract_start',
     'days_after_activation', 5, 'calendar_days', 'monthly', true)
  RETURNING id INTO d1;

  -- ═══════════ 2. INQUILINO ═══════════
  failed := false;
  BEGIN
    INSERT INTO contract_obligation_definitions (organization_id, contract_id, title, source_clause_id)
    VALUES (org_b, ct_b, 'Cláusula de outro inquilino', cl_a);
  EXCEPTION WHEN foreign_key_violation THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: definição referenciou cláusula de outro inquilino.'; END IF;

  failed := false;
  BEGIN
    INSERT INTO contract_obligation_parties (organization_id, definition_id, role, party_id)
    VALUES (org_a, d1, 'insurer', party_b);
  EXCEPTION WHEN foreign_key_violation THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: parte da obrigação aceitou Party de outro inquilino.'; END IF;

  -- ═══════════ 3. PARTES BILATERAIS E MULTILATERAIS ═══════════
  INSERT INTO contract_obligation_parties (organization_id, definition_id, role, party_id)
    VALUES (org_a, d1, 'insurer', party_a);
  INSERT INTO contract_obligation_parties (organization_id, definition_id, role, party_text)
    VALUES (org_a, d1, 'verifier', 'Órgão fiscalizador municipal');
  INSERT INTO contract_obligation_parties (organization_id, definition_id, role, party_text)
    VALUES (org_a, d1, 'beneficiary', 'Cliente contratante');
  SELECT count(*) INTO n FROM contract_obligation_parties WHERE definition_id = d1;
  IF n <> 3 THEN RAISE EXCEPTION 'FALHA: responsabilidade multilateral não foi registrada (% partes).', n; END IF;

  -- Identidade não provada preserva o TEXTO e deixa o vínculo ausente.
  IF EXISTS (SELECT 1 FROM contract_obligation_parties
              WHERE definition_id = d1 AND role = 'verifier' AND party_id IS NOT NULL) THEN
    RAISE EXCEPTION 'FALHA: parte sem Party provada ganhou vínculo canônico.';
  END IF;

  failed := false;
  BEGIN
    INSERT INTO contract_obligation_parties (organization_id, definition_id, role) VALUES (org_a, d1, 'obligor');
  EXCEPTION WHEN check_violation THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: parte sem Party e sem texto foi aceita.'; END IF;

  -- ═══════════ 4. LINHAGEM ═══════════
  INSERT INTO contract_obligation_definitions
    (organization_id, contract_id, title, source_clause_id, predecessor_id, change_effect,
     effective_from, recurrence_kind, activation_kind, due_kind)
  VALUES (org_a, ct_a, 'Relatório mensal de segurança (v2)', cl_a, d1, 'altered',
     DATE '2026-07-01', 'monthly', 'contract_start', 'unspecified')
  RETURNING id INTO d2;

  -- O antecessor NÃO foi reescrito.
  IF (SELECT title FROM contract_obligation_definitions WHERE id = d1) <> 'Relatório mensal de segurança' THEN
    RAISE EXCEPTION 'FALHA: aditivo reescreveu a definição anterior.';
  END IF;
  IF (SELECT effective_from FROM contract_obligation_definitions WHERE id = d1) <> DATE '2026-01-01' THEN
    RAISE EXCEPTION 'FALHA: vigência do antecessor foi alterada.';
  END IF;

  -- Reescrever a história é recusado.
  failed := false;
  BEGIN UPDATE contract_obligation_definitions SET title = 'reescrito' WHERE id = d1;
  EXCEPTION WHEN restrict_violation THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: definição histórica foi reescrita.'; END IF;

  failed := false;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN DELETE FROM contract_obligation_definitions WHERE id = d1;
    EXCEPTION WHEN OTHERS THEN failed := true; END;
    EXECUTE 'RESET ROLE';
  END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: a aplicação apagou definição histórica.'; END IF;

  -- Supersessão (só `status`) continua permitida.
  UPDATE contract_obligation_definitions SET status = 'superseded' WHERE id = d1;

  -- Sucessor ambíguo é recusado.
  failed := false;
  BEGIN
    INSERT INTO contract_obligation_definitions
      (organization_id, contract_id, title, source_clause_id, predecessor_id, change_effect)
    VALUES (org_a, ct_a, 'Segundo sucessor', cl_a, d1, 'altered');
  EXCEPTION WHEN unique_violation THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: dois sucessores para o mesmo antecessor foram aceitos.'; END IF;

  -- Sucessão entre CONTRATOS diferentes é recusada.
  failed := false;
  BEGIN
    INSERT INTO contract_obligation_definitions
      (organization_id, contract_id, title, source_document_id, predecessor_id, change_effect)
    VALUES (org_a, ct_a2, 'Sucessor de outro contrato', doc_a2, d2, 'altered');
  EXCEPTION WHEN check_violation THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: linhagem cruzou contratos.'; END IF;

  -- Sucessão sem efeito declarado é recusada.
  failed := false;
  BEGIN
    INSERT INTO contract_obligation_definitions
      (organization_id, contract_id, title, source_clause_id, predecessor_id)
    VALUES (org_a, ct_a, 'Sucessor sem efeito', cl_a, d2);
  EXCEPTION WHEN check_violation THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: sucessão sem change_effect foi aceita.'; END IF;

  -- Remoção preserva história.
  INSERT INTO contract_obligation_definitions
    (organization_id, contract_id, title, source_clause_id, predecessor_id, change_effect, effective_from, status)
  VALUES (org_a, ct_a, 'Relatório mensal de segurança (removido)', cl_a, d2, 'removed', DATE '2026-10-01', 'removed')
  RETURNING id INTO d3;
  IF NOT EXISTS (SELECT 1 FROM contract_obligation_definitions WHERE id = d1)
     OR NOT EXISTS (SELECT 1 FROM contract_obligation_definitions WHERE id = d2) THEN
    RAISE EXCEPTION 'FALHA: remoção apagou a história.';
  END IF;

  -- ═══════════ 5. MATERIALIZAÇÃO IDEMPOTENTE ═══════════
  INSERT INTO contract_obligation_definitions
    (organization_id, contract_id, title, source_clause_id, effective_from,
     activation_kind, due_kind, due_offset_days, calendar_basis, recurrence_kind, blocks_billing)
  VALUES (org_a, ct_a, 'Relatório recorrente', cl_a, DATE '2026-01-01',
     'contract_start', 'days_after_activation', 5, 'calendar_days', 'monthly', true)
  RETURNING id INTO d_rec;

  SELECT contract_obligations_materialize(d_rec, DATE '2026-06-30', org_a) INTO n;
  IF n <> 6 THEN RAISE EXCEPTION 'FALHA: materialização mensal criou % ocorrências (esperado 6).', n; END IF;

  -- Repetir NÃO duplica.
  SELECT contract_obligations_materialize(d_rec, DATE '2026-06-30', org_a) INTO m;
  IF m <> 0 THEN RAISE EXCEPTION 'FALHA: reexecutar a materialização criou % duplicata(s).', m; END IF;
  SELECT count(*) INTO n FROM contract_obligation_instances WHERE definition_id = d_rec;
  IF n <> 6 THEN RAISE EXCEPTION 'FALHA: total após reexecução é % (esperado 6).', n; END IF;

  -- Chave de ocorrência estável e legível.
  IF NOT EXISTS (SELECT 1 FROM contract_obligation_instances WHERE definition_id = d_rec AND occurrence_key = '2026-03') THEN
    RAISE EXCEPTION 'FALHA: chave de ocorrência mensal não é estável.';
  END IF;

  -- Estender o horizonte acrescenta só o que falta.
  SELECT contract_obligations_materialize(d_rec, DATE '2026-08-31', org_a) INTO m;
  IF m <> 2 THEN RAISE EXCEPTION 'FALHA: estender o horizonte criou % (esperado 2).', m; END IF;

  -- O horizonte NÃO ultrapassa o fim do contrato.
  SELECT contract_obligations_materialize(d_rec, DATE '2030-12-31', org_a) INTO m;
  SELECT count(*) INTO n FROM contract_obligation_instances WHERE definition_id = d_rec;
  IF n <> 12 THEN RAISE EXCEPTION 'FALHA: recorrência ultrapassou o fim do contrato (% ocorrências).', n; END IF;

  -- Inquilino errado é erro, não filtro silencioso.
  failed := false;
  BEGIN PERFORM contract_obligations_materialize(d_rec, DATE '2026-06-30', org_b);
  EXCEPTION WHEN check_violation THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: materialização aceitou organização errada.'; END IF;

  -- ═══════════ 6. ÂNCORA DESCONHECIDA NÃO INVENTA PRAZO ═══════════
  INSERT INTO contract_obligation_definitions
    (organization_id, contract_id, title, source_document_id, activation_kind, due_kind, recurrence_kind)
  VALUES (org_a, ct_a2, 'Obrigação sem vigência conhecida', doc_a2, 'unspecified', 'unspecified', 'one_time')
  RETURNING id INTO d_unknown;
  -- (contrato A2 não tem start_date; a definição não tem effective_from)
  UPDATE contracts SET start_date = NULL WHERE id = ct_a2;
  SELECT contract_obligations_materialize(d_unknown, DATE '2026-12-31', org_a) INTO n;
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA: ocorrência única sem âncora deveria existir (criadas %).', n; END IF;
  IF EXISTS (SELECT 1 FROM contract_obligation_instances
              WHERE definition_id = d_unknown AND (due_date IS NOT NULL OR due_confidence <> 'unknown')) THEN
    RAISE EXCEPTION 'FALHA: prazo foi inventado para âncora desconhecida.';
  END IF;

  -- ═══════════ 7. DIAS ÚTEIS SEM CALENDÁRIO ═══════════
  INSERT INTO contract_obligation_definitions
    (organization_id, contract_id, title, source_clause_id, effective_from,
     activation_kind, due_kind, due_offset_days, calendar_basis, recurrence_kind)
  VALUES (org_a, ct_a, 'Aceite em 5 dias úteis', cl_a, DATE '2026-01-01',
     'contract_start', 'days_after_activation', 5, 'business_days', 'one_time')
  RETURNING id INTO d_bizdays;
  PERFORM contract_obligations_materialize(d_bizdays, DATE '2026-12-31', org_a);
  IF EXISTS (SELECT 1 FROM contract_obligation_instances
              WHERE definition_id = d_bizdays AND due_date IS NOT NULL) THEN
    RAISE EXCEPTION 'FALHA: dias ÚTEIS foram contados como dias corridos.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM contract_obligation_instances
                  WHERE definition_id = d_bizdays AND due_confidence = 'unknown'
                    AND due_basis LIKE '%dias úteis%') THEN
    RAISE EXCEPTION 'FALHA: o motivo do prazo desconhecido não foi registrado.';
  END IF;

  -- ═══════════ 8. TRANSIÇÕES E HISTÓRICO ═══════════
  SELECT id INTO i1 FROM contract_obligation_instances WHERE definition_id = d_rec AND occurrence_key = '2026-03';

  -- Nascer já gera histórico.
  SELECT count(*) INTO n FROM contract_obligation_instance_history WHERE instance_id = i1;
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA: materialização não registrou histórico (% linhas).', n; END IF;

  -- A ativação é DETERMINADA PELA REGRA (início do contrato): a ocorrência já
  -- nasce OPEN, com a data de ativação gravada. Só ativação manual ou por
  -- evento externo nasce NOT_ACTIVATED.
  IF (SELECT state FROM contract_obligation_instances WHERE id = i1) <> 'OPEN' THEN
    RAISE EXCEPTION 'FALHA: ativação determinada pela regra não abriu a ocorrência.';
  END IF;
  IF (SELECT activated_at FROM contract_obligation_instances WHERE id = i1) IS NULL THEN
    RAISE EXCEPTION 'FALHA: data de ativação derivável não foi gravada.';
  END IF;

  -- Transição real acrescenta linha ao histórico.
  UPDATE contract_obligation_instances
     SET state = 'SATISFIED', satisfied_at = now(), satisfaction_basis = 'explicit_completion' WHERE id = i1;
  SELECT count(*) INTO n FROM contract_obligation_instance_history WHERE instance_id = i1;
  IF n <> 2 THEN RAISE EXCEPTION 'FALHA: transição não virou histórico (% linhas).', n; END IF;

  -- Cumprida é estado final: nada sai dele.
  failed := false;
  BEGIN UPDATE contract_obligation_instances SET state = 'OPEN' WHERE id = i1;
  EXCEPTION WHEN check_violation THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: transição inválida a partir de SATISFIED foi aceita.'; END IF;

  -- Cumprida sem base declarada é recusada (noutra ocorrência, ainda aberta).
  failed := false;
  BEGIN
    UPDATE contract_obligation_instances SET state = 'SATISFIED'
     WHERE definition_id = d_rec AND occurrence_key = '2026-04';
  EXCEPTION WHEN check_violation THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: obrigação foi dada por cumprida sem base nem autor.'; END IF;

  -- Histórico é somente-acréscimo. Reescrever é recusado a TODO MUNDO;
  -- apagar é recusado à APLICAÇÃO — o caminho privilegiado segue aberto, e é
  -- ele que mantém a exclusão de um inquilino inteiro possível.
  failed := false;
  BEGIN UPDATE contract_obligation_instance_history SET note = 'x' WHERE instance_id = i1;
  EXCEPTION WHEN check_violation OR restrict_violation THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: histórico de transição foi reescrito.'; END IF;

  failed := false;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      DELETE FROM contract_obligation_instance_history WHERE instance_id = i1;
    EXCEPTION WHEN OTHERS THEN failed := true; END;
    EXECUTE 'RESET ROLE';
  END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: a aplicação apagou histórico de transição.'; END IF;

  -- ═══════════ 9. DEPENDÊNCIAS ═══════════
  INSERT INTO contract_obligation_dependencies
    (organization_id, contract_id, dependent_definition_id, depends_on_definition_id, mapping_mode)
  VALUES (org_a, ct_a, d_bizdays, d_rec, 'same_occurrence_key');

  failed := false;
  BEGIN
    INSERT INTO contract_obligation_dependencies
      (organization_id, contract_id, dependent_definition_id, depends_on_definition_id)
    VALUES (org_a, ct_a, d_rec, d_rec);
  EXCEPTION WHEN check_violation THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: autodependência foi aceita.'; END IF;

  failed := false;
  BEGIN
    INSERT INTO contract_obligation_dependencies
      (organization_id, contract_id, dependent_definition_id, depends_on_definition_id)
    VALUES (org_a, ct_a, d_rec, d_bizdays);
  EXCEPTION WHEN check_violation THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: ciclo de dependência foi aceito.'; END IF;

  -- ---------- limpeza do primeiro cenário ----------
  DELETE FROM organizations WHERE id IN (org_a, org_b);
  RAISE NOTICE 'Fase 3 (1/2): proveniência, inquilino, partes, linhagem, recorrência, prazo e transições — OK.';
END $$;

-- Segundo bloco: cross-tenant de dependência e o restante, com cenário próprio.
DO $$
DECLARE
  org_a uuid; org_b uuid; ct_a uuid; ct_b uuid; doc_a uuid; doc_b uuid;
  d_a uuid; d_a2 uuid; d_b uuid; i_a uuid; req uuid; ex1 uuid;
  failed boolean; n integer;
BEGIN
  INSERT INTO organizations (name, slug) VALUES ('Obrig C', 'obrig-c-' || substr(gen_random_uuid()::text,1,8)) RETURNING id INTO org_a;
  INSERT INTO organizations (name, slug) VALUES ('Obrig D', 'obrig-d-' || substr(gen_random_uuid()::text,1,8)) RETURNING id INTO org_b;
  INSERT INTO contracts (organization_id, title, contract_number, counterparty_name, status, start_date, end_date)
    VALUES (org_a, 'C', 'C-1', 'X', 'active', DATE '2026-01-01', DATE '2026-12-31') RETURNING id INTO ct_a;
  INSERT INTO contracts (organization_id, title, contract_number, counterparty_name, status, start_date, end_date)
    VALUES (org_b, 'D', 'D-1', 'Y', 'active', DATE '2026-01-01', DATE '2026-12-31') RETURNING id INTO ct_b;
  INSERT INTO contract_documents (organization_id, contract_id, title, file_path, document_type)
    VALUES (org_a, ct_a, 'c.pdf', 'org/c.pdf', 'contract') RETURNING id INTO doc_a;
  INSERT INTO contract_documents (organization_id, contract_id, title, file_path, document_type)
    VALUES (org_b, ct_b, 'd.pdf', 'org/d.pdf', 'contract') RETURNING id INTO doc_b;

  INSERT INTO contract_obligation_definitions
    (organization_id, contract_id, title, source_document_id, effective_from, activation_kind, due_kind,
     due_offset_days, calendar_basis, recurrence_kind, blocks_billing)
  VALUES (org_a, ct_a, 'Medição', doc_a, DATE '2026-01-01', 'contract_start', 'days_after_activation',
     10, 'calendar_days', 'monthly', true) RETURNING id INTO d_a;
  INSERT INTO contract_obligation_definitions
    (organization_id, contract_id, title, source_document_id, effective_from, activation_kind, due_kind, recurrence_kind)
  VALUES (org_a, ct_a, 'Aceite', doc_a, DATE '2026-01-01', 'contract_start', 'unspecified', 'monthly')
    RETURNING id INTO d_a2;
  INSERT INTO contract_obligation_definitions
    (organization_id, contract_id, title, source_document_id, recurrence_kind)
  VALUES (org_b, ct_b, 'Obrigação de outro inquilino', doc_b, 'one_time') RETURNING id INTO d_b;

  -- ---------- dependência entre inquilinos ----------
  failed := false;
  BEGIN
    INSERT INTO contract_obligation_dependencies
      (organization_id, contract_id, dependent_definition_id, depends_on_definition_id)
    VALUES (org_a, ct_a, d_a2, d_b);
  EXCEPTION WHEN foreign_key_violation THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: dependência entre inquilinos foi aceita.'; END IF;

  -- ---------- evidência ----------
  PERFORM contract_obligations_materialize(d_a, DATE '2026-03-31', org_a);
  SELECT id INTO i_a FROM contract_obligation_instances WHERE definition_id = d_a AND occurrence_key = '2026-01';

  INSERT INTO contract_obligation_evidence_requirements
    (organization_id, contract_id, definition_id, requirement_text, evidence_type, mandatory, requires_formal_acceptance)
  VALUES (org_a, ct_a, d_a, 'Boletim de medição assinado', 'document', true, true) RETURNING id INTO req;

  -- Evidência anexada NÃO é evidência aceita.
  INSERT INTO contract_obligation_evidence
    (organization_id, contract_id, instance_id, requirement_id, document_id)
  VALUES (org_a, ct_a, i_a, req, doc_a);
  IF (SELECT acceptance_state FROM contract_obligation_evidence WHERE instance_id = i_a) <> 'pending' THEN
    RAISE EXCEPTION 'FALHA: evidência que exige aceite formal nasceu aceita.';
  END IF;
  IF (SELECT state FROM contract_obligation_instances WHERE id = i_a) = 'SATISFIED' THEN
    RAISE EXCEPTION 'FALHA: presença de evidência marcou a obrigação como cumprida.';
  END IF;

  -- Documento de OUTRO inquilino como evidência.
  failed := false;
  BEGIN
    INSERT INTO contract_obligation_evidence (organization_id, contract_id, instance_id, document_id)
    VALUES (org_a, ct_a, i_a, doc_b);
  EXCEPTION WHEN foreign_key_violation THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: evidência aceitou documento de outro inquilino.'; END IF;

  -- Evidência sem documento e sem referência.
  failed := false;
  BEGIN
    INSERT INTO contract_obligation_evidence (organization_id, contract_id, instance_id) VALUES (org_a, ct_a, i_a);
  EXCEPTION WHEN check_violation THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: evidência vazia foi aceita.'; END IF;

  -- ---------- dispensa ----------
  -- Sem autoridade provada, a dispensa NÃO produz efeito.
  INSERT INTO contract_obligation_exceptions
    (organization_id, contract_id, instance_id, kind, reason, scope, effective_from, effective_to)
  VALUES (org_a, ct_a, i_a, 'waiver', 'Dispensa sem autoridade registrada', 'instance',
     DATE '2026-01-01', DATE '2026-12-31') RETURNING id INTO ex1;
  IF (SELECT contract_obligation_exception_is_effective(e, DATE '2026-06-01')
        FROM contract_obligation_exceptions e WHERE e.id = ex1) THEN
    RAISE EXCEPTION 'FALHA: dispensa sem autoridade produziu efeito.';
  END IF;

  -- Com autoridade e dentro da vigência: efetiva.
  UPDATE contract_obligation_exceptions SET authority_reference = 'Ata da diretoria 12/2026' WHERE id = ex1;
  IF NOT (SELECT contract_obligation_exception_is_effective(e, DATE '2026-06-01')
            FROM contract_obligation_exceptions e WHERE e.id = ex1) THEN
    RAISE EXCEPTION 'FALHA: dispensa legítima não produziu efeito.';
  END IF;

  -- VENCIDA: volta a não suprimir nada.
  IF (SELECT contract_obligation_exception_is_effective(e, DATE '2027-06-01')
        FROM contract_obligation_exceptions e WHERE e.id = ex1) THEN
    RAISE EXCEPTION 'FALHA: dispensa vencida continuou suprimindo a obrigação.';
  END IF;

  -- Aprovação pendente não dispensa.
  UPDATE contract_obligation_exceptions SET approval_state = 'pending' WHERE id = ex1;
  IF (SELECT contract_obligation_exception_is_effective(e, DATE '2026-06-01')
        FROM contract_obligation_exceptions e WHERE e.id = ex1) THEN
    RAISE EXCEPTION 'FALHA: dispensa com aprovação pendente produziu efeito.';
  END IF;

  -- A obrigação original continua inteira.
  IF NOT EXISTS (SELECT 1 FROM contract_obligation_instances WHERE id = i_a) THEN
    RAISE EXCEPTION 'FALHA: dispensa apagou a obrigação original.';
  END IF;
  failed := false;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN DELETE FROM contract_obligation_exceptions WHERE id = ex1;
    EXCEPTION WHEN OTHERS THEN failed := true; END;
    EXECUTE 'RESET ROLE';
  END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: a aplicação apagou a dispensa.'; END IF;

  -- ---------- escalonamento ----------
  INSERT INTO contract_obligation_escalation_rules
    (organization_id, definition_id, trigger_kind, offset_days, severity, target_side)
  VALUES (org_a, d_a, 'days_before_due', 5, 'medium', 'contracting_organization');
  INSERT INTO contract_obligation_escalation_rules
    (organization_id, definition_id, trigger_kind, severity) VALUES (org_a, d_a, 'on_due_date', 'high');
  failed := false;
  BEGIN
    INSERT INTO contract_obligation_escalation_rules
      (organization_id, definition_id, trigger_kind, offset_days) VALUES (org_a, d_a, 'on_due_date', 3);
  EXCEPTION WHEN check_violation THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: regra "no vencimento" aceitou deslocamento.'; END IF;

  -- ---------- impacto financeiro ----------
  INSERT INTO contract_obligation_financial_impacts
    (organization_id, contract_id, definition_id, record_kind, impact_type, percentage, basis_text)
  VALUES (org_a, ct_a, d_a, 'rule', 'penalty', 2.0, '2% do valor da parcela');
  failed := false;
  BEGIN
    INSERT INTO contract_obligation_financial_impacts
      (organization_id, contract_id, definition_id, record_kind, impact_type, fixed_amount)
    VALUES (org_a, ct_a, d_a, 'rule', 'penalty', 1000);
  EXCEPTION WHEN check_violation THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: valor sem moeda foi aceito.'; END IF;

  -- ---------- apagamento privilegiado ----------
  DELETE FROM organizations WHERE id = org_a;
  SELECT (SELECT count(*) FROM contract_obligation_definitions WHERE organization_id = org_a)
       + (SELECT count(*) FROM contract_obligation_instances WHERE organization_id = org_a)
       + (SELECT count(*) FROM contract_obligation_instance_history WHERE organization_id = org_a)
       + (SELECT count(*) FROM contract_obligation_evidence WHERE organization_id = org_a)
       + (SELECT count(*) FROM contract_obligation_exceptions WHERE organization_id = org_a)
       INTO n;
  IF n <> 0 THEN RAISE EXCEPTION 'FALHA: apagamento privilegiado não alcançou a subárvore de obrigações (% linhas).', n; END IF;
  DELETE FROM organizations WHERE id = org_b;

  RAISE NOTICE 'Fase 3: todas as provas funcionais do motor de obrigações passaram.';
END $$;
