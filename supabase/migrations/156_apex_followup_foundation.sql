-- ============================================================================
-- PLATAFORMA — Operacionalização (3/3): fundação do ACOMPANHAMENTO do Apex
-- Migration: 156_apex_followup_foundation
--
-- ─── O que isto é, e o que NÃO é ───────────────────────────────────────────
--
-- É a fundação transversal de ACOMPANHAMENTO governado: o Apex identifica algo
-- material, um humano diz quem responde por aquilo, e a partir daí o Apex é
-- dono do acompanhamento — cobra, espera quando a resposta é de terceiro,
-- escala quando precisa, verifica evidência e fecha quando a verificação passa.
--
-- NÃO é o planejador autônomo da Fase 10, não escolhe ferramenta sozinho, não
-- decide questão jurídica e não age fora do escopo em que foi ancorado. É
-- deliberadamente pequeno: fila de estado + cadência + verificação.
--
-- ─── Por que na plataforma, e não dentro de Contratos ──────────────────────
--
-- Um acompanhamento é sobre uma OBRIGAÇÃO, um RISCO, uma CONDIÇÃO DE
-- FATURAMENTO — e amanhã sobre coisas de outros módulos. Colocá-lo dentro de
-- Contratos criaria a terceira lista de tarefas do produto e obrigaria o
-- próximo módulo a duplicá-la. Ele é organization-scoped e protegido por RLS
-- como qualquer verdade de inquilino.
--
-- ─── A regra que impede spam ───────────────────────────────────────────────
--
-- "O cliente está analisando o aditivo. Resposta esperada em 15/09."
--
-- Isso é um ESTADO — WAITING_EXTERNAL_PARTY — com um próximo evento esperado.
-- Enquanto a data não chega, `apex_followup_due_nudges()` não devolve a linha.
-- Cobrar todo dia alguém que já respondeu é a forma mais rápida de fazer o
-- produto inteiro virar ruído.
--
-- ─── Autoridade ────────────────────────────────────────────────────────────
--
-- Designar responsável é ato humano. Fechar por CONFIRMAÇÃO humana é ato
-- humano. Fechar por EVIDÊNCIA VERIFICADA é ato do Apex — e só quando a regra
-- de verificação é determinística. O gatilho recusa qualquer tentativa de
-- fabricar o primeiro tipo a partir de conexão sem sessão.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Vocabulários
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apex_followup_states() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY[
  'ACTIVE',
  'WAITING_EXTERNAL_PARTY',
  'BLOCKED',
  'COMPLETED',
  'ESCALATED',
  'CANCELLED'
] $$;

CREATE OR REPLACE FUNCTION public.apex_followup_source_kinds() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY[
  'contract',
  'contract_clause',
  'contract_obligation_instance',
  'contract_billing_condition',
  'contract_risk',
  'contract_guarantee',
  'contract_insurance_requirement'
] $$;

-- ---------------------------------------------------------------------------
-- 2) O acompanhamento
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.apex_followups (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- ---- de onde nasceu ----
  source_kind        text NOT NULL,
  source_id          uuid NOT NULL,
  -- Denormalizado para filtro por contrato sem sete JOINs condicionais. NULL
  -- quando o acompanhamento não é de contrato.
  contract_id        uuid,

  -- ---- o que se quer que aconteça ----
  goal               text NOT NULL CHECK (btrim(goal) <> ''),
  expected_evidence  text,

  -- ---- quem responde ----
  -- Pessoa interna OU parte externa OU texto. Uma das três, nunca nenhuma:
  -- acompanhamento sem responsável é lembrete, e lembrete não é governança.
  responsible_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  responsible_party_id uuid,
  responsible_text     text,
  assigned_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at          timestamptz,

  -- ---- tempo ----
  due_date              date,
  -- O que o Apex está esperando acontecer, e quando. É isto que cala a cobrança
  -- diária enquanto a bola está com o outro lado.
  next_expected_event      text,
  next_expected_event_at   date,
  -- Cadência de cobrança em dias. NULL = o Apex não cobra por tempo; ele espera
  -- o próximo evento esperado.
  cadence_days          integer CHECK (cadence_days IS NULL OR cadence_days > 0),
  last_nudge_at         timestamptz,
  nudge_count           integer NOT NULL DEFAULT 0 CHECK (nudge_count >= 0),

  -- ---- escalonamento ----
  escalate_after_days   integer CHECK (escalate_after_days IS NULL OR escalate_after_days > 0),
  escalation_target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  escalated_at          timestamptz,

  -- ---- verificação ----
  -- 'deterministic_evidence': existe uma regra conferível (documento válido,
  -- CNPJ certo, cobertura de data). 'human_confirmation': não existe, e aí é
  -- pessoa que confirma. Não há terceira opção — "confiar no clique" é a
  -- primeira disfarçada de segunda.
  verification_mode     text NOT NULL DEFAULT 'human_confirmation',
  verification_rule     jsonb,
  verified_at           timestamptz,
  verified_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verification_evidence_id uuid,

  -- ---- estado ----
  state                 text NOT NULL DEFAULT 'ACTIVE',
  state_note            text,
  closure_basis         text,
  closed_at             timestamptz,

  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT af_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT af_source_kind CHECK (source_kind = ANY (public.apex_followup_source_kinds())),
  CONSTRAINT af_state CHECK (state = ANY (public.apex_followup_states())),
  CONSTRAINT af_contract_tenant FOREIGN KEY (organization_id, contract_id)
    REFERENCES public.contracts (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT af_party_tenant FOREIGN KEY (organization_id, responsible_party_id)
    REFERENCES public.parties (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT af_verification_mode CHECK (verification_mode IN ('deterministic_evidence','human_confirmation')),
  CONSTRAINT af_closure_basis CHECK (closure_basis IS NULL OR closure_basis IN
    ('verified_evidence','human_confirmation','no_longer_applicable','superseded')),
  -- Fechado exige base de fechamento; aberto não pode ter uma.
  CONSTRAINT af_closed_has_basis CHECK ((state = 'COMPLETED') = (closure_basis IS NOT NULL)),
  CONSTRAINT af_closed_at CHECK ((state IN ('COMPLETED','CANCELLED')) = (closed_at IS NOT NULL)),
  -- Espera de terceiro sem evento esperado é só um jeito de nunca mais cobrar.
  CONSTRAINT af_waiting_has_expectation CHECK (
    state <> 'WAITING_EXTERNAL_PARTY' OR next_expected_event_at IS NOT NULL),
  CONSTRAINT af_has_responsible CHECK (
    responsible_user_id IS NOT NULL
    OR responsible_party_id IS NOT NULL
    OR btrim(coalesce(responsible_text,'')) <> ''),
  CONSTRAINT af_assignment_stamp CHECK ((assigned_at IS NULL) = (assigned_by IS NULL)),
  CONSTRAINT af_verification_stamp CHECK (verified_at IS NULL OR verification_evidence_id IS NOT NULL OR verified_by IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS af_open ON public.apex_followups (organization_id, state, due_date)
  WHERE state IN ('ACTIVE','WAITING_EXTERNAL_PARTY','BLOCKED','ESCALATED');
CREATE INDEX IF NOT EXISTS af_source ON public.apex_followups (organization_id, source_kind, source_id);
CREATE INDEX IF NOT EXISTS af_contract ON public.apex_followups (organization_id, contract_id)
  WHERE contract_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS af_responsible ON public.apex_followups (organization_id, responsible_user_id)
  WHERE responsible_user_id IS NOT NULL;

COMMENT ON TABLE public.apex_followups IS
  'ACOMPANHAMENTO governado do Apex. Não é lista de tarefas: cada linha tem '
  'objetivo, responsável, evidência esperada, próximo evento esperado, política '
  'de escalonamento e regra de verificação. O Apex é dono do acompanhamento; a '
  'AUTORIDADE continua humana.';
COMMENT ON COLUMN public.apex_followups.next_expected_event_at IS
  'Enquanto esta data não chega, o Apex NÃO cobra. É o que separa acompanhar de '
  'importunar.';

-- ---------------------------------------------------------------------------
-- 3) Histórico — append-only
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.apex_followup_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  followup_id      uuid NOT NULL,
  event_type       text NOT NULL,
  previous_state   text,
  next_state       text,
  -- Quem agiu: pessoa ou o próprio Apex. Sem esta coluna, "o Apex cobrou" e
  -- "alguém cobrou" viram a mesma linha de auditoria.
  actor_kind       text NOT NULL DEFAULT 'apex' CHECK (actor_kind IN ('human','apex')),
  actor_user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note             text,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT afe_followup_tenant FOREIGN KEY (organization_id, followup_id)
    REFERENCES public.apex_followups (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT afe_event_type CHECK (event_type IN
    ('created','assigned','nudged','state_changed','evidence_received',
     'verified','escalated','closed','cancelled','note')),
  -- Ato humano carrega usuário; ato do Apex não carrega usuário nenhum.
  CONSTRAINT afe_actor_coherent CHECK (
    (actor_kind = 'human') = (actor_user_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS afe_by_followup ON public.apex_followup_events (followup_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.apex_followups_reject_history_rewrite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Histórico de acompanhamento é append-only.' USING ERRCODE = 'restrict_violation';
END $$;
REVOKE ALL ON FUNCTION public.apex_followups_reject_history_rewrite() FROM PUBLIC;
DROP TRIGGER IF EXISTS afe_append_only ON public.apex_followup_events;
CREATE TRIGGER afe_append_only BEFORE UPDATE OR DELETE ON public.apex_followup_events
  FOR EACH ROW EXECUTE FUNCTION public.apex_followups_reject_history_rewrite();

-- ---------------------------------------------------------------------------
-- 4) Máquina de estados
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apex_followup_valid_transition(p_from text, p_to text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_from = p_to THEN true
    WHEN p_from = 'ACTIVE'  THEN p_to IN ('WAITING_EXTERNAL_PARTY','BLOCKED','ESCALATED','COMPLETED','CANCELLED')
    WHEN p_from = 'WAITING_EXTERNAL_PARTY' THEN p_to IN ('ACTIVE','BLOCKED','ESCALATED','COMPLETED','CANCELLED')
    WHEN p_from = 'BLOCKED' THEN p_to IN ('ACTIVE','WAITING_EXTERNAL_PARTY','ESCALATED','COMPLETED','CANCELLED')
    WHEN p_from = 'ESCALATED' THEN p_to IN ('ACTIVE','WAITING_EXTERNAL_PARTY','BLOCKED','COMPLETED','CANCELLED')
    -- Terminal é terminal: reabrir apagaria a razão pela qual foi fechado.
    ELSE false
  END
$$;

-- ---------------------------------------------------------------------------
-- 5) Guardas de autoridade
-- ---------------------------------------------------------------------------
-- Mesma doutrina da 153/154: o que é ato humano exige sessão humana. Uma
-- conexão de service role pode CRIAR acompanhamento (o Apex identificou algo)
-- mas não pode designar responsável nem declarar confirmação humana.
CREATE OR REPLACE FUNCTION public.apex_followups_guard_authority() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
    IF NOT public.apex_followup_valid_transition(OLD.state, NEW.state) THEN
      RAISE EXCEPTION 'Transição de acompanhamento inválida: % -> %.', OLD.state, NEW.state
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Designar responsável é ato humano.
  IF NEW.assigned_by IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.assigned_by IS DISTINCT FROM NEW.assigned_by) THEN
    IF _uid IS NULL THEN
      RAISE EXCEPTION
        'GOVERNANCE VIOLATION: assigned_by requires an authenticated user session (auth.uid() is NULL). '
        'Apex may create a follow-up; only a human assigns responsibility.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.assigned_by IS DISTINCT FROM _uid THEN
      RAISE EXCEPTION
        'GOVERNANCE VIOLATION: assigned_by (%) does not match the authenticated session user (%).',
        NEW.assigned_by, _uid USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- Confirmação humana é ato humano — e o carimbo é de quem confirmou.
  IF NEW.verified_by IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.verified_by IS DISTINCT FROM NEW.verified_by) THEN
    IF _uid IS NULL THEN
      RAISE EXCEPTION
        'GOVERNANCE VIOLATION: verified_by requires an authenticated user session (auth.uid() is NULL). '
        'AI agents, scripts, and service-role connections must not fabricate human verification.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.verified_by IS DISTINCT FROM _uid THEN
      RAISE EXCEPTION
        'GOVERNANCE VIOLATION: verified_by (%) does not match the authenticated session user (%).',
        NEW.verified_by, _uid USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- Fechar por confirmação humana exige a confirmação humana de verdade.
  IF NEW.closure_basis = 'human_confirmation'
     AND (TG_OP = 'INSERT' OR OLD.closure_basis IS DISTINCT FROM NEW.closure_basis) THEN
    IF _uid IS NULL OR NEW.verified_by IS NULL THEN
      RAISE EXCEPTION
        'GOVERNANCE VIOLATION: closure_basis "human_confirmation" requires an authenticated '
        'user session and a verified_by stamp.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- Fechar por evidência verificada só quando a verificação É determinística.
  -- Caso contrário o Apex estaria dizendo "conferi" sobre algo que ninguém
  -- programou para conferir.
  IF NEW.closure_basis = 'verified_evidence'
     AND (TG_OP = 'INSERT' OR OLD.closure_basis IS DISTINCT FROM NEW.closure_basis) THEN
    IF NEW.verification_mode <> 'deterministic_evidence' THEN
      RAISE EXCEPTION
        'GOVERNANCE VIOLATION: closure_basis "verified_evidence" requires verification_mode '
        '"deterministic_evidence". Without a deterministic rule the closure needs human confirmation.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.verification_evidence_id IS NULL THEN
      RAISE EXCEPTION
        'GOVERNANCE VIOLATION: closure_basis "verified_evidence" requires the evidence that was verified.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.apex_followups_guard_authority() FROM PUBLIC;
DROP TRIGGER IF EXISTS af_guard_authority ON public.apex_followups;
CREATE TRIGGER af_guard_authority BEFORE INSERT OR UPDATE ON public.apex_followups
  FOR EACH ROW EXECUTE FUNCTION public.apex_followups_guard_authority();

-- Nascimento e transição vão para o histórico sem que ninguém precise lembrar.
CREATE OR REPLACE FUNCTION public.apex_followups_record_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.apex_followup_events
      (organization_id, followup_id, event_type, previous_state, next_state,
       actor_kind, actor_user_id, note)
    VALUES (NEW.organization_id, NEW.id, 'created', NULL, NEW.state,
            CASE WHEN _uid IS NULL THEN 'apex' ELSE 'human' END, _uid, NEW.state_note);
    RETURN NEW;
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO public.apex_followup_events
      (organization_id, followup_id, event_type, previous_state, next_state,
       actor_kind, actor_user_id, note)
    VALUES (NEW.organization_id, NEW.id,
            CASE WHEN NEW.state = 'COMPLETED' THEN 'closed'
                 WHEN NEW.state = 'CANCELLED' THEN 'cancelled'
                 WHEN NEW.state = 'ESCALATED' THEN 'escalated'
                 ELSE 'state_changed' END,
            OLD.state, NEW.state,
            CASE WHEN _uid IS NULL THEN 'apex' ELSE 'human' END, _uid, NEW.state_note);
  END IF;

  IF NEW.last_nudge_at IS DISTINCT FROM OLD.last_nudge_at AND NEW.last_nudge_at IS NOT NULL THEN
    INSERT INTO public.apex_followup_events
      (organization_id, followup_id, event_type, actor_kind, actor_user_id, note)
    VALUES (NEW.organization_id, NEW.id, 'nudged',
            CASE WHEN _uid IS NULL THEN 'apex' ELSE 'human' END, _uid, NEW.next_expected_event);
  END IF;

  IF NEW.assigned_at IS DISTINCT FROM OLD.assigned_at AND NEW.assigned_at IS NOT NULL THEN
    INSERT INTO public.apex_followup_events
      (organization_id, followup_id, event_type, actor_kind, actor_user_id, note)
    VALUES (NEW.organization_id, NEW.id, 'assigned', 'human', NEW.assigned_by, NEW.responsible_text);
  END IF;

  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.apex_followups_record_event() FROM PUBLIC;
DROP TRIGGER IF EXISTS af_record_event ON public.apex_followups;
CREATE TRIGGER af_record_event AFTER INSERT OR UPDATE ON public.apex_followups
  FOR EACH ROW EXECUTE FUNCTION public.apex_followups_record_event();

-- ---------------------------------------------------------------------------
-- 6) A cobrança que não vira spam
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apex_followup_due_nudges(
  p_organization_id uuid,
  p_as_of           date DEFAULT CURRENT_DATE
) RETURNS TABLE (
  id uuid, state text, goal text, responsible_user_id uuid,
  due_date date, next_expected_event_at date, reason text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT f.id, f.state, f.goal, f.responsible_user_id, f.due_date, f.next_expected_event_at,
         CASE
           WHEN f.state = 'WAITING_EXTERNAL_PARTY' THEN 'expected_event_reached'
           WHEN f.due_date IS NOT NULL AND f.due_date < p_as_of THEN 'overdue'
           ELSE 'cadence'
         END AS reason
    FROM public.apex_followups f
   WHERE f.organization_id = p_organization_id
     AND f.state IN ('ACTIVE','WAITING_EXTERNAL_PARTY','BLOCKED','ESCALATED')
     -- Enquanto a bola está com o outro lado E a data esperada não chegou,
     -- não se cobra. É a regra inteira do §18.
     AND (f.state <> 'WAITING_EXTERNAL_PARTY'
          OR (f.next_expected_event_at IS NOT NULL AND f.next_expected_event_at <= p_as_of))
     -- Respeita a cadência: cobrado há menos de `cadence_days`, não cobra de novo.
     AND (f.last_nudge_at IS NULL
          OR f.cadence_days IS NULL
          OR (p_as_of - f.last_nudge_at::date) >= f.cadence_days)
     -- Sem cadência e sem prazo vencido e sem evento esperado atingido, não há
     -- motivo para falar com ninguém.
     AND (f.cadence_days IS NOT NULL
          OR (f.due_date IS NOT NULL AND f.due_date <= p_as_of)
          OR (f.state = 'WAITING_EXTERNAL_PARTY' AND f.next_expected_event_at <= p_as_of))
$$;

COMMENT ON FUNCTION public.apex_followup_due_nudges(uuid, date) IS
  'Quem o Apex deve cobrar HOJE. WAITING_EXTERNAL_PARTY só entra quando o '
  'próximo evento esperado chega; cadência já cumprida não reentra.';

CREATE OR REPLACE FUNCTION public.apex_followup_should_escalate(
  p_organization_id uuid,
  p_as_of           date DEFAULT CURRENT_DATE
) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT f.id
    FROM public.apex_followups f
   WHERE f.organization_id = p_organization_id
     AND f.state IN ('ACTIVE','WAITING_EXTERNAL_PARTY','BLOCKED')
     AND f.escalate_after_days IS NOT NULL
     AND f.due_date IS NOT NULL
     AND (p_as_of - f.due_date) >= f.escalate_after_days
     AND f.escalated_at IS NULL
$$;

REVOKE ALL ON FUNCTION public.apex_followup_due_nudges(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apex_followup_due_nudges(uuid, date) TO authenticated;
REVOKE ALL ON FUNCTION public.apex_followup_should_escalate(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apex_followup_should_escalate(uuid, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7) RLS
-- ---------------------------------------------------------------------------
-- Leitura por inquilino; escrita só pelo caminho servidor governado, como o
-- resto do módulo. Nenhuma mutação direta pelo navegador.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['apex_followups','apex_followup_events']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (organization_id = public.current_user_organization_id())',
                   t || '_read', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM authenticated, anon', t);
  END LOOP;
END $$;

COMMIT;
