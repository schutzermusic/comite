-- ============================================================
-- PLATAFORMA — Motor de Aprovação: PEDIDO, ESTÁGIO/ETAPA INSTANCIADOS, DECISÃO
-- Migration: 126_platform_approval_requests
--
-- ─── A invariante desta migration ──────────────────────────────────────────
--
--   O pedido NÃO consulta a política em tempo de decisão. Ele carrega uma
--   CÓPIA GOVERNADA do plano de etapas, tirada no instante da criação.
--
-- Sem essa cópia, editar a política mudaria a rota de um pedido que já estava
-- em curso — e a etapa que ninguém decidiu passaria a existir (ou a sumir)
-- retroativamente. A cópia é o que faz "resolve-se sob a v1" ser verdade
-- mecânica em vez de promessa.
--
-- ─── As três camadas de verdade, e por que são três ────────────────────────
--
--   approval_decisions   HISTÓRIA autoritativa da decisão. Append-only.
--   approval_request_*   PROJEÇÃO do estado atual, derivada da história.
--   domain_events        FATO durável e causalidade (migration 119).
--
-- `status` do pedido é PROJEÇÃO, não a verdade histórica (§12). Apagar a
-- projeção e recalculá-la a partir das decisões tem de dar o mesmo resultado;
-- é isso que torna a projeção segura de existir.
--
-- ─── Impressão digital do sujeito ──────────────────────────────────────────
--
-- O pedido guarda a impressão digital EXATA do conteúdo aprovado. A §26 é
-- categórica: aprovar o objeto de ontem não pode autorizar o conteúdo
-- modificado de hoje. A impressão é recalculada e reconferida em TODA decisão,
-- na migration 127.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1) approval_requests
-- ------------------------------------------------------------
CREATE TABLE public.approval_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Que regra governou. RESTRICT de propósito: apagar a versão que governou um
  -- pedido apagaria a resposta para "sob que autoridade isto foi decidido".
  policy_version_id  uuid NOT NULL,
  policy_id          uuid NOT NULL,
  policy_key         text NOT NULL,   -- desnormalizado: a história tem de ser
  policy_version_no  integer NOT NULL, -- legível sem depender de junção viva.

  -- ---- o sujeito autoritativo ----
  subject_type       text NOT NULL CHECK (subject_type ~ '^[a-z][a-z0-9_]*$'),
  subject_id         uuid NOT NULL,
  action_type        text NOT NULL CHECK (action_type ~ '^[a-z][a-z0-9_]*$'),
  decision_purpose   text NOT NULL
                       CHECK (decision_purpose = ANY (public.approval_decision_purposes())),
  -- Conteúdo EXATO sob decisão. Ver §26 e a função da 128.
  subject_fingerprint text NOT NULL CHECK (btrim(subject_fingerprint) <> ''),
  -- Contexto de seleção congelado — o que a política viu quando escolheu.
  subject_amount     numeric(18,2),
  subject_currency   text CHECK (subject_currency IS NULL OR subject_currency ~ '^[A-Z]{3}$'),
  subject_label      text,
  -- Quem criou o SUJEITO (não o pedido). É a base do SoD de autoria.
  subject_created_by uuid,

  -- ---- quem pediu e por quê ----
  requested_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at       timestamptz NOT NULL DEFAULT now(),
  request_reason     text,
  request_context    jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- ---- projeção do estado ----
  status             text NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING','APPROVED','REJECTED','RETURNED_FOR_CORRECTION',
                                         'CANCELLED','EXPIRED','SUPERSEDED')),
  current_stage_no   integer CHECK (current_stage_no IS NULL OR current_stage_no > 0),
  expires_at         timestamptz,
  finalized_at       timestamptz,
  finalized_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  outcome_reason     text,

  -- ---- causalidade ----
  correlation_id     uuid NOT NULL DEFAULT gen_random_uuid(),
  source_event_id    uuid,
  supersedes_request_id uuid,

  -- Chave de negócio da criação: repetir o clique não cria um segundo pedido.
  idempotency_key    text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  -- Cópia do flag da versão da política, congelada junto com o resto do plano.
  -- É esta coluna que o índice `areq_one_active` consulta.
  allow_parallel     boolean NOT NULL DEFAULT false,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT areq_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT areq_idempotent    UNIQUE (organization_id, idempotency_key),
  CONSTRAINT areq_policy_version_tenant FOREIGN KEY (organization_id, policy_version_id)
    REFERENCES public.approval_policy_versions (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT areq_policy_tenant FOREIGN KEY (organization_id, policy_id)
    REFERENCES public.approval_policies (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT areq_source_event_tenant FOREIGN KEY (organization_id, source_event_id)
    REFERENCES public.domain_events (organization_id, id) ON DELETE SET NULL (source_event_id),
  CONSTRAINT areq_supersedes_tenant FOREIGN KEY (organization_id, supersedes_request_id)
    REFERENCES public.approval_requests (organization_id, id) ON DELETE SET NULL (supersedes_request_id),
  CONSTRAINT areq_no_self_supersede CHECK (supersedes_request_id IS DISTINCT FROM id),
  -- Estado final e carimbo de final andam juntos, sempre.
  CONSTRAINT areq_final_coherent CHECK (
    (status = 'PENDING') = (finalized_at IS NULL)),
  CONSTRAINT areq_stage_coherent CHECK (
    (status = 'PENDING') <= (current_stage_no IS NOT NULL)),
  CONSTRAINT areq_context_object CHECK (jsonb_typeof(request_context) = 'object'),
  CONSTRAINT areq_context_small CHECK (pg_column_size(request_context) <= 8192),
  CONSTRAINT areq_context_no_secrets CHECK (public.apex_payload_is_safe(request_context)),
  CONSTRAINT areq_amount_needs_currency CHECK ((subject_amount IS NULL) OR (subject_currency IS NOT NULL))
);

COMMENT ON TABLE public.approval_requests IS
  'Um pedido de decisão governada. `status` é PROJEÇÃO: a verdade histórica '
  'está em approval_decisions. O plano de etapas é COPIADO na criação e nunca '
  'reconsulta a política.';
COMMENT ON COLUMN public.approval_requests.subject_fingerprint IS
  'Impressão digital do conteúdo EXATO sob decisão. Reconferida em toda '
  'decisão: aprovar o objeto de ontem não autoriza o conteúdo de hoje (§26).';

/*
  UM pedido ativo por ação governada (§27).

  Índice único PARCIAL sobre os pedidos PENDENTES. Cliques repetidos e eventos
  duplicados esbarram aqui, no banco — não na desabilitação do botão, que não é
  fronteira de segurança. A política pode abrir mão disso por
  `allow_parallel_requests`, e nesse caso a criação (127) usa uma chave de
  idempotência distinta; o índice continua valendo para o caso normal.
*/
CREATE UNIQUE INDEX areq_one_active ON public.approval_requests
  (organization_id, subject_type, subject_id, action_type, decision_purpose)
  WHERE status = 'PENDING' AND NOT allow_parallel;

CREATE INDEX areq_org_status  ON public.approval_requests (organization_id, status, requested_at DESC);
CREATE INDEX areq_subject     ON public.approval_requests (organization_id, subject_type, subject_id, requested_at DESC);
CREATE INDEX areq_expiring    ON public.approval_requests (expires_at) WHERE status = 'PENDING' AND expires_at IS NOT NULL;
CREATE INDEX areq_correlation ON public.approval_requests (correlation_id);

-- ------------------------------------------------------------
-- 2) approval_request_stages — o quórum congelado
-- ------------------------------------------------------------
CREATE TABLE public.approval_request_stages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  request_id         uuid NOT NULL,
  stage_no           integer NOT NULL CHECK (stage_no > 0),
  name               text NOT NULL,
  -- Já resolvido na criação: NULL na política vira o número de etapas aqui.
  -- Guardar o número resolvido evita reinterpretar "todas" depois.
  quorum_required    integer NOT NULL CHECK (quorum_required > 0),
  rejection_behavior text NOT NULL CHECK (rejection_behavior = 'REJECT_REQUEST'),
  status             text NOT NULL DEFAULT 'WAITING'
                       CHECK (status IN ('WAITING','OPEN','APPROVED','REJECTED','RETURNED','CANCELLED','EXPIRED')),
  opened_at          timestamptz,
  closed_at          timestamptz,

  CONSTRAINT arstg_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT arstg_unique        UNIQUE (organization_id, request_id, stage_no),
  CONSTRAINT arstg_request_tenant FOREIGN KEY (organization_id, request_id)
    REFERENCES public.approval_requests (organization_id, id) ON DELETE CASCADE
);

-- ------------------------------------------------------------
-- 3) approval_request_steps — a cópia governada
-- ------------------------------------------------------------
CREATE TABLE public.approval_request_steps (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  request_id         uuid NOT NULL,
  request_stage_id   uuid NOT NULL,
  -- Rastreia a etapa de política de origem, sem depender dela para funcionar.
  policy_step_id     uuid,

  step_key           text NOT NULL,
  stage_no           integer NOT NULL CHECK (stage_no > 0),
  name               text NOT NULL,
  decision_purpose   text NOT NULL
                       CHECK (decision_purpose = ANY (public.approval_decision_purposes())),

  -- ---- regra COPIADA da política (§14: o pedido não depende da política viva)
  eligibility_mode   text NOT NULL CHECK (eligibility_mode IN ('PERMISSION','ROLE','NAMED')),
  permission_key     text,
  role_key           text,
  named_user_id      uuid,
  authority_required boolean NOT NULL DEFAULT false,
  authority_max_amount numeric(18,2),
  authority_currency text,
  sod_forbid_requester       boolean NOT NULL,
  sod_forbid_subject_creator boolean NOT NULL,
  sod_group          text,
  delegation_allowed boolean NOT NULL,
  reason_requirement text NOT NULL CHECK (reason_requirement IN ('OPTIONAL','REQUIRED_ON_NEGATIVE','REQUIRED_ALWAYS')),
  step_expires_after interval,

  -- ---- projeção ----
  status             text NOT NULL DEFAULT 'WAITING'
                       CHECK (status IN ('WAITING','OPEN','APPROVED','REJECTED','RETURNED','SKIPPED','CANCELLED','EXPIRED')),
  opened_at          timestamptz,
  expires_at         timestamptz,
  decided_at         timestamptz,
  decided_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT arst_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT arst_key_unique    UNIQUE (organization_id, request_id, step_key),
  CONSTRAINT arst_request_tenant FOREIGN KEY (organization_id, request_id)
    REFERENCES public.approval_requests (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT arst_stage_tenant FOREIGN KEY (organization_id, request_stage_id)
    REFERENCES public.approval_request_stages (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT arst_eligibility_coherent CHECK (
    (eligibility_mode = 'PERMISSION' AND permission_key IS NOT NULL AND role_key IS NULL AND named_user_id IS NULL)
 OR (eligibility_mode = 'ROLE'       AND role_key IS NOT NULL AND permission_key IS NULL AND named_user_id IS NULL)
 OR (eligibility_mode = 'NAMED'      AND named_user_id IS NOT NULL AND permission_key IS NULL AND role_key IS NULL)),
  CONSTRAINT arst_authority_coherent CHECK (
    (NOT authority_required AND authority_max_amount IS NULL AND authority_currency IS NULL)
 OR (authority_required AND (authority_max_amount IS NULL) = (authority_currency IS NULL))),
  -- Decidida implica decisor e instante — e nunca o contrário.
  CONSTRAINT arst_decided_coherent CHECK (
    (status IN ('APPROVED','REJECTED','RETURNED')) = (decided_at IS NOT NULL))
);

COMMENT ON TABLE public.approval_request_steps IS
  'Cópia GOVERNADA do plano de etapas, tirada na criação do pedido. Editar a '
  'política depois não muda a rota de um pedido em curso.';

CREATE INDEX arst_open ON public.approval_request_steps (organization_id, status, stage_no)
  WHERE status = 'OPEN';
CREATE INDEX arst_request ON public.approval_request_steps (organization_id, request_id, stage_no);
CREATE INDEX arst_named   ON public.approval_request_steps (organization_id, named_user_id)
  WHERE named_user_id IS NOT NULL;

-- ------------------------------------------------------------
-- 4) approval_decisions — a HISTÓRIA, append-only
-- ------------------------------------------------------------
CREATE TABLE public.approval_decisions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  request_id         uuid NOT NULL,
  request_step_id    uuid NOT NULL,
  step_key           text NOT NULL,
  stage_no           integer NOT NULL,

  decision           text NOT NULL CHECK (decision IN ('APPROVED','REJECTED','RETURNED_FOR_CORRECTION')),
  decision_purpose   text NOT NULL
                       CHECK (decision_purpose = ANY (public.approval_decision_purposes())),
  reason             text,

  -- ---- ator ----
  -- Quem CLICOU. Vem sempre de auth.uid() dentro da RPC; nunca de parâmetro.
  actor_user_id      uuid NOT NULL,
  -- Por conta de QUEM, quando houve delegação. NULL = agiu por si.
  on_behalf_of_user_id uuid,
  delegation_id      uuid,
  actor_source       text NOT NULL DEFAULT 'human'
                       CHECK (actor_source IN ('human','system')),

  -- ---- proveniência da autoridade, congelada no instante da decisão (§18) ----
  authority_source   text NOT NULL
                       CHECK (authority_source IN ('PERMISSION','ROLE','NAMED','DELEGATED')),
  authority_basis    text,
  authority_limit_amount numeric(18,2),
  authority_currency text,
  subject_amount     numeric(18,2),
  subject_currency   text,
  -- A impressão digital CONFERIDA no instante da decisão. Se o sujeito mudou
  -- depois, esta linha continua dizendo o que foi de fato aprovado.
  subject_fingerprint text NOT NULL,

  decided_at         timestamptz NOT NULL DEFAULT now(),
  idempotency_key    text NOT NULL CHECK (btrim(idempotency_key) <> ''),

  CONSTRAINT adec_org_id_unique UNIQUE (organization_id, id),
  /*
    UMA decisão por etapa. É esta restrição — e não o estado do botão, nem uma
    verificação em memória — que impede a mesma etapa de ser decidida duas
    vezes por dois processos simultâneos.
  */
  CONSTRAINT adec_one_per_step UNIQUE (organization_id, request_step_id),
  -- Retentativa de HTTP com a mesma chave não vira segunda linha (§23).
  CONSTRAINT adec_idempotent   UNIQUE (organization_id, idempotency_key),
  CONSTRAINT adec_request_tenant FOREIGN KEY (organization_id, request_id)
    REFERENCES public.approval_requests (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT adec_step_tenant FOREIGN KEY (organization_id, request_step_id)
    REFERENCES public.approval_request_steps (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT adec_actor_fk FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  -- Delegação implica um delegante, e agir por si implica não ter delegação.
  CONSTRAINT adec_delegation_coherent CHECK (
    (delegation_id IS NULL AND on_behalf_of_user_id IS NULL AND authority_source <> 'DELEGATED')
 OR (delegation_id IS NOT NULL AND on_behalf_of_user_id IS NOT NULL AND authority_source = 'DELEGATED')),
  CONSTRAINT adec_no_self_delegation CHECK (on_behalf_of_user_id IS DISTINCT FROM actor_user_id),
  CONSTRAINT adec_authority_currency CHECK (
    (authority_limit_amount IS NULL) OR (authority_currency IS NOT NULL))
);

COMMENT ON TABLE public.approval_decisions IS
  'HISTÓRIA autoritativa da decisão. Append-only: nunca se edita um APPROVED '
  'para virar REJECTED. Uma linha por etapa, garantido pelo banco.';
COMMENT ON COLUMN public.approval_decisions.actor_user_id IS
  'SEMPRE auth.uid() dentro da RPC. Não existe caminho em que o navegador '
  'informe quem decidiu (§36).';

CREATE INDEX adec_request ON public.approval_decisions (organization_id, request_id, decided_at);
CREATE INDEX adec_actor   ON public.approval_decisions (organization_id, actor_user_id, decided_at DESC);

-- ------------------------------------------------------------
-- 5) Imutabilidade da história
-- ------------------------------------------------------------
-- Nada aqui é UPDATE e nada aqui é DELETE. Corrigir uma decisão errada é
-- registrar a decisão seguinte no processo seguinte — não reescrever a
-- anterior. Sem isto, "histórico imutável" seria uma frase de documentação.
CREATE FUNCTION public.approval_decisions_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION
    'Histórico de decisão é append-only: % em approval_decisions não é permitido (decisão %).',
    TG_OP, COALESCE(OLD.id, NEW.id) USING ERRCODE = 'check_violation';
END $$;
REVOKE ALL ON FUNCTION public.approval_decisions_append_only() FROM PUBLIC;

CREATE TRIGGER adec_no_update BEFORE UPDATE ON public.approval_decisions
  FOR EACH ROW EXECUTE FUNCTION public.approval_decisions_append_only();
-- DELETE segue a mesma fronteira que a 110 desenhou para a história de
-- contrato: a aplicação não apaga; a exclusão do inquilino inteiro, sim.
CREATE TRIGGER adec_no_erasure BEFORE DELETE ON public.approval_decisions
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

CREATE TRIGGER areq_updated_at BEFORE UPDATE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- 6) RLS — ler no mesmo inquilino; ESCREVER só por RPC
-- ------------------------------------------------------------
/*
  A assimetria é o ponto (§38). Existem policies de SELECT e não existe
  nenhuma de INSERT/UPDATE/DELETE para estas quatro tabelas, e os GRANTs
  abaixo dão apenas SELECT a `authenticated`.

  Consequência concreta: mesmo um usuário legítimo, com a permissão de decidir,
  NÃO consegue gravar uma linha em approval_decisions pelo PostgREST. O único
  caminho de escrita é a RPC da migration 127, que é quem revalida
  elegibilidade, SoD, alçada, ordem e impressão digital — todas de uma vez,
  dentro de uma transação. Um caminho de escrita direto tornaria essas
  verificações opcionais.
*/
ALTER TABLE public.approval_requests       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_request_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_request_steps  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_decisions      ENABLE ROW LEVEL SECURITY;

CREATE POLICY approval_requests_select ON public.approval_requests FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.current_user_is_admin() OR public.current_user_has_permission('approvals.view')));
CREATE POLICY approval_request_stages_select ON public.approval_request_stages FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.current_user_is_admin() OR public.current_user_has_permission('approvals.view')));
CREATE POLICY approval_request_steps_select ON public.approval_request_steps FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.current_user_is_admin() OR public.current_user_has_permission('approvals.view')));
CREATE POLICY approval_decisions_select ON public.approval_decisions FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.current_user_is_admin() OR public.current_user_has_permission('approvals.view')));

GRANT SELECT ON public.approval_requests, public.approval_request_stages,
                public.approval_request_steps, public.approval_decisions TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.approval_requests, public.approval_request_stages,
       public.approval_request_steps, public.approval_decisions FROM authenticated, anon;
REVOKE ALL ON public.approval_requests, public.approval_request_stages,
              public.approval_request_steps, public.approval_decisions FROM anon;

COMMIT;
