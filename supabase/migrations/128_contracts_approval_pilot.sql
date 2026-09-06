-- ============================================================
-- CONTRATOS — piloto do Motor de Aprovação, compatibilidade e fronteira de corte
-- Migration: 128_contracts_approval_pilot
--
-- ─── O que esta migration FAZ ──────────────────────────────────────────────
--
--   · registra `contract` e `contract_amendment_revision` como sujeitos que o
--     motor sabe ler, com impressão digital de conteúdo real;
--   · cria a fronteira de CORTE, que garante que uma ação de contrato nunca
--     esteja viva em dois motores ao mesmo tempo;
--   · expõe a história legada de `contract_approvals` como LEGADO declarado;
--   · publica o modelo de leitura canônico.
--
-- ─── O que esta migration NÃO FAZ, e por quê ───────────────────────────────
--
-- Não cria política de aprovação nenhuma na organização real, e não liga o
-- corte. A auditoria da Fase 5 encontrou o seguinte, e é ele que manda:
--
--   · `contract_approvals` tem TRÊS linhas, todas do MESMO contrato, e esse
--     contrato é `data_class = 'demo'` ([QA] Contrato de Serviços). Não existe
--     uma única aprovação de contrato REAL no banco.
--   · A única regra autoritativa provável é estrutural: o vocabulário de
--     etapas (juridico, financeiro, comite, diretoria), a ordem entre elas
--     (`contract_approval_step_order`) e a segregação de funções da Fase 0
--     (quem cadastrou o contrato não decide).
--   · Não existe, em lugar nenhum do repositório ou do banco, alçada,
--     limite por valor, quórum, delegação ou aprovador nomeado. Nenhuma linha,
--     nenhuma constante, nenhum documento.
--
-- A §34 do plano diz o que fazer com isso: completar a infraestrutura,
-- validar com política descartável, e PARAR antes de declarar corte real.
-- Semear "Jurídico aprova até R$ 100.000" seria inventar governança — e uma
-- alçada inventada é indistinguível de uma alçada real depois que alguém a
-- aprova por cima. Por isso aqui há MECANISMO e nenhuma REGRA DE NEGÓCIO.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1) Impressão digital de contrato
-- ------------------------------------------------------------
/*
  O que entra na impressão é o que, se mudar, invalida a aprovação: o dinheiro,
  o prazo, a contraparte, o tipo, o objeto e o estado do contrato.

  O que NÃO entra: `updated_at`, `health_score`, `lifecycle_stage` e qualquer
  coisa que se mexa sozinha. Incluí-los faria toda releitura de página
  invalidar a aprovação em curso, e o efeito prático seria as pessoas
  aprenderem a ignorar o aviso de "objeto mudou" — que é pior do que não ter
  o aviso.

  A concatenação usa separador e marcador explícito de NULO. Sem isso,
  ('AB', NULL) e ('A', 'B') produziriam o mesmo texto, e duas versões
  diferentes do contrato teriam a mesma impressão.
*/
CREATE FUNCTION public.contract_approval_fingerprint(p_contract_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
  SELECT encode(extensions.digest(concat_ws('|',
    'contract.v1',
    c.id::text,
    COALESCE(c.contract_number,        '∅'),
    COALESCE(c.title,                  '∅'),
    COALESCE(c.contract_type,          '∅'),
    COALESCE(c.status,                 '∅'),
    COALESCE(c.currency,               '∅'),
    COALESCE(c.total_value::text,      '∅'),
    COALESCE(c.monthly_value::text,    '∅'),
    COALESCE(c.start_date::text,       '∅'),
    COALESCE(c.end_date::text,         '∅'),
    COALESCE(c.signed_date::text,      '∅'),
    COALESCE(c.counterparty_name,      '∅'),
    COALESCE(c.counterparty_party_id::text, '∅'),
    COALESCE(c.payment_terms,          '∅'),
    COALESCE(c.scope_summary,          '∅'),
    COALESCE(c.risk_level,             '∅'),
    -- O aditivo mais recente faz parte do conteúdo do contrato: aprovar o
    -- contrato de ontem não pode autorizar o contrato já aditado de hoje.
    COALESCE((SELECT max(r.revision)::text FROM public.contract_amendment_revisions r
               WHERE r.contract_id = c.id), '0')
  )::bytea, 'sha256'), 'hex')
  FROM public.contracts c
  WHERE c.id = p_contract_id AND c.deleted_at IS NULL
$$;
REVOKE ALL ON FUNCTION public.contract_approval_fingerprint(uuid) FROM PUBLIC;

COMMENT ON FUNCTION public.contract_approval_fingerprint(uuid) IS
  'Impressão digital do CONTEÚDO do contrato. Inclui dinheiro, prazo, '
  'contraparte, objeto, estado e a revisão de aditivo mais recente. NÃO '
  'inclui updated_at nem health_score: se mudasse sozinha, o aviso de '
  '"objeto alterado" viraria ruído e as pessoas aprenderiam a ignorá-lo.';

-- ------------------------------------------------------------
-- 2) O adaptador de sujeito, agora com Contratos registrado
-- ------------------------------------------------------------
-- CREATE OR REPLACE da função declarada na 127. A assinatura e as colunas de
-- retorno são exatamente as mesmas; o que muda é que agora há dois casos.
CREATE OR REPLACE FUNCTION public.approval_subject_resolve(
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
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  c   public.contracts%ROWTYPE;
  rev public.contract_amendment_revisions%ROWTYPE;
BEGIN
  /*
    CASE explícito, um domínio por ramo. Não há despacho por nome de função
    guardado em tabela: isso permitiria a quem escreve a linha escolher o
    código que roda (§65). Registrar um domínio novo é uma migration.
  */
  IF p_subject_type = 'contract' THEN
    SELECT * INTO c FROM public.contracts
     WHERE id = p_subject_id AND organization_id = p_organization_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RETURN QUERY SELECT true, false, NULL::text, NULL::numeric, NULL::text, NULL::text,
                          NULL::uuid, 'contracts'::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
      RETURN;
    END IF;
    RETURN QUERY SELECT
      true, true,
      public.contract_approval_fingerprint(c.id),
      c.total_value,
      -- Valor sem moeda declarada é valor DESCONHECIDO para efeito de alçada:
      -- a 126 exige moeda junto do valor, e comparar número puro contra um
      -- limite em BRL seria inventar a moeda.
      CASE WHEN c.currency IS NOT NULL AND c.currency ~ '^[A-Z]{3}$' THEN c.currency END,
      COALESCE(c.contract_number || ' — ', '') || COALESCE(c.title, 'Contrato'),
      c.created_by,
      'contracts'::text,
      c.contract_type,
      c.risk_level,
      NULL::uuid, NULL::uuid;
    RETURN;

  ELSIF p_subject_type = 'contract_amendment_revision' THEN
    -- A §26 pede a REVISÃO EXATA do aditivo, não o contêiner mutável. A
    -- revisão é imutável por natureza (a 108 a grava como instantâneo), então
    -- a impressão digital dela é o próprio par (id, revisão).
    SELECT * INTO rev FROM public.contract_amendment_revisions
     WHERE id = p_subject_id AND organization_id = p_organization_id;
    IF NOT FOUND THEN
      RETURN QUERY SELECT true, false, NULL::text, NULL::numeric, NULL::text, NULL::text,
                          NULL::uuid, 'contracts'::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
      RETURN;
    END IF;
    SELECT * INTO c FROM public.contracts WHERE id = rev.contract_id;
    RETURN QUERY SELECT
      true, true,
      encode(extensions.digest(concat_ws('|', 'contract_amendment_revision.v1',
        rev.id::text, rev.revision::text, rev.amendment_id::text,
        md5(COALESCE(rev.amendment_snapshot, '{}'::jsonb)::text))::bytea, 'sha256'), 'hex'),
      NULLIF(rev.amendment_snapshot->>'value_delta','')::numeric,
      CASE WHEN c.currency ~ '^[A-Z]{3}$' THEN c.currency END,
      format('Aditivo rev. %s — %s', rev.revision, COALESCE(c.contract_number, c.title, 'contrato')),
      NULL::uuid,
      'contracts'::text, c.contract_type, c.risk_level, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  -- Tipo não registrado. `supported = false` e nada mais: o motor não inventa
  -- impressão digital para um objeto que não sabe ler.
  RETURN QUERY SELECT false, false, NULL::text, NULL::numeric, NULL::text, NULL::text,
                      NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
END $$;

-- ------------------------------------------------------------
-- 3) A fronteira de CORTE — garantia de UM motor de escrita
-- ------------------------------------------------------------
/*
  A §32 exige uma fronteira explícita e a §60 exige provar que uma ação de
  negócio não pode estar ativa nos dois motores. Esta tabela é essa fronteira, e
  ela é uma DECISÃO REGISTRADA, não uma variável de ambiente: quem cortou,
  quando, e sob que justificativa fica gravado.

  Enquanto NÃO houver linha aqui, nada muda: o caminho legado continua
  escrevendo normalmente e o motor compartilhado recusa criar pedido para a
  mesma ação. Havendo linha, os papéis se invertem — e nunca há um instante em
  que os dois escrevam.
*/
CREATE TABLE public.approval_engine_cutover (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  business_domain  text NOT NULL,
  subject_type     text NOT NULL,
  action_type      text NOT NULL,
  cut_over_at      timestamptz NOT NULL DEFAULT now(),
  enabled_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  justification    text NOT NULL CHECK (btrim(justification) <> ''),
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT aec_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT aec_unique UNIQUE (organization_id, subject_type, action_type)
);

COMMENT ON TABLE public.approval_engine_cutover IS
  'Fronteira de corte por (inquilino, sujeito, ação). SEM linha: escreve o '
  'motor legado do domínio e o compartilhado recusa. COM linha: o inverso. '
  'Nunca os dois. Tabela VAZIA nesta migration — o corte de Contratos está '
  'bloqueado por falta de regra real provada (§34, §63).';

ALTER TABLE public.approval_engine_cutover ENABLE ROW LEVEL SECURITY;
CREATE POLICY approval_engine_cutover_select ON public.approval_engine_cutover FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id());
GRANT SELECT ON public.approval_engine_cutover TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.approval_engine_cutover FROM authenticated, anon;
REVOKE ALL ON public.approval_engine_cutover FROM anon;

CREATE FUNCTION public.approval_is_cut_over(p_organization_id uuid, p_subject_type text, p_action_type text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.approval_engine_cutover
                  WHERE organization_id = p_organization_id
                    AND subject_type = p_subject_type AND action_type = p_action_type
                    AND cut_over_at <= now())
$$;

-- ---- lado LEGADO da fronteira ----
-- Depois do corte, nenhuma linha nova entra em `contract_approvals`. A história
-- que já está lá continua legível e intocada — o gatilho barra INSERT e UPDATE,
-- nunca SELECT, e nunca apaga nada.
CREATE FUNCTION public.contract_approvals_reject_after_cutover() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF public.approval_is_cut_over(NEW.organization_id, 'contract', 'approve') THEN
    RAISE EXCEPTION
      'Aprovação de contrato migrou para o Motor de Aprovação da Plataforma. '
      'Esta tabela ficou somente-leitura em %; use approval_request_create / approval_decide.',
      (SELECT cut_over_at FROM public.approval_engine_cutover
        WHERE organization_id = NEW.organization_id AND subject_type = 'contract' AND action_type = 'approve')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contract_approvals_reject_after_cutover() FROM PUBLIC;

CREATE TRIGGER trg_contract_approvals_cutover
  BEFORE INSERT OR UPDATE ON public.contract_approvals
  FOR EACH ROW EXECUTE FUNCTION public.contract_approvals_reject_after_cutover();

-- ---- lado NOVO da fronteira ----
-- Antes do corte o motor compartilhado recusa criar pedido para a mesma ação
-- que o legado ainda governa. É a metade que impede o pior caso: os dois
-- motores abertos ao mesmo tempo sobre o mesmo contrato.
CREATE FUNCTION public.approval_requests_guard_cutover() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.subject_type = 'contract' AND NEW.action_type = 'approve'
     AND NOT public.approval_is_cut_over(NEW.organization_id, 'contract', 'approve') THEN
    RAISE EXCEPTION
      'NOT_CUT_OVER: a aprovação de contrato ainda é governada por contract_approvals nesta organização. '
      'Registre a fronteira em approval_engine_cutover antes de abrir pedidos no motor compartilhado.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.approval_requests_guard_cutover() FROM PUBLIC;

CREATE TRIGGER trg_approval_requests_cutover
  BEFORE INSERT ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.approval_requests_guard_cutover();

-- ------------------------------------------------------------
-- 4) História legada, declarada como legado
-- ------------------------------------------------------------
/*
  A §33 proíbe fabricar proveniência. Estas três linhas não têm política, não
  têm versão, não têm alçada, não têm requerente e não têm base de autoridade,
  porque essas colunas nunca existiram na tabela — e não porque se perderam.

  A visão devolve NULL nesses campos e diz `provenance = 'LEGACY_CONTRACT_APPROVALS'`.
  Preencher com uma política sintética faria a tela mostrar governança que
  ninguém exerceu, que é exatamente o que a §43 chama de transformar ausência
  em afirmação.

  `reviewer_user_id` é quem estava designado E quem decidiu: a tabela legada
  usa uma coluna só para os dois papéis, e a visão não finge que são duas.
*/
CREATE VIEW public.contract_approvals_legacy_history
WITH (security_invoker = true) AS
SELECT
  a.id                                 AS legacy_id,
  a.organization_id,
  a.contract_id,
  a.step_name                          AS step_key,
  array_position(public.contract_approval_step_order(), a.step_name) AS step_order,
  a.status                             AS legacy_status,
  a.reviewer_user_id,
  a.comments,
  a.rejection_reason,
  a.requested_changes_note,
  a.deadline_date,
  a.started_at,
  a.completed_at,
  a.approval_timestamp,
  a.created_at,
  a.updated_at,
  'LEGACY_CONTRACT_APPROVALS'::text    AS provenance,
  -- Campos que o motor compartilhado tem e o legado NUNCA teve. NULL aqui é
  -- uma afirmação verdadeira: "não foi registrado".
  NULL::uuid   AS policy_version_id,
  NULL::text   AS policy_key,
  NULL::integer AS policy_version_no,
  NULL::uuid   AS requested_by,
  NULL::text   AS authority_source,
  NULL::text   AS authority_basis,
  NULL::text   AS subject_fingerprint,
  NULL::uuid   AS delegation_id
FROM public.contract_approvals a;

COMMENT ON VIEW public.contract_approvals_legacy_history IS
  'História LEGADA de aprovação de contrato, exposta como legado. Os campos '
  'do motor compartilhado vêm NULL porque nunca foram registrados — e NULL '
  'aqui é a verdade, não uma lacuna a preencher (§33).';

GRANT SELECT ON public.contract_approvals_legacy_history TO authenticated;

-- ------------------------------------------------------------
-- 5) Modelo de leitura canônico
-- ------------------------------------------------------------
-- UMA visão que responde o que a §41 pede. Existir uma só evita que a tela, o
-- PDF e o relatório contem três histórias diferentes do mesmo pedido.
CREATE VIEW public.approval_request_read_model
WITH (security_invoker = true) AS
SELECT
  r.id AS request_id, r.organization_id,
  r.policy_key, r.policy_version_no, r.policy_version_id,
  r.subject_type, r.subject_id, r.subject_label, r.subject_amount, r.subject_currency,
  r.subject_fingerprint, r.action_type, r.decision_purpose,
  r.requested_by, r.requested_at, r.request_reason,
  r.status, r.current_stage_no, r.expires_at, r.finalized_at, r.outcome_reason,
  r.supersedes_request_id, r.correlation_id, r.source_event_id,
  'SHARED_ENGINE'::text AS provenance,
  -- Idade em horas do pedido em aberto: a §42 pede que "há quanto tempo" seja
  -- visível sem que a tela precise calcular por conta própria.
  CASE WHEN r.status = 'PENDING'
       THEN round(EXTRACT(epoch FROM (now() - r.requested_at)) / 3600.0, 1) END AS open_hours,
  (SELECT jsonb_agg(jsonb_build_object(
            'stage_no', g.stage_no, 'name', g.name, 'status', g.status,
            'quorum_required', g.quorum_required, 'opened_at', g.opened_at, 'closed_at', g.closed_at,
            'approved_count', (SELECT count(*) FROM public.approval_request_steps s
                                WHERE s.request_stage_id = g.id AND s.status = 'APPROVED'))
          ORDER BY g.stage_no)
     FROM public.approval_request_stages g WHERE g.request_id = r.id) AS stages,
  (SELECT jsonb_agg(jsonb_build_object(
            'step_id', s.id, 'step_key', s.step_key, 'name', s.name, 'stage_no', s.stage_no,
            'status', s.status, 'decision_purpose', s.decision_purpose,
            'eligibility_mode', s.eligibility_mode, 'permission_key', s.permission_key,
            'role_key', s.role_key, 'named_user_id', s.named_user_id,
            'authority_required', s.authority_required,
            'authority_max_amount', s.authority_max_amount, 'authority_currency', s.authority_currency,
            'sod_group', s.sod_group, 'delegation_allowed', s.delegation_allowed,
            'reason_requirement', s.reason_requirement,
            'opened_at', s.opened_at, 'expires_at', s.expires_at,
            'decided_at', s.decided_at, 'decided_by', s.decided_by)
          ORDER BY s.stage_no, s.step_key)
     FROM public.approval_request_steps s WHERE s.request_id = r.id) AS steps,
  (SELECT jsonb_agg(jsonb_build_object(
            'decision_id', d.id, 'step_key', d.step_key, 'stage_no', d.stage_no,
            'decision', d.decision, 'decision_purpose', d.decision_purpose, 'reason', d.reason,
            'actor_user_id', d.actor_user_id, 'on_behalf_of_user_id', d.on_behalf_of_user_id,
            'delegation_id', d.delegation_id,
            'authority_source', d.authority_source, 'authority_basis', d.authority_basis,
            'authority_limit_amount', d.authority_limit_amount, 'authority_currency', d.authority_currency,
            'decided_at', d.decided_at)
          ORDER BY d.decided_at)
     FROM public.approval_decisions d WHERE d.request_id = r.id) AS decisions
FROM public.approval_requests r;

COMMENT ON VIEW public.approval_request_read_model IS
  'Modelo de leitura CANÔNICO do pedido: política/versão, sujeito, estágios, '
  'etapas, decisões e proveniência. Uma fonte só — três consultas diferentes '
  'para a mesma pergunta divergiriam, e a divergência apareceria no PDF.';

GRANT SELECT ON public.approval_request_read_model TO authenticated;

-- A elegibilidade do ESPECTADOR não entra na visão: ela depende de quem
-- pergunta, e uma visão não recebe parâmetro. A tela chama
-- `approval_step_eligibility_for_viewer` (127), que já é concedida lá.

COMMIT;
