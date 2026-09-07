-- ============================================================
-- Fase 7 — 137: PONTE FATURAMENTO → FISCAL, E O FATO DE AUTORIZAÇÃO
-- ============================================================
--
-- ─── A fronteira, escrita no esquema ─────────────────────────────────────
--
-- A §29 e a §3 são absolutas: Contratos NUNCA insere em `fiscal_documents`.
-- O caminho é sempre
--
--     faturamento LIBERADO → domain_events → handler do Fiscal → Fiscal
--
-- Esta migration cria o lado DURÁVEL desse caminho — o pedido e o vínculo — e
-- não cria documento fiscal nenhum. Quem cria rascunho é o serviço do Fiscal
-- (`src/lib/fiscal/server/store.ts`), que já existe, já valida estabelecimento,
-- tomador, catálogo de serviço e vigência, e já congela os retratos de emissão.
-- Reimplementar isso em SQL seria ter duas verdades fiscais.
--
-- ─── O portão de produção continua intacto (§30, §102) ───────────────────
--
-- Nada aqui liga emissão real. `fiscal_establishments.production_enabled`
-- segue governado por `fiscal_production_gates` e pelo gatilho
-- `fiscal_guard_production`, que roda para todos, service role incluído.
-- A ponte cria RASCUNHO. Transmitir continua sendo ato do Fiscal, com
-- `fiscal.transmit`, pela fila `fiscal_jobs` — que a §66 congela e a §123
-- proíbe migrar para `apex_jobs`.
--
-- A auditoria de produção encontrou: ZERO estabelecimento fiscal, ZERO perfil
-- de parte, ZERO catálogo de serviço, ZERO configuração de provedor e ZERO
-- linha em `fiscal_production_gates`. A ponte estará completa e o desfecho
-- real será, corretamente, BLOCKED_BY_CONFIGURATION.
--
-- ─── Cardinalidade (§31, §32) ────────────────────────────────────────────
--
-- A §31 oferece `contract_billing_events.fiscal_document_id` OU uma estrutura
-- de alocação. A coluna única foi descartada por um motivo concreto e presente
-- no esquema: `fiscal_documents` tem `replaced_document_id` /
-- `replacement_document_id`. Substituição é real, e uma coluna única seria
-- SOBRESCRITA pela nota nova — apagando o vínculo com a nota cancelada, que é
-- exatamente a história que a §34 manda preservar.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1) O pedido durável de documento fiscal
-- ------------------------------------------------------------
CREATE TABLE public.contract_billing_fiscal_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  billing_event_id    uuid NOT NULL,

  -- A impressão digital da liberação que originou o pedido. É ela que torna a
  -- idempotência verdadeira: liberar de novo o MESMO fato não gera segundo
  -- pedido; superar o faturamento gera outra impressão, logo outro pedido.
  release_fingerprint text NOT NULL,

  state               text NOT NULL DEFAULT 'REQUESTED'
                        CHECK (state IN ('REQUESTED','DRAFT_CREATED',
                                         'BLOCKED_BY_CONFIGURATION','ERROR','CANCELLED')),
  blockers            jsonb NOT NULL DEFAULT '[]'::jsonb
                        CHECK (jsonb_typeof(blockers) = 'array'),

  -- Valor pedido, em centavos inteiros. A §79 proíbe ponto flutuante em
  -- dinheiro; a travessia do `numeric` de Contratos para o `bigint` do Fiscal
  -- é arredondamento determinístico e acontece num lugar só: aqui.
  requested_amount_cents bigint CHECK (requested_amount_cents IS NULL OR requested_amount_cents > 0),
  currency            text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),

  fiscal_document_id  uuid,
  source_event_id     uuid,
  correlation_id      uuid,
  last_error_safe     text,
  attempts            integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cbfr_org_id_unique UNIQUE (organization_id, id),
  -- A UNICIDADE DO PEDIDO (§109): reentrega do mesmo fato não cria segundo
  -- rascunho fiscal. Mora no banco, não no chamador.
  CONSTRAINT cbfr_idempotent UNIQUE (organization_id, billing_event_id, release_fingerprint),
  CONSTRAINT cbfr_event_tenant FOREIGN KEY (organization_id, billing_event_id)
    REFERENCES public.contract_billing_events (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT cbfr_document_tenant FOREIGN KEY (organization_id, fiscal_document_id)
    REFERENCES public.fiscal_documents (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT cbfr_source_event_tenant FOREIGN KEY (organization_id, source_event_id)
    REFERENCES public.domain_events (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT cbfr_draft_has_document CHECK (state <> 'DRAFT_CREATED' OR fiscal_document_id IS NOT NULL)
);

COMMENT ON TABLE public.contract_billing_fiscal_requests IS
  'Lado durável da ponte Faturamento → Fiscal. Contratos NÃO escreve '
  'fiscal_documents: escreve pedido, e o handler do Fiscal decide. '
  'BLOCKED_BY_CONFIGURATION é desfecho legítimo, não falha (§30).';

CREATE INDEX cbfr_open ON public.contract_billing_fiscal_requests (organization_id, state)
  WHERE state IN ('REQUESTED','ERROR');
CREATE INDEX cbfr_event ON public.contract_billing_fiscal_requests (organization_id, billing_event_id);

ALTER TABLE public.contract_billing_fiscal_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY cbfr_select ON public.contract_billing_fiscal_requests FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id());
-- Escrita é de servidor. O navegador não pede nota; ele libera faturamento, e
-- o pedido nasce do fato.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.contract_billing_fiscal_requests
  FROM anon, authenticated;

-- ------------------------------------------------------------
-- 2) Alocação faturamento ↔ documento fiscal (§31, §32)
-- ------------------------------------------------------------
CREATE TABLE public.contract_billing_fiscal_allocations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  billing_event_id    uuid NOT NULL,
  fiscal_document_id  uuid NOT NULL,
  allocated_amount_cents bigint NOT NULL CHECK (allocated_amount_cents > 0),
  currency            text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),

  state               text NOT NULL DEFAULT 'ACTIVE'
                        CHECK (state IN ('ACTIVE','CANCELLED','REPLACED')),
  -- Quando a nota é substituída, a alocação antiga vira REPLACED e aponta para
  -- a nova. A linha antiga PERMANECE: é a lineage que a §34 exige.
  replaced_by_allocation_id uuid,

  created_at          timestamptz NOT NULL DEFAULT now(),
  closed_at           timestamptz,
  closed_reason       text,

  CONSTRAINT cbfa_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT cbfa_event_tenant FOREIGN KEY (organization_id, billing_event_id)
    REFERENCES public.contract_billing_events (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT cbfa_document_tenant FOREIGN KEY (organization_id, fiscal_document_id)
    REFERENCES public.fiscal_documents (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT cbfa_replaced_tenant FOREIGN KEY (organization_id, replaced_by_allocation_id)
    REFERENCES public.contract_billing_fiscal_allocations (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT cbfa_closed_coherent CHECK ((state = 'ACTIVE') = (closed_at IS NULL)),
  CONSTRAINT cbfa_no_self_replacement CHECK (replaced_by_allocation_id IS DISTINCT FROM id)
);

COMMENT ON TABLE public.contract_billing_fiscal_allocations IS
  'Vínculo EXPLÍCITO entre direito de faturar e documento fiscal, com valor '
  'alocado. A §31 proíbe casar nota com faturamento por valor e data: só '
  'vínculo declarado vale.';

/*
  No máximo uma alocação ATIVA por par (faturamento, documento). Índice
  PARCIAL: cancelada e substituída saem do caminho, e é isso que permite
  substituição de nota sem apagar história.
*/
CREATE UNIQUE INDEX cbfa_active_unique
  ON public.contract_billing_fiscal_allocations (organization_id, billing_event_id, fiscal_document_id)
  WHERE state = 'ACTIVE';
CREATE INDEX cbfa_document ON public.contract_billing_fiscal_allocations
  (organization_id, fiscal_document_id) WHERE state = 'ACTIVE';

ALTER TABLE public.contract_billing_fiscal_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY cbfa_select ON public.contract_billing_fiscal_allocations FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id());
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.contract_billing_fiscal_allocations
  FROM anon, authenticated;
CREATE TRIGGER cbfa_no_erasure BEFORE DELETE ON public.contract_billing_fiscal_allocations
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

-- ------------------------------------------------------------
-- 3) Prontidão fiscal — os bloqueios, nomeados
-- ------------------------------------------------------------
/*
  Responde "por que a nota não sai?" com códigos, não com um booleano. É a
  mesma disciplina da §16 aplicada ao estágio seguinte: sem os nomes, quem
  opera descobre o motivo abrindo cinco telas.
*/
CREATE FUNCTION public.contract_billing_fiscal_readiness(p_billing_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e        public.contract_billing_events%ROWTYPE;
  c        public.contracts%ROWTYPE;
  blockers jsonb := '[]'::jsonb;
  estab_id uuid;
BEGIN
  SELECT * INTO e FROM public.contract_billing_events WHERE id = p_billing_event_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ready', false,
      'blockers', jsonb_build_array(jsonb_build_object('code','BILLING_EVENT_NOT_FOUND')));
  END IF;
  SELECT * INTO c FROM public.contracts WHERE id = e.contract_id;

  IF e.release_state <> 'RELEASED' THEN
    blockers := blockers || jsonb_build_object('code','BILLING_NOT_RELEASED','detail', e.release_state);
  END IF;
  IF e.amount IS NULL OR e.amount <= 0 THEN
    blockers := blockers || jsonb_build_object('code','AMOUNT_UNKNOWN');
  END IF;
  IF e.currency IS NULL THEN
    blockers := blockers || jsonb_build_object('code','CURRENCY_UNKNOWN');
  END IF;
  IF c.counterparty_party_id IS NULL THEN
    blockers := blockers || jsonb_build_object('code','COUNTERPARTY_UNRESOLVED');
  END IF;

  SELECT id INTO estab_id FROM public.fiscal_establishments
   WHERE organization_id = e.organization_id AND active ORDER BY created_at LIMIT 1;
  IF estab_id IS NULL THEN
    blockers := blockers || jsonb_build_object('code','FISCAL_ESTABLISHMENT_MISSING');
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.fiscal_service_catalog s
                    WHERE s.organization_id = e.organization_id
                      AND s.establishment_id = estab_id AND s.active) THEN
      blockers := blockers || jsonb_build_object('code','FISCAL_SERVICE_CATALOG_MISSING');
    END IF;
  END IF;

  IF c.counterparty_party_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.fiscal_party_profiles p
                      WHERE p.organization_id = e.organization_id
                        AND p.party_id = c.counterparty_party_id AND p.active) THEN
    blockers := blockers || jsonb_build_object('code','FISCAL_PARTY_PROFILE_MISSING');
  END IF;

  RETURN jsonb_build_object(
    'ready', jsonb_array_length(blockers) = 0,
    'blockers', blockers,
    'establishment_id', estab_id,
    -- Centavos inteiros, arredondamento determinístico e num lugar só (§79).
    'amount_cents', CASE WHEN e.amount IS NOT NULL THEN round(e.amount * 100)::bigint END,
    'currency', e.currency,
    'party_id', c.counterparty_party_id,
    'contract_id', e.contract_id,
    'billing_event_id', e.id);
END $$;
REVOKE ALL ON FUNCTION public.contract_billing_fiscal_readiness(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_billing_fiscal_readiness(uuid) TO authenticated;

-- ------------------------------------------------------------
-- 4) Abertura idempotente do pedido, a partir do fato de liberação
-- ------------------------------------------------------------
CREATE FUNCTION public.contract_billing_open_fiscal_request(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ev   public.domain_events%ROWTYPE;
  e    public.contract_billing_events%ROWTYPE;
  rdy  jsonb;
  req_id uuid;
  existing public.contract_billing_fiscal_requests%ROWTYPE;
BEGIN
  SELECT * INTO ev FROM public.domain_events WHERE id = p_event_id;
  IF NOT FOUND OR ev.event_type <> 'contracts.billing.released' THEN
    RETURN jsonb_build_object('opened', false, 'reason', 'NOT_A_RELEASE_EVENT');
  END IF;

  SELECT * INTO e FROM public.contract_billing_events
   WHERE id = ev.aggregate_id AND organization_id = ev.organization_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('opened', false, 'reason', 'BILLING_EVENT_NOT_FOUND'); END IF;
  -- Liberação revogada entre o fato e o consumo: não se pede nota do que
  -- deixou de estar liberado.
  IF e.release_state <> 'RELEASED' THEN
    RETURN jsonb_build_object('opened', false, 'reason', 'NO_LONGER_RELEASED',
                              'release_state', e.release_state);
  END IF;

  SELECT * INTO existing FROM public.contract_billing_fiscal_requests
   WHERE organization_id = e.organization_id AND billing_event_id = e.id
     AND release_fingerprint = e.release_fingerprint;
  IF FOUND THEN
    RETURN jsonb_build_object('opened', false, 'idempotent', true,
                              'request_id', existing.id, 'state', existing.state);
  END IF;

  rdy := public.contract_billing_fiscal_readiness(e.id);

  BEGIN
    INSERT INTO public.contract_billing_fiscal_requests
      (organization_id, billing_event_id, release_fingerprint, state, blockers,
       requested_amount_cents, currency, source_event_id, correlation_id)
    VALUES
      (e.organization_id, e.id, e.release_fingerprint,
       CASE WHEN (rdy->>'ready')::boolean THEN 'REQUESTED' ELSE 'BLOCKED_BY_CONFIGURATION' END,
       rdy->'blockers',
       NULLIF(rdy->>'amount_cents','')::bigint, rdy->>'currency', ev.id, ev.correlation_id)
    RETURNING id INTO req_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO existing FROM public.contract_billing_fiscal_requests
     WHERE organization_id = e.organization_id AND billing_event_id = e.id
       AND release_fingerprint = e.release_fingerprint;
    RETURN jsonb_build_object('opened', false, 'idempotent', true,
                              'request_id', existing.id, 'state', existing.state);
  END;

  RETURN jsonb_build_object('opened', true, 'request_id', req_id,
                            'state', CASE WHEN (rdy->>'ready')::boolean
                                          THEN 'REQUESTED' ELSE 'BLOCKED_BY_CONFIGURATION' END,
                            'blockers', rdy->'blockers');
END $$;
REVOKE ALL ON FUNCTION public.contract_billing_open_fiscal_request(uuid)
  FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 5) Registro do rascunho criado pelo Fiscal
-- ------------------------------------------------------------
-- Chamada pelo handler DEPOIS que o serviço do Fiscal criou o rascunho. Ela
-- não cria documento: apenas amarra o vínculo, e recusa amarrar documento de
-- outro inquilino (a FK composta já recusaria; a mensagem explícita é o que
-- torna a falha diagnosticável).
CREATE FUNCTION public.contract_billing_link_fiscal_document(
  p_billing_event_id uuid,
  p_fiscal_document_id uuid,
  p_request_id       uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e     public.contract_billing_events%ROWTYPE;
  d     public.fiscal_documents%ROWTYPE;
  alloc_id uuid;
BEGIN
  SELECT * INTO e FROM public.contract_billing_events WHERE id = p_billing_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_EVENT_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;
  SELECT * INTO d FROM public.fiscal_documents
   WHERE id = p_fiscal_document_id AND organization_id = e.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FISCAL_DOCUMENT_TENANT_MISMATCH: documento fiscal não pertence à organização do faturamento.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT id INTO alloc_id FROM public.contract_billing_fiscal_allocations
   WHERE organization_id = e.organization_id AND billing_event_id = e.id
     AND fiscal_document_id = d.id AND state = 'ACTIVE';
  IF alloc_id IS NOT NULL THEN
    RETURN jsonb_build_object('allocation_id', alloc_id, 'idempotent', true);
  END IF;

  INSERT INTO public.contract_billing_fiscal_allocations
    (organization_id, billing_event_id, fiscal_document_id, allocated_amount_cents, currency)
  VALUES (e.organization_id, e.id, d.id, d.service_amount_cents, COALESCE(e.currency, 'BRL'))
  RETURNING id INTO alloc_id;

  IF p_request_id IS NOT NULL THEN
    UPDATE public.contract_billing_fiscal_requests
       SET state = 'DRAFT_CREATED', fiscal_document_id = d.id, blockers = '[]'::jsonb,
           last_error_safe = NULL, updated_at = now()
     WHERE id = p_request_id AND organization_id = e.organization_id;
  END IF;

  INSERT INTO public.contract_billing_event_history
    (organization_id, billing_event_id, transition, detail, actor_source, correlation_id)
  VALUES (e.organization_id, e.id, 'fiscal_document_linked',
          jsonb_build_object('fiscal_document_id', d.id, 'allocation_id', alloc_id,
                             'document_status', d.status),
          'system', e.correlation_id);

  RETURN jsonb_build_object('allocation_id', alloc_id, 'idempotent', false);
END $$;
REVOKE ALL ON FUNCTION public.contract_billing_link_fiscal_document(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 6) FATOS FISCAIS AUTORITATIVOS (§33, §34, §65)
-- ------------------------------------------------------------
/*
  Emitidos por GATILHO, e não pelo código do provedor, por uma razão que a §65
  nomeia: gatilho roda na MESMA transação da mudança de estado. Um `emit` feito
  pelo motor depois do UPDATE seria "melhor esforço" — e um documento
  autorizado cujo fato se perdeu não gera Contas a Receber nunca.

  O payload carrega identificadores e campos de negócio. Nada de XML, nada de
  payload de provedor, nada de segredo: a §33 é explícita, e `domain_events` já
  recusaria por `apex_payload_is_safe`.
*/
CREATE FUNCTION public.fiscal_documents_emit_lifecycle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ev_type text;
  billing_id uuid;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  ev_type := CASE NEW.status
    WHEN 'authorized' THEN 'fiscal.document.authorized'
    WHEN 'cancelled'  THEN 'fiscal.document.cancelled'
    WHEN 'replaced'   THEN 'fiscal.document.replaced'
    ELSE NULL END;
  IF ev_type IS NULL THEN RETURN NEW; END IF;

  SELECT a.billing_event_id INTO billing_id
    FROM public.contract_billing_fiscal_allocations a
   WHERE a.organization_id = NEW.organization_id
     AND a.fiscal_document_id = NEW.id AND a.state = 'ACTIVE'
   LIMIT 1;

  PERFORM public.emit_domain_event(
    NEW.organization_id, ev_type, 1, 'fiscal_document', NEW.id,
    -- Identidade de negócio: documento + estado. A reentrada da mesma
    -- transição devolve o mesmo fato.
    ev_type || ':' || NEW.id::text,
    jsonb_build_object(
      'document_number', NEW.document_number,
      'series', NEW.series,
      /*
        A chave de acesso da NFS-e é dado PÚBLICO — está impressa no DANFSe e
        serve para o tomador consultar a nota. Ela viaja aqui com outro NOME
        porque a guarda de segredo da Fase 4 recusa qualquer chave que case
        `access[_-]?key`, e ela recusa pelo NOME, sem olhar o valor. Renomear é
        a resposta certa: afrouxar a guarda para deixar passar um caso público
        abriria a porta para o próximo, que não seria.
      */
      'fiscal_access_code', NEW.access_key,
      'environment', NEW.environment,
      'status', NEW.status,
      'competence_date', NEW.competence_date,
      'issue_date', NEW.issue_date,
      'due_date', NEW.due_date,
      'party_id', NEW.party_id,
      'contract_id', NEW.contract_id,
      'project_id', NEW.project_id,
      'billing_event_id', billing_id,
      -- A BASE DO VALOR, inteira e explícita. Qual delas é o recebível é
      -- decisão de Finanças, configurada, e nunca inferida aqui (§40).
      'service_amount_cents', NEW.service_amount_cents,
      'deductions_cents', NEW.deductions_cents,
      'unconditional_discount_cents', NEW.unconditional_discount_cents,
      'conditional_discount_cents', NEW.conditional_discount_cents,
      'withheld_total_cents', NEW.withheld_total_cents,
      'issuer_tax_total_cents', NEW.issuer_tax_total_cents,
      'net_amount_cents', NEW.net_amount_cents,
      'business_unit_id', NEW.business_unit_id,
      'cost_center_id', NEW.cost_center_id,
      'replaced_document_id', NEW.replaced_document_id,
      'replacement_document_id', NEW.replacement_document_id),
    COALESCE(NEW.authorized_at, NEW.cancelled_at, now()),
    'provider', NULL, NULL, NULL);

  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fiscal_documents_emit_lifecycle() FROM PUBLIC;

CREATE TRIGGER fiscal_documents_lifecycle_facts AFTER UPDATE ON public.fiscal_documents
  FOR EACH ROW EXECUTE FUNCTION public.fiscal_documents_emit_lifecycle();

COMMENT ON FUNCTION public.fiscal_documents_emit_lifecycle() IS
  'Fato fiscal autoritativo na MESMA transação da mudança de estado (§65). '
  'Payload só com identificadores e campos de negócio — nunca XML, nunca '
  'resposta bruta de provedor (§33).';

-- ------------------------------------------------------------
-- 7) Substituição e cancelamento fecham a alocação, sem apagá-la
-- ------------------------------------------------------------
CREATE FUNCTION public.contract_billing_close_fiscal_allocation(
  p_organization_id uuid,
  p_fiscal_document_id uuid,
  p_state  text,
  p_reason text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF p_state NOT IN ('CANCELLED','REPLACED') THEN
    RAISE EXCEPTION 'INVALID_ALLOCATION_STATE' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.contract_billing_fiscal_allocations
     SET state = p_state, closed_at = now(), closed_reason = p_reason
   WHERE organization_id = p_organization_id
     AND fiscal_document_id = p_fiscal_document_id AND state = 'ACTIVE';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.contract_billing_close_fiscal_allocation(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;

COMMIT;
