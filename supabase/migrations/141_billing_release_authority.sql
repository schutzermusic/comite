-- ============================================================
-- Fase 7 — 141: AUTORIDADE DE LIBERAÇÃO DE FATURAMENTO
-- ============================================================
--
-- ─── O que a 136 fez de errado ───────────────────────────────────────────
--
-- A 136 criou as permissões `contracts.billing.release` e
-- `contracts.billing.adjust` — e as CONCEDEU, na própria migration, a três
-- papéis globais: `owner_admin`, `juridico_contratos` e `financeiro`. Além
-- disso, `contract_billing_release` aceitava `current_user_is_admin()` como
-- caminho alternativo, e, quando o Motor de Aprovação respondia NO_POLICY,
-- liberava direto por permissão.
--
-- O comentário daquela seed dizia, com todas as letras, que aquilo era
-- "atribuição de PAPEL, e não política de alçada". A distinção não se sustenta:
-- liberar faturamento é declarar a um cliente que ele deve. Quem pode fazer
-- isso, em nome de qual organização e até que valor, é autoridade comercial —
-- e ela não se deduz de um papel chamado "financeiro" ter sido criado por uma
-- seed genérica de RBAC.
--
-- A auditoria da fase já tinha estabelecido o fato relevante: ZERO política de
-- aprovação, ZERO alçada, ZERO aprovador nomeado, em qualquer inquilino. A
-- conclusão correta era declarar a governança AUSENTE. A 136 preencheu a
-- lacuna com nomes de papéis, que é a forma mais fácil de inventar governança
-- sem perceber que se inventou.
--
-- ─── O que esta migration faz ────────────────────────────────────────────
--
--   · retira as concessões automáticas de `contracts.billing.*`;
--   · mantém o VOCABULÁRIO das permissões — capacidade não é autoridade;
--   · cria o lugar onde a autoridade REAL é declarada, com evidência;
--   · remove o desvio de administrador na liberação;
--   · faz a ausência de governança virar um BLOQUEIO NOMEADO em vez de uma
--     liberação silenciosa.
--
-- Nasce VAZIA. Enquanto ninguém declarar autoridade, ninguém libera — e a tela
-- diz por quê. É a mesma disciplina que a §40 impôs à base do recebível e a
-- §42 ao mapeamento contábil: configuração ausente bloqueia, não adivinha.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1) Desfazer a concessão automática (§18)
-- ------------------------------------------------------------
/*
  As linhas de `permissions` FICAM: o vocabulário é útil e não afirma nada
  sobre quem manda. O que sai é o vínculo papel↔permissão que a 136 criou sem
  fonte autoritativa.

  O DELETE é restrito às permissões de faturamento e aos papéis GLOBAIS que a
  136 semeou. Uma organização que já tenha concedido a permissão por conta
  própria — em papel próprio, com `organization_id` preenchido — não é tocada:
  aquilo é decisão dela, e desfazê-la seria o mesmo erro na direção contrária.
*/
DELETE FROM public.role_permissions rp
 USING public.roles r, public.permissions p
 WHERE rp.role_id = r.id
   AND rp.permission_id = p.id
   AND r.organization_id IS NULL
   AND r.key IN ('owner_admin', 'juridico_contratos', 'financeiro')
   AND p.key IN ('contracts.billing.release', 'contracts.billing.adjust');

COMMENT ON COLUMN public.permissions.key IS
  'Vocabulário de CAPACIDADE. Capacidade não é autoridade: para faturamento, '
  'quem pode liberar é declarado em contract_billing_release_authorities, com '
  'evidência (Fase 7, migration 141).';

-- ------------------------------------------------------------
-- 2) Onde a autoridade REAL é declarada
-- ------------------------------------------------------------
CREATE TABLE public.contract_billing_release_authorities (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Nulo = vale para a organização inteira; preenchido = só aquele contrato.
  contract_id        uuid,

  /*
    A quem a autoridade foi dada. PAPEL ou PESSOA, nunca os dois — "todo mundo
    do papel X, e também a Maria" são duas declarações distintas, e misturá-las
    numa linha só torna impossível revogar uma sem revogar a outra.
  */
  grantee_kind       text NOT NULL CHECK (grantee_kind IN ('ROLE','USER')),
  grantee_role_id    uuid REFERENCES public.roles(id) ON DELETE CASCADE,
  grantee_user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,

  /*
    Limite de valor. NULO significa "não declarado", e NÃO significa ilimitado:
    a resolução abaixo trata nulo como sem teto porque a declaração é explícita
    e alguém a assinou — inventar um teto seria a alçada que a §18 proíbe.
  */
  max_amount         numeric(18,2) CHECK (max_amount IS NULL OR max_amount > 0),
  currency           text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),

  -- ---- a EVIDÊNCIA, que é o ponto inteiro desta tabela ----
  source_kind        text NOT NULL CHECK (source_kind IN (
    'BOARD_RESOLUTION','POWER_OF_ATTORNEY','DELEGATION_LETTER',
    'CONTRACT_CLAUSE','INTERNAL_POLICY_DOCUMENT','BYLAWS')),
  source_reference   text NOT NULL CHECK (btrim(source_reference) <> ''),
  source_document_id uuid,
  justification      text NOT NULL CHECK (btrim(justification) <> ''),

  effective_from     date NOT NULL DEFAULT current_date,
  effective_until    date,
  active             boolean NOT NULL DEFAULT true,

  declared_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  revoked_at         timestamptz,
  revoked_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revocation_reason  text,

  CONSTRAINT cbra_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT cbra_contract_tenant FOREIGN KEY (organization_id, contract_id)
    REFERENCES public.contracts (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT cbra_grantee_exclusive CHECK (
    (grantee_kind = 'ROLE' AND grantee_role_id IS NOT NULL AND grantee_user_id IS NULL)
    OR (grantee_kind = 'USER' AND grantee_user_id IS NOT NULL AND grantee_role_id IS NULL)),
  CONSTRAINT cbra_window CHECK (effective_until IS NULL OR effective_until >= effective_from),
  CONSTRAINT cbra_revoked_coherent CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  CONSTRAINT cbra_amount_needs_currency CHECK (max_amount IS NULL OR currency IS NOT NULL)
);

COMMENT ON TABLE public.contract_billing_release_authorities IS
  'Quem pode LIBERAR faturamento, por declaração com evidência — ata, '
  'procuração, carta de delegação, cláusula ou política interna. Nasce VAZIA. '
  'Sem linha vigente e sem política do Motor de Aprovação, a liberação recusa '
  'com RELEASE_AUTHORITY_NOT_CONFIGURED em vez de deduzir autoridade do nome '
  'de um papel (§18).';

CREATE INDEX cbra_lookup ON public.contract_billing_release_authorities
  (organization_id, contract_id) WHERE active AND revoked_at IS NULL;

/*
  Coerência de inquilino do outorgado.

  Um papel GLOBAL (organization_id nulo) pode ser outorgado por qualquer
  organização — é o catálogo compartilhado de RBAC. Um papel de organização, e
  uma pessoa, precisam pertencer à MESMA organização da declaração: outorgar
  autoridade comercial a alguém de outro inquilino não é um caso de uso, é um
  furo.
*/
CREATE FUNCTION public.contract_billing_release_authority_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE role_org uuid;
BEGIN
  IF NEW.grantee_kind = 'ROLE' THEN
    SELECT organization_id INTO role_org FROM public.roles WHERE id = NEW.grantee_role_id;
    IF role_org IS NOT NULL AND role_org IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'GRANTEE_TENANT_MISMATCH: o papel pertence a outra organização.'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.profiles p
                    WHERE p.user_id = NEW.grantee_user_id
                      AND p.organization_id = NEW.organization_id
                      AND p.status = 'active') THEN
      RAISE EXCEPTION 'GRANTEE_TENANT_MISMATCH: a pessoa não tem perfil ativo nesta organização.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contract_billing_release_authority_guard()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER cbra_guard BEFORE INSERT OR UPDATE
  ON public.contract_billing_release_authorities
  FOR EACH ROW EXECUTE FUNCTION public.contract_billing_release_authority_guard();

ALTER TABLE public.contract_billing_release_authorities ENABLE ROW LEVEL SECURITY;

CREATE POLICY cbra_select ON public.contract_billing_release_authorities
  FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id());

/*
  Quem DECLARA autoridade não é quem a exerce.

  A escrita exige `security.admin` ou administrador da organização — o mesmo
  lugar onde papéis e permissões são governados. Deixar a escrita para quem tem
  `contracts.billing.release` faria o outorgado ampliar a própria autoridade, e
  a declaração deixaria de ser evidência de coisa nenhuma.
*/
CREATE POLICY cbra_write ON public.contract_billing_release_authorities
  FOR ALL TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND public.current_user_is_admin())
  WITH CHECK (organization_id = public.current_user_organization_id()
         AND public.current_user_is_admin());

REVOKE TRUNCATE ON public.contract_billing_release_authorities FROM anon, authenticated;

-- ------------------------------------------------------------
-- 3) A resolução da autoridade
-- ------------------------------------------------------------
CREATE FUNCTION public.contract_billing_release_authority_for(
  p_organization_id uuid,
  p_contract_id     uuid,
  p_user_id         uuid,
  p_amount          numeric DEFAULT NULL,
  p_currency        text    DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE found_id uuid;
BEGIN
  IF p_user_id IS NULL THEN RETURN NULL; END IF;

  SELECT a.id INTO found_id
    FROM public.contract_billing_release_authorities a
   WHERE a.organization_id = p_organization_id
     AND a.active AND a.revoked_at IS NULL
     AND a.effective_from <= current_date
     AND (a.effective_until IS NULL OR a.effective_until >= current_date)
     AND (a.contract_id IS NULL OR a.contract_id = p_contract_id)
     AND (
       (a.grantee_kind = 'USER' AND a.grantee_user_id = p_user_id)
       OR (a.grantee_kind = 'ROLE' AND EXISTS (
             SELECT 1 FROM public.user_roles ur
              WHERE ur.user_id = p_user_id
                AND ur.role_id = a.grantee_role_id
                AND ur.organization_id = p_organization_id)))
     /*
       O teto, quando declarado, vale. Moeda diferente da declarada NÃO passa:
       comparar 10.000 USD com um teto de 10.000 BRL exigiria política de
       câmbio, que a §78 proíbe inventar.
     */
     AND (a.max_amount IS NULL
          OR (p_amount IS NOT NULL AND p_currency IS NOT NULL
              AND a.currency = p_currency AND p_amount <= a.max_amount))
   -- A declaração mais ESPECÍFICA vence: pessoa antes de papel, contrato antes
   -- de organização.
   ORDER BY (a.grantee_kind = 'USER') DESC, (a.contract_id IS NOT NULL) DESC, a.created_at DESC
   LIMIT 1;

  RETURN found_id;
END $$;
REVOKE ALL ON FUNCTION public.contract_billing_release_authority_for(uuid, uuid, uuid, numeric, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.contract_billing_release_authority_for(uuid, uuid, uuid, numeric, text) IS
  'Autoridade DECLARADA de liberação para (organização, contrato, pessoa, '
  'valor). NULL significa não configurada — e quem chama trata isso como '
  'bloqueio, nunca como permissão.';

-- ------------------------------------------------------------
-- 4) Liberação: governança real ou bloqueio nomeado
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contract_billing_release(
  p_billing_event_id uuid,
  p_note             text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e      public.contract_billing_events%ROWTYPE;
  actor  uuid := auth.uid();
  elig   jsonb;
  appr   jsonb;
  fp     text;
  caller_org uuid;
  authority uuid;
BEGIN
  SELECT * INTO e FROM public.contract_billing_events
   WHERE id = p_billing_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BILLING_EVENT_NOT_FOUND: faturamento inexistente.' USING ERRCODE = 'no_data_found';
  END IF;

  -- Inquilino ANTES de qualquer resposta que descreva a linha (migration 140).
  caller_org := public.apex_browser_organization();
  IF caller_org IS NOT NULL AND e.organization_id IS DISTINCT FROM caller_org THEN
    RAISE EXCEPTION 'BILLING_EVENT_NOT_FOUND: faturamento inexistente.' USING ERRCODE = 'no_data_found';
  END IF;

  IF e.release_state = 'RELEASED' THEN
    RETURN jsonb_build_object('billing_event_id', e.id, 'release_state', 'RELEASED',
                              'idempotent', true, 'release_fingerprint', e.release_fingerprint);
  END IF;
  IF e.release_state = 'PENDING_RELEASE' THEN
    RETURN jsonb_build_object('billing_event_id', e.id, 'release_state', 'PENDING_RELEASE',
                              'idempotent', true,
                              'approval_request_id', e.release_approval_request_id);
  END IF;

  IF e.legacy_row THEN
    RAISE EXCEPTION 'LEGACY_ROW_NOT_RELEASABLE: faturamento anterior à Fase 7 não tem procedência para liberar (§126).'
      USING ERRCODE = 'check_violation';
  END IF;
  IF e.release_state IN ('CANCELLED','SUPERSEDED') THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: faturamento em % não se libera.', e.release_state
      USING ERRCODE = 'check_violation';
  END IF;

  IF actor IS NULL THEN
    RAISE EXCEPTION 'RELEASE_NEVER_AUTOMATED: liberação de faturamento exige pessoa autenticada. '
      'Sistema, rotina e IA não liberam faturamento (§17, §98).' USING ERRCODE = '42501';
  END IF;

  /*
    CAPACIDADE. Continua sendo pré-requisito, e deixou de ser suficiente.

    O desvio `current_user_is_admin()` SAIU. Administrar a plataforma é
    autoridade sobre configuração, usuários e papéis — não sobre declarar a um
    cliente que ele deve. Confundir as duas foi o defeito que esta migration
    corrige, e mantê-lo "para não travar ninguém" seria mantê-lo.
  */
  IF NOT public.current_user_has_permission('contracts.billing.release') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: falta a permissão contracts.billing.release.'
      USING ERRCODE = '42501';
  END IF;

  elig := public.contract_billing_recompute_eligibility(e.id);
  IF (elig->>'state') <> 'ELIGIBLE' THEN
    RAISE EXCEPTION 'NOT_ELIGIBLE: faturamento em % — %', elig->>'state', (elig->'reasons')::text
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO e FROM public.contract_billing_events WHERE id = e.id;

  -- ---- 1ª via de governança: o Motor de Aprovação compartilhado ----
  appr := public.approval_request_create(
    e.organization_id, 'contract_billing_event', e.id, 'release', 'RELEASE',
    p_note,
    jsonb_build_object('contract_id', e.contract_id, 'amount', e.amount,
                       'currency', e.currency, 'amount_source', e.amount_source),
    'billing-release:' || e.id::text || ':' || COALESCE(public.contract_billing_fingerprint(e.id),'nofp'),
    e.source_event_id, NULL, e.correlation_id);

  IF (appr->>'status') NOT IN ('NO_POLICY','SUBJECT_TYPE_UNSUPPORTED') THEN
    UPDATE public.contract_billing_events
       SET release_state = 'PENDING_RELEASE',
           release_approval_request_id = NULLIF(appr->>'request_id','')::uuid,
           release_note = p_note, updated_at = now()
     WHERE id = e.id;
    SELECT * INTO e FROM public.contract_billing_events WHERE id = e.id;

    INSERT INTO public.contract_billing_event_history
      (organization_id, billing_event_id, transition, from_state, to_state, reason,
       detail, actor_user_id, actor_source, correlation_id)
    VALUES (e.organization_id, e.id, 'release_requested', 'ELIGIBLE', 'PENDING_RELEASE', p_note,
            appr, actor, 'human', e.correlation_id);

    RETURN jsonb_build_object('billing_event_id', e.id, 'release_state', 'PENDING_RELEASE',
                              'approval', appr, 'idempotent', false,
                              'governance', 'APPROVAL_POLICY');
  END IF;

  /*
    ─── 2ª via: autoridade DECLARADA ───────────────────────────────────────

    Sem política no Motor, a pergunta não vira "então libera": vira "alguém
    declarou, com evidência, que esta pessoa pode liberar isto?".

    A versão anterior respondia "então libera" — e é por isso que existia
    liberação por dedução de nome de papel.
  */
  authority := public.contract_billing_release_authority_for(
    e.organization_id, e.contract_id, actor, e.amount, e.currency);

  IF authority IS NULL THEN
    /*
      A recusa NÃO é gravada em `contract_billing_event_history`, e a ausência
      é deliberada.

      A primeira versão desta correção inseria a linha de história logo antes
      do RAISE. Não funciona, e a bateria pegou: a exceção desfaz a transação
      inteira, inclusive o INSERT — o registro nunca chegaria ao banco, e o
      teste que o procurasse estaria testando uma ilusão.

      Gravar a tentativa exigiria transação autônoma, que o PostgreSQL não tem
      sem `dblink`. E não é preciso: a recusa é observável de dois jeitos
      honestos — a mensagem nomeada que o chamador recebe, e
      `release_governance_state = 'NOT_CONFIGURED'` no modelo de leitura, que a
      tela lê sem precisar tentar liberar.

      História é o registro do que ACONTECEU. Nada aconteceu aqui.
    */
    RAISE EXCEPTION
      'RELEASE_AUTHORITY_NOT_CONFIGURED: não há política de aprovação nem autoridade de '
      'liberação declarada para esta organização/contrato/valor. Faturamento ELEGÍVEL e '
      'NÃO liberável: declare a autoridade em contract_billing_release_authorities, com '
      'evidência, ou cadastre a política no Motor de Aprovação (§18).'
      USING ERRCODE = '42501';
  END IF;

  fp := public.contract_billing_fingerprint(e.id);
  UPDATE public.contract_billing_events
     SET release_state = 'RELEASED', released_at = now(), released_by = actor,
         release_fingerprint = fp, release_note = p_note, updated_at = now()
   WHERE id = e.id;
  SELECT * INTO e FROM public.contract_billing_events WHERE id = e.id;

  INSERT INTO public.contract_billing_event_history
    (organization_id, billing_event_id, transition, from_state, to_state, reason,
     detail, actor_user_id, actor_source, correlation_id)
  VALUES (e.organization_id, e.id, 'released', 'ELIGIBLE', 'RELEASED', p_note,
          jsonb_build_object('release_fingerprint', fp, 'amount', e.amount,
                             'currency', e.currency, 'amount_source', e.amount_source,
                             'governance', 'DECLARED_AUTHORITY',
                             'release_authority_id', authority),
          actor, 'human', e.correlation_id);

  PERFORM public.contract_billing_emit(e, 'contracts.billing.released',
    jsonb_build_object('release_fingerprint', fp, 'released_at', e.released_at,
                       'due_date', e.due_date, 'title', e.title,
                       'release_authority_id', authority),
    actor, 'human');

  RETURN jsonb_build_object('billing_event_id', e.id, 'release_state', 'RELEASED',
                            'release_fingerprint', fp, 'idempotent', false,
                            'governance', 'DECLARED_AUTHORITY',
                            'release_authority_id', authority);
END $$;

COMMENT ON FUNCTION public.contract_billing_release(uuid, text) IS
  'Liberação GOVERNADA. Exige pessoa autenticada, permissão, elegibilidade '
  'recomputada no ato E governança real: política do Motor de Aprovação ou '
  'autoridade declarada com evidência. Sem nenhuma das duas, recusa com '
  'RELEASE_AUTHORITY_NOT_CONFIGURED. Sem desvio de administrador (§18).';

-- ------------------------------------------------------------
-- 5) Cancelar e superar: mesma autoridade, sem desvio de admin
-- ------------------------------------------------------------
/*
  Cancelar e superar agem sobre um direito de cobrança — inclusive sobre um já
  LIBERADO. Se a autoridade para criar a cobrança precisa ser declarada, a
  autoridade para desfazê-la e substituí-la é da mesma natureza.

  A permissão continua bastando quando o faturamento NUNCA foi liberado:
  cancelar um candidato que ninguém apresentou ao cliente não é ato comercial,
  é higiene de fila. A autoridade declarada passa a ser exigida a partir do
  momento em que a liberação existiu.
*/
CREATE OR REPLACE FUNCTION public.contract_billing_cancel(
  p_billing_event_id uuid,
  p_reason           text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e public.contract_billing_events%ROWTYPE;
  actor uuid := auth.uid();
  caller_org uuid;
BEGIN
  SELECT * INTO e FROM public.contract_billing_events WHERE id = p_billing_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_EVENT_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;

  caller_org := public.apex_browser_organization();
  IF caller_org IS NOT NULL AND e.organization_id IS DISTINCT FROM caller_org THEN
    RAISE EXCEPTION 'BILLING_EVENT_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  IF e.release_state = 'CANCELLED' THEN
    RETURN jsonb_build_object('billing_event_id', e.id, 'release_state', 'CANCELLED', 'idempotent', true);
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'REASON_REQUIRED: cancelamento sem motivo não é registro, é apagamento com outro nome.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF caller_org IS NOT NULL THEN
    IF NOT public.current_user_has_permission('contracts.billing.release') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE = '42501';
    END IF;
    IF e.released_at IS NOT NULL
       AND public.contract_billing_release_authority_for(
             e.organization_id, e.contract_id, actor, e.amount, e.currency) IS NULL THEN
      RAISE EXCEPTION
        'RELEASE_AUTHORITY_NOT_CONFIGURED: cancelar um faturamento já liberado exige a mesma '
        'autoridade declarada que a liberação exige.' USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.contract_billing_events
     SET release_state = 'CANCELLED', cancelled_at = now(), cancelled_by = actor,
         cancellation_reason = p_reason, updated_at = now()
   WHERE id = e.id;
  SELECT * INTO e FROM public.contract_billing_events WHERE id = e.id;

  INSERT INTO public.contract_billing_event_history
    (organization_id, billing_event_id, transition, from_state, to_state, reason,
     actor_user_id, actor_source, correlation_id)
  VALUES (e.organization_id, e.id, 'cancelled', NULL, 'CANCELLED', p_reason,
          actor, CASE WHEN actor IS NULL THEN 'system' ELSE 'human' END, e.correlation_id);

  PERFORM public.contract_billing_emit(e, 'contracts.billing.cancelled',
    jsonb_build_object('reason', p_reason), actor,
    CASE WHEN actor IS NULL THEN 'system' ELSE 'human' END);

  RETURN jsonb_build_object('billing_event_id', e.id, 'release_state', 'CANCELLED', 'idempotent', false);
END $$;

CREATE OR REPLACE FUNCTION public.contract_billing_supersede(
  p_billing_event_id uuid,
  p_reason           text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e public.contract_billing_events%ROWTYPE;
  actor uuid := auth.uid();
  new_id uuid;
  caller_org uuid;
BEGIN
  SELECT * INTO e FROM public.contract_billing_events WHERE id = p_billing_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_EVENT_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;

  caller_org := public.apex_browser_organization();
  IF caller_org IS NOT NULL AND e.organization_id IS DISTINCT FROM caller_org THEN
    RAISE EXCEPTION 'BILLING_EVENT_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  IF e.superseded_by_id IS NOT NULL THEN
    RETURN jsonb_build_object('billing_event_id', e.id, 'successor_id', e.superseded_by_id,
                              'idempotent', true);
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  IF caller_org IS NOT NULL THEN
    IF NOT public.current_user_has_permission('contracts.billing.release') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE = '42501';
    END IF;
    IF e.released_at IS NOT NULL
       AND public.contract_billing_release_authority_for(
             e.organization_id, e.contract_id, actor, e.amount, e.currency) IS NULL THEN
      RAISE EXCEPTION
        'RELEASE_AUTHORITY_NOT_CONFIGURED: superar um faturamento já liberado exige a mesma '
        'autoridade declarada que a liberação exige.' USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.contract_billing_events
     SET release_state = 'SUPERSEDED', supersession_reason = p_reason, updated_at = now()
   WHERE id = e.id;

  INSERT INTO public.contract_billing_events
    (organization_id, contract_id, milestone_id, title, amount, due_date, status,
     currency, source_kind, source_measurement_id, occurrence_key, entitlement_key,
     amount_source, amount_source_id, amount_source_revision, amount_derivation_rule,
     amount_derived_at, release_state, supersedes_id, correlation_id, source_event_id)
  VALUES
    (e.organization_id, e.contract_id, e.milestone_id, e.title, e.amount, e.due_date, e.status,
     e.currency, e.source_kind, e.source_measurement_id, e.occurrence_key, e.entitlement_key,
     e.amount_source, e.amount_source_id, e.amount_source_revision, e.amount_derivation_rule,
     now(), 'NOT_ELIGIBLE', e.id, e.correlation_id, e.source_event_id)
  RETURNING id INTO new_id;

  UPDATE public.contract_billing_events SET superseded_by_id = new_id WHERE id = e.id;
  SELECT * INTO e FROM public.contract_billing_events WHERE id = e.id;

  INSERT INTO public.contract_billing_event_history
    (organization_id, billing_event_id, transition, from_state, to_state, reason, detail,
     actor_user_id, actor_source, correlation_id)
  VALUES (e.organization_id, e.id, 'superseded', NULL, 'SUPERSEDED', p_reason,
          jsonb_build_object('successor_id', new_id), actor,
          CASE WHEN actor IS NULL THEN 'system' ELSE 'human' END, e.correlation_id);

  PERFORM public.contract_billing_recompute_eligibility(new_id);
  RETURN jsonb_build_object('billing_event_id', e.id, 'successor_id', new_id, 'idempotent', false);
END $$;

COMMIT;
