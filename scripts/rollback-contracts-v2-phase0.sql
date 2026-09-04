-- ============================================================
-- ROLLBACK das migrations da Fase 0 do Contracts V2 (099, 100, 101)
-- ============================================================
--
-- NÃO é uma migration: fica fora de supabase/migrations/ de propósito, para não
-- ser aplicado por engano por nenhum runner.
--
--   node -e "..." ou psql < scripts/rollback-contracts-v2-phase0.sql
--
-- O que este arquivo desfaz é ESTRUTURA, nunca dado. As três migrations não
-- reescrevem linha nenhuma — o único UPDATE é o backfill de `organization_id`
-- em duas tabelas que estavam vazias nesta base —, então desfazê-las não pode
-- perder informação.
--
-- ATENÇÃO ao que o rollback REABRE:
--   * 099 → volta a leitura cross-tenant de cost_center e supplier
--   * 100 → volta a permitir aprovar com `contracts.edit`, autoaprovação e
--           etapa fora de ordem
--   * 101 → volta a aceitar qualquer texto em contracts.status
-- Reverter é restaurar os defeitos. Faça-o apenas para desbloquear, e por tempo
-- medido em horas.
-- ============================================================

BEGIN;

-- ── 101 ────────────────────────────────────────────────────────────────────
ALTER TABLE public.contracts DROP CONSTRAINT IF EXISTS contracts_status_check;
DROP FUNCTION IF EXISTS public.contract_status_vocabulary();

-- ── 100 ────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_contract_approval_safety ON public.contract_approvals;
DROP FUNCTION IF EXISTS public.enforce_contract_approval_safety();
DROP FUNCTION IF EXISTS public.contract_approval_step_order();

DROP POLICY IF EXISTS contract_approvals_insert ON public.contract_approvals;
DROP POLICY IF EXISTS contract_approvals_update ON public.contract_approvals;

-- Restaura a política original da 034, com o defeito que ela tinha.
CREATE POLICY contract_approvals_manage ON public.contract_approvals
  FOR ALL TO authenticated
  USING (
    organization_id = public.current_user_organization_id()
    AND (
      public.current_user_is_admin()
      OR public.current_user_has_permission('contracts.approve')
      OR public.current_user_has_permission('contracts.edit')
    )
  );

-- ── 099 ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cost_center_select_scoped" ON public.cost_center;
DROP POLICY IF EXISTS "cost_center_write_scoped"  ON public.cost_center;
DROP POLICY IF EXISTS "supplier_select_scoped"    ON public.supplier;
DROP POLICY IF EXISTS "supplier_insert_scoped"    ON public.supplier;
DROP POLICY IF EXISTS "supplier_update_scoped"    ON public.supplier;
DROP POLICY IF EXISTS "supplier_delete_scoped"    ON public.supplier;

CREATE POLICY "ref_read_cc"  ON public.cost_center FOR SELECT TO authenticated USING (true);
CREATE POLICY "ref_read_sup" ON public.supplier    FOR SELECT TO authenticated USING (true);
CREATE POLICY "ref_write_cc" ON public.cost_center FOR ALL TO authenticated
  USING (public.has_finance_role_or_perm('finance_admin', 'finance.admin'))
  WITH CHECK (public.has_finance_role_or_perm('finance_admin', 'finance.admin'));
CREATE POLICY "ref_write_sup" ON public.supplier FOR INSERT TO authenticated
  WITH CHECK (
    public.has_finance_role_or_perm('finance_admin', 'finance.admin')
    OR public.has_finance_role_or_perm('finance_analyst', 'finance.edit')
  );

DROP INDEX IF EXISTS public.idx_cost_center_org_code;
DROP INDEX IF EXISTS public.idx_cost_center_org;
DROP INDEX IF EXISTS public.idx_supplier_org;

-- A coluna `organization_id` é DELIBERADAMENTE preservada.
--
-- Derrubá-la apagaria a atribuição de tenant de cada linha — o único dado que
-- estas migrations criaram. Uma coluna a mais, sem política que a use, não faz
-- mal nenhum; reconstruir a atribuição depois faria.
-- Para removê-la mesmo assim, e sabendo o que se perde:
--   ALTER TABLE public.cost_center DROP COLUMN organization_id;
--   ALTER TABLE public.supplier    DROP COLUMN organization_id;
-- E então recrie a UNIQUE global que a 099 substituiu:
--   ALTER TABLE public.cost_center ADD CONSTRAINT cost_center_code_key UNIQUE (code);

COMMIT;
