-- ============================================================
-- CUSTO DE MÃO DE OBRA — Permission seed
-- Migration: 044_labor_cost_perm_seeds
--
-- Data-only, idempotent. Seeds people.cost_manage (compute/reconcile
-- labor cost snapshots) used by migration 043, and grants it to roles
-- that already hold cost visibility. Reading is gated by the existing
-- people.cost_view (migration 039).
-- ============================================================
BEGIN;

INSERT INTO public.permissions (key, module, action, description) VALUES
  ('people.cost_manage', 'people', 'cost_manage', 'Calcular e reconciliar custo de mao de obra (snapshots)')
ON CONFLICT (key) DO NOTHING;

-- owner_admin / financeiro / rh -> compute & reconcile cost
WITH r AS (
  SELECT id FROM public.roles
  WHERE organization_id IS NULL AND key IN ('owner_admin','financeiro','rh')
),
p AS (
  SELECT id FROM public.permissions WHERE key = 'people.cost_manage'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

COMMIT;
