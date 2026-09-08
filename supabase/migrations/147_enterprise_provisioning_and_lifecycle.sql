-- ============================================================
-- Fase 7.5 — 147: PROVISIONAMENTO, TROCA E CICLO DE VIDA
-- ============================================================
--
-- Nenhuma das quatro tabelas da 145 aceita escrita do navegador. Tudo que muda
-- vínculo, autoridade ou contexto passa por aqui — funções SECURITY DEFINER
-- construídas sob a regra que a Fase 7 pagou caro para aprender:
--
--     NUNCA confie em RLS dentro de SECURITY DEFINER.
--
-- Na prática, em toda função deste arquivo:
--   · o ator vem de `auth.uid()`, jamais de parâmetro;
--   · a organização do alvo é conferida EXPLICITAMENTE contra o vínculo;
--   · "de outro grupo" e "não existe" produzem a MESMA resposta, para que ter
--     um UUID na mão não vire um oráculo de existência (§4.3, §46);
--   · a concessão é revogada de `anon`: nenhuma destas funções tem sentido sem
--     pessoa autenticada, e uma delas escreve.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1) As organizações que a pessoa pode ENTRAR (§8)
-- ------------------------------------------------------------
/*
  Alimenta o seletor global. Devolve só o que o vínculo prova — organização de
  que a pessoa não é membro simplesmente não aparece, e não há como pedir a
  lista "de outra pessoa": não existe parâmetro de usuário.
*/
CREATE OR REPLACE FUNCTION public.my_organizations()
RETURNS TABLE (
  organization_id       uuid,
  name                  text,
  slug                  text,
  status                text,
  enterprise_account_id uuid,
  enterprise_name       text,
  membership_status     text,
  is_active_context     boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT o.id, o.name, o.slug, o.status, o.enterprise_account_id, ea.name,
         om.status,
         o.id = public.current_user_organization_id()
    FROM public.organization_memberships om
    JOIN public.organizations o       ON o.id = om.organization_id
    JOIN public.enterprise_accounts ea ON ea.id = o.enterprise_account_id
   WHERE om.user_id = auth.uid()
     AND om.status IN ('ACTIVE','SUSPENDED','INVITED')
   ORDER BY (om.status = 'ACTIVE') DESC, o.name;
$$;

-- ------------------------------------------------------------
-- 2) Trocar de organização (§31)
-- ------------------------------------------------------------
/*
  A troca não move dado nenhum. Ela só registra qual contexto a pessoa PEDIU —
  e o pedido só é aceito depois que o vínculo o prova. Guardar a escolha não a
  torna permanente: `current_user_organization_id()` reconfere vínculo e estado
  da organização a cada resolução, de modo que uma revogação posterior invalida
  a linha guardada sem que ninguém precise apagá-la.
*/
CREATE OR REPLACE FUNCTION public.organization_switch(p_organization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE actor uuid := auth.uid(); org public.organizations%ROWTYPE; ms text;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '42501';
  END IF;

  SELECT om.status INTO ms
    FROM public.organization_memberships om
   WHERE om.user_id = actor AND om.organization_id = p_organization_id;

  /*
    Sem vínculo, a resposta é a mesma que para organização inexistente. Duas
    mensagens diferentes contariam a um administrador de A que a organização B
    existe — que é exatamente o oráculo que a §4.3 fecha.
  */
  IF ms IS NULL THEN
    RAISE EXCEPTION 'ORGANIZATION_NOT_FOUND' USING ERRCODE = '42501';
  END IF;
  IF ms <> 'ACTIVE' THEN
    RAISE EXCEPTION 'MEMBERSHIP_NOT_ACTIVE' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO org FROM public.organizations WHERE id = p_organization_id;
  IF org.status = 'suspended' THEN
    RAISE EXCEPTION 'ORGANIZATION_SUSPENDED' USING ERRCODE = '42501';
  ELSIF org.status = 'archived' THEN
    RAISE EXCEPTION 'ORGANIZATION_ARCHIVED' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.user_active_organization (user_id, organization_id, activated_at)
  VALUES (actor, p_organization_id, now())
  ON CONFLICT (user_id) DO UPDATE
    SET organization_id = EXCLUDED.organization_id, activated_at = now();

  INSERT INTO public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (p_organization_id, actor, 'organization.context.switched', 'organization', p_organization_id,
          jsonb_build_object('source','organization_switch'));

  RETURN jsonb_build_object(
    'ok', true, 'organization_id', org.id, 'name', org.name, 'slug', org.slug,
    'enterprise_account_id', org.enterprise_account_id);
END $$;

-- ------------------------------------------------------------
-- 3) Provisionar organização (§10, §30)
-- ------------------------------------------------------------
/*
  Transacional e vazia. Cria a linha, o vínculo de quem criou, a capacidade
  administrativa MÍNIMA dentro da organização nova, o rastro de auditoria e o
  fato de domínio. Nada mais.

  Sobre o papel `owner_admin` concedido a quem cria: não é autoridade de
  negócio inventada. `owner_admin` não libera faturamento (a 141 retirou essa
  concessão), não aprova nada (não há política), não configura fiscal nem
  financeiro — tudo isso continua AUSENTE e bloqueando por ausência. O que ele
  concede é o direito de administrar a organização recém-criada, sem o qual
  ninguém jamais poderia sequer convidar a segunda pessoa. E quem recebe é
  quem já detinha autoridade de provisionamento no grupo.

  O que esta função explicitamente NÃO faz: semear comitê, centro de custo,
  política de aprovação, alçada de faturamento, emitente fiscal, regra de
  postagem, base de recebível ou qualquer fato operacional. `setup_first_organization`
  semeia comitês; esta não semeia — a §11 e a §12 são claras, e um comitê
  padrão é estrutura de governança que ninguém decidiu ainda.
*/
CREATE OR REPLACE FUNCTION public.organization_provision(
  p_name             text,
  p_legal_name       text    DEFAULT NULL,
  p_country_code     text    DEFAULT NULL,
  p_default_currency text    DEFAULT NULL,
  p_timezone         text    DEFAULT NULL,
  p_legal_identifier text    DEFAULT NULL,
  p_idempotency_key  text    DEFAULT NULL,
  p_enterprise_account_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  actor      uuid := auth.uid();
  ea_id      uuid;
  new_id     uuid;
  base_slug  text;
  slug       text;
  owner_role uuid;
  existing   public.organizations%ROWTYPE;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'ORGANIZATION_NAME_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  /*
    A conta empresarial-alvo. Sem parâmetro, é a do contexto ativo. Com
    parâmetro, ele é conferido contra as contas que a pessoa ADMINISTRA — e a
    recusa é a mesma para "não administro" e "não existe".
  */
  ea_id := COALESCE(p_enterprise_account_id, public.current_user_enterprise_account_id());
  IF ea_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.current_user_enterprise_admin_accounts() a WHERE a = ea_id) THEN
    RAISE EXCEPTION 'ENTERPRISE_PROVISIONING_NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;

  -- Idempotência: o mesmo pedido, repetido, devolve a MESMA organização (§38).
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO existing FROM public.organizations
     WHERE enterprise_account_id = ea_id AND provisioning_idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'organization_id', existing.id,
                                'name', existing.name, 'slug', existing.slug,
                                'enterprise_account_id', ea_id, 'idempotent_replay', true);
    END IF;
  END IF;

  base_slug := trim(both '-' from lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g')));
  IF base_slug = '' THEN
    RAISE EXCEPTION 'ORGANIZATION_NAME_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;
  slug := base_slug;

  BEGIN
    INSERT INTO public.organizations
      (name, slug, status, enterprise_account_id, legal_name, country_code,
       default_currency, timezone, legal_identifier, created_by,
       provisioning_idempotency_key)
    VALUES (btrim(p_name), slug, 'active', ea_id, p_legal_name, p_country_code,
            p_default_currency, p_timezone, p_legal_identifier, actor, p_idempotency_key)
    RETURNING id INTO new_id;
  EXCEPTION WHEN unique_violation THEN
    -- Criação simultânea com a mesma chave: quem perdeu a corrida lê o vencedor.
    IF p_idempotency_key IS NOT NULL THEN
      SELECT * INTO existing FROM public.organizations
       WHERE enterprise_account_id = ea_id AND provisioning_idempotency_key = p_idempotency_key;
      IF FOUND THEN
        RETURN jsonb_build_object('ok', true, 'organization_id', existing.id,
                                  'name', existing.name, 'slug', existing.slug,
                                  'enterprise_account_id', ea_id, 'idempotent_replay', true);
      END IF;
    END IF;
    RAISE EXCEPTION 'ORGANIZATION_SLUG_TAKEN' USING ERRCODE = 'unique_violation';
  END;

  INSERT INTO public.organization_memberships
    (organization_id, user_id, status, source, joined_at, created_by)
  VALUES (new_id, actor, 'ACTIVE', 'PROVISIONING', now(), actor);

  SELECT id INTO owner_role FROM public.roles
   WHERE organization_id IS NULL AND key = 'owner_admin' LIMIT 1;
  IF owner_role IS NULL THEN
    RAISE EXCEPTION 'PLATFORM_ROLE_VOCABULARY_MISSING: papel global owner_admin ausente.'
      USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO public.user_roles (user_id, role_id, organization_id)
  VALUES (actor, owner_role, new_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (new_id, actor, 'organization.created', 'organization', new_id,
          jsonb_build_object('source','organization_provision','enterprise_account_id', ea_id));

  PERFORM public.emit_domain_event(
    new_id, 'platform.organization.created', 1, 'organization', new_id,
    'organization-created-' || new_id::text,
    jsonb_build_object('enterprise_account_id', ea_id, 'slug', slug),
    now(), 'human', actor, NULL, NULL);

  RETURN jsonb_build_object('ok', true, 'organization_id', new_id, 'name', btrim(p_name),
                            'slug', slug, 'enterprise_account_id', ea_id,
                            'idempotent_replay', false);
END $$;

-- ------------------------------------------------------------
-- 4) Ciclo de vida do vínculo (§15)
-- ------------------------------------------------------------
/*
  Mudança de vínculo é evento de segurança: auditada, atribuída a `auth.uid()`,
  e nunca auto-concedida. Quem administra vínculo é quem tem
  `admin.manage_users` NA ORGANIZAÇÃO ATIVA — e a organização-alvo precisa ser
  a ativa. Um administrador de A não mexe no quadro de B nem sabendo o UUID.
*/
CREATE OR REPLACE FUNCTION public.organization_membership_set_status(
  p_organization_id uuid,
  p_user_id         uuid,
  p_status          text,
  p_reason          text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE actor uuid := auth.uid(); active_org uuid; prev text;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('INVITED','ACTIVE','SUSPENDED','REVOKED') THEN
    RAISE EXCEPTION 'INVALID_MEMBERSHIP_STATUS' USING ERRCODE = 'check_violation';
  END IF;

  active_org := public.current_user_organization_id();
  IF active_org IS NULL OR active_org <> p_organization_id THEN
    RAISE EXCEPTION 'ORGANIZATION_NOT_FOUND' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.current_user_has_permission('admin.manage_users') OR public.current_user_is_admin()) THEN
    RAISE EXCEPTION 'ORGANIZATION_ACCESS_DENIED' USING ERRCODE = '42501';
  END IF;
  -- Auto-escalada e auto-revogação ficam ambas de fora (§15).
  IF p_user_id = actor THEN
    RAISE EXCEPTION 'SELF_MEMBERSHIP_CHANGE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO prev FROM public.organization_memberships
   WHERE organization_id = p_organization_id AND user_id = p_user_id;

  INSERT INTO public.organization_memberships
    (organization_id, user_id, status, source, invited_at, joined_at, disabled_at, disabled_by, created_by)
  VALUES (p_organization_id, p_user_id, p_status, 'INVITE',
          CASE WHEN p_status = 'INVITED' THEN now() END,
          CASE WHEN p_status = 'ACTIVE'  THEN now() END,
          CASE WHEN p_status IN ('SUSPENDED','REVOKED') THEN now() END,
          CASE WHEN p_status IN ('SUSPENDED','REVOKED') THEN actor END,
          actor)
  ON CONFLICT (organization_id, user_id) DO UPDATE
    SET status      = EXCLUDED.status,
        joined_at   = CASE WHEN EXCLUDED.status = 'ACTIVE'
                           THEN COALESCE(public.organization_memberships.joined_at, now())
                           ELSE public.organization_memberships.joined_at END,
        disabled_at = CASE WHEN EXCLUDED.status IN ('SUSPENDED','REVOKED') THEN now() END,
        disabled_by = CASE WHEN EXCLUDED.status IN ('SUSPENDED','REVOKED') THEN actor END,
        updated_at  = now();

  /*
    Revogar/suspender derruba o contexto guardado no ato. A resolução já
    recusaria a linha órfã, mas deixá-la ali seria guardar um pedido que nunca
    mais pode ser atendido.
  */
  IF p_status IN ('SUSPENDED','REVOKED') THEN
    DELETE FROM public.user_active_organization
     WHERE user_id = p_user_id AND organization_id = p_organization_id;
  END IF;

  INSERT INTO public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (p_organization_id, actor,
          'organization.membership.' || lower(p_status), 'organization_membership', p_user_id,
          jsonb_build_object('previous_status', prev, 'reason', p_reason));

  PERFORM public.emit_domain_event(
    p_organization_id,
    'platform.organization.membership.' || lower(p_status), 1,
    'organization_membership', p_organization_id,
    'membership-' || p_organization_id::text || '-' || p_user_id::text || '-' || lower(p_status) || '-' || extract(epoch from now())::bigint::text,
    jsonb_build_object('previous_status', prev, 'new_status', p_status),
    now(), 'human', actor, NULL, NULL);

  RETURN jsonb_build_object('ok', true, 'organization_id', p_organization_id,
                            'user_id', p_user_id, 'status', p_status, 'previous_status', prev);
END $$;

-- ------------------------------------------------------------
-- 5) Ciclo de vida da organização (§14)
-- ------------------------------------------------------------
/*
  ARQUIVAR não apaga história — muda estado. E o estado é lido pela resolução:
  organização suspensa ou arquivada deixa de render contexto para qualquer
  pessoa, inclusive quem tem vínculo ativo. Bloqueio de operação por estrutura,
  não por tela.

  Autoridade: administração empresarial do grupo DONO da organização. É
  registro, não dado operacional.
*/
CREATE OR REPLACE FUNCTION public.organization_set_lifecycle_status(
  p_organization_id uuid,
  p_status          text,
  p_reason          text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE actor uuid := auth.uid(); org public.organizations%ROWTYPE;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('active','suspended','archived') THEN
    RAISE EXCEPTION 'INVALID_ORGANIZATION_STATUS' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO org FROM public.organizations WHERE id = p_organization_id;
  IF NOT FOUND OR NOT EXISTS (
       SELECT 1 FROM public.current_user_enterprise_admin_accounts() a
        WHERE a = org.enterprise_account_id) THEN
    RAISE EXCEPTION 'ORGANIZATION_NOT_FOUND' USING ERRCODE = '42501';
  END IF;

  UPDATE public.organizations
     SET status       = p_status,
         suspended_at = CASE WHEN p_status = 'suspended' THEN COALESCE(suspended_at, now()) END,
         archived_at  = CASE WHEN p_status = 'archived'  THEN COALESCE(archived_at,  now()) END,
         updated_at   = now()
   WHERE id = p_organization_id;

  IF p_status <> 'active' THEN
    DELETE FROM public.user_active_organization WHERE organization_id = p_organization_id;
  END IF;

  INSERT INTO public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (p_organization_id, actor, 'organization.' ||
          CASE p_status WHEN 'suspended' THEN 'suspended' WHEN 'archived' THEN 'archived' ELSE 'reactivated' END,
          'organization', p_organization_id, jsonb_build_object('reason', p_reason, 'previous_status', org.status));

  PERFORM public.emit_domain_event(
    p_organization_id,
    'platform.organization.' ||
      CASE p_status WHEN 'suspended' THEN 'suspended' WHEN 'archived' THEN 'archived' ELSE 'reactivated' END,
    1, 'organization', p_organization_id,
    'organization-lifecycle-' || p_organization_id::text || '-' || p_status || '-' || extract(epoch from now())::bigint::text,
    jsonb_build_object('previous_status', org.status), now(), 'human', actor, NULL, NULL);

  RETURN jsonb_build_object('ok', true, 'organization_id', p_organization_id, 'status', p_status);
END $$;

-- ------------------------------------------------------------
-- 6) Prontidão verdadeira da organização (§21, §34)
-- ------------------------------------------------------------
/*
  A tela de onboarding precisa dizer a verdade: VAZIO é diferente de
  NÃO_CONFIGURADO, e os dois são diferentes de "deu erro". Esta função conta o
  que existe — sem inventar default, sem preencher lacuna.

  Só membro lê. Administração empresarial NÃO entra aqui: contagem de contrato
  e de recebível é dado operacional, e a §26 proíbe o atalho do "grupo vê tudo".
*/
CREATE OR REPLACE FUNCTION public.organization_readiness(p_organization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE org uuid := p_organization_id; facts jsonb; config jsonb; platform jsonb;
BEGIN
  IF NOT public.current_user_is_organization_member(org) THEN
    RAISE EXCEPTION 'ORGANIZATION_NOT_FOUND' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'contracts',              (SELECT count(*) FROM public.contracts                     WHERE organization_id = org),
    'contract_amendments',    (SELECT count(*) FROM public.contract_amendments           WHERE organization_id = org),
    'contract_clauses',       (SELECT count(*) FROM public.contract_clauses              WHERE organization_id = org),
    'contract_obligations',   (SELECT count(*) FROM public.contract_obligations          WHERE organization_id = org),
    'obligation_instances',   (SELECT count(*) FROM public.contract_obligation_instances WHERE organization_id = org),
    'contract_project_links', (SELECT count(*) FROM public.contract_project_links        WHERE organization_id = org),
    'contract_milestones',    (SELECT count(*) FROM public.contract_milestones           WHERE organization_id = org),
    'projects',               (SELECT count(*) FROM public.projects                      WHERE organization_id = org),
    'measurements',           (SELECT count(*) FROM public.project_measurements          WHERE organization_id = org),
    'billing_events',         (SELECT count(*) FROM public.contract_billing_events       WHERE organization_id = org),
    'fiscal_documents',       (SELECT count(*) FROM public.fiscal_documents              WHERE organization_id = org),
    'receivables',            (SELECT count(*) FROM public.finance_receivables           WHERE organization_id = org),
    'settlements',            (SELECT count(*) FROM public.finance_settlements           WHERE organization_id = org),
    'reconciliations',        (SELECT count(*) FROM public.finance_reconciliations       WHERE organization_id = org),
    'risks',                  (SELECT count(*) FROM public.risks                         WHERE organization_id = org),
    'approval_requests',      (SELECT count(*) FROM public.approval_requests             WHERE organization_id = org),
    'contract_files',         (SELECT count(*) FROM public.contract_files                WHERE organization_id = org),
    'parties',                (SELECT count(*) FROM public.parties                       WHERE organization_id = org)
  ) INTO facts;

  /*
    Fato de PLATAFORMA não é fato OPERACIONAL. Uma organização recém-criada tem
    exatamente um evento — o da própria criação — e isso é o rastro de que ela
    nasceu, não conteúdo de negócio. Somar os dois no mesmo total faria a tela
    de prontidão mentir em ambas as direções: diria "não está vazia" quando
    está, e esconderia o dia em que um fato operacional aparecer sozinho.
  */
  SELECT jsonb_build_object(
    'domain_events', (SELECT count(*) FROM public.domain_events WHERE organization_id = org),
    'apex_jobs',     (SELECT count(*) FROM public.apex_jobs     WHERE organization_id = org),
    'audit_logs',    (SELECT count(*) FROM public.audit_logs    WHERE organization_id = org)
  ) INTO platform;

  SELECT jsonb_build_object(
    'company_profile',   CASE WHEN EXISTS (SELECT 1 FROM public.organizations o
                                            WHERE o.id = org AND o.legal_name IS NOT NULL
                                              AND o.country_code IS NOT NULL AND o.default_currency IS NOT NULL)
                              THEN 'READY' ELSE 'INCOMPLETE' END,
    'members',           (SELECT count(*) FROM public.organization_memberships
                           WHERE organization_id = org AND status = 'ACTIVE'),
    'fiscal',            CASE WHEN EXISTS (SELECT 1 FROM public.fiscal_establishments WHERE organization_id = org)
                              THEN 'CONFIGURED' ELSE 'NOT_CONFIGURED' END,
    'approval_policies', CASE WHEN EXISTS (SELECT 1 FROM public.approval_policies WHERE organization_id = org)
                              THEN 'CONFIGURED' ELSE 'NOT_CONFIGURED' END,
    'billing_release_authority',
                         CASE WHEN EXISTS (SELECT 1 FROM public.contract_billing_release_authorities
                                            WHERE organization_id = org)
                              THEN 'CONFIGURED' ELSE 'NOT_CONFIGURED' END
  ) INTO config;

  RETURN jsonb_build_object(
    'organization_id', org,
    'operational_facts', facts,
    'operational_facts_total', (SELECT sum((value)::bigint) FROM jsonb_each_text(facts)),
    'platform_facts', platform,
    'configuration', config);
END $$;

-- ------------------------------------------------------------
-- 7) Concessões — nada disso é chamável por `anon`
-- ------------------------------------------------------------
/*
  `REVOKE ... FROM PUBLIC` não basta. O Supabase mantém DEFAULT PRIVILEGES que
  concedem EXECUTE a `anon` DIRETAMENTE, e privilégio direto não some quando se
  revoga de PUBLIC. Sem o REVOKE nominal abaixo, toda RPC desta fase — inclusive
  as duas que ESCREVEM — nasceria alcançável sem autenticação.
*/
REVOKE ALL ON FUNCTION public.my_organizations()                                          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.organization_switch(uuid)                                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.organization_provision(text,text,text,text,text,text,text,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.organization_membership_set_status(uuid,uuid,text,text)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.organization_set_lifecycle_status(uuid,text,text)           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.organization_readiness(uuid)                                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.profiles_project_membership()                               FROM PUBLIC, anon;

/*
  Os auxiliares da 145 saíram com `REVOKE ... FROM PUBLIC` apenas, pelo mesmo
  motivo — e a 145 já está aplicada, então a correção vem aqui em vez de
  reescrever migration aplicada. Nenhum deles vaza nada para `anon` (todos
  partem de `auth.uid()`, que é NULL sem sessão), mas superfície alcançável sem
  autenticação não se deixa aberta por ser inofensiva hoje.
*/
REVOKE ALL ON FUNCTION public.current_user_is_organization_member(uuid)     FROM anon;
REVOKE ALL ON FUNCTION public.current_user_enterprise_admin_accounts()      FROM anon;
REVOKE ALL ON FUNCTION public.current_user_can_provision_organizations()    FROM anon;
REVOKE ALL ON FUNCTION public.current_user_enterprise_account_id()          FROM anon;

GRANT EXECUTE ON FUNCTION public.my_organizations()                                          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.organization_switch(uuid)                                   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.organization_provision(text,text,text,text,text,text,text,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.organization_membership_set_status(uuid,uuid,text,text)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.organization_set_lifecycle_status(uuid,text,text)           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.organization_readiness(uuid)                                TO authenticated, service_role;

/*
  `setup_first_organization` é o caminho de primeiro login e continua válido —
  mas passa a ancorar a organização nova numa conta empresarial e a criar o
  vínculo, porque sem vínculo a pessoa criaria uma organização em que não
  consegue entrar. Ela continua semeando comitês: é o fluxo legado de
  onboarding, e mudar o que ele semeia não é assunto desta fase.
*/
CREATE OR REPLACE FUNCTION public.setup_first_organization(
  organization_name text, organization_slug text,
  profile_full_name text DEFAULT NULL, profile_job_title text DEFAULT NULL,
  profile_department text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  new_organization_id uuid;
  owner_role_id uuid;
  normalized_slug text;
  ea_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Profile already exists for this user';
  END IF;

  normalized_slug := lower(regexp_replace(coalesce(organization_slug, organization_name), '[^a-zA-Z0-9]+', '-', 'g'));
  normalized_slug := trim(both '-' from normalized_slug);

  INSERT INTO enterprise_accounts (name, slug, created_by)
  VALUES (organization_name, 'ea-' || normalized_slug, auth.uid())
  RETURNING id INTO ea_id;

  INSERT INTO organizations (name, slug, enterprise_account_id, created_by)
  VALUES (organization_name, normalized_slug, ea_id, auth.uid())
  RETURNING id INTO new_organization_id;

  INSERT INTO enterprise_account_memberships
    (enterprise_account_id, user_id, role, status, granted_basis, created_by)
  VALUES (ea_id, auth.uid(), 'OWNER', 'ACTIVE', 'FIRST_ORGANIZATION_SETUP', auth.uid());

  -- O gatilho da 145 projeta o vínculo a partir do perfil.
  INSERT INTO profiles (user_id, organization_id, full_name, job_title, department)
  VALUES (auth.uid(), new_organization_id, profile_full_name, profile_job_title, profile_department);

  SELECT id INTO owner_role_id FROM roles WHERE organization_id IS NULL AND key = 'owner_admin' LIMIT 1;
  INSERT INTO user_roles (user_id, role_id, organization_id)
  VALUES (auth.uid(), owner_role_id, new_organization_id);

  PERFORM seed_default_committees(new_organization_id);

  INSERT INTO audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (new_organization_id, auth.uid(), 'organization.created', 'organization', new_organization_id,
          jsonb_build_object('source', 'onboarding'));

  RETURN new_organization_id;
END $$;

COMMIT;
