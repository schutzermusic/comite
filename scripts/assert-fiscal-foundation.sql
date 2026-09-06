-- ============================================================
-- Provas FUNCIONAIS da fundação Fiscal.
--
-- Estrutura presente não é o mesmo que estrutura que funciona. Aqui cada regra
-- é exercitada com dado descartável, dentro da transação do runner (que sempre
-- termina em ROLLBACK no ensaio), e o que se prova é o comportamento: a
-- travessia de inquilino falha, a produção é recusada, a NFS-e emitida não pode
-- ser reescrita, a numeração não repete.
--
-- Toda prova segue a mesma forma: tenta o que deve ser recusado e falha se
-- NÃO houver exceção. Um teste que passa porque o comando não fez nada seria
-- pior que nenhum teste.
-- ============================================================
DO $$
DECLARE
  org_a uuid; org_b uuid;
  estab_a uuid; estab_b uuid;
  party_a uuid; party_b uuid;
  svc_a uuid;
  doc_a uuid;
  n1 bigint; n2 bigint;
  failed boolean;
BEGIN
  -- ---------- cenário: duas organizações ----------
  INSERT INTO organizations (id, name, slug) VALUES
    (gen_random_uuid(), 'Fiscal Prova A', 'fiscal-prova-a-' || substr(gen_random_uuid()::text, 1, 8))
    RETURNING id INTO org_a;
  INSERT INTO organizations (id, name, slug) VALUES
    (gen_random_uuid(), 'Fiscal Prova B', 'fiscal-prova-b-' || substr(gen_random_uuid()::text, 1, 8))
    RETURNING id INTO org_b;

  INSERT INTO fiscal_establishments (organization_id, legal_name, cnpj, municipal_registration, tax_regime,
    municipality_ibge, municipality_name, uf, postal_code, street, street_number, district)
  VALUES (org_a, 'Emitente A', '11222333000181', 'IM-A', 'lucro_presumido',
    '3550308', 'São Paulo', 'SP', '01001000', 'Rua A', '100', 'Centro') RETURNING id INTO estab_a;
  INSERT INTO fiscal_establishments (organization_id, legal_name, cnpj, municipal_registration, tax_regime,
    municipality_ibge, municipality_name, uf, postal_code, street, street_number, district)
  VALUES (org_b, 'Emitente B', '11222333000262', 'IM-B', 'lucro_presumido',
    '3304557', 'Rio de Janeiro', 'RJ', '20010000', 'Rua B', '200', 'Centro') RETURNING id INTO estab_b;

  INSERT INTO parties (organization_id, kind, legal_name, document_type, document_number)
  VALUES (org_a, 'organization', 'Tomador A', 'cnpj', '44555666000177') RETURNING id INTO party_a;
  INSERT INTO parties (organization_id, kind, legal_name, document_type, document_number)
  VALUES (org_b, 'organization', 'Tomador B', 'cnpj', '44555666000258') RETURNING id INTO party_b;

  INSERT INTO fiscal_service_catalog (organization_id, establishment_id, code, description, lc116_code,
    municipal_service_code, iss_rate, effective_from, approved_by_accountant)
  VALUES (org_a, estab_a, 'S1', 'Serviço de prova', '7.02', '070200', 2.0, current_date, true)
  RETURNING id INTO svc_a;

  -- ---------- 1) tomador de OUTRO inquilino é recusado ----------
  failed := false;
  BEGIN
    INSERT INTO fiscal_documents (organization_id, establishment_id, party_id, series, competence_date,
      service_amount_cents, net_amount_cents, service_location_ibge, description,
      issuer_snapshot, recipient_snapshot, service_snapshot, tax_snapshot, idempotency_key)
    VALUES (org_a, estab_a, party_b, '1', current_date, 100000, 100000, '3550308', 'cross-tenant',
      '{}', '{}', '{}', '{}', 'x-tenant-party');
  EXCEPTION WHEN foreign_key_violation THEN failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: NFS-e aceitou tomador de outro inquilino.'; END IF;

  -- ---------- 2) estabelecimento de OUTRO inquilino é recusado ----------
  failed := false;
  BEGIN
    INSERT INTO fiscal_documents (organization_id, establishment_id, party_id, series, competence_date,
      service_amount_cents, net_amount_cents, service_location_ibge, description,
      issuer_snapshot, recipient_snapshot, service_snapshot, tax_snapshot, idempotency_key)
    VALUES (org_a, estab_b, party_a, '1', current_date, 100000, 100000, '3550308', 'cross-tenant',
      '{}', '{}', '{}', '{}', 'x-tenant-estab');
  EXCEPTION WHEN foreign_key_violation THEN failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: NFS-e aceitou estabelecimento de outro inquilino.'; END IF;

  -- ---------- 3) perfil fiscal de Party de outro inquilino é recusado ----------
  failed := false;
  BEGIN
    INSERT INTO fiscal_party_profiles (organization_id, party_id, municipal_registration)
    VALUES (org_a, party_b, 'IM-X');
  EXCEPTION WHEN foreign_key_violation THEN failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: perfil fiscal aceitou Party de outro inquilino.'; END IF;

  -- ---------- 4) documento legítimo ----------
  INSERT INTO fiscal_documents (organization_id, establishment_id, party_id, series, competence_date,
    service_amount_cents, net_amount_cents, service_location_ibge, description,
    issuer_snapshot, recipient_snapshot, service_snapshot, tax_snapshot, idempotency_key)
  VALUES (org_a, estab_a, party_a, '1', current_date, 100000, 98000, '3550308', 'Serviço de prova',
    '{}', '{}', '{}', '{}', 'ok-1') RETURNING id INTO doc_a;

  -- ---------- 5) idempotência: a mesma chave não cria segunda NFS-e ----------
  failed := false;
  BEGIN
    INSERT INTO fiscal_documents (organization_id, establishment_id, party_id, series, competence_date,
      service_amount_cents, net_amount_cents, service_location_ibge, description,
      issuer_snapshot, recipient_snapshot, service_snapshot, tax_snapshot, idempotency_key)
    VALUES (org_a, estab_a, party_a, '1', current_date, 100000, 98000, '3550308', 'duplicata',
      '{}', '{}', '{}', '{}', 'ok-1');
  EXCEPTION WHEN unique_violation THEN failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: chave de idempotência aceitou duplicata.'; END IF;

  -- ---------- 6) numeração de DPS não repete ----------
  SELECT fiscal_reserve_dps_number(org_a, estab_a) INTO n1;
  SELECT fiscal_reserve_dps_number(org_a, estab_a) INTO n2;
  IF n2 <> n1 + 1 THEN RAISE EXCEPTION 'FALHA: numeração de DPS repetiu ou pulou (% -> %).', n1, n2; END IF;

  -- ---------- 7) produção é recusada sem portão ----------
  failed := false;
  BEGIN
    UPDATE fiscal_establishments SET production_enabled = true WHERE id = estab_a;
  EXCEPTION WHEN check_violation THEN failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: produção foi habilitada sem portão registrado.'; END IF;

  -- ---------- 8) produção é recusada com portão INCOMPLETO ----------
  INSERT INTO fiscal_production_gates (organization_id, establishment_id, certificate_installed)
  VALUES (org_a, estab_a, true);
  failed := false;
  BEGIN
    UPDATE fiscal_establishments SET production_enabled = true WHERE id = estab_a;
  EXCEPTION WHEN check_violation THEN failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: produção foi habilitada com portão incompleto.'; END IF;

  -- ---------- 9) sandbox em produção é recusado ----------
  failed := false;
  BEGIN
    INSERT INTO fiscal_provider_configs (organization_id, establishment_id, provider_key, environment, enabled)
    VALUES (org_a, estab_a, 'sandbox', 'production', true);
  EXCEPTION WHEN check_violation THEN failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: adaptador sandbox foi habilitado em produção.'; END IF;

  -- ---------- 10) provedor real em produção sem estabelecimento habilitado ----------
  failed := false;
  BEGIN
    INSERT INTO fiscal_provider_configs (organization_id, establishment_id, provider_key, environment, enabled)
    VALUES (org_a, estab_a, 'nfse_nacional', 'production', true);
  EXCEPTION WHEN check_violation THEN failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: integração de produção habilitada sem produção no estabelecimento.'; END IF;

  -- ---------- 11) homologação é permitida ----------
  INSERT INTO fiscal_provider_configs (organization_id, establishment_id, provider_key, environment, enabled)
  VALUES (org_a, estab_a, 'nfse_nacional', 'homologation', true);

  -- ---------- 12) NFS-e autorizada é imutável no que é declaração ----------
  UPDATE fiscal_documents SET status = 'authorized', access_key = '1234567890',
    authorized_at = now() WHERE id = doc_a;
  failed := false;
  BEGIN
    UPDATE fiscal_documents SET service_amount_cents = 1 WHERE id = doc_a;
  EXCEPTION WHEN restrict_violation THEN failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: valor de NFS-e autorizada foi reescrito.'; END IF;

  failed := false;
  BEGIN
    UPDATE fiscal_documents SET description = 'outra coisa' WHERE id = doc_a;
  EXCEPTION WHEN restrict_violation THEN failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: descrição de NFS-e autorizada foi reescrita.'; END IF;

  -- ...mas o que a operação posterior legitimamente muda continua passando.
  UPDATE fiscal_documents SET status = 'cancellation_requested', cancellation_reason = 'prova' WHERE id = doc_a;
  UPDATE fiscal_documents SET xml_storage_path = 'x/y.xml', danfse_storage_path = 'x/y.pdf' WHERE id = doc_a;

  -- ---------- 13) evento é somente-acréscimo ----------
  INSERT INTO fiscal_events (organization_id, document_id, event_type, message)
  VALUES (org_a, doc_a, 'prova', 'evento de prova');
  failed := false;
  BEGIN
    UPDATE fiscal_events SET message = 'reescrito' WHERE document_id = doc_a;
  EXCEPTION WHEN restrict_violation THEN failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: evento fiscal foi reescrito.'; END IF;

  -- ---------- 14) tentativa de transmissão não duplica número ----------
  INSERT INTO fiscal_transmission_attempts (organization_id, document_id, operation, attempt_number, request_id, status)
  VALUES (org_a, doc_a, 'issue', 1, 'req-1', 'success');
  failed := false;
  BEGIN
    INSERT INTO fiscal_transmission_attempts (organization_id, document_id, operation, attempt_number, request_id, status)
    VALUES (org_a, doc_a, 'issue', 1, 'req-2', 'success');
  EXCEPTION WHEN unique_violation THEN failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: tentativa de transmissão duplicou o número.'; END IF;

  -- ---------- 15) apagar a organização alcança toda a subárvore fiscal ----------
  DELETE FROM organizations WHERE id = org_a;
  IF EXISTS (SELECT 1 FROM fiscal_documents WHERE organization_id = org_a)
     OR EXISTS (SELECT 1 FROM fiscal_events WHERE organization_id = org_a)
     OR EXISTS (SELECT 1 FROM fiscal_establishments WHERE organization_id = org_a) THEN
    RAISE EXCEPTION 'FALHA: apagamento privilegiado não alcançou a subárvore fiscal.';
  END IF;
  DELETE FROM organizations WHERE id = org_b;

  RAISE NOTICE 'Todas as 15 provas funcionais da fundação Fiscal passaram.';
END $$;
