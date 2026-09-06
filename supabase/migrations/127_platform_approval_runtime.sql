-- ============================================================
-- PLATAFORMA — Motor de Aprovação: DELEGAÇÃO e RUNTIME ATÔMICO
-- Migration: 127_platform_approval_runtime
--
-- ─── A regra desta migration ───────────────────────────────────────────────
--
--   Toda a lógica de decisão é UMA transação, dentro de UMA função.
--
-- Travar o pedido, validar o estado, resolver o ator, revalidar elegibilidade,
-- SoD, alçada e delegação, conferir a impressão digital, gravar a decisão
-- imutável, atualizar a projeção, apurar o quórum, abrir o próximo estágio,
-- finalizar e EMITIR O EVENTO — tudo junto ou nada.
--
-- A alternativa (o cliente faz três chamadas) falha de um jeito específico e
-- caro: o processo morre entre a segunda e a terceira, e o que sobra é um
-- pedido aprovado sem evento, ou um evento sem decisão. Não há como consertar
-- isso depois porque não há como saber, olhando o banco, o que estava sendo
-- tentado.
--
-- ─── O ator ────────────────────────────────────────────────────────────────
--
-- `actor_user_id` NUNCA é parâmetro. Vem de `auth.uid()`, aqui dentro. Não
-- existe forma de o navegador dizer quem decidiu (§36). É por isso que a
-- assinatura de `approval_decide` não tem um campo de ator, e não é esquecimento.
--
-- ─── SECURITY DEFINER, e as consequências ──────────────────────────────────
--
-- DEFINER porque a função precisa gravar em tabelas onde `authenticated` não
-- tem INSERT — que é justamente o desenho da 126. Em troca ela assume a
-- obrigação de validar o inquilino do chamador por conta própria, com
-- `search_path` fixo, e de nunca confiar num id vindo de fora sem confrontá-lo
-- com o perfil de quem chamou.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1) approval_delegations
-- ------------------------------------------------------------
-- Delegação é uma afirmação sobre AUTORIDADE, não um atalho de caixa de
-- entrada. Por isso ela é explícita, do mesmo inquilino, com prazo, com
-- escopo, revogável e auditável — e por isso o delegado nunca ganha mais do
-- que o delegante tinha.
CREATE TABLE public.approval_delegations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  delegator_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delegate_user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- ---- escopo: NULL = não restringe aquela dimensão ----
  scope_domain       text,
  scope_subject_type text,
  scope_action_type  text,
  scope_policy_id    uuid,

  -- Teto que o delegante impõe. O limite EFETIVO na decisão é o MENOR entre
  -- este e o da etapa: delegar não cria autoridade nova (§20).
  max_amount         numeric(18,2) CHECK (max_amount IS NULL OR max_amount >= 0),
  currency           text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),

  effective_from     timestamptz NOT NULL DEFAULT now(),
  effective_until    timestamptz NOT NULL,
  reason             text NOT NULL CHECK (btrim(reason) <> ''),

  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  revoked_at         timestamptz,
  revoked_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  CONSTRAINT adel_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT adel_policy_tenant FOREIGN KEY (organization_id, scope_policy_id)
    REFERENCES public.approval_policies (organization_id, id) ON DELETE CASCADE,
  -- Delegar para si mesmo não é delegação; é ruído no histórico.
  CONSTRAINT adel_no_self CHECK (delegate_user_id <> delegator_user_id),
  -- Delegação SEM prazo seria transferência permanente de autoridade sem
  -- decisão de governança. `effective_until` é NOT NULL de propósito (§20).
  CONSTRAINT adel_window CHECK (effective_until > effective_from),
  CONSTRAINT adel_amount_needs_currency CHECK ((max_amount IS NULL) = (currency IS NULL)),
  CONSTRAINT adel_revoked_coherent CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

COMMENT ON TABLE public.approval_delegations IS
  'Delegação explícita, do mesmo inquilino, com prazo obrigatório, escopo e '
  'revogação. O delegado NUNCA excede a autoridade do delegante, e delegação '
  'não dispensa SoD nem fronteira de inquilino.';

CREATE INDEX adel_active ON public.approval_delegations
  (organization_id, delegate_user_id, effective_until)
  WHERE revoked_at IS NULL;
CREATE INDEX adel_delegator ON public.approval_delegations (organization_id, delegator_user_id);

-- Delegação é fato de autoridade: o que muda é a REVOGAÇÃO, nada mais. Editar
-- prazo ou teto depois faria uma decisão passada parecer autorizada por regra
-- que não existia quando ela foi tomada.
CREATE FUNCTION public.approval_delegations_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.organization_id   IS DISTINCT FROM OLD.organization_id
  OR NEW.delegator_user_id IS DISTINCT FROM OLD.delegator_user_id
  OR NEW.delegate_user_id  IS DISTINCT FROM OLD.delegate_user_id
  OR NEW.scope_domain      IS DISTINCT FROM OLD.scope_domain
  OR NEW.scope_subject_type IS DISTINCT FROM OLD.scope_subject_type
  OR NEW.scope_action_type IS DISTINCT FROM OLD.scope_action_type
  OR NEW.scope_policy_id   IS DISTINCT FROM OLD.scope_policy_id
  OR NEW.max_amount        IS DISTINCT FROM OLD.max_amount
  OR NEW.currency          IS DISTINCT FROM OLD.currency
  OR NEW.effective_from    IS DISTINCT FROM OLD.effective_from
  OR NEW.effective_until   IS DISTINCT FROM OLD.effective_until
  OR NEW.reason            IS DISTINCT FROM OLD.reason THEN
    RAISE EXCEPTION 'Delegação % só admite revogação; o resto é imutável.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'Delegação % já revogada.', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.approval_delegations_guard() FROM PUBLIC;
CREATE TRIGGER adel_immutable BEFORE UPDATE ON public.approval_delegations
  FOR EACH ROW EXECUTE FUNCTION public.approval_delegations_guard();

ALTER TABLE public.approval_delegations ENABLE ROW LEVEL SECURITY;

CREATE POLICY approval_delegations_select ON public.approval_delegations FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.current_user_is_admin()
              OR public.current_user_has_permission('approvals.view')
              OR delegator_user_id = auth.uid() OR delegate_user_id = auth.uid()));

-- Só se delega a PRÓPRIA autoridade. `delegator_user_id = auth.uid()` no
-- WITH CHECK é o que impede alguém de delegar a autoridade de terceiro — que
-- seria escalonamento com aparência de rotina administrativa.
CREATE POLICY approval_delegations_insert ON public.approval_delegations FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_user_organization_id()
              AND delegator_user_id = auth.uid()
              AND public.current_user_has_permission('approvals.delegate')
              -- O delegado tem de ser membro ATIVO do MESMO inquilino.
              AND EXISTS (SELECT 1 FROM public.profiles p
                           WHERE p.user_id = delegate_user_id
                             AND p.organization_id = public.current_user_organization_id()
                             AND p.status = 'active'));

-- Revogar: o delegante, ou quem administra o motor.
CREATE POLICY approval_delegations_revoke ON public.approval_delegations FOR UPDATE TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (delegator_user_id = auth.uid() OR public.current_user_is_admin()
              OR public.current_user_has_permission('approvals.admin')))
  WITH CHECK (organization_id = public.current_user_organization_id());

GRANT SELECT, INSERT, UPDATE ON public.approval_delegations TO authenticated;
REVOKE ALL ON public.approval_delegations FROM anon;

-- ------------------------------------------------------------
-- 2) Elegibilidade — a mesma resposta para a tela e para a decisão
-- ------------------------------------------------------------
-- Uma função só, usada pela RPC E pelo modelo de leitura. Duas implementações
-- da mesma pergunta divergem, e a divergência aparece como um botão habilitado
-- que devolve erro — ou, pior, como um botão escondido sobre um direito real.
--
-- Devolve um código, nunca um booleano: "não pode" sem MOTIVO produz tela que
-- não sabe explicar o bloqueio, e a §42 exige que o bloqueio seja visível.
CREATE FUNCTION public.approval_step_eligibility(
  p_step_id uuid,
  p_user_id uuid,
  p_delegation_id uuid DEFAULT NULL
) RETURNS TABLE (
  eligible          boolean,
  code              text,
  detail            text,
  authority_source  text,
  authority_basis   text,
  authority_limit   numeric,
  authority_currency text,
  on_behalf_of      uuid
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  st   public.approval_request_steps%ROWTYPE;
  req  public.approval_requests%ROWTYPE;
  del  public.approval_delegations%ROWTYPE;
  -- Quem precisa satisfazer a regra da etapa: o próprio ator, ou o delegante.
  principal uuid;
  src   text;
  basis text;
  lim   numeric;
  cur   text;
  behalf uuid := NULL;
BEGIN
  SELECT * INTO st FROM public.approval_request_steps WHERE id = p_step_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'STEP_NOT_FOUND', NULL::text, NULL::text, NULL::text, NULL::numeric, NULL::text, NULL::uuid; RETURN;
  END IF;
  SELECT * INTO req FROM public.approval_requests WHERE id = st.request_id;

  -- Membro ATIVO do inquilino do pedido. Sem isto, um ex-colaborador com
  -- sessão viva ainda decidiria.
  IF NOT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.user_id = p_user_id AND p.organization_id = req.organization_id
                    AND p.status = 'active') THEN
    RETURN QUERY SELECT false, 'NOT_ACTIVE_MEMBER', NULL::text, NULL::text, NULL::text, NULL::numeric, NULL::text, NULL::uuid; RETURN;
  END IF;

  principal := p_user_id;

  -- ---------- delegação ----------
  IF p_delegation_id IS NOT NULL THEN
    IF NOT st.delegation_allowed THEN
      RETURN QUERY SELECT false, 'DELEGATION_NOT_ALLOWED',
        format('A etapa "%s" não admite delegação.', st.step_key),
        NULL::text, NULL::text, NULL::numeric, NULL::text, NULL::uuid; RETURN;
    END IF;

    SELECT * INTO del FROM public.approval_delegations WHERE id = p_delegation_id;
    -- Mensagem ÚNICA para inexistente e de outro inquilino: duas mensagens
    -- diferentes diriam, a quem tem um UUID na mão, que aquela delegação
    -- existe noutra organização. É o oráculo que a Fase 2 fechou.
    IF del.id IS NULL OR del.organization_id <> req.organization_id THEN
      RETURN QUERY SELECT false, 'DELEGATION_INVALID', NULL::text, NULL::text, NULL::text, NULL::numeric, NULL::text, NULL::uuid; RETURN;
    END IF;
    IF del.delegate_user_id <> p_user_id THEN
      RETURN QUERY SELECT false, 'DELEGATION_INVALID', NULL::text, NULL::text, NULL::text, NULL::numeric, NULL::text, NULL::uuid; RETURN;
    END IF;
    IF del.revoked_at IS NOT NULL THEN
      RETURN QUERY SELECT false, 'DELEGATION_REVOKED', NULL::text, NULL::text, NULL::text, NULL::numeric, NULL::text, NULL::uuid; RETURN;
    END IF;
    IF now() < del.effective_from OR now() >= del.effective_until THEN
      RETURN QUERY SELECT false, 'DELEGATION_EXPIRED', NULL::text, NULL::text, NULL::text, NULL::numeric, NULL::text, NULL::uuid; RETURN;
    END IF;
    IF (del.scope_subject_type IS NOT NULL AND del.scope_subject_type <> req.subject_type)
    OR (del.scope_action_type  IS NOT NULL AND del.scope_action_type  <> req.action_type)
    OR (del.scope_policy_id    IS NOT NULL AND del.scope_policy_id    <> req.policy_id) THEN
      RETURN QUERY SELECT false, 'DELEGATION_OUT_OF_SCOPE', NULL::text, NULL::text, NULL::text, NULL::numeric, NULL::text, NULL::uuid; RETURN;
    END IF;
    /*
      SEM ENCADEAMENTO (§20, padrão).

      O delegante tem de satisfazer a regra da etapa POR SI. Se ele próprio só
      a satisfizesse por outra delegação, a autoridade estaria sendo repassada
      em cadeia, e ninguém conseguiria dizer de onde ela veio originalmente.
      A verificação abaixo usa `principal := del.delegator_user_id` e mais
      nenhuma delegação.
    */
    principal := del.delegator_user_id;
    behalf    := del.delegator_user_id;
  END IF;

  -- ---------- SoD ----------
  -- Vem ANTES da elegibilidade positiva de propósito: quem está barrado por
  -- segregação de funções deve ver "você não pode decidir o que você mesmo
  -- pediu", não "você não tem a permissão X".
  --
  -- O ATOR e o DELEGANTE são verificados. Delegar para o requerente não pode
  -- ser a porta dos fundos da autoaprovação.
  IF st.sod_forbid_requester AND req.requested_by IS NOT NULL
     AND (p_user_id = req.requested_by OR principal = req.requested_by) THEN
    RETURN QUERY SELECT false, 'SOD_REQUESTER',
      'Quem solicitou a aprovação não pode decidi-la.',
      NULL::text, NULL::text, NULL::numeric, NULL::text, NULL::uuid; RETURN;
  END IF;

  IF st.sod_forbid_subject_creator AND req.subject_created_by IS NOT NULL
     AND (p_user_id = req.subject_created_by OR principal = req.subject_created_by) THEN
    RETURN QUERY SELECT false, 'SOD_SUBJECT_CREATOR',
      'Quem cadastrou o objeto não pode decidir esta etapa.',
      NULL::text, NULL::text, NULL::numeric, NULL::text, NULL::uuid; RETURN;
  END IF;

  -- Etapas incompatíveis: o mesmo ator não cumpre duas do mesmo grupo no mesmo
  -- pedido. Conta a decisão JÁ REGISTRADA, e conta tanto quem clicou quanto
  -- por conta de quem se agiu.
  IF st.sod_group IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.approval_decisions d
         JOIN public.approval_request_steps s2 ON s2.id = d.request_step_id
        WHERE d.request_id = st.request_id
          AND s2.sod_group = st.sod_group
          AND s2.id <> st.id
          AND (d.actor_user_id IN (p_user_id, principal)
               OR d.on_behalf_of_user_id IN (p_user_id, principal))) THEN
    RETURN QUERY SELECT false, 'SOD_INCOMPATIBLE_STEP',
      format('Este ator já decidiu outra etapa incompatível (grupo %s) neste pedido.', st.sod_group),
      NULL::text, NULL::text, NULL::numeric, NULL::text, NULL::uuid; RETURN;
  END IF;

  -- ---------- elegibilidade positiva ----------
  -- Avaliada sobre o PRINCIPAL (o delegante, quando há delegação).
  IF st.eligibility_mode = 'NAMED' THEN
    IF principal <> st.named_user_id THEN
      RETURN QUERY SELECT false, 'NOT_NAMED_APPROVER',
        format('A etapa "%s" tem aprovador nomeado.', st.step_key),
        NULL::text, NULL::text, NULL::numeric, NULL::text, NULL::uuid; RETURN;
    END IF;
    src := 'NAMED'; basis := 'named_user:' || st.named_user_id::text;

  ELSIF st.eligibility_mode = 'ROLE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
                    WHERE ur.user_id = principal AND ur.organization_id = req.organization_id
                      AND r.key = st.role_key) THEN
      RETURN QUERY SELECT false, 'MISSING_ROLE',
        format('A etapa "%s" exige o papel "%s".', st.step_key, st.role_key),
        NULL::text, NULL::text, NULL::numeric, NULL::text, NULL::uuid; RETURN;
    END IF;
    src := 'ROLE'; basis := 'role:' || st.role_key;

  ELSE
    /*
      PERMISSÃO — resolvida para o PRINCIPAL, que pode não ser quem chamou.
      Por isso não se usa `current_user_has_permission`, que só sabe responder
      sobre `auth.uid()`. A mesma precedência é reproduzida: uma negação
      explícita vence a concessão por papel.

      Ser administrador NÃO entra nesta conta. A §35 é explícita: administrar o
      motor não concede alçada. Um `OR current_user_is_admin()` aqui faria todo
      administrador aprovar qualquer coisa, e a SoD viraria enfeite.
    */
    IF COALESCE((SELECT upo.effect FROM public.user_permission_overrides upo
                   JOIN public.permissions pm ON pm.id = upo.permission_id
                  WHERE upo.user_id = principal AND upo.organization_id = req.organization_id
                    AND pm.key = st.permission_key LIMIT 1), '') = 'deny' THEN
      RETURN QUERY SELECT false, 'PERMISSION_DENIED_OVERRIDE',
        format('A permissão "%s" está explicitamente negada para este ator.', st.permission_key),
        NULL::text, NULL::text, NULL::numeric, NULL::text, NULL::uuid; RETURN;
    END IF;

    IF NOT (
      COALESCE((SELECT upo.effect FROM public.user_permission_overrides upo
                  JOIN public.permissions pm ON pm.id = upo.permission_id
                 WHERE upo.user_id = principal AND upo.organization_id = req.organization_id
                   AND pm.key = st.permission_key LIMIT 1), '') = 'grant'
      OR EXISTS (SELECT 1 FROM public.user_roles ur
                   JOIN public.role_permissions rp ON rp.role_id = ur.role_id
                   JOIN public.permissions pm ON pm.id = rp.permission_id
                  WHERE ur.user_id = principal AND ur.organization_id = req.organization_id
                    AND pm.key = st.permission_key)) THEN
      RETURN QUERY SELECT false, 'MISSING_PERMISSION',
        format('A etapa "%s" exige a permissão "%s".', st.step_key, st.permission_key),
        NULL::text, NULL::text, NULL::numeric, NULL::text, NULL::uuid; RETURN;
    END IF;
    src := 'PERMISSION'; basis := 'permission:' || st.permission_key;
  END IF;

  -- ---------- alçada ----------
  lim := st.authority_max_amount;
  cur := st.authority_currency;

  IF p_delegation_id IS NOT NULL THEN
    -- O delegado não ganha mais do que o delegante deu, nem mais do que a
    -- etapa permite: vale o MENOR dos dois tetos (§20).
    IF del.max_amount IS NOT NULL THEN
      IF cur IS NOT NULL AND del.currency <> cur THEN
        RETURN QUERY SELECT false, 'DELEGATION_CURRENCY_MISMATCH',
          format('Delegação em %s não cobre alçada em %s; não há conversão.', del.currency, cur),
          NULL::text, NULL::text, NULL::numeric, NULL::text, NULL::uuid; RETURN;
      END IF;
      lim := LEAST(COALESCE(lim, del.max_amount), del.max_amount);
      cur := COALESCE(cur, del.currency);
    END IF;
    src := 'DELEGATED';
    basis := format('%s via delegation:%s', basis, del.id);
  END IF;

  IF st.authority_required THEN
    IF req.subject_amount IS NULL THEN
      -- Ausência NUNCA vira "dentro do limite". Valor desconhecido bloqueia.
      RETURN QUERY SELECT false, 'AUTHORITY_AMOUNT_UNKNOWN',
        'O valor do objeto é desconhecido e a etapa exige alçada.',
        src, basis, lim, cur, behalf; RETURN;
    END IF;
    IF lim IS NOT NULL THEN
      IF req.subject_currency IS DISTINCT FROM cur THEN
        -- Sem conversão inventada (§18): moeda incompatível bloqueia.
        RETURN QUERY SELECT false, 'AUTHORITY_CURRENCY_MISMATCH',
          format('Alçada em %s não decide valor em %s; não há conversão de moeda.',
                 cur, COALESCE(req.subject_currency, 'moeda desconhecida')),
          src, basis, lim, cur, behalf; RETURN;
      END IF;
      IF req.subject_amount > lim THEN
        RETURN QUERY SELECT false, 'AUTHORITY_LIMIT_EXCEEDED',
          format('Valor %s %s excede a alçada de %s %s.', req.subject_currency, req.subject_amount, cur, lim),
          src, basis, lim, cur, behalf; RETURN;
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT true, 'ELIGIBLE', NULL::text, src, basis, lim, cur, behalf;
END $$;

REVOKE ALL ON FUNCTION public.approval_step_eligibility(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

/*
  A versão que o navegador enxerga, e a razão de ela existir.

  A função acima recebe `p_user_id` porque a RPC de decisão precisa avaliar o
  DELEGANTE, que não é quem chamou. Expor esse parâmetro à tela seria um
  oráculo de permissão: com um id de usuário na mão, qualquer pessoa
  descobriria, uma etapa por vez, que papéis e permissões o colega tem.

  Fechar isso com uma guarda `current_user IN ('authenticated','anon')` NÃO
  funcionaria, e vale registrar por quê: dentro de uma função SECURITY DEFINER
  o `current_user` já é o DONO da função, não quem chamou — a guarda nunca
  dispararia. A separação em duas funções resolve por construção em vez de por
  verificação: o navegador só alcança a que não tem o parâmetro.
*/
CREATE FUNCTION public.approval_step_eligibility_for_viewer(
  p_step_id uuid, p_delegation_id uuid DEFAULT NULL
) RETURNS TABLE (
  eligible          boolean,
  code              text,
  detail            text,
  authority_source  text,
  authority_basis   text,
  authority_limit   numeric,
  authority_currency text,
  on_behalf_of      uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT * FROM public.approval_step_eligibility(p_step_id, auth.uid(), p_delegation_id)
$$;
REVOKE ALL ON FUNCTION public.approval_step_eligibility_for_viewer(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approval_step_eligibility_for_viewer(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.approval_step_eligibility_for_viewer(uuid, uuid) IS
  'A elegibilidade do PRÓPRIO espectador — a mesma função que a decisão usa, '
  'sem o parâmetro de ator. É o que a tela chama, para que botão e servidor '
  'nunca discordem.';

COMMENT ON FUNCTION public.approval_step_eligibility(uuid, uuid, uuid) IS
  'UMA resposta de elegibilidade, usada pela RPC de decisão E pelo modelo de '
  'leitura. Devolve CÓDIGO, não booleano: bloqueio sem motivo produz tela que '
  'não sabe explicar. Ser admin não entra na conta (§35).';

COMMIT;

-- ============================================================
-- 127b — SUJEITO, CRIAÇÃO, DECISÃO ATÔMICA, CANCELAMENTO, EXPIRAÇÃO, SUCESSÃO
-- (mesma migration 127)
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 3) O adaptador de sujeito
-- ------------------------------------------------------------
/*
  O motor não sabe o que é um contrato. Ele sabe perguntar a alguém que sabe.

  Uma função ÚNICA com CASE por `subject_type`, e não despacho dinâmico por
  nome de função vindo de tabela. A §65 proíbe expressão SQL arbitrária, e um
  `EXECUTE format('SELECT * FROM %s', ...)` sobre um nome guardado em tabela é
  exatamente isso: quem escrevesse a linha escolheria o código a rodar.
  Registrar um domínio novo aqui é uma migration — que é onde a revisão está.

  Nesta migration NENHUM tipo está registrado. O piloto de Contratos entra na
  128, por CREATE OR REPLACE, e é lá que a impressão digital de contrato é
  definida. Tipo não registrado devolve `supported = false`, e o chamador
  descobre isso antes de criar pedido nenhum — nunca uma impressão digital
  inventada para um objeto que o motor não sabe ler.
*/
CREATE FUNCTION public.approval_subject_resolve(
  p_organization_id uuid,
  p_subject_type    text,
  p_subject_id      uuid
) RETURNS TABLE (
  supported        boolean,
  found            boolean,
  fingerprint      text,
  amount           numeric,
  currency         text,
  label            text,
  created_by       uuid,
  business_domain  text,
  contract_type    text,
  risk_class       text,
  cost_center_id   uuid,
  business_unit_id uuid
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN QUERY SELECT false, false, NULL::text, NULL::numeric, NULL::text, NULL::text,
                      NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
END $$;

REVOKE ALL ON FUNCTION public.approval_subject_resolve(uuid, text, uuid) FROM PUBLIC;

COMMENT ON FUNCTION public.approval_subject_resolve(uuid, text, uuid) IS
  'Adaptador de sujeito do lado do SERVIDOR. Resolve o objeto, deriva o '
  'inquilino, calcula a impressão digital e expõe o contexto de seleção. O '
  'navegador não informa nada disso. Sem tipo registrado aqui; a 128 registra '
  'contract.';

-- ------------------------------------------------------------
-- 4) Criação de pedido
-- ------------------------------------------------------------
CREATE FUNCTION public.approval_request_create(
  p_organization_id       uuid,
  p_subject_type          text,
  p_subject_id            uuid,
  p_action_type           text,
  p_decision_purpose      text,
  p_reason                text        DEFAULT NULL,
  p_context               jsonb       DEFAULT '{}'::jsonb,
  p_idempotency_key       text        DEFAULT NULL,
  p_source_event_id       uuid        DEFAULT NULL,
  p_supersedes_request_id uuid        DEFAULT NULL,
  p_correlation_id        uuid        DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  subj      record;
  vers      public.approval_policy_versions%ROWTYPE;
  pol       public.approval_policies%ROWTYPE;
  v_id      uuid;
  req_id    uuid;
  actor     uuid := auth.uid();
  idem      text;
  corr      uuid;
  stage_row record;
  step_row  record;
  new_stage_id uuid;
  n_steps   integer;
  quorum    integer;
  blocked   text;
  existing  public.approval_requests%ROWTYPE;
  ev_id     uuid;
  first_stage_id uuid;
BEGIN
  -- ---------- inquilino do chamador ----------
  IF current_user IN ('authenticated','anon') THEN
    IF public.current_user_organization_id() IS DISTINCT FROM p_organization_id THEN
      RAISE EXCEPTION 'Criação de pedido negada.' USING ERRCODE = '42501';
    END IF;
    IF NOT (public.current_user_has_permission('approvals.request')
            OR public.current_user_has_permission('approvals.admin')
            OR public.current_user_is_admin()) THEN
      RAISE EXCEPTION 'Criação de pedido negada.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- ---------- sujeito ----------
  SELECT * INTO subj FROM public.approval_subject_resolve(p_organization_id, p_subject_type, p_subject_id);
  IF NOT subj.supported THEN
    RETURN jsonb_build_object('status','SUBJECT_TYPE_UNSUPPORTED','subject_type',p_subject_type);
  END IF;
  IF NOT subj.found THEN
    -- Mensagem única: "não existe" e "é de outro inquilino" respondem igual.
    RETURN jsonb_build_object('status','SUBJECT_NOT_FOUND');
  END IF;

  -- ---------- política ----------
  v_id := public.approval_policy_select(
    p_organization_id, p_subject_type, p_action_type, p_decision_purpose,
    subj.amount, subj.currency, subj.contract_type, subj.risk_class,
    subj.cost_center_id, subj.business_unit_id);

  IF v_id IS NULL THEN
    -- Zero políticas NÃO é "aprovado" nem "não precisa de aprovação". É a
    -- ausência de regra, e quem chamou decide o que fazer com ela (§10, §43).
    RETURN jsonb_build_object('status','NO_POLICY',
      'subject_type',p_subject_type,'action_type',p_action_type,'decision_purpose',p_decision_purpose);
  END IF;

  SELECT * INTO vers FROM public.approval_policy_versions WHERE id = v_id;
  SELECT * INTO pol  FROM public.approval_policies WHERE id = vers.policy_id;

  -- ---------- idempotência ----------
  /*
    A chave PADRÃO inclui a impressão digital. Consequência desejada: clicar
    duas vezes devolve o mesmo pedido, mas o objeto ALTERADO gera chave nova —
    porque é outro conteúdo, e aprovar o de ontem não vale para o de hoje.
  */
  idem := COALESCE(p_idempotency_key,
    format('%s:%s:%s:%s:%s', p_subject_type, p_subject_id, p_action_type, p_decision_purpose, subj.fingerprint));

  SELECT * INTO existing FROM public.approval_requests
   WHERE organization_id = p_organization_id AND idempotency_key = idem;
  IF FOUND THEN
    RETURN jsonb_build_object('status','EXISTING','request_id',existing.id,
      'request_status',existing.status,'policy_version_id',existing.policy_version_id);
  END IF;

  corr := COALESCE(p_correlation_id, gen_random_uuid());
  -- O id é gerado ANTES da inserção porque a sucessão precisa acontecer
  -- primeiro: enquanto o pedido antigo estiver PENDING, o índice parcial
  -- `areq_one_active` recusa o sucessor — corretamente, já que os dois
  -- estariam ativos para a mesma ação. Suceder depois de inserir é uma ordem
  -- que nunca chega a rodar.
  req_id := gen_random_uuid();

  IF p_supersedes_request_id IS NOT NULL THEN
    PERFORM public.approval_request_supersede(p_supersedes_request_id, req_id, corr);
  END IF;

  -- ---------- o pedido ----------
  INSERT INTO public.approval_requests (
    id,
    organization_id, policy_version_id, policy_id, policy_key, policy_version_no,
    subject_type, subject_id, action_type, decision_purpose, subject_fingerprint,
    subject_amount, subject_currency, subject_label, subject_created_by,
    requested_by, request_reason, request_context, status, current_stage_no,
    expires_at, correlation_id, source_event_id, supersedes_request_id,
    idempotency_key, allow_parallel)
  VALUES (
    req_id,
    p_organization_id, vers.id, vers.policy_id, pol.policy_key, vers.version_no,
    p_subject_type, p_subject_id, p_action_type, p_decision_purpose, subj.fingerprint,
    subj.amount, subj.currency, subj.label, subj.created_by,
    actor, p_reason, COALESCE(p_context,'{}'::jsonb), 'PENDING', 1,
    CASE WHEN vers.request_expires_after IS NOT NULL THEN now() + vers.request_expires_after END,
    corr, p_source_event_id, p_supersedes_request_id,
    idem, vers.allow_parallel_requests);

  -- ---------- a CÓPIA governada do plano ----------
  FOR stage_row IN
    SELECT * FROM public.approval_policy_stages
     WHERE policy_version_id = vers.id ORDER BY stage_no
  LOOP
    SELECT count(*) INTO n_steps FROM public.approval_policy_steps WHERE policy_stage_id = stage_row.id;
    -- Quórum NULL na política vira o número REAL de etapas aqui. Guardar o
    -- número resolvido impede que "todas" seja reinterpretado depois.
    quorum := COALESCE(stage_row.quorum_required, n_steps);

    INSERT INTO public.approval_request_stages (
      organization_id, request_id, stage_no, name, quorum_required, rejection_behavior,
      status, opened_at)
    VALUES (p_organization_id, req_id, stage_row.stage_no, stage_row.name, quorum,
            stage_row.rejection_behavior,
            CASE WHEN stage_row.stage_no = 1 THEN 'OPEN' ELSE 'WAITING' END,
            CASE WHEN stage_row.stage_no = 1 THEN now() END)
    RETURNING id INTO new_stage_id;
    IF stage_row.stage_no = 1 THEN first_stage_id := new_stage_id; END IF;

    FOR step_row IN
      SELECT * FROM public.approval_policy_steps WHERE policy_stage_id = stage_row.id ORDER BY step_key
    LOOP
      INSERT INTO public.approval_request_steps (
        organization_id, request_id, request_stage_id, policy_step_id, step_key, stage_no,
        name, decision_purpose, eligibility_mode, permission_key, role_key, named_user_id,
        authority_required, authority_max_amount, authority_currency,
        sod_forbid_requester, sod_forbid_subject_creator, sod_group, delegation_allowed,
        reason_requirement, step_expires_after, status, opened_at, expires_at)
      VALUES (
        p_organization_id, req_id, new_stage_id, step_row.id, step_row.step_key, stage_row.stage_no,
        step_row.name, step_row.decision_purpose, step_row.eligibility_mode,
        step_row.permission_key, step_row.role_key, step_row.named_user_id,
        step_row.authority_required, step_row.authority_max_amount, step_row.authority_currency,
        step_row.sod_forbid_requester, step_row.sod_forbid_subject_creator, step_row.sod_group,
        step_row.delegation_allowed AND vers.allow_delegation,
        step_row.reason_requirement, step_row.step_expires_after,
        CASE WHEN stage_row.stage_no = 1 THEN 'OPEN' ELSE 'WAITING' END,
        CASE WHEN stage_row.stage_no = 1 THEN now() END,
        CASE WHEN stage_row.stage_no = 1 AND step_row.step_expires_after IS NOT NULL
             THEN now() + step_row.step_expires_after END);
    END LOOP;
  END LOOP;

  /*
    NO_ELIGIBLE_APPROVER — §37.

    Um pedido cuja etapa não tem NENHUM aprovador possível nasceria travado, e
    travado é visualmente indistinguível de "em análise". Pior seria o remédio
    comum: cair no Admin. A §37 proíbe isso explicitamente, e por bom motivo —
    resolveria o impasse concedendo a decisão exatamente a quem a política não
    escolheu.

    A verificação já desconta a SoD do requerente, que é o caso real: uma etapa
    nomeada para quem está pedindo.
  */
  SELECT string_agg(s.step_key, ', ') INTO blocked
    FROM public.approval_request_steps s
   WHERE s.request_id = req_id
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles pr
        WHERE pr.organization_id = p_organization_id AND pr.status = 'active'
          AND NOT (s.sod_forbid_requester AND pr.user_id = actor)
          AND NOT (s.sod_forbid_subject_creator AND pr.user_id = subj.created_by)
          AND (
            (s.eligibility_mode = 'NAMED' AND pr.user_id = s.named_user_id)
         OR (s.eligibility_mode = 'ROLE' AND EXISTS (
               SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
                WHERE ur.user_id = pr.user_id AND ur.organization_id = p_organization_id
                  AND r.key = s.role_key))
         OR (s.eligibility_mode = 'PERMISSION' AND EXISTS (
               SELECT 1 FROM public.user_roles ur
                 JOIN public.role_permissions rp ON rp.role_id = ur.role_id
                 JOIN public.permissions pm ON pm.id = rp.permission_id
                WHERE ur.user_id = pr.user_id AND ur.organization_id = p_organization_id
                  AND pm.key = s.permission_key))));

  IF blocked IS NOT NULL THEN
    RAISE EXCEPTION
      'NO_ELIGIBLE_APPROVER: nenhuma pessoa elegível para a(s) etapa(s) "%". O pedido não foi criado.',
      blocked USING ERRCODE = 'check_violation';
  END IF;

  -- ---------- fatos, na MESMA transação ----------
  ev_id := public.emit_domain_event(
    p_organization_id, 'approval.request.created', 1, 'approval_request', req_id,
    'approval-request:' || req_id::text,
    jsonb_build_object('subject_type',p_subject_type,'subject_id',p_subject_id,
      'action_type',p_action_type,'decision_purpose',p_decision_purpose,
      'policy_key',pol.policy_key,'policy_version_no',vers.version_no,
      'policy_version_id',vers.id,'subject_fingerprint',subj.fingerprint),
    now(), CASE WHEN actor IS NULL THEN 'system' ELSE 'human' END, actor, corr, p_source_event_id);

  PERFORM public.emit_domain_event(
    p_organization_id, 'approval.stage.opened', 1, 'approval_request', req_id,
    format('approval-request:%s:stage:1', req_id),
    jsonb_build_object('stage_no',1,'request_stage_id',first_stage_id),
    now(), 'system', NULL, corr, ev_id);

  RETURN jsonb_build_object(
    'status','CREATED','request_id',req_id,'policy_version_id',vers.id,
    'policy_key',pol.policy_key,'policy_version_no',vers.version_no,
    'subject_fingerprint',subj.fingerprint,'correlation_id',corr,'event_id',ev_id);
END $$;

REVOKE ALL ON FUNCTION public.approval_request_create(uuid, text, uuid, text, text, text, jsonb, text, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approval_request_create(uuid, text, uuid, text, text, text, jsonb, text, uuid, uuid, uuid) TO authenticated;

COMMIT;

-- ============================================================
-- 127c — A DECISÃO ATÔMICA e o resto do ciclo de vida
-- (mesma migration 127)
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 5) Sucessão
-- ------------------------------------------------------------
-- O pedido antigo NÃO é apagado nem reescrito: ele para de ser decidível e
-- passa a apontar para quem o substituiu. Apagá-lo perderia a resposta para
-- "o que se tentou aprovar antes, e por que não valeu".
CREATE FUNCTION public.approval_request_supersede(
  p_request_id uuid, p_by_request_id uuid, p_correlation_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE req public.approval_requests%ROWTYPE;
BEGIN
  SELECT * INTO req FROM public.approval_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF req.status <> 'PENDING' THEN RETURN; END IF;

  UPDATE public.approval_request_steps
     SET status = 'CANCELLED'
   WHERE request_id = req.id AND status IN ('WAITING','OPEN');
  UPDATE public.approval_request_stages
     SET status = 'CANCELLED', closed_at = now()
   WHERE request_id = req.id AND status IN ('WAITING','OPEN');
  UPDATE public.approval_requests
     SET status = 'SUPERSEDED', finalized_at = now(), current_stage_no = NULL,
         outcome_reason = format('Substituído pelo pedido %s.', p_by_request_id)
   WHERE id = req.id;

  PERFORM public.emit_domain_event(
    req.organization_id, 'approval.request.superseded', 1, 'approval_request', req.id,
    format('approval-request:%s:superseded', req.id),
    jsonb_build_object('superseded_by_request_id', p_by_request_id),
    now(), 'system', NULL, COALESCE(p_correlation_id, req.correlation_id), NULL);
END $$;
REVOKE ALL ON FUNCTION public.approval_request_supersede(uuid, uuid, uuid) FROM PUBLIC;

-- ------------------------------------------------------------
-- 6) A DECISÃO — uma transação, uma função
-- ------------------------------------------------------------
CREATE FUNCTION public.approval_decide(
  p_request_step_id     uuid,
  p_decision            text,
  p_idempotency_key     text,
  p_reason              text DEFAULT NULL,
  p_delegation_id       uuid DEFAULT NULL,
  p_expected_fingerprint text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  st        public.approval_request_steps%ROWTYPE;
  stg       public.approval_request_stages%ROWTYPE;
  req       public.approval_requests%ROWTYPE;
  elig      record;
  subj      record;
  prior     public.approval_decisions%ROWTYPE;
  actor     uuid := auth.uid();
  dec_id    uuid;
  ev_id     uuid;
  approved_n integer;
  open_n     integer;
  next_stage public.approval_request_stages%ROWTYPE;
  final_status text;
BEGIN
  IF p_decision NOT IN ('APPROVED','REJECTED','RETURNED_FOR_CORRECTION') THEN
    RAISE EXCEPTION 'Decisão inválida: %.', p_decision USING ERRCODE = 'check_violation';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Decisão exige chave de idempotência.' USING ERRCODE = 'check_violation';
  END IF;
  /*
    O ATOR não é parâmetro. Vem de auth.uid(), aqui. Um `p_approved_by` na
    assinatura seria o bastante para que o navegador aprovasse em nome de
    terceiro, e nenhuma verificação posterior consertaria isso (§36).
  */
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Decisão exige identidade autenticada. Sistema e IA não decidem.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO st FROM public.approval_request_steps WHERE id = p_request_step_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Etapa inexistente.' USING ERRCODE = 'no_data_found';
  END IF;

  -- Inquilino do chamador confrontado com o do PEDIDO, não com o informado.
  IF current_user IN ('authenticated','anon')
     AND public.current_user_organization_id() IS DISTINCT FROM st.organization_id THEN
    RAISE EXCEPTION 'Etapa inexistente.' USING ERRCODE = 'no_data_found';
  END IF;

  /*
    O TRAVÃO. Toda decisão sobre um mesmo pedido passa por esta linha, em fila.

    É isto — e não o estado do botão, nem uma verificação lida antes de
    escrever — que impede duas aprovações simultâneas de fecharem o quórum
    duas vezes, ou uma aprovação e uma rejeição concorrentes de finalizarem o
    pedido em dois desfechos. Decisões em etapas DIFERENTES continuam ambas
    válidas: elas serializam, não se anulam.
  */
  SELECT * INTO req FROM public.approval_requests WHERE id = st.request_id FOR UPDATE;

  -- ---------- idempotência, DEPOIS do travão ----------
  -- Antes do travão, duas retentativas simultâneas passariam as duas pela
  -- verificação e só a segunda quebraria na restrição única — com erro de
  -- banco em vez de resposta idempotente.
  SELECT * INTO prior FROM public.approval_decisions
   WHERE organization_id = st.organization_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF prior.request_step_id = p_request_step_id
       AND prior.decision = p_decision
       AND prior.reason IS NOT DISTINCT FROM p_reason THEN
      SELECT * INTO req FROM public.approval_requests WHERE id = prior.request_id;
      RETURN jsonb_build_object('status','IDEMPOTENT_REPLAY','decision_id',prior.id,
        'request_id',prior.request_id,'request_status',req.status,'decision',prior.decision);
    END IF;
    -- Mesma chave, significado diferente. Aceitar seria fazer a segunda
    -- decisão desaparecer em silêncio (§23).
    RAISE EXCEPTION
      'Chave de idempotência % já foi usada com outra decisão neste inquilino.', p_idempotency_key
      USING ERRCODE = 'unique_violation';
  END IF;

  -- ---------- o pedido ainda aceita decisão? ----------
  IF req.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Pedido já está em %; não aceita nova decisão.', req.status
      USING ERRCODE = 'check_violation';
  END IF;

  /*
    EXPIRAÇÃO conferida AQUI, não só pelo agendador.

    Se a validade dependesse do trabalhador ter rodado, um atraso de dez
    minutos na fila viraria dez minutos de autoridade extra. A §25 é explícita:
    o atraso do agendador não pode alterar a semântica efetiva do prazo. O
    trabalhador só materializa o que este teste já considera verdade.
  */
  IF req.expires_at IS NOT NULL AND req.expires_at <= now() THEN
    -- Só a recusa. Gravar aqui a mudança para EXPIRED seria inútil: o RAISE
    -- logo abaixo desfaz a transação inteira, e a escrita iria junto. Quem
    -- materializa a projeção é `approval_requests_expire_due`; quem garante a
    -- SEMÂNTICA é esta recusa, que não espera pelo agendador.
    RAISE EXCEPTION 'Pedido expirado em %; não aceita decisão.', req.expires_at
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO st  FROM public.approval_request_steps  WHERE id = p_request_step_id FOR UPDATE;
  SELECT * INTO stg FROM public.approval_request_stages WHERE id = st.request_stage_id FOR UPDATE;

  IF st.status = 'WAITING' THEN
    RAISE EXCEPTION
      'Ordem de aprovação: a etapa "%" está no estágio % e o pedido está no estágio %.',
      st.step_key, st.stage_no, req.current_stage_no USING ERRCODE = 'check_violation';
  END IF;
  IF st.status <> 'OPEN' THEN
    RAISE EXCEPTION 'A etapa "%" já está em % e não decide de novo.', st.step_key, st.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF st.expires_at IS NOT NULL AND st.expires_at <= now() THEN
    RAISE EXCEPTION 'A etapa "%" expirou em %.', st.step_key, st.expires_at
      USING ERRCODE = 'check_violation';
  END IF;

  /*
    IMPRESSÃO DIGITAL — §26.

    Recalculada agora, do objeto vivo, e comparada com a que o pedido
    congelou. Sem isto, alterar o valor do contrato depois de aberto o pedido
    faria a aprovação de ontem autorizar o conteúdo de hoje — que é a
    substituição silenciosa de objeto que a fase inteira existe para impedir.
  */
  SELECT * INTO subj FROM public.approval_subject_resolve(
    req.organization_id, req.subject_type, req.subject_id);

  IF NOT subj.found THEN
    RAISE EXCEPTION 'O objeto do pedido não existe mais; a decisão fica sem sujeito.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF subj.fingerprint IS DISTINCT FROM req.subject_fingerprint THEN
    RAISE EXCEPTION
      'SUBJECT_CHANGED: o objeto mudou depois que este pedido foi aberto. Abra um pedido novo para o conteúdo atual.'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Trava opcional do chamador: o cliente afirma o que ACHA que está decidindo.
  IF p_expected_fingerprint IS NOT NULL AND p_expected_fingerprint <> req.subject_fingerprint THEN
    RAISE EXCEPTION 'SUBJECT_CHANGED: a tela decidia outro conteúdo.' USING ERRCODE = 'check_violation';
  END IF;

  -- ---------- elegibilidade, SoD, alçada, delegação ----------
  -- Reavaliadas AGORA (§19), não na abertura do pedido: papel revogado,
  -- delegação expirada e limite alterado valem no instante da decisão.
  SELECT * INTO elig FROM public.approval_step_eligibility(p_request_step_id, actor, p_delegation_id);
  IF NOT elig.eligible THEN
    RAISE EXCEPTION '%: %', elig.code, COALESCE(elig.detail, 'Ator não elegível para esta etapa.')
      USING ERRCODE = '42501';
  END IF;

  -- ---------- justificativa ----------
  IF st.reason_requirement = 'REQUIRED_ALWAYS' AND COALESCE(btrim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'A etapa "%" exige justificativa.', st.step_key USING ERRCODE = 'check_violation';
  END IF;
  IF st.reason_requirement = 'REQUIRED_ON_NEGATIVE'
     AND p_decision <> 'APPROVED' AND COALESCE(btrim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'Rejeitar ou devolver a etapa "%" exige justificativa.', st.step_key
      USING ERRCODE = 'check_violation';
  END IF;

  -- ---------- a decisão, imutável ----------
  INSERT INTO public.approval_decisions (
    organization_id, request_id, request_step_id, step_key, stage_no,
    decision, decision_purpose, reason, actor_user_id, on_behalf_of_user_id,
    delegation_id, actor_source, authority_source, authority_basis,
    authority_limit_amount, authority_currency, subject_amount, subject_currency,
    subject_fingerprint, idempotency_key)
  VALUES (
    st.organization_id, st.request_id, st.id, st.step_key, st.stage_no,
    p_decision, st.decision_purpose, NULLIF(btrim(COALESCE(p_reason,'')),''), actor, elig.on_behalf_of,
    p_delegation_id, 'human', elig.authority_source, elig.authority_basis,
    elig.authority_limit, elig.authority_currency, req.subject_amount, req.subject_currency,
    req.subject_fingerprint, p_idempotency_key)
  RETURNING id INTO dec_id;

  -- ---------- projeção da etapa ----------
  UPDATE public.approval_request_steps
     SET status = CASE p_decision WHEN 'APPROVED' THEN 'APPROVED'
                                  WHEN 'REJECTED' THEN 'REJECTED' ELSE 'RETURNED' END,
         decided_at = now(), decided_by = actor
   WHERE id = st.id;

  ev_id := public.emit_domain_event(
    req.organization_id, 'approval.decision.recorded', 1, 'approval_request', req.id,
    'approval-decision:' || dec_id::text,
    jsonb_build_object('decision_id',dec_id,'step_key',st.step_key,'stage_no',st.stage_no,
      'decision',p_decision,'decision_purpose',st.decision_purpose,
      'authority_source',elig.authority_source,'delegated',(p_delegation_id IS NOT NULL)),
    now(), 'human', actor, req.correlation_id, NULL);

  -- ---------- progressão ----------
  IF p_decision = 'APPROVED' THEN
    SELECT count(*) FILTER (WHERE status = 'APPROVED'),
           count(*) FILTER (WHERE status IN ('WAITING','OPEN'))
      INTO approved_n, open_n
      FROM public.approval_request_steps WHERE request_stage_id = stg.id;

    IF approved_n >= stg.quorum_required THEN
      -- Quórum atingido. As etapas restantes do estágio ficam SKIPPED — e
      -- isso é diferente de "pulada por falta de aprovador", que a §15 proíbe:
      -- aqui a regra do estágio JÁ foi satisfeita pelo número declarado.
      UPDATE public.approval_request_steps SET status = 'SKIPPED'
       WHERE request_stage_id = stg.id AND status IN ('WAITING','OPEN');
      UPDATE public.approval_request_stages SET status = 'APPROVED', closed_at = now()
       WHERE id = stg.id;

      SELECT * INTO next_stage FROM public.approval_request_stages
       WHERE request_id = req.id AND stage_no > stg.stage_no AND status = 'WAITING'
       ORDER BY stage_no LIMIT 1;

      IF FOUND THEN
        UPDATE public.approval_request_stages SET status = 'OPEN', opened_at = now()
         WHERE id = next_stage.id;
        UPDATE public.approval_request_steps
           SET status = 'OPEN', opened_at = now(),
               expires_at = CASE WHEN step_expires_after IS NOT NULL THEN now() + step_expires_after END
         WHERE request_stage_id = next_stage.id AND status = 'WAITING';
        UPDATE public.approval_requests SET current_stage_no = next_stage.stage_no WHERE id = req.id;

        PERFORM public.emit_domain_event(
          req.organization_id, 'approval.stage.opened', 1, 'approval_request', req.id,
          format('approval-request:%s:stage:%s', req.id, next_stage.stage_no),
          jsonb_build_object('stage_no',next_stage.stage_no,'request_stage_id',next_stage.id),
          now(), 'system', NULL, req.correlation_id, ev_id);
      ELSE
        final_status := 'APPROVED';
      END IF;
    END IF;

  ELSIF p_decision = 'REJECTED' THEN
    final_status := 'REJECTED';
  ELSE
    final_status := 'RETURNED_FOR_CORRECTION';
  END IF;

  -- ---------- finalização ----------
  IF final_status IS NOT NULL THEN
    UPDATE public.approval_request_steps SET status = 'CANCELLED'
     WHERE request_id = req.id AND status IN ('WAITING','OPEN');
    UPDATE public.approval_request_stages
       SET status = CASE WHEN final_status = 'APPROVED' THEN 'APPROVED'
                         WHEN final_status = 'REJECTED' THEN 'REJECTED' ELSE 'RETURNED' END,
           closed_at = now()
     WHERE id = stg.id;
    UPDATE public.approval_request_stages SET status = 'CANCELLED', closed_at = now()
     WHERE request_id = req.id AND status IN ('WAITING','OPEN');
    UPDATE public.approval_requests
       SET status = final_status, finalized_at = now(), finalized_by = actor,
           current_stage_no = NULL, outcome_reason = NULLIF(btrim(COALESCE(p_reason,'')),'')
     WHERE id = req.id;

    /*
      O desfecho é um FATO, e para aqui.

      APPROVED significa que a decisão foi tomada — não que a execução a
      jusante deu certo (§30). Quem reage a este evento reage por trabalho
      durável, e um fracasso lá NÃO devolve este pedido para PENDING.
    */
    PERFORM public.emit_domain_event(
      req.organization_id,
      CASE final_status
        WHEN 'APPROVED' THEN 'approval.request.approved'
        WHEN 'REJECTED' THEN 'approval.request.rejected'
        ELSE 'approval.request.returned_for_correction' END,
      1, 'approval_request', req.id,
      format('approval-request:%s:%s', req.id, lower(final_status)),
      jsonb_build_object('subject_type',req.subject_type,'subject_id',req.subject_id,
        'action_type',req.action_type,'decision_purpose',req.decision_purpose,
        'policy_key',req.policy_key,'policy_version_no',req.policy_version_no,
        'subject_fingerprint',req.subject_fingerprint,
        'downstream_execution','not_started'),
      now(), 'human', actor, req.correlation_id, ev_id);
  END IF;

  SELECT * INTO req FROM public.approval_requests WHERE id = req.id;

  RETURN jsonb_build_object(
    'status','RECORDED','decision_id',dec_id,'decision',p_decision,
    'request_id',req.id,'request_status',req.status,'current_stage_no',req.current_stage_no,
    'authority_source',elig.authority_source,'authority_basis',elig.authority_basis,
    'delegated',(p_delegation_id IS NOT NULL),'event_id',ev_id);
END $$;

REVOKE ALL ON FUNCTION public.approval_decide(uuid, text, text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approval_decide(uuid, text, text, text, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.approval_decide(uuid, text, text, text, uuid, text) IS
  'A decisão inteira em UMA transação: travar, validar, revalidar '
  'elegibilidade/SoD/alçada/delegação, conferir impressão digital, gravar a '
  'decisão imutável, apurar quórum, progredir, finalizar e emitir o fato. '
  'O ator vem de auth.uid() e nunca de parâmetro.';

-- ------------------------------------------------------------
-- 7) Cancelamento
-- ------------------------------------------------------------
CREATE FUNCTION public.approval_request_cancel(p_request_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE req public.approval_requests%ROWTYPE; actor uuid := auth.uid();
BEGIN
  IF COALESCE(btrim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'Cancelar um pedido exige motivo.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO req FROM public.approval_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido inexistente.' USING ERRCODE = 'no_data_found'; END IF;

  IF current_user IN ('authenticated','anon') THEN
    IF public.current_user_organization_id() IS DISTINCT FROM req.organization_id THEN
      RAISE EXCEPTION 'Pedido inexistente.' USING ERRCODE = 'no_data_found';
    END IF;
    -- Quem pediu pode desistir; quem administra o motor pode encerrar. Ninguém
    -- mais — cancelar é retirar da governança uma decisão que estava em curso.
    IF NOT (req.requested_by = actor
            OR public.current_user_has_permission('approvals.admin')
            OR public.current_user_is_admin()) THEN
      RAISE EXCEPTION 'Cancelamento negado.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Depois de finalizado não se cancela (§25): o desfecho já é história.
  IF req.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Pedido já está em % e não pode ser cancelado.', req.status
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.approval_request_steps SET status = 'CANCELLED'
   WHERE request_id = req.id AND status IN ('WAITING','OPEN');
  UPDATE public.approval_request_stages SET status = 'CANCELLED', closed_at = now()
   WHERE request_id = req.id AND status IN ('WAITING','OPEN');
  -- Nada é APAGADO. As decisões já tomadas continuam onde estavam.
  UPDATE public.approval_requests
     SET status = 'CANCELLED', finalized_at = now(), finalized_by = actor,
         current_stage_no = NULL, outcome_reason = btrim(p_reason)
   WHERE id = req.id;

  PERFORM public.emit_domain_event(
    req.organization_id, 'approval.request.cancelled', 1, 'approval_request', req.id,
    format('approval-request:%s:cancelled', req.id),
    jsonb_build_object('reason', btrim(p_reason)),
    now(), 'human', actor, req.correlation_id, NULL);

  RETURN jsonb_build_object('status','CANCELLED','request_id',req.id);
END $$;
REVOKE ALL ON FUNCTION public.approval_request_cancel(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approval_request_cancel(uuid, text) TO authenticated;

-- ------------------------------------------------------------
-- 8) Expiração
-- ------------------------------------------------------------
-- Expirar NÃO é rejeitar (§25). Rejeitado é um parecer; expirado é a ausência
-- de parecer dentro do prazo. Relatar um como o outro mentiria sobre o que a
-- organização decidiu.
CREATE FUNCTION public.approval_request_expire(p_request_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE req public.approval_requests%ROWTYPE;
BEGIN
  SELECT * INTO req FROM public.approval_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR req.status <> 'PENDING' THEN RETURN false; END IF;
  IF req.expires_at IS NULL OR req.expires_at > now() THEN RETURN false; END IF;

  UPDATE public.approval_request_steps SET status = 'EXPIRED'
   WHERE request_id = req.id AND status IN ('WAITING','OPEN');
  UPDATE public.approval_request_stages SET status = 'EXPIRED', closed_at = now()
   WHERE request_id = req.id AND status IN ('WAITING','OPEN');
  UPDATE public.approval_requests
     SET status = 'EXPIRED', finalized_at = now(), current_stage_no = NULL,
         outcome_reason = format('Prazo esgotado em %s.', req.expires_at)
   WHERE id = req.id;

  PERFORM public.emit_domain_event(
    req.organization_id, 'approval.request.expired', 1, 'approval_request', req.id,
    format('approval-request:%s:expired', req.id),
    jsonb_build_object('expires_at', req.expires_at),
    -- `occurred_at` é o VENCIMENTO, não a hora em que o trabalhador acordou.
    -- É a mesma distinção que a 119 desenhou entre occurred_at e recorded_at.
    req.expires_at, 'system', NULL, req.correlation_id, NULL);

  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.approval_request_expire(uuid) FROM PUBLIC;

-- Varredura em lote, chamada pelo trabalho `platform.approvals.expire`.
CREATE FUNCTION public.approval_requests_expire_due(p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record; n integer := 0;
BEGIN
  IF p_limit IS NULL OR p_limit <= 0 THEN
    -- A lição da 124: LIMIT NULL é "sem limite" no Postgres, e uma guarda que
    -- deixa NULL passar não é guarda.
    RAISE EXCEPTION 'Limite de expiração inválido.' USING ERRCODE = 'check_violation';
  END IF;
  FOR r IN SELECT id FROM public.approval_requests
            WHERE status = 'PENDING' AND expires_at IS NOT NULL AND expires_at <= now()
            ORDER BY expires_at LIMIT p_limit
  LOOP
    IF public.approval_request_expire(r.id) THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.approval_requests_expire_due(integer) FROM PUBLIC;

COMMIT;
