-- ============================================================
-- FINANCE COST CENTERS — canonical, org-scoped, UUID-keyed
-- Migration: 022_finance_cost_centers
--
-- Why: the payroll cost-center mapping must persist a VALID, durable id.
-- Phase 1/2 stored client store ids ('cc-eng-campo'), but
-- payroll_cost_center_summaries.matched_cost_center_id is a uuid column with an
-- FK to the (non org-scoped) cost_center table — so saving a 'cc-*' value would
-- fail and break sendToFinance. This migration introduces a real, org-scoped
-- finance_cost_centers table with uuid ids, seeds it from the standard cost
-- centers, and repoints the summaries FK at it. From now on the payroll mapping
-- saves a finance_cost_centers.id (uuid).
--
-- "cc-* vira UUID": the conceptual cost centers (client ids 'cc-eng-campo' with
-- codes 'ENG-CAMPO') are inserted here once per organization with a fresh uuid,
-- keyed for idempotency on (organization_id, code). The stable bridge between
-- the legacy client id and the new uuid is the shared `code` (see
-- resolveFinanceCostCenterId in cost-center-mapping.ts).
--
-- Conventions follow 017/021: org-scoped, set_updated_at() trigger, RLS via the
-- helpers from 005. Idempotent.
-- ============================================================
BEGIN;

-- ── 1. TABLE ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance_cost_centers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code            text NOT NULL,
  name            text NOT NULL,
  active          boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES auth.users(id),
  updated_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fcc_org_code ON finance_cost_centers (organization_id, code);
CREATE INDEX IF NOT EXISTS idx_fcc_org ON finance_cost_centers (organization_id);

DROP TRIGGER IF EXISTS trg_finance_cost_centers_updated_at ON finance_cost_centers;
CREATE TRIGGER trg_finance_cost_centers_updated_at
  BEFORE UPDATE ON finance_cost_centers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 2. RLS ──────────────────────────────────────────────────
ALTER TABLE finance_cost_centers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS finance_cost_centers_select_scoped ON finance_cost_centers;
CREATE POLICY finance_cost_centers_select_scoped ON finance_cost_centers
FOR SELECT TO authenticated
USING (organization_id = current_user_organization_id());

DROP POLICY IF EXISTS finance_cost_centers_write_scoped ON finance_cost_centers;
CREATE POLICY finance_cost_centers_write_scoped ON finance_cost_centers
FOR ALL TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin()
       OR current_user_has_permission('finance.edit')
       OR current_user_has_permission('people.payroll_close'))
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin()
       OR current_user_has_permission('finance.edit')
       OR current_user_has_permission('people.payroll_close'))
);

-- ── 3. SEED — standard cost centers for every organization ──
-- Mirrors src/data/finance/seed-categories.ts (code + name). Idempotent on
-- (organization_id, code). Re-runnable; adding a new org later requires re-run.
INSERT INTO finance_cost_centers (organization_id, code, name)
SELECT org.id, seed.code, seed.name
FROM organizations org
CROSS JOIN (VALUES
  ('ENG-CAMPO', 'Engenharia de Campo'),
  ('MANUT',     'Manutenção Industrial'),
  ('MOB',       'Mobilização'),
  ('ADM-SP',    'Administrativo SP'),
  ('TI',        'Tecnologia da Informação'),
  ('RH',        'Recursos Humanos'),
  ('COMERC',    'Comercial'),
  ('FIN',       'Financeiro')
) AS seed(code, name)
ON CONFLICT (organization_id, code) DO NOTHING;

-- ── 4. Repoint payroll summaries FK at finance_cost_centers ──
-- The old FK targeted cost_center(id); the payroll mapping now resolves to
-- finance_cost_centers(id). NULL out any pre-existing value that isn't a valid
-- finance_cost_centers id (defensive — there should be none), then swap the FK.
UPDATE payroll_cost_center_summaries s
SET matched_cost_center_id = NULL
WHERE matched_cost_center_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM finance_cost_centers f WHERE f.id = s.matched_cost_center_id);

ALTER TABLE payroll_cost_center_summaries
  DROP CONSTRAINT IF EXISTS payroll_cost_center_summaries_matched_cost_center_id_fkey;
ALTER TABLE payroll_cost_center_summaries
  ADD CONSTRAINT payroll_cost_center_summaries_matched_cost_center_id_fkey
  FOREIGN KEY (matched_cost_center_id) REFERENCES finance_cost_centers(id) ON DELETE SET NULL;

COMMIT;
