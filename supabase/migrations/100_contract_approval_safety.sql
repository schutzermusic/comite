-- ============================================================
-- CONTRACTS V2 · PHASE 0.2 — SEGURANÇA DA APROVAÇÃO DE CONTRATOS
-- Migration: 100_contract_approval_safety
-- ============================================================
--
-- O DEFEITO, EM TRÊS PARTES
--
-- 1. AUTORIDADE ERRADA. `contract_approvals_manage` (034) concede FOR ALL a
--    quem tem `contracts.approve` OU `contracts.edit`. Nos papéis semeados,
--    `juridico_contratos` tem `edit` e NÃO tem `approve` — ou seja, exatamente
--    o papel que cadastra o contrato podia gravar `approved` em qualquer etapa.
--    A separação entre redigir e decidir existia no catálogo de permissões e
--    não existia na política.
--
-- 2. SEM WITH CHECK. A mesma política é FOR ALL sem WITH CHECK, então nada
--    restringia o CONTEÚDO da linha gravada — inclusive `reviewer_user_id`,
--    que podia apontar para outra pessoa.
--
-- 3. SEM ORDEM E SEM SEGREGAÇÃO. `submitContractApproval` é um upsert simples:
--    `diretoria` podia ser aprovada com `juridico` ainda pendente, e quem
--    cadastrou o contrato podia aprovar o próprio contrato. Esta base tem
--    registro disso acontecido.
--
-- A DIVISÃO DE RESPONSABILIDADE
--
-- RLS responde "esta sessão pode gravar esta linha?" — e é onde a identidade do
-- revisor é amarrada a `auth.uid()`.
-- O TRIGGER responde "esta decisão é válida?" — ordem e segregação de funções —
-- e vale para TODA escrita, inclusive service role, seed e seu próprio script.
-- Um invariante que a chave de serviço contorna não é um invariante.
--
-- O QUE ESTA MIGRATION NÃO FAZ
--
-- Não constrói o Approval Engine transversal (Fase 5). Não renomeia etapa
-- (`juridico`, `financeiro`, `comite`, `diretoria`) nem status (`pending`,
-- `under_review`, `approved`, `rejected`). Não reescreve linha existente: o
-- trigger só olha escritas novas, e as decisões já gravadas — inclusive as
-- autoaprovadas — permanecem como registro histórico do que de fato ocorreu.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) Ordem canônica das etapas — uma função, não uma constante repetida
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.contract_approval_step_order()
RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$ SELECT ARRAY['juridico', 'financeiro', 'comite', 'diretoria']::text[] $$;

COMMENT ON FUNCTION public.contract_approval_step_order() IS
  'Ordem canônica das etapas de aprovação de contrato. Espelha APPROVAL_STEP_ORDER em trust/approval-intelligence.ts.';

-- ------------------------------------------------------------
-- 2) Trigger — segregação de funções e ordem das etapas
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_contract_approval_safety()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  steps            text[] := public.contract_approval_step_order();
  contract_creator uuid;
  step_index       integer;
  blocking         text;
BEGIN
  -- Só decisão TERMINAL é barrada. `pending` e `under_review` são o trâmite
  -- normal — inclusive "solicitar ajustes", que reabre a etapa e não decide
  -- nada. Barrar o trâmite tornaria a regra impossível de cumprir.
  IF NEW.status NOT IN ('approved', 'rejected') THEN
    RETURN NEW;
  END IF;

  SELECT c.created_by INTO contract_creator
    FROM public.contracts c
   WHERE c.id = NEW.contract_id;

  -- Segregação de funções.
  --
  -- Quando `created_by` é NULL a autoria é desconhecida e a comparação não pode
  -- ser feita. A escolha aqui é deixar passar, e ela é deliberada: bloquear
  -- tornaria contrato legado inaprovável para sempre, o que é um problema de
  -- dados sendo tratado como se fosse um problema de segurança. Na prática a
  -- coluna está sempre preenchida — `contracts_insert_permissioned` exige
  -- `created_by = auth.uid()` no INSERT.
  IF contract_creator IS NOT NULL
     AND NEW.reviewer_user_id IS NOT NULL
     AND NEW.reviewer_user_id = contract_creator THEN
    RAISE EXCEPTION
      'Segregação de funções: quem cadastrou o contrato não pode decidir a etapa "%".', NEW.step_name
      USING ERRCODE = 'check_violation';
  END IF;

  -- Ordem das etapas — só na aprovação.
  --
  -- Uma REJEIÇÃO pode acontecer a qualquer momento: recusar cedo é justamente
  -- o que se espera de um parecer. Já APROVAR uma etapa posterior por cima de
  -- uma anterior não decidida inverteria o sentido da rota.
  IF NEW.status = 'approved' THEN
    step_index := array_position(steps, NEW.step_name);

    IF step_index IS NOT NULL THEN
      -- Só etapa REGISTRADA conta. A rota de um contrato é o conjunto de etapas
      -- que ele tem — exigir as quatro sempre obrigaria todo contrato a passar
      -- por diretoria, o que nunca foi a regra.
      SELECT string_agg(a.step_name, ', ' ORDER BY array_position(steps, a.step_name))
        INTO blocking
        FROM public.contract_approvals a
       WHERE a.contract_id = NEW.contract_id
         AND a.id IS DISTINCT FROM NEW.id
         AND array_position(steps, a.step_name) < step_index
         AND a.status <> 'approved';

      IF blocking IS NOT NULL THEN
        RAISE EXCEPTION
          'Ordem de aprovação: a etapa "%" não pode ser aprovada enquanto "%" não estiver aprovada.',
          NEW.step_name, blocking
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.enforce_contract_approval_safety() IS
  'Fase 0.2: segregação de funções (autor não decide) e ordem das etapas. Vale para toda escrita, inclusive service role.';

DROP TRIGGER IF EXISTS trg_contract_approval_safety ON public.contract_approvals;
CREATE TRIGGER trg_contract_approval_safety
  BEFORE INSERT OR UPDATE ON public.contract_approvals
  FOR EACH ROW EXECUTE FUNCTION public.enforce_contract_approval_safety();

-- ------------------------------------------------------------
-- 3) RLS — quebra o FOR ALL, remove `contracts.edit`, amarra o revisor
-- ------------------------------------------------------------

DROP POLICY IF EXISTS contract_approvals_manage ON public.contract_approvals;
DROP POLICY IF EXISTS contract_approvals_insert ON public.contract_approvals;
DROP POLICY IF EXISTS contract_approvals_update ON public.contract_approvals;

-- `reviewer_user_id = auth.uid()` no WITH CHECK é o que faz a coluna significar
-- "quem decidiu" em vez de "quem alguém digitou". Sem isso, a trilha de
-- aprovação é uma afirmação não verificada.
CREATE POLICY contract_approvals_insert ON public.contract_approvals
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.current_user_organization_id()
    AND public.current_user_can_read_contract(contract_id)
    AND (public.current_user_is_admin() OR public.current_user_has_permission('contracts.approve'))
    AND reviewer_user_id = auth.uid()
  );

CREATE POLICY contract_approvals_update ON public.contract_approvals
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.current_user_organization_id()
    AND public.current_user_can_read_contract(contract_id)
    AND (public.current_user_is_admin() OR public.current_user_has_permission('contracts.approve'))
  )
  WITH CHECK (
    organization_id = public.current_user_organization_id()
    AND public.current_user_can_read_contract(contract_id)
    AND (public.current_user_is_admin() OR public.current_user_has_permission('contracts.approve'))
    AND reviewer_user_id = auth.uid()
  );

-- Nenhuma política de DELETE, e isso é a decisão: decisão de aprovação é
-- histórico. A política FOR ALL anterior permitia apagá-la; nada no código
-- jamais apagou. Ausência de política nega — e é a negação certa.

COMMIT;
