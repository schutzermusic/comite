-- ============================================================================
-- CONTRACTS — Operacionalização (1/3): interpretação estruturada e
-- governança POR EXCEÇÃO
-- Migration: 154_contract_interpretation_governance
--
-- ─── O modelo que sai ──────────────────────────────────────────────────────
--
-- Até aqui toda leitura de documento nascia `review_status = 'draft'` e ficava
-- numa FILA aguardando que um humano a validasse uma por uma. Isso descrevia o
-- Apex como um assistente que PROPÕE cláusulas e espera aprovação — e a
-- cláusula não é do Apex: ela já existe, assinada, no contrato que o cliente
-- mandou. Pedir que alguém certifique que a máquina leu cada frase é trabalho
-- de conferência, não de autoridade; e com 195 páginas de contrato a fila
-- vira o próprio motivo de ninguém olhar o que importa.
--
-- ─── O modelo que entra ────────────────────────────────────────────────────
--
-- A leitura vira INTERPRETAÇÃO ESTRUTURADA. Ela é do Apex, é derivada do
-- documento, carrega proveniência, e NÃO é verdade contratual — verdade
-- contratual é o PDF assinado, que continua intacto e acessível.
--
-- Uma interpretação bem evidenciada é estruturada automaticamente
-- (`interpretation_state = 'structured'`). Atenção humana é EXCEÇÃO, e a
-- exceção é DETERMINÍSTICA: `contracts_interpretation_attention_reasons()`
-- devolve os motivos a partir do que está gravado — confiança baixa, risco
-- material, exposição financeira, ambiguidade, conflito, responsabilidade
-- indefinida. Sem motivo, sem fila.
--
-- ─── O que NÃO muda ────────────────────────────────────────────────────────
--
-- `review_status` continua existindo com o mesmo vocabulário e a mesma
-- trilha: uma decisão humana já registrada é história e não é reescrita. O
-- gatilho de personificação da 153 continua valendo, e esta migration o
-- ESTENDE para os campos novos: nem IA, nem script, nem service role podem
-- fabricar confirmação humana ou baixa de atenção.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Vocabulários
-- ---------------------------------------------------------------------------
-- Função em vez de ENUM, pelo mesmo motivo da 114: acrescentar valor a ENUM em
-- produção trava a tabela, e este vocabulário ainda vai crescer.
CREATE OR REPLACE FUNCTION public.contract_interpretation_states() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY[
  'structured',         -- o Apex estruturou; evidência suficiente, sem exceção
  'requires_attention', -- exceção de política: alguém precisa DECIDIR algo
  'human_confirmed',    -- um humano olhou e confirmou (ato de autoridade)
  'dismissed'           -- um humano descartou a interpretação
] $$;

CREATE OR REPLACE FUNCTION public.contract_interpretation_attention_codes() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY[
  'low_confidence',
  'legal_ambiguity',
  'conflicting_clauses',
  'amendment_precedence_conflict',
  'unclear_party_responsibility',
  'material_financial_exposure',
  'material_contractual_risk',
  'possible_legal_commitment',
  'possible_contract_amendment',
  'exceptional_billing_treatment',
  'risk_acceptance',
  'authority_required',
  'human_only_policy',
  'never_automated_action'
] $$;

-- ---------------------------------------------------------------------------
-- 2) Colunas
-- ---------------------------------------------------------------------------
ALTER TABLE public.contract_clauses
  ADD COLUMN IF NOT EXISTS interpretation_state   text,
  ADD COLUMN IF NOT EXISTS attention_reasons      text[],
  -- Exposição financeira que motivou a atenção, quando houve. NULL = não
  -- houve exposição APURADA — nunca "exposição zero".
  ADD COLUMN IF NOT EXISTS attention_exposure     numeric,
  ADD COLUMN IF NOT EXISTS attention_resolved_at  timestamptz,
  ADD COLUMN IF NOT EXISTS attention_resolved_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attention_resolution_note text,
  -- Versão da política de exceção que classificou esta linha. Sem isso não dá
  -- para saber, meses depois, POR QUE aquela leitura não pediu atenção.
  ADD COLUMN IF NOT EXISTS attention_policy_version text;

ALTER TABLE public.contract_clauses DROP CONSTRAINT IF EXISTS contract_clauses_interpretation_state_check;
ALTER TABLE public.contract_clauses
  ADD CONSTRAINT contract_clauses_interpretation_state_check
  CHECK (interpretation_state IS NULL
         OR interpretation_state = ANY (public.contract_interpretation_states()));

ALTER TABLE public.contract_clauses DROP CONSTRAINT IF EXISTS contract_clauses_attention_codes_check;
ALTER TABLE public.contract_clauses
  ADD CONSTRAINT contract_clauses_attention_codes_check
  CHECK (attention_reasons IS NULL
         OR attention_reasons <@ public.contract_interpretation_attention_codes());

-- Baixa de atenção é ato humano: exige carimbo COMPLETO ou nenhum.
ALTER TABLE public.contract_clauses DROP CONSTRAINT IF EXISTS contract_clauses_attention_resolution_check;
ALTER TABLE public.contract_clauses
  ADD CONSTRAINT contract_clauses_attention_resolution_check
  CHECK ((attention_resolved_at IS NULL) = (attention_resolved_by IS NULL));

COMMENT ON COLUMN public.contract_clauses.interpretation_state IS
  'Estado da INTERPRETAÇÃO do Apex — não da cláusula. A cláusula existe no '
  'contrato assinado independentemente disto. structured = o Apex estruturou '
  'sem exceção de política; requires_attention = exceção que exige decisão '
  'humana; human_confirmed/dismissed = ato humano registrado.';
COMMENT ON COLUMN public.contract_clauses.attention_reasons IS
  'POR QUE esta interpretação exige atenção. Vazio/NULL = nenhuma exceção — e '
  'nenhuma fila. Derivado deterministicamente por '
  'contracts_interpretation_attention_reasons().';
COMMENT ON COLUMN public.contract_clauses.review_status IS
  'LEGADO de fluxo. A governança operacional passou a ser interpretation_state '
  '+ attention_reasons: leitura bem evidenciada não fica em fila. review_status '
  'segue gravado porque decisão humana já registrada é história.';

-- ---------------------------------------------------------------------------
-- 3) A política de exceção — determinística, no banco
-- ---------------------------------------------------------------------------
-- Mora aqui, e não só no TypeScript, porque é ela que decide se um item entra
-- ou não na fila de autoridade humana. Uma política de autoridade que só
-- existe na camada de aplicação é uma política que o próximo script contorna.
CREATE OR REPLACE FUNCTION public.contract_interpretation_policy_version() RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT 'contract-attention-policy/1.0.0'::text $$;

-- Limiar de exposição material. Constante nomeada em vez de literal solto: o
-- valor é uma decisão de negócio e precisa ser encontrável.
CREATE OR REPLACE FUNCTION public.contract_interpretation_material_amount() RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$ SELECT 100000::numeric $$;

CREATE OR REPLACE FUNCTION public.contract_interpretation_attention_reasons(
  p_ai_flagged   boolean,
  p_confidence   numeric,
  p_risk_level   text,
  p_amount       numeric,
  p_clause_type  text,
  p_source_excerpt text,
  p_source_page  integer
) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE reasons text[] := ARRAY[]::text[];
BEGIN
  -- Leitura de máquina sem evidência conferível não é interpretação: é
  -- afirmação. Ela nunca é estruturada em silêncio.
  IF p_ai_flagged AND (p_source_page IS NULL OR btrim(coalesce(p_source_excerpt,'')) = '') THEN
    reasons := array_append(reasons, 'legal_ambiguity');
  END IF;

  -- Confiança AUSENTE numa leitura de máquina é desconhecida, não alta.
  IF p_ai_flagged AND (p_confidence IS NULL OR p_confidence < 0.75) THEN
    reasons := array_append(reasons, 'low_confidence');
  END IF;

  IF p_risk_level = 'high' THEN
    reasons := array_append(reasons, 'material_contractual_risk');
  END IF;

  IF p_amount IS NOT NULL AND abs(p_amount) >= public.contract_interpretation_material_amount() THEN
    reasons := array_append(reasons, 'material_financial_exposure');
  END IF;

  -- Categorias que comprometem juridicamente ou liberam dinheiro não são
  -- estruturadas em silêncio, por melhor que seja a leitura.
  IF p_clause_type IN ('penalidade','rescisao','responsabilidade') THEN
    reasons := array_append(reasons, 'possible_legal_commitment');
  END IF;
  IF p_clause_type = 'garantia' THEN
    reasons := array_append(reasons, 'authority_required');
  END IF;

  RETURN reasons;
END $$;

COMMENT ON FUNCTION public.contract_interpretation_attention_reasons(boolean,numeric,text,numeric,text,text,integer) IS
  'Política de EXCEÇÃO. Devolve os motivos pelos quais uma interpretação exige '
  'atenção humana. Lista vazia = o Apex estrutura sozinho. Determinística e '
  'imutável: a mesma linha classifica igual hoje e na auditoria de amanhã.';

-- ---------------------------------------------------------------------------
-- 4) Classificação automática
-- ---------------------------------------------------------------------------
-- O gatilho classifica; ele NUNCA promove nada a estado humano. `human_confirmed`
-- e `dismissed` só chegam por caminho de sessão autenticada (guarda abaixo).
CREATE OR REPLACE FUNCTION public.contracts_classify_interpretation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE reasons text[];
BEGIN
  -- Estado decidido por humano é registro, não derivação: sai intacto.
  IF NEW.interpretation_state IN ('human_confirmed','dismissed') THEN
    RETURN NEW;
  END IF;

  reasons := public.contract_interpretation_attention_reasons(
    NEW.ai_flagged, NEW.ai_confidence, NEW.risk_level, NEW.amount,
    NEW.clause_type, NEW.source_excerpt, NEW.source_page);

  NEW.attention_reasons := CASE WHEN array_length(reasons,1) IS NULL THEN NULL ELSE reasons END;
  NEW.attention_policy_version := public.contract_interpretation_policy_version();
  NEW.attention_exposure := CASE
    WHEN NEW.amount IS NOT NULL
     AND abs(NEW.amount) >= public.contract_interpretation_material_amount()
    THEN NEW.amount ELSE NULL END;

  -- Uma atenção já baixada por humano não volta sozinha à fila: o motivo fica
  -- registrado, o estado permanece estruturado. Reabri-la a cada UPDATE faria
  -- a decisão humana ser desfeita por um `touch` de coluna qualquer.
  IF NEW.attention_resolved_at IS NOT NULL THEN
    NEW.interpretation_state := 'structured';
  ELSIF NEW.attention_reasons IS NULL THEN
    NEW.interpretation_state := 'structured';
  ELSE
    NEW.interpretation_state := 'requires_attention';
  END IF;

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.contracts_classify_interpretation() FROM PUBLIC;

DROP TRIGGER IF EXISTS classify_interpretation ON public.contract_clauses;
-- Antes da guarda de personificação (ordem alfabética do nome do gatilho:
-- `classify_...` < `guard_...`), para que a guarda veja o estado final.
CREATE TRIGGER classify_interpretation
  BEFORE INSERT OR UPDATE ON public.contract_clauses
  FOR EACH ROW EXECUTE FUNCTION public.contracts_classify_interpretation();

-- ---------------------------------------------------------------------------
-- 5) Retroalimentação das linhas existentes — ANTES da guarda estendida
-- ---------------------------------------------------------------------------
-- A ordem importa: a retroalimentação roda ANTES da guarda estendida entrar em
-- vigor, porque a guarda recusa — corretamente — que qualquer caminho sem
-- sessão autenticada grave um estado humano. Uma migration NÃO tem sessão, e
-- não deveria ter: o que ela faz aqui é TRANSCREVER a decisão que a própria
-- linha já registra em review_status/reviewed_by, não criar decisão nova.
--
-- Só o estado DERIVADO é preenchido. Nenhuma decisão humana é inventada:
-- linhas já validadas/rejeitadas por humano recebem o estado humano
-- correspondente ao que ELAS JÁ REGISTRAM, e nada mais.
UPDATE public.contract_clauses SET updated_at = updated_at;  -- dispara a classificação

UPDATE public.contract_clauses
   SET interpretation_state = CASE review_status
         WHEN 'validated' THEN 'human_confirmed'
         WHEN 'rejected'  THEN 'dismissed'
         ELSE interpretation_state END
 WHERE review_status IN ('validated','rejected')
   AND reviewed_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS contract_clauses_attention
  ON public.contract_clauses (organization_id, contract_id)
  WHERE interpretation_state = 'requires_attention';

-- ---------------------------------------------------------------------------
-- 6) Guarda de personificação — ESTENDIDA
-- ---------------------------------------------------------------------------
-- A 153 protegia review_status/reviewed_by. Os campos novos criam DUAS novas
-- superfícies de autoridade — confirmar uma interpretação e baixar uma
-- atenção — e ambas seriam falsificáveis por service role se a guarda não as
-- cobrisse. Fail closed, como manda a arquitetura.
CREATE OR REPLACE FUNCTION public.contracts_guard_review_impersonation()
RETURNS TRIGGER AS $$
DECLARE
  _decision_states TEXT[] := ARRAY['validated', 'rejected'];
  _human_interpretation_states TEXT[] := ARRAY['human_confirmed', 'dismissed'];
  _session_uid UUID;
BEGIN
  _session_uid := auth.uid();

  -- Guard 1: Transition into decision state (validated or rejected)
  IF NEW.review_status = ANY(_decision_states) THEN
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.review_status IS DISTINCT FROM NEW.review_status) THEN
      IF _session_uid IS NULL THEN
        RAISE EXCEPTION
          'GOVERNANCE VIOLATION: review_status cannot be set to "%" without an authenticated user session (auth.uid() is NULL). '
          'AI agents, scripts, service-role connections, and migrations must not impersonate human reviewers.',
          NEW.review_status
        USING ERRCODE = 'insufficient_privilege';
      END IF;

      IF NEW.reviewed_by IS DISTINCT FROM _session_uid THEN
        RAISE EXCEPTION
          'GOVERNANCE VIOLATION: reviewed_by (%) does not match the authenticated session user (%). '
          'The reviewer stamp must be the actual user making the decision.',
          NEW.reviewed_by, _session_uid
        USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
  END IF;

  -- Guard 2: Setting or changing reviewed_by to any user
  IF NEW.reviewed_by IS NOT NULL THEN
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.reviewed_by IS DISTINCT FROM NEW.reviewed_by) THEN
      IF _session_uid IS NULL THEN
        RAISE EXCEPTION
          'GOVERNANCE VIOLATION: reviewed_by cannot be set without an authenticated user session (auth.uid() is NULL). '
          'AI agents, scripts, service-role connections, and migrations must not impersonate human reviewers.'
        USING ERRCODE = 'insufficient_privilege';
      END IF;

      IF NEW.reviewed_by IS DISTINCT FROM _session_uid THEN
        RAISE EXCEPTION
          'GOVERNANCE VIOLATION: reviewed_by (%) does not match the authenticated session user (%). '
          'Cannot assign review attribution to an arbitrary user.',
          NEW.reviewed_by, _session_uid
        USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
  END IF;

  -- Guard 3 (154): human interpretation states are acts of authority.
  IF NEW.interpretation_state = ANY(_human_interpretation_states) THEN
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.interpretation_state IS DISTINCT FROM NEW.interpretation_state) THEN
      IF _session_uid IS NULL THEN
        RAISE EXCEPTION
          'GOVERNANCE VIOLATION: interpretation_state cannot be set to "%" without an authenticated user session (auth.uid() is NULL). '
          'Apex structures interpretations; only a human confirms or dismisses one.',
          NEW.interpretation_state
        USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
  END IF;

  -- Guard 4 (154): clearing an attention item is a governed human decision.
  IF NEW.attention_resolved_by IS NOT NULL THEN
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.attention_resolved_by IS DISTINCT FROM NEW.attention_resolved_by) THEN
      IF _session_uid IS NULL THEN
        RAISE EXCEPTION
          'GOVERNANCE VIOLATION: attention_resolved_by cannot be set without an authenticated user session (auth.uid() is NULL). '
          'AI agents, scripts, and service-role connections must not fabricate human attention resolution.'
        USING ERRCODE = 'insufficient_privilege';
      END IF;

      IF NEW.attention_resolved_by IS DISTINCT FROM _session_uid THEN
        RAISE EXCEPTION
          'GOVERNANCE VIOLATION: attention_resolved_by (%) does not match the authenticated session user (%).',
          NEW.attention_resolved_by, _session_uid
        USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.contracts_guard_review_impersonation() IS
  'Prevents AI agents, scripts, and service-role connections from fabricating '
  'human review decisions, reviewer attribution, human interpretation '
  'confirmation, or attention resolution on contract clauses.';

DROP TRIGGER IF EXISTS guard_review_impersonation ON public.contract_clauses;
CREATE TRIGGER guard_review_impersonation
  BEFORE INSERT OR UPDATE ON public.contract_clauses
  FOR EACH ROW
  EXECUTE FUNCTION public.contracts_guard_review_impersonation();

COMMIT;
