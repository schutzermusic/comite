-- ============================================================
-- FINANCE — Category aliases (free-text label → management_category)
-- Migration: 025_finance_category_aliases
--
-- Persists the alias that links an imported FREE-TEXT category/subcategory label
-- (from Excel/finance imports or the payroll handoff) to a management_category,
-- so future imports auto-map instead of creating duplicates like
-- "Hotel" / "HOTEL" / "Hospedagem Hotel". This is the category analogue of
-- payroll_cost_center_mappings (021) and is DISTINCT from category_mapping (001),
-- which maps ERP ACCOUNT CODES (source_system, source_account_code) — a
-- different key space. Imports never auto-create categories; an unmatched label
-- only yields a suggestion.
--
-- Conventions follow 021/022: org-scoped, created_by/updated_by → auth.users,
-- set_updated_at() trigger from 005, RLS via helpers from 005, idempotent.
-- ============================================================
BEGIN;

-- ── 1. TABLE ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance_category_aliases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  imported_name   text NOT NULL,                 -- original spelling, for display/audit
  normalized_name text NOT NULL,                 -- lookup key (lower, no accents/punct)
  category_id     uuid NOT NULL REFERENCES management_category(id) ON DELETE CASCADE,
  confidence      numeric(4,3) NOT NULL DEFAULT 1,
  match_method    text,                          -- how it was first resolved (manual/alias/exact/…)
  created_by      uuid REFERENCES auth.users(id),
  updated_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One alias per normalized name per organization (the upsert conflict target).
CREATE UNIQUE INDEX IF NOT EXISTS uq_fca_org_normalized
  ON finance_category_aliases (organization_id, normalized_name);
CREATE INDEX IF NOT EXISTS idx_fca_org      ON finance_category_aliases (organization_id);
CREATE INDEX IF NOT EXISTS idx_fca_category ON finance_category_aliases (category_id);

-- updated_at trigger (reuse set_updated_at from 005).
DROP TRIGGER IF EXISTS trg_finance_category_aliases_updated_at ON finance_category_aliases;
CREATE TRIGGER trg_finance_category_aliases_updated_at
  BEFORE UPDATE ON finance_category_aliases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 2. RLS ──────────────────────────────────────────────────
ALTER TABLE finance_category_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS finance_category_aliases_select_scoped ON finance_category_aliases;
CREATE POLICY finance_category_aliases_select_scoped ON finance_category_aliases
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin()
       OR current_user_has_permission('finance.view')
       OR current_user_has_permission('finance.edit'))
);

DROP POLICY IF EXISTS finance_category_aliases_write_scoped ON finance_category_aliases;
CREATE POLICY finance_category_aliases_write_scoped ON finance_category_aliases
FOR ALL TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('finance.edit'))
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('finance.edit'))
);

COMMIT;
