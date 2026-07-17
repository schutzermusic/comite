-- ============================================================
-- CUSTO DE MÃO DE OBRA — RLS hardening (security review)
-- Migration: 054_labor_cost_rls_hardening
-- Date:      2026-07-17
-- Purpose:   Fecha vazamento de custo individual identificado na
--            revisão de segurança: project_labor_cost_periods carrega
--            valores em centavos (planejado/estimado/reconciliado/
--            variação) e o SELECT permitia people.allocations_view OU
--            projects.view — papéis amplos que NÃO têm people.cost_view.
--            A UI mascara (maskCost), mas o PostgREST expunha o valor
--            bruto. Restringe a leitura a quem pode ver custo individual
--            (mesma regra de employee_cost_snapshots).
-- Dependencies: 043_labor_cost
-- NOTE: Idempotente. Não altera colunas — só a política de leitura.
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS plcp_select ON public.project_labor_cost_periods;
CREATE POLICY plcp_select ON public.project_labor_cost_periods
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('people.cost_view')
    OR current_user_has_permission('people.cost_manage')
    OR current_user_is_admin()
  )
);

COMMIT;

-- ============================================================
-- Verificação (staging):
--   Usuário com projects.view mas SEM people.cost_view:
--     SELECT * FROM project_labor_cost_periods  ->  0 linhas.
--   Usuário com people.cost_view: leitura normal.
-- ============================================================
