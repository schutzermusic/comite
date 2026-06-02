-- ============================================================
-- PAYROLL CLOSING — Cost-center mapping aliases + override permission
-- Migration: 021_payroll_cost_center_mappings
--
-- Persists the alias that links an imported payroll cost-center NAME to a
-- Finance cost center, so the link is shared across users/browsers and future
-- imports auto-match (replacing the org-scoped localStorage used in phase 1).
--
-- Conventions follow 017/018/020: organization-scoped table, created_by/
-- updated_by referencing auth.users, set_updated_at() trigger, RLS via the
-- helpers from 005, idempotent perm seed grant.
--
-- `cost_center_id` is stored as TEXT (not a uuid FK) on purpose: the Finance
-- cost-center master data is currently served from the client store with string
-- ids (e.g. 'cc-eng-campo'), so a strict uuid FK would reject those. Keeping it
-- text also keeps the alias resilient if a cost center is later renamed/replaced.
-- ============================================================
BEGIN;

-- ── 1. TABLE ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_cost_center_mappings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  imported_name   text NOT NULL,                 -- original spelling, for display/audit
  normalized_name text NOT NULL,                 -- lookup key (lower, no accents/punct)
  cost_center_id  text NOT NULL,                 -- Finance cost center id (see note above)
  confidence      numeric(4,3) NOT NULL DEFAULT 1,
  match_method    text,                          -- how it was first resolved (manual/alias/exact/…)
  created_by      uuid REFERENCES auth.users(id),
  updated_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One alias per normalized name per organization (the upsert conflict target).
CREATE UNIQUE INDEX IF NOT EXISTS uq_pccm_org_normalized
  ON payroll_cost_center_mappings (organization_id, normalized_name);
CREATE INDEX IF NOT EXISTS idx_pccm_org ON payroll_cost_center_mappings (organization_id);

-- updated_at trigger (reuse set_updated_at from 005).
DROP TRIGGER IF EXISTS trg_payroll_cost_center_mappings_updated_at ON payroll_cost_center_mappings;
CREATE TRIGGER trg_payroll_cost_center_mappings_updated_at
  BEFORE UPDATE ON payroll_cost_center_mappings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 2. RLS ──────────────────────────────────────────────────
ALTER TABLE payroll_cost_center_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_cost_center_mappings_select_scoped ON payroll_cost_center_mappings;
CREATE POLICY payroll_cost_center_mappings_select_scoped ON payroll_cost_center_mappings
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin()
       OR current_user_has_permission('people.payroll_close')
       OR current_user_has_permission('people.view'))
);

DROP POLICY IF EXISTS payroll_cost_center_mappings_write_scoped ON payroll_cost_center_mappings;
CREATE POLICY payroll_cost_center_mappings_write_scoped ON payroll_cost_center_mappings
FOR ALL TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('people.payroll_close'))
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('people.payroll_close'))
);

-- ── 3. OVERRIDE PERMISSION (sendToFinance with unmapped centers) ──
-- Non-admins need this explicit permission to push a closing to Finance while
-- some cost centers are still unmapped. Owners/admins bypass via is_admin.
INSERT INTO public.permissions (key, module, action, description) VALUES
  ('people.payroll_override_mapping', 'people', 'payroll_override_mapping',
   'Enviar fechamento ao Financeiro com centros de custo nao vinculados (override)')
ON CONFLICT (key) DO NOTHING;

-- Grant to owner_admin (explicit; admins also bypass in code).
WITH owner_role AS (
  SELECT id FROM public.roles WHERE key = 'owner_admin' AND organization_id IS NULL
),
override_perm AS (
  SELECT id FROM public.permissions WHERE key = 'people.payroll_override_mapping'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT owner_role.id, override_perm.id FROM owner_role, override_perm
ON CONFLICT DO NOTHING;

COMMIT;
