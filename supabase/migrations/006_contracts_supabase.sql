-- ============================================================
-- CONTRACTS MODULE - Supabase persistence, RLS, storage foundation
-- Migration: 006_contracts_supabase
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text REFERENCES projects(id) ON DELETE SET NULL,
  client_id uuid NULL,
  supplier_id uuid NULL,
  title text NOT NULL,
  contract_number text NULL,
  counterparty_name text NULL,
  contract_type text NULL,
  status text NOT NULL DEFAULT 'draft',
  lifecycle_stage text NULL,
  start_date date NULL,
  end_date date NULL,
  signed_date date NULL,
  renewal_date date NULL,
  currency text NOT NULL DEFAULT 'BRL',
  total_value numeric(14,2) NULL,
  monthly_value numeric(14,2) NULL,
  payment_terms text NULL,
  scope_summary text NULL,
  risk_level text NOT NULL DEFAULT 'medium',
  health_score numeric NULL,
  owner_user_id uuid REFERENCES auth.users(id) NULL,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

CREATE TABLE IF NOT EXISTS contract_clauses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  clause_type text,
  title text NOT NULL,
  content text,
  risk_level text NOT NULL DEFAULT 'medium',
  ai_flagged boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contract_penalties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  penalty_type text,
  amount numeric(14,2) NULL,
  trigger_condition text,
  deadline_date date NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contract_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  project_id text REFERENCES projects(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  milestone_type text,
  due_date date NULL,
  completed_at timestamptz NULL,
  billing_amount numeric(14,2) NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contract_billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  milestone_id uuid REFERENCES contract_milestones(id) ON DELETE SET NULL,
  title text NOT NULL,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  due_date date NULL,
  paid_at timestamptz NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contract_risks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  category text,
  probability integer NULL,
  impact integer NULL,
  risk_score integer NULL,
  status text NOT NULL DEFAULT 'open',
  mitigation_plan text NULL,
  owner_user_id uuid REFERENCES auth.users(id) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contract_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_path text NOT NULL UNIQUE,
  file_type text NULL,
  file_size bigint NULL,
  uploaded_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contract_ai_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  summary text NULL,
  risk_summary text NULL,
  extracted_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_contracts_org_status ON contracts(organization_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_project ON contracts(project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_counterparty ON contracts(organization_id, counterparty_name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_end_date ON contracts(organization_id, end_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contract_clauses_contract ON contract_clauses(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_penalties_contract ON contract_penalties(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_milestones_contract ON contract_milestones(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_billing_contract ON contract_billing_events(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_risks_contract ON contract_risks(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_files_contract ON contract_files(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_ai_analyses_contract ON contract_ai_analyses(contract_id);

DROP TRIGGER IF EXISTS trg_contracts_updated_at ON contracts;
CREATE TRIGGER trg_contracts_updated_at BEFORE UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_contract_clauses_updated_at ON contract_clauses;
CREATE TRIGGER trg_contract_clauses_updated_at BEFORE UPDATE ON contract_clauses FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_contract_penalties_updated_at ON contract_penalties;
CREATE TRIGGER trg_contract_penalties_updated_at BEFORE UPDATE ON contract_penalties FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_contract_milestones_updated_at ON contract_milestones;
CREATE TRIGGER trg_contract_milestones_updated_at BEFORE UPDATE ON contract_milestones FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_contract_billing_events_updated_at ON contract_billing_events;
CREATE TRIGGER trg_contract_billing_events_updated_at BEFORE UPDATE ON contract_billing_events FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_contract_risks_updated_at ON contract_risks;
CREATE TRIGGER trg_contract_risks_updated_at BEFORE UPDATE ON contract_risks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION current_user_can_read_contract(target_contract_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM contracts c
    LEFT JOIN projects p ON p.id = c.project_id
    WHERE c.id = target_contract_id
      AND c.organization_id = current_user_organization_id()
      AND c.deleted_at IS NULL
      AND (
        current_user_is_admin()
        OR current_user_has_permission('contracts.view')
        OR current_user_has_permission('contracts.approve')
        OR (
          current_user_has_permission('projects.view_assigned')
          AND p.project->'responsavel'->>'id' = auth.uid()::text
        )
      )
  )
$$;

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_clauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_penalties ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_risks ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_ai_analyses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contracts_select_scoped ON contracts;
CREATE POLICY contracts_select_scoped ON contracts
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND deleted_at IS NULL
  AND (
    current_user_is_admin()
    OR current_user_has_permission('contracts.view')
    OR current_user_has_permission('contracts.approve')
    OR (
      current_user_has_permission('projects.view_assigned')
      AND EXISTS (
        SELECT 1 FROM projects p
        WHERE p.id = contracts.project_id
          AND p.project->'responsavel'->>'id' = auth.uid()::text
      )
    )
  )
);

DROP POLICY IF EXISTS contracts_insert_permissioned ON contracts;
CREATE POLICY contracts_insert_permissioned ON contracts
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND created_by = auth.uid()
  AND (current_user_is_admin() OR current_user_has_permission('contracts.create'))
);

DROP POLICY IF EXISTS contracts_update_permissioned ON contracts;
CREATE POLICY contracts_update_permissioned ON contracts
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND deleted_at IS NULL
  AND (
    current_user_is_admin()
    OR current_user_has_permission('contracts.edit')
    OR current_user_has_permission('contracts.delete')
  )
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
    current_user_is_admin()
    OR current_user_has_permission('contracts.edit')
    OR current_user_has_permission('contracts.delete')
  )
);

DROP POLICY IF EXISTS contracts_delete_permissioned ON contracts;
CREATE POLICY contracts_delete_permissioned ON contracts
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('contracts.delete'))
);

DROP POLICY IF EXISTS contract_clauses_select_scoped ON contract_clauses;
CREATE POLICY contract_clauses_select_scoped ON contract_clauses
FOR SELECT TO authenticated
USING (organization_id = current_user_organization_id() AND current_user_can_read_contract(contract_id));
DROP POLICY IF EXISTS contract_clauses_manage_permissioned ON contract_clauses;
CREATE POLICY contract_clauses_manage_permissioned ON contract_clauses
FOR ALL TO authenticated
USING (organization_id = current_user_organization_id() AND (current_user_is_admin() OR current_user_has_permission('contracts.edit')))
WITH CHECK (organization_id = current_user_organization_id() AND (current_user_is_admin() OR current_user_has_permission('contracts.edit')));

DROP POLICY IF EXISTS contract_penalties_select_scoped ON contract_penalties;
CREATE POLICY contract_penalties_select_scoped ON contract_penalties
FOR SELECT TO authenticated
USING (organization_id = current_user_organization_id() AND current_user_can_read_contract(contract_id) AND (current_user_has_permission('contracts.view_penalties') OR current_user_has_permission('contracts.edit') OR current_user_is_admin()));
DROP POLICY IF EXISTS contract_penalties_manage_permissioned ON contract_penalties;
CREATE POLICY contract_penalties_manage_permissioned ON contract_penalties
FOR ALL TO authenticated
USING (organization_id = current_user_organization_id() AND (current_user_is_admin() OR current_user_has_permission('contracts.edit')))
WITH CHECK (organization_id = current_user_organization_id() AND (current_user_is_admin() OR current_user_has_permission('contracts.edit')));

DROP POLICY IF EXISTS contract_milestones_select_scoped ON contract_milestones;
CREATE POLICY contract_milestones_select_scoped ON contract_milestones
FOR SELECT TO authenticated
USING (organization_id = current_user_organization_id() AND current_user_can_read_contract(contract_id));
DROP POLICY IF EXISTS contract_milestones_manage_permissioned ON contract_milestones;
CREATE POLICY contract_milestones_manage_permissioned ON contract_milestones
FOR ALL TO authenticated
USING (organization_id = current_user_organization_id() AND (current_user_is_admin() OR current_user_has_permission('contracts.edit')))
WITH CHECK (organization_id = current_user_organization_id() AND (current_user_is_admin() OR current_user_has_permission('contracts.edit')));

DROP POLICY IF EXISTS contract_billing_events_select_scoped ON contract_billing_events;
CREATE POLICY contract_billing_events_select_scoped ON contract_billing_events
FOR SELECT TO authenticated
USING (organization_id = current_user_organization_id() AND current_user_can_read_contract(contract_id) AND (current_user_has_permission('contracts.view_values') OR current_user_has_permission('finance.view') OR current_user_is_admin()));
DROP POLICY IF EXISTS contract_billing_events_manage_permissioned ON contract_billing_events;
CREATE POLICY contract_billing_events_manage_permissioned ON contract_billing_events
FOR ALL TO authenticated
USING (organization_id = current_user_organization_id() AND (current_user_is_admin() OR current_user_has_permission('contracts.edit')))
WITH CHECK (organization_id = current_user_organization_id() AND (current_user_is_admin() OR current_user_has_permission('contracts.edit')));

DROP POLICY IF EXISTS contract_risks_select_scoped ON contract_risks;
CREATE POLICY contract_risks_select_scoped ON contract_risks
FOR SELECT TO authenticated
USING (organization_id = current_user_organization_id() AND current_user_can_read_contract(contract_id));
DROP POLICY IF EXISTS contract_risks_manage_permissioned ON contract_risks;
CREATE POLICY contract_risks_manage_permissioned ON contract_risks
FOR ALL TO authenticated
USING (organization_id = current_user_organization_id() AND (current_user_is_admin() OR current_user_has_permission('contracts.edit') OR current_user_has_permission('risks.edit')))
WITH CHECK (organization_id = current_user_organization_id() AND (current_user_is_admin() OR current_user_has_permission('contracts.edit') OR current_user_has_permission('risks.edit')));

DROP POLICY IF EXISTS contract_files_select_scoped ON contract_files;
CREATE POLICY contract_files_select_scoped ON contract_files
FOR SELECT TO authenticated
USING (organization_id = current_user_organization_id() AND current_user_can_read_contract(contract_id));
DROP POLICY IF EXISTS contract_files_insert_permissioned ON contract_files;
CREATE POLICY contract_files_insert_permissioned ON contract_files
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND uploaded_by = auth.uid()
  AND (current_user_is_admin() OR current_user_has_permission('contracts.upload_file'))
);

DROP POLICY IF EXISTS contract_ai_analyses_select_scoped ON contract_ai_analyses;
CREATE POLICY contract_ai_analyses_select_scoped ON contract_ai_analyses
FOR SELECT TO authenticated
USING (organization_id = current_user_organization_id() AND current_user_can_read_contract(contract_id));
DROP POLICY IF EXISTS contract_ai_analyses_insert_permissioned ON contract_ai_analyses;
CREATE POLICY contract_ai_analyses_insert_permissioned ON contract_ai_analyses
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND created_by = auth.uid()
  AND (current_user_is_admin() OR current_user_has_permission('contracts.analyze_with_ai'))
);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contract-files',
  'contract-files',
  false,
  52428800,
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png',
    'image/jpeg',
    'text/plain'
  ]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS contract_files_storage_read ON storage.objects;
CREATE POLICY contract_files_storage_read
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'contract-files'
  AND EXISTS (
    SELECT 1
    FROM contract_files cf
    WHERE cf.file_path = storage.objects.name
      AND cf.organization_id = current_user_organization_id()
      AND current_user_can_read_contract(cf.contract_id)
  )
);

DROP POLICY IF EXISTS contract_files_storage_insert ON storage.objects;
CREATE POLICY contract_files_storage_insert
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'contract-files'
  AND split_part(name, '/', 1) = current_user_organization_id()::text
  AND (current_user_is_admin() OR current_user_has_permission('contracts.upload_file'))
);

DROP POLICY IF EXISTS contract_files_storage_delete ON storage.objects;
CREATE POLICY contract_files_storage_delete
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'contract-files'
  AND split_part(name, '/', 1) = current_user_organization_id()::text
  AND (current_user_is_admin() OR current_user_has_permission('contracts.delete'))
);
