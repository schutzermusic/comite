-- ============================================================
-- PLATAFORMA — Motor de Aprovação: POLÍTICA, VERSÃO, ESTÁGIO, ETAPA
-- Migration: 125_platform_approval_policies
--
-- ─── O que a Fase 5 constrói ───────────────────────────────────────────────
--
-- UM motor de aprovação da Plataforma, compartilhado. Contratos é o PILOTO,
-- não o dono. A pergunta que o motor responde inteira é:
--
--   QUE decisão foi pedida? POR QUE? QUEM podia decidir? EM QUE ORDEM?
--   SOB QUE ALÇADA? O mesmo ator podia cumprir duas etapas? QUE VERSÃO da
--   política governou? O QUE aconteceu? QUANDO? Qual o desfecho?
--
-- ─── O que estas quatro tabelas são ────────────────────────────────────────
--
--   approval_policies         identidade estável da política de governança
--   approval_policy_versions  a REGRA, versionada e imutável depois de usada
--   approval_policy_stages    os estágios ORDENADOS de uma versão + quórum
--   approval_policy_steps     as etapas PARALELAS dentro de um estágio
--
-- A separação política/versão existe por uma razão só, e ela é a invariante
-- central desta migration:
--
--   Pedido criado sob a v1 resolve-se SEMPRE sob a v1.
--   Ativar a v2 não reinterpreta pedido nenhum que já existia.
--
-- Uma tabela única, editável, faria a regra de ontem virar a regra de hoje
-- retroativamente — e a história da decisão passaria a mentir sobre sob que
-- autoridade ela foi tomada. É por isso que a versão em uso é IMUTÁVEL, por
-- gatilho, e não por convenção de aplicação.
--
-- ─── O que estas tabelas NÃO são ───────────────────────────────────────────
--
-- Não são um BPMN. Não há laço, não há expressão SQL do usuário, não há
-- código autorável. Um motor de fluxo genérico responderia "o que o desenhista
-- escreveu"; este responde "quem tinha autoridade", que é a pergunta de
-- governança. O teto é: estágios ordenados, etapas paralelas, quórum, SoD,
-- alçada, delegação, prazo, devolução, cancelamento, sucessão.
--
-- Não são catálogo de política REAL. Esta migration não semeia política de
-- negócio nenhuma em organização nenhuma. Ela semeia VOCABULÁRIO (permissões),
-- que é o que a §34 do plano permite. Política real exige regra autoritativa
-- provada, e inventá-la seria fabricar governança.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1) Vocabulário compartilhado
-- ------------------------------------------------------------
-- Texto com CHECK, e não ENUM, pela mesma razão da 119: o vocabulário cresce a
-- cada domínio que entra no motor, e ENUM obrigaria migration para cada um.

-- O PROPÓSITO da decisão. A §3 do plano é explícita: aprovação, autorização,
-- liberação, aceite, validação, revisão e ciência NÃO são intercambiáveis.
-- Guardar o propósito é o que impede que uma revisão vire, num relatório,
-- "aprovado".
CREATE FUNCTION public.approval_decision_purposes() RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT ARRAY['APPROVAL','AUTHORIZATION','RELEASE','ACCEPTANCE','VALIDATION','REVIEW','ACKNOWLEDGEMENT']::text[]
$$;
COMMENT ON FUNCTION public.approval_decision_purposes() IS
  'Propósitos de decisão. REVIEW e ACKNOWLEDGEMENT compartilham o motor mas '
  'NÃO significam aprovação — ver §3 do plano da Fase 5.';

-- ------------------------------------------------------------
-- 2) approval_policies — a identidade estável
-- ------------------------------------------------------------
CREATE TABLE public.approval_policies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Chave estável e legível. É ela que sobrevive à troca de versão.
  policy_key       text NOT NULL CHECK (policy_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
  name             text NOT NULL CHECK (btrim(name) <> ''),
  description      text,

  -- A que domínio de negócio a política pertence. Contratos é o primeiro.
  business_domain  text NOT NULL CHECK (business_domain ~ '^[a-z][a-z0-9_]*$'),

  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ap_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT ap_key_unique    UNIQUE (organization_id, policy_key)
);

COMMENT ON TABLE public.approval_policies IS
  'Identidade estável de uma política de governança. A REGRA mora nas versões; '
  'esta linha só dá nome e domínio a ela.';

-- ------------------------------------------------------------
-- 3) approval_policy_versions — a regra, versionada
-- ------------------------------------------------------------
CREATE TABLE public.approval_policy_versions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  policy_id             uuid NOT NULL,
  version_no            integer NOT NULL CHECK (version_no > 0),

  status                text NOT NULL DEFAULT 'DRAFT'
                          CHECK (status IN ('DRAFT','ACTIVE','INACTIVE','SUPERSEDED')),

  -- ---- o que esta versão governa (critério de SELEÇÃO) ----
  subject_type          text NOT NULL CHECK (subject_type ~ '^[a-z][a-z0-9_]*$'),
  action_type           text NOT NULL CHECK (action_type ~ '^[a-z][a-z0-9_]*$'),
  decision_purpose      text NOT NULL
                          CHECK (decision_purpose = ANY (public.approval_decision_purposes())),

  -- Condições de aplicabilidade. TODAS opcionais: NULL significa "não
  -- restringe", nunca "restringe a nada". Faixa de valor é fechada embaixo e
  -- ABERTA em cima (>= min, < max) para que faixas contíguas não se
  -- sobreponham no ponto de corte — a sobreposição é justamente o que produz
  -- ambiguidade de seleção.
  min_amount            numeric(18,2) CHECK (min_amount IS NULL OR min_amount >= 0),
  max_amount            numeric(18,2) CHECK (max_amount IS NULL OR max_amount >= 0),
  currency              text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  contract_type         text,
  risk_class            text,
  cost_center_id        uuid,
  business_unit_id      uuid,

  -- Precedência EXPLÍCITA. A §10 do plano proíbe desempatar por "mais recente"
  -- ou "primeira linha": se duas versões igualmente autoritativas casarem, o
  -- resultado correto é PARAR. Precedência diferente é governança declarada;
  -- precedência igual é ambiguidade.
  precedence            integer NOT NULL DEFAULT 0,

  -- ---- vigência ----
  effective_from        timestamptz NOT NULL DEFAULT now(),
  effective_until       timestamptz,

  -- ---- comportamento ----
  -- Prazo do PEDIDO inteiro. NULL = não expira.
  request_expires_after interval CHECK (request_expires_after IS NULL OR request_expires_after > interval '0'),
  allow_delegation      boolean NOT NULL DEFAULT false,
  -- Se falso, um mesmo sujeito+ação não pode ter dois pedidos ativos (§27).
  allow_parallel_requests boolean NOT NULL DEFAULT false,
  -- Devolver encerra o pedido; a correção volta por SUCESSÃO, com impressão
  -- digital nova. Reabrir o estágio no mesmo pedido exigiria mais de uma
  -- decisão por etapa, e a história deixaria de ter uma linha por decisão.
  return_behavior       text NOT NULL DEFAULT 'TERMINATE_REQUEST'
                          CHECK (return_behavior = 'TERMINATE_REQUEST'),

  -- ---- ciclo de vida da própria versão ----
  validated_at          timestamptz,
  activated_at          timestamptz,
  activated_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  superseded_by_version_id uuid,
  notes                 text,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT apv_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT apv_version_unique UNIQUE (organization_id, policy_id, version_no),
  -- Mesma organização, estruturalmente — não por convenção (§38).
  CONSTRAINT apv_policy_tenant FOREIGN KEY (organization_id, policy_id)
    REFERENCES public.approval_policies (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT apv_superseded_tenant FOREIGN KEY (organization_id, superseded_by_version_id)
    REFERENCES public.approval_policy_versions (organization_id, id) ON DELETE SET NULL (superseded_by_version_id),
  CONSTRAINT apv_no_self_supersede CHECK (superseded_by_version_id IS DISTINCT FROM id),
  CONSTRAINT apv_amount_range CHECK (min_amount IS NULL OR max_amount IS NULL OR min_amount < max_amount),
  -- Faixa de valor sem moeda compararia número puro entre moedas diferentes.
  -- A §18 proíbe conversão inventada; então a faixa exige moeda declarada.
  CONSTRAINT apv_amount_needs_currency CHECK ((min_amount IS NULL AND max_amount IS NULL) OR currency IS NOT NULL),
  CONSTRAINT apv_effective_order CHECK (effective_until IS NULL OR effective_until > effective_from),
  CONSTRAINT apv_active_was_validated CHECK (status <> 'ACTIVE' OR validated_at IS NOT NULL),
  CONSTRAINT apv_active_has_activation CHECK ((status = 'ACTIVE') <= (activated_at IS NOT NULL))
);

COMMENT ON TABLE public.approval_policy_versions IS
  'A REGRA de governança, versionada. Uma versão JÁ USADA por um pedido é '
  'imutável: pedido criado sob a v1 resolve-se sob a v1 para sempre.';
COMMENT ON COLUMN public.approval_policy_versions.precedence IS
  'Desempate EXPLÍCITO da seleção. Precedência igual entre duas versões que '
  'casam = ambiguidade = erro. Nunca "a mais recente".';

CREATE INDEX apv_selection ON public.approval_policy_versions
  (organization_id, subject_type, action_type, decision_purpose, status)
  WHERE status = 'ACTIVE';
CREATE INDEX apv_policy ON public.approval_policy_versions (organization_id, policy_id, version_no DESC);

-- ------------------------------------------------------------
-- 4) approval_policy_stages — os estágios ordenados e o quórum
-- ------------------------------------------------------------
-- O quórum é propriedade do ESTÁGIO, não da etapa. "Jurídico + Financeiro,
-- quórum 2 de 2" é uma afirmação sobre o estágio; repeti-la em cada etapa
-- criaria duas fontes para o mesmo número, e elas divergiriam.
CREATE TABLE public.approval_policy_stages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  policy_version_id  uuid NOT NULL,
  stage_no           integer NOT NULL CHECK (stage_no > 0),
  name               text NOT NULL CHECK (btrim(name) <> ''),

  -- Quantas etapas do estágio precisam aprovar para ele completar. NULL = TODAS.
  -- A §16 é explícita: nunca assumir maioria. Ou o número está declarado, ou a
  -- regra é a unanimidade das etapas configuradas.
  quorum_required    integer CHECK (quorum_required IS NULL OR quorum_required > 0),

  -- O que uma rejeição dentro do estágio faz. Explícito, nunca presumido.
  -- Só um valor, e ele é o implementado. Declarar 'BLOCK_STAGE' aqui sem o
  -- runtime correspondente daria à política um botão que não faz nada — e um
  -- estado de governança que não existe é pior que um estado ausente.
  rejection_behavior text NOT NULL DEFAULT 'REJECT_REQUEST'
                       CHECK (rejection_behavior = 'REJECT_REQUEST'),

  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT aps_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT aps_stage_unique  UNIQUE (organization_id, policy_version_id, stage_no),
  CONSTRAINT aps_version_tenant FOREIGN KEY (organization_id, policy_version_id)
    REFERENCES public.approval_policy_versions (organization_id, id) ON DELETE CASCADE
);

COMMENT ON COLUMN public.approval_policy_stages.quorum_required IS
  'NULL = todas as etapas do estágio. Nunca se presume maioria (§16).';

-- ------------------------------------------------------------
-- 5) approval_policy_steps — as etapas
-- ------------------------------------------------------------
CREATE TABLE public.approval_policy_steps (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  policy_version_id  uuid NOT NULL,
  policy_stage_id    uuid NOT NULL,

  -- Chave ESTÁVEL da etapa. É por ela que a história se lê depois que o nome
  -- de exibição mudou. Única dentro da versão.
  step_key           text NOT NULL CHECK (step_key ~ '^[a-z][a-z0-9_]*$'),
  name               text NOT NULL CHECK (btrim(name) <> ''),
  decision_purpose   text NOT NULL
                       CHECK (decision_purpose = ANY (public.approval_decision_purposes())),

  -- ---- elegibilidade ----
  -- Três bases, e apenas três. A §19 proíbe substituir autoridade nomeada por
  -- papel genérico "por conveniência", então NAMED é uma base de primeira
  -- classe, não um caso especial.
  eligibility_mode   text NOT NULL
                       CHECK (eligibility_mode IN ('PERMISSION','ROLE','NAMED')),
  permission_key     text,
  role_key           text,
  named_user_id      uuid REFERENCES auth.users(id) ON DELETE RESTRICT,

  -- ---- alçada ----
  authority_required boolean NOT NULL DEFAULT false,
  -- NULL com authority_required = ilimitada, e é uma declaração, não um vazio.
  authority_max_amount numeric(18,2) CHECK (authority_max_amount IS NULL OR authority_max_amount >= 0),
  authority_currency   text CHECK (authority_currency IS NULL OR authority_currency ~ '^[A-Z]{3}$'),

  -- ---- segregação de funções ----
  sod_forbid_requester       boolean NOT NULL DEFAULT true,
  sod_forbid_subject_creator boolean NOT NULL DEFAULT false,
  -- Etapas que compartilham o mesmo grupo são INCOMPATÍVEIS: um mesmo ator não
  -- pode cumprir duas delas no mesmo pedido.
  sod_group          text,

  -- ---- delegação ----
  delegation_allowed boolean NOT NULL DEFAULT false,

  -- ---- prazo e justificativa ----
  step_expires_after interval CHECK (step_expires_after IS NULL OR step_expires_after > interval '0'),
  reason_requirement text NOT NULL DEFAULT 'REQUIRED_ON_NEGATIVE'
                       CHECK (reason_requirement IN ('OPTIONAL','REQUIRED_ON_NEGATIVE','REQUIRED_ALWAYS')),

  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT apst_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT apst_key_unique    UNIQUE (organization_id, policy_version_id, step_key),
  CONSTRAINT apst_version_tenant FOREIGN KEY (organization_id, policy_version_id)
    REFERENCES public.approval_policy_versions (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT apst_stage_tenant FOREIGN KEY (organization_id, policy_stage_id)
    REFERENCES public.approval_policy_stages (organization_id, id) ON DELETE CASCADE,
  -- Cada modo de elegibilidade exige EXATAMENTE o seu campo e proíbe os outros.
  -- Sem isto, uma etapa NAMED com permission_key preenchida teria dois donos.
  CONSTRAINT apst_eligibility_coherent CHECK (
    (eligibility_mode = 'PERMISSION' AND permission_key IS NOT NULL AND role_key IS NULL     AND named_user_id IS NULL)
 OR (eligibility_mode = 'ROLE'       AND role_key       IS NOT NULL AND permission_key IS NULL AND named_user_id IS NULL)
 OR (eligibility_mode = 'NAMED'      AND named_user_id  IS NOT NULL AND permission_key IS NULL AND role_key IS NULL)),
  -- Limite de alçada sem moeda compararia número entre moedas. Proibido (§18).
  CONSTRAINT apst_authority_coherent CHECK (
    (NOT authority_required AND authority_max_amount IS NULL AND authority_currency IS NULL)
 OR (authority_required AND (authority_max_amount IS NULL) = (authority_currency IS NULL))),
  CONSTRAINT apst_sod_group_shape CHECK (sod_group IS NULL OR btrim(sod_group) <> '')
);

COMMENT ON TABLE public.approval_policy_steps IS
  'Etapas de uma versão de política. Etapas do MESMO estágio são paralelas; '
  'estágios são ordenados. sod_group marca etapas INCOMPATÍVEIS entre si.';
COMMENT ON COLUMN public.approval_policy_steps.authority_max_amount IS
  'NULL com authority_required = alçada ILIMITADA declarada. A moeda anda '
  'junto porque não existe conversão: moeda incompatível bloqueia a decisão.';

CREATE INDEX apst_version ON public.approval_policy_steps (organization_id, policy_version_id);
CREATE INDEX apst_stage   ON public.approval_policy_steps (organization_id, policy_stage_id);

-- ------------------------------------------------------------
-- 6) Imutabilidade da versão em uso
-- ------------------------------------------------------------
-- A regra que governou um pedido não muda depois. Enquanto a versão é DRAFT
-- ela é material de trabalho; a partir de ACTIVE, só as colunas de CICLO DE
-- VIDA (status, desativação, sucessão) se mexem. E se um pedido já a citou,
-- nem excluir é possível: a FK das fases seguintes é RESTRICT.
CREATE FUNCTION public.approval_policy_version_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.status = 'DRAFT' THEN
    -- Rascunho é editável, mas ninguém volta de ACTIVE para DRAFT.
    RETURN NEW;
  END IF;

  IF NEW.subject_type      IS DISTINCT FROM OLD.subject_type
  OR NEW.action_type       IS DISTINCT FROM OLD.action_type
  OR NEW.decision_purpose  IS DISTINCT FROM OLD.decision_purpose
  OR NEW.min_amount        IS DISTINCT FROM OLD.min_amount
  OR NEW.max_amount        IS DISTINCT FROM OLD.max_amount
  OR NEW.currency          IS DISTINCT FROM OLD.currency
  OR NEW.contract_type     IS DISTINCT FROM OLD.contract_type
  OR NEW.risk_class        IS DISTINCT FROM OLD.risk_class
  OR NEW.cost_center_id    IS DISTINCT FROM OLD.cost_center_id
  OR NEW.business_unit_id  IS DISTINCT FROM OLD.business_unit_id
  OR NEW.precedence        IS DISTINCT FROM OLD.precedence
  OR NEW.effective_from    IS DISTINCT FROM OLD.effective_from
  OR NEW.request_expires_after IS DISTINCT FROM OLD.request_expires_after
  OR NEW.allow_delegation  IS DISTINCT FROM OLD.allow_delegation
  OR NEW.allow_parallel_requests IS DISTINCT FROM OLD.allow_parallel_requests
  OR NEW.return_behavior   IS DISTINCT FROM OLD.return_behavior
  OR NEW.policy_id         IS DISTINCT FROM OLD.policy_id
  OR NEW.version_no        IS DISTINCT FROM OLD.version_no
  OR NEW.organization_id   IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION
      'Versão de política % já saiu de DRAFT: a regra é imutável. Crie uma versão nova.',
      OLD.id USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'DRAFT' THEN
    RAISE EXCEPTION 'Uma versão publicada não volta a DRAFT.' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.approval_policy_version_guard() FROM PUBLIC;

CREATE TRIGGER apv_immutable_after_draft BEFORE UPDATE ON public.approval_policy_versions
  FOR EACH ROW EXECUTE FUNCTION public.approval_policy_version_guard();

-- Estágio e etapa de versão publicada não se editam nem se apagam. Sem isto a
-- versão seria "imutável" só na linha de cima, e o plano de etapas — que é a
-- regra de verdade — continuaria mutável por baixo.
CREATE FUNCTION public.approval_policy_shape_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_status text; v_version uuid;
BEGIN
  v_version := COALESCE(NEW.policy_version_id, OLD.policy_version_id);
  SELECT status INTO v_status FROM public.approval_policy_versions WHERE id = v_version;
  -- Versão ausente = a própria versão está sendo apagada em cascata. Deixar
  -- passar aqui é o que permite excluir um rascunho inteiro.
  IF v_status IS NULL OR v_status = 'DRAFT' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION
    'O plano de etapas da versão % é imutável fora de DRAFT.', v_version
    USING ERRCODE = 'check_violation';
END $$;
REVOKE ALL ON FUNCTION public.approval_policy_shape_guard() FROM PUBLIC;

CREATE TRIGGER aps_immutable_after_draft BEFORE INSERT OR UPDATE OR DELETE ON public.approval_policy_stages
  FOR EACH ROW EXECUTE FUNCTION public.approval_policy_shape_guard();
CREATE TRIGGER apst_immutable_after_draft BEFORE INSERT OR UPDATE OR DELETE ON public.approval_policy_steps
  FOR EACH ROW EXECUTE FUNCTION public.approval_policy_shape_guard();

CREATE TRIGGER ap_updated_at   BEFORE UPDATE ON public.approval_policies        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER apv_updated_at  BEFORE UPDATE ON public.approval_policy_versions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;

-- ============================================================
-- 125b — VALIDAÇÃO, ATIVAÇÃO, SELEÇÃO DETERMINÍSTICA, RLS, PERMISSÕES
-- (mesma migration 125; separado só para leitura)
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 7) Validação de versão — §37
-- ------------------------------------------------------------
-- Devolve a lista de problemas. Vazia = válida. Devolver LISTA em vez de
-- levantar no primeiro erro é deliberado: quem desenha a política quer ver
-- tudo o que está errado de uma vez, não descobrir um problema por tentativa.
CREATE FUNCTION public.approval_policy_version_problems(p_version_id uuid)
RETURNS TABLE (code text, detail text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v public.approval_policy_versions%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.approval_policy_versions WHERE id = p_version_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'VERSION_NOT_FOUND'::text, p_version_id::text; RETURN;
  END IF;

  -- Uma versão sem etapa aprovaria por vacuidade. É o pior defeito possível
  -- num motor de aprovação: o pedido nasceria APROVADO sem ninguém decidir.
  IF NOT EXISTS (SELECT 1 FROM public.approval_policy_steps WHERE policy_version_id = p_version_id) THEN
    RETURN QUERY SELECT 'NO_STEPS'::text, 'A versão não tem nenhuma etapa.'::text;
  END IF;

  -- Estágios têm de ser 1..N contíguos. Um buraco (1, 3) faria a progressão
  -- pular um estágio sem que ninguém tivesse decidido dispensá-lo.
  RETURN QUERY
    SELECT 'STAGE_NUMBERING'::text,
           format('Estágios devem ser 1..N contíguos; encontrados: %s',
                  string_agg(stage_no::text, ', ' ORDER BY stage_no))
      FROM public.approval_policy_stages WHERE policy_version_id = p_version_id
     HAVING count(*) > 0
        AND (min(stage_no) <> 1 OR max(stage_no) <> count(*));

  -- Estágio sem etapa completaria sozinho.
  RETURN QUERY
    SELECT 'EMPTY_STAGE'::text, format('Estágio %s não tem etapa.', s.stage_no)
      FROM public.approval_policy_stages s
     WHERE s.policy_version_id = p_version_id
       AND NOT EXISTS (SELECT 1 FROM public.approval_policy_steps st WHERE st.policy_stage_id = s.id);

  -- Quórum maior que o número de etapas nunca se satisfaz: o pedido travaria
  -- para sempre, e travado é indistinguível de "em análise".
  RETURN QUERY
    SELECT 'QUORUM_UNREACHABLE'::text,
           format('Estágio %s exige quórum %s com apenas %s etapa(s).', s.stage_no, s.quorum_required, c.n)
      FROM public.approval_policy_stages s
      JOIN LATERAL (SELECT count(*) n FROM public.approval_policy_steps st WHERE st.policy_stage_id = s.id) c ON true
     WHERE s.policy_version_id = p_version_id AND s.quorum_required IS NOT NULL AND s.quorum_required > c.n;

  -- SoD impossível: duas etapas NOMEADAS para a MESMA pessoa dentro do mesmo
  -- grupo de incompatibilidade. Nenhum ator poderia cumprir as duas, e a
  -- política nunca fecharia.
  RETURN QUERY
    SELECT DISTINCT 'SOD_IMPOSSIBLE'::text,
           format('Etapas "%s" e "%s" são incompatíveis (grupo %s) e nomeiam a mesma pessoa.',
                  a.step_key, b.step_key, a.sod_group)
      FROM public.approval_policy_steps a
      JOIN public.approval_policy_steps b
        ON b.policy_version_id = a.policy_version_id
       AND b.sod_group = a.sod_group
       AND b.named_user_id = a.named_user_id
       AND b.step_key > a.step_key
     WHERE a.policy_version_id = p_version_id
       AND a.sod_group IS NOT NULL AND a.eligibility_mode = 'NAMED' AND b.eligibility_mode = 'NAMED';

  -- Permissão inexistente no catálogo: a etapa jamais elegeria ninguém.
  RETURN QUERY
    SELECT 'PERMISSION_UNKNOWN'::text, format('Etapa "%s" exige a permissão inexistente "%s".', st.step_key, st.permission_key)
      FROM public.approval_policy_steps st
     WHERE st.policy_version_id = p_version_id AND st.eligibility_mode = 'PERMISSION'
       AND NOT EXISTS (SELECT 1 FROM public.permissions p WHERE p.key = st.permission_key);

  RETURN QUERY
    SELECT 'ROLE_UNKNOWN'::text, format('Etapa "%s" exige o papel inexistente "%s".', st.step_key, st.role_key)
      FROM public.approval_policy_steps st
     WHERE st.policy_version_id = p_version_id AND st.eligibility_mode = 'ROLE'
       AND NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.key = st.role_key
                        AND (r.organization_id IS NULL OR r.organization_id = v.organization_id));

  -- Aprovador nomeado tem de ser membro ATIVO da própria organização.
  RETURN QUERY
    SELECT 'NAMED_NOT_MEMBER'::text, format('Etapa "%s" nomeia alguém que não é membro ativo da organização.', st.step_key)
      FROM public.approval_policy_steps st
     WHERE st.policy_version_id = p_version_id AND st.eligibility_mode = 'NAMED'
       AND NOT EXISTS (SELECT 1 FROM public.profiles pr
                        WHERE pr.user_id = st.named_user_id AND pr.organization_id = v.organization_id
                          AND pr.status = 'active');

  -- Delegação permitida numa etapa cuja versão a proíbe: contradição declarada.
  RETURN QUERY
    SELECT 'DELEGATION_CONTRADICTION'::text,
           format('Etapa "%s" permite delegação, mas a versão da política não permite.', st.step_key)
      FROM public.approval_policy_steps st
     WHERE st.policy_version_id = p_version_id AND st.delegation_allowed AND NOT v.allow_delegation;

  -- Prazo da etapa maior que o do pedido: a etapa expiraria depois do pedido,
  -- e o prazo mais longo nunca teria efeito nenhum.
  RETURN QUERY
    SELECT 'EXPIRY_INCOHERENT'::text,
           format('Etapa "%s" tem prazo maior que o prazo do pedido inteiro.', st.step_key)
      FROM public.approval_policy_steps st
     WHERE st.policy_version_id = p_version_id
       AND st.step_expires_after IS NOT NULL AND v.request_expires_after IS NOT NULL
       AND st.step_expires_after > v.request_expires_after;

  -- Alçada declarada em moeda diferente da faixa que a política seleciona.
  RETURN QUERY
    SELECT 'AUTHORITY_CURRENCY_MISMATCH'::text,
           format('Etapa "%s" tem alçada em %s, mas a política seleciona em %s.', st.step_key, st.authority_currency, v.currency)
      FROM public.approval_policy_steps st
     WHERE st.policy_version_id = p_version_id
       AND st.authority_currency IS NOT NULL AND v.currency IS NOT NULL
       AND st.authority_currency <> v.currency;
END $$;

COMMENT ON FUNCTION public.approval_policy_version_problems(uuid) IS
  'Validação da §37. Lista vazia = versão ativável. Devolve TODOS os problemas '
  'de uma vez em vez de levantar no primeiro.';

-- ------------------------------------------------------------
-- 8) Ativação
-- ------------------------------------------------------------
-- Ativar é o momento em que a regra passa a poder criar pedido. Duas coisas
-- acontecem aqui e em lugar nenhum mais: a validação é exigida, e a
-- AMBIGUIDADE DE SELEÇÃO é barrada na origem — porque descobrir a ambiguidade
-- só na hora de criar o pedido deixaria o negócio parado sem saber por quê.
CREATE FUNCTION public.approval_policy_activate(p_version_id uuid, p_supersede_previous boolean DEFAULT true)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v public.approval_policy_versions%ROWTYPE;
  problems text;
  clash    text;
  actor    uuid := auth.uid();
BEGIN
  SELECT * INTO v FROM public.approval_policy_versions WHERE id = p_version_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Versão de política inexistente.' USING ERRCODE = 'no_data_found';
  END IF;

  -- Administrar política NÃO é decidir (§35). Quem chega aqui precisa de
  -- approvals.policy.manage, e ter essa permissão não dá alçada nenhuma.
  IF current_user IN ('authenticated','anon') THEN
    IF public.current_user_organization_id() IS DISTINCT FROM v.organization_id
       OR NOT (public.current_user_has_permission('approvals.policy.manage')
               OR public.current_user_has_permission('approvals.admin')) THEN
      RAISE EXCEPTION 'Ativação negada.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Só uma versão em DRAFT pode ser ativada (status atual: %).', v.status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT string_agg(format('%s: %s', code, detail), E'\n')
    INTO problems FROM public.approval_policy_version_problems(p_version_id);
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION E'Versão de política inválida:\n%', problems USING ERRCODE = 'check_violation';
  END IF;

  /*
    Ambiguidade de seleção, barrada na ATIVAÇÃO.

    Duas versões ATIVAS que casem o mesmo (sujeito, ação, propósito), com
    janelas de vigência sobrepostas, condições sobrepostas e MESMA precedência
    são indistinguíveis para o seletor. A §10 proíbe desempatar por "a mais
    recente". Precedência diferente resolve; precedência igual é erro de
    governança, e o lugar de recusá-lo é aqui.

    Sobreposição de faixa: dois intervalos [a,b) e [c,d) se sobrepõem quando
    a < d e c < b, com NULL valendo infinito do lado correspondente. Moedas
    diferentes nunca se sobrepõem — não há conversão.
  */
  SELECT string_agg(format('%s v%s', p.policy_key, o.version_no), ', ')
    INTO clash
    FROM public.approval_policy_versions o
    JOIN public.approval_policies p ON p.id = o.policy_id
   WHERE o.organization_id  = v.organization_id
     AND o.id              <> v.id
     AND o.status           = 'ACTIVE'
     AND o.subject_type     = v.subject_type
     AND o.action_type      = v.action_type
     AND o.decision_purpose = v.decision_purpose
     AND o.precedence       = v.precedence
     AND (o.effective_until IS NULL OR o.effective_until > v.effective_from)
     AND (v.effective_until IS NULL OR v.effective_until > o.effective_from)
     AND (o.contract_type    IS NULL OR v.contract_type    IS NULL OR o.contract_type    = v.contract_type)
     AND (o.risk_class       IS NULL OR v.risk_class       IS NULL OR o.risk_class       = v.risk_class)
     AND (o.cost_center_id   IS NULL OR v.cost_center_id   IS NULL OR o.cost_center_id   = v.cost_center_id)
     AND (o.business_unit_id IS NULL OR v.business_unit_id IS NULL OR o.business_unit_id = v.business_unit_id)
     AND (o.currency IS NULL OR v.currency IS NULL OR o.currency = v.currency)
     AND (o.min_amount IS NULL OR v.max_amount IS NULL OR o.min_amount < v.max_amount)
     AND (v.min_amount IS NULL OR o.max_amount IS NULL OR v.min_amount < o.max_amount)
     -- Uma versão ANTERIOR da MESMA política não é conflito: ela vai ser
     -- sucedida logo abaixo, nesta mesma transação.
     AND NOT (p_supersede_previous AND o.policy_id = v.policy_id);

  IF clash IS NOT NULL THEN
    RAISE EXCEPTION
      'Ambiguidade de seleção: esta versão casaria junto com % na mesma precedência (%). Declare precedência ou restrinja a aplicabilidade.',
      clash, v.precedence USING ERRCODE = 'check_violation';
  END IF;

  IF p_supersede_previous THEN
    UPDATE public.approval_policy_versions
       SET status = 'SUPERSEDED', superseded_by_version_id = v.id
     WHERE organization_id = v.organization_id AND policy_id = v.policy_id
       AND id <> v.id AND status = 'ACTIVE';
  END IF;

  UPDATE public.approval_policy_versions
     SET status = 'ACTIVE', validated_at = now(), activated_at = now(), activated_by = actor
   WHERE id = v.id;

  RETURN v.id;
END $$;

REVOKE ALL ON FUNCTION public.approval_policy_activate(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approval_policy_activate(uuid, boolean) TO authenticated;

-- ------------------------------------------------------------
-- 9) Seleção determinística — §10
-- ------------------------------------------------------------
-- Devolve NO MÁXIMO uma versão. Zero casamentos devolve NULL, e cabe ao
-- domínio decidir se isso significa "não governado" ou "não suportado" — o
-- motor não inventa política para preencher o vazio.
--
-- Nenhum LLM. Nenhuma expressão do usuário. Só as colunas estruturadas acima.
CREATE FUNCTION public.approval_policy_select(
  p_organization_id uuid,
  p_subject_type    text,
  p_action_type     text,
  p_decision_purpose text,
  p_amount          numeric      DEFAULT NULL,
  p_currency        text         DEFAULT NULL,
  p_contract_type   text         DEFAULT NULL,
  p_risk_class      text         DEFAULT NULL,
  p_cost_center_id  uuid         DEFAULT NULL,
  p_business_unit_id uuid        DEFAULT NULL,
  p_at              timestamptz  DEFAULT now()
) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  matches uuid[];
  top_prec integer;
  names   text;
BEGIN
  /*
    Uma consulta só, sem tabela temporária: a função é STABLE e não pode
    escrever. `matches` guarda apenas as versões empatadas na MAIOR
    precedência — que é exatamente o conjunto sobre o qual a decisão recai.
  */
  WITH candidate AS (
    SELECT v.id, v.precedence
      FROM public.approval_policy_versions v
     WHERE v.organization_id  = p_organization_id
       AND v.status           = 'ACTIVE'
       AND v.subject_type     = p_subject_type
       AND v.action_type      = p_action_type
       AND v.decision_purpose = p_decision_purpose
       AND v.effective_from  <= p_at
       AND (v.effective_until IS NULL OR v.effective_until > p_at)
       -- Condição NULA na política = não restringe. Condição declarada exige
       -- que o contexto a satisfaça; contexto DESCONHECIDO não satisfaz nada —
       -- ausência nunca vira "atende" (invariante da arquitetura).
       AND (v.contract_type    IS NULL OR v.contract_type    = p_contract_type)
       AND (v.risk_class       IS NULL OR v.risk_class       = p_risk_class)
       AND (v.cost_center_id   IS NULL OR v.cost_center_id   = p_cost_center_id)
       AND (v.business_unit_id IS NULL OR v.business_unit_id = p_business_unit_id)
       -- Faixa de valor exige moeda IGUAL. Não há conversão (§18).
       AND (v.min_amount IS NULL OR (p_amount IS NOT NULL AND v.currency = p_currency AND p_amount >= v.min_amount))
       AND (v.max_amount IS NULL OR (p_amount IS NOT NULL AND v.currency = p_currency AND p_amount <  v.max_amount))
       AND (v.currency IS NULL OR p_currency IS NULL OR v.currency = p_currency)
  )
  SELECT max(precedence) INTO top_prec FROM candidate;

  IF top_prec IS NULL THEN RETURN NULL; END IF;

  SELECT array_agg(v.id) INTO matches
    FROM public.approval_policy_versions v
   WHERE v.organization_id  = p_organization_id
     AND v.status           = 'ACTIVE'
     AND v.subject_type     = p_subject_type
     AND v.action_type      = p_action_type
     AND v.decision_purpose = p_decision_purpose
     AND v.precedence       = top_prec
     AND v.effective_from  <= p_at
     AND (v.effective_until IS NULL OR v.effective_until > p_at)
     AND (v.contract_type    IS NULL OR v.contract_type    = p_contract_type)
     AND (v.risk_class       IS NULL OR v.risk_class       = p_risk_class)
     AND (v.cost_center_id   IS NULL OR v.cost_center_id   = p_cost_center_id)
     AND (v.business_unit_id IS NULL OR v.business_unit_id = p_business_unit_id)
     AND (v.min_amount IS NULL OR (p_amount IS NOT NULL AND v.currency = p_currency AND p_amount >= v.min_amount))
     AND (v.max_amount IS NULL OR (p_amount IS NOT NULL AND v.currency = p_currency AND p_amount <  v.max_amount))
     AND (v.currency IS NULL OR p_currency IS NULL OR v.currency = p_currency);

  IF array_length(matches, 1) > 1 THEN
    SELECT string_agg(format('%s v%s', p.policy_key, v.version_no), ', ')
      INTO names
      FROM public.approval_policy_versions v
      JOIN public.approval_policies p ON p.id = v.policy_id
     WHERE v.id = ANY (matches);
    RAISE EXCEPTION
      'Seleção de política ambígua: % casam com a mesma precedência (%). Nenhuma é escolhida.',
      names, top_prec USING ERRCODE = 'check_violation';
  END IF;

  RETURN matches[1];
END $$;

REVOKE ALL ON FUNCTION public.approval_policy_select(uuid, text, text, text, numeric, text, text, text, uuid, uuid, timestamptz) FROM PUBLIC;

COMMENT ON FUNCTION public.approval_policy_select(uuid, text, text, text, numeric, text, text, text, uuid, uuid, timestamptz) IS
  'Seleção DETERMINÍSTICA. Zero casamentos = NULL (o domínio decide o que '
  'isso significa). Empate na maior precedência = erro, nunca "a mais recente".';

-- ------------------------------------------------------------
-- 10) RLS — leitura no mesmo inquilino; escrita por rota controlada
-- ------------------------------------------------------------
ALTER TABLE public.approval_policies        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_policy_stages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_policy_steps    ENABLE ROW LEVEL SECURITY;

CREATE POLICY approval_policies_select ON public.approval_policies FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.current_user_is_admin() OR public.current_user_has_permission('approvals.view')));
CREATE POLICY approval_policy_versions_select ON public.approval_policy_versions FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.current_user_is_admin() OR public.current_user_has_permission('approvals.view')));
CREATE POLICY approval_policy_stages_select ON public.approval_policy_stages FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.current_user_is_admin() OR public.current_user_has_permission('approvals.view')));
CREATE POLICY approval_policy_steps_select ON public.approval_policy_steps FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.current_user_is_admin() OR public.current_user_has_permission('approvals.view')));

-- Desenho de política é escrita governada, e passa por permissão explícita.
-- Note que NÃO existe policy de escrita para pedidos, etapas ou decisões nas
-- migrations seguintes: aquilo só se escreve por RPC.
CREATE POLICY approval_policies_write ON public.approval_policies FOR ALL TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.current_user_is_admin() OR public.current_user_has_permission('approvals.policy.manage')))
  WITH CHECK (organization_id = public.current_user_organization_id()
         AND (public.current_user_is_admin() OR public.current_user_has_permission('approvals.policy.manage')));
CREATE POLICY approval_policy_versions_write ON public.approval_policy_versions FOR ALL TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.current_user_is_admin() OR public.current_user_has_permission('approvals.policy.manage')))
  WITH CHECK (organization_id = public.current_user_organization_id()
         AND (public.current_user_is_admin() OR public.current_user_has_permission('approvals.policy.manage')));
CREATE POLICY approval_policy_stages_write ON public.approval_policy_stages FOR ALL TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.current_user_is_admin() OR public.current_user_has_permission('approvals.policy.manage')))
  WITH CHECK (organization_id = public.current_user_organization_id()
         AND (public.current_user_is_admin() OR public.current_user_has_permission('approvals.policy.manage')));
CREATE POLICY approval_policy_steps_write ON public.approval_policy_steps FOR ALL TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.current_user_is_admin() OR public.current_user_has_permission('approvals.policy.manage')))
  WITH CHECK (organization_id = public.current_user_organization_id()
         AND (public.current_user_is_admin() OR public.current_user_has_permission('approvals.policy.manage')));

-- Concessões explícitas. TRUNCATE não está aqui e não pode voltar (118).
GRANT SELECT ON public.approval_policies, public.approval_policy_versions,
                public.approval_policy_stages, public.approval_policy_steps TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.approval_policies, public.approval_policy_versions,
                public.approval_policy_stages, public.approval_policy_steps TO authenticated;
REVOKE ALL ON public.approval_policies, public.approval_policy_versions,
              public.approval_policy_stages, public.approval_policy_steps FROM anon;

-- ------------------------------------------------------------
-- 11) Permissões — VOCABULÁRIO, não política de negócio
-- ------------------------------------------------------------
-- Semear chave de permissão é seguro (§34): é vocabulário do sistema. Semear
-- política de aprovação com aprovador e alçada NÃO é, e esta migration não faz.
INSERT INTO public.permissions (key, module, action, description) VALUES
  ('approvals.view',          'approvals', 'view',          'Ver pedidos, etapas e histórico de decisão de aprovação'),
  ('approvals.request',       'approvals', 'request',       'Solicitar aprovação de uma ação governada'),
  ('approvals.decide',        'approvals', 'decide',        'Decidir etapa de aprovação quando elegível'),
  ('approvals.delegate',      'approvals', 'delegate',      'Delegar a própria autoridade de decisão por prazo determinado'),
  ('approvals.policy.manage', 'approvals', 'policy_manage', 'Desenhar, versionar e ativar políticas de aprovação'),
  ('approvals.admin',         'approvals', 'admin',         'Administrar o motor de aprovação (NÃO concede alçada nem dispensa SoD)')
ON CONFLICT (key) DO NOTHING;

-- owner_admin recebe as chaves ADMINISTRATIVAS e de leitura.
--
-- `approvals.decide` NÃO entra por padrão, e isso é o ponto: a §35 diz que
-- administrar o motor não é ter autoridade de negócio. Um administrador que
-- ganhasse alçada de decisão só por ser administrador tornaria a segregação de
-- funções decorativa. Quem decide é quem a POLÍTICA elege.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
 WHERE r.key = 'owner_admin' AND r.organization_id IS NULL
   AND p.key IN ('approvals.view','approvals.request','approvals.delegate','approvals.policy.manage','approvals.admin')
ON CONFLICT DO NOTHING;

-- Quem já acompanha contrato passa a enxergar a governança dele.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
 WHERE r.key IN ('ceo_diretoria','juridico_contratos','financeiro') AND r.organization_id IS NULL
   AND p.key IN ('approvals.view','approvals.request')
ON CONFLICT DO NOTHING;

COMMIT;
