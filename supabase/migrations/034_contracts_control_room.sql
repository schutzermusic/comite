-- ============================================================
-- CONTRACTS CONTROL ROOM - Extended schema: obligations, approvals, links
-- Migration: 034_contracts_control_room
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Table: contract_obligations
CREATE TABLE IF NOT EXISTS public.contract_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'due_soon', 'overdue', 'done')),
  due_date date NULL,
  evidence text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2) Table: contract_approvals
CREATE TABLE IF NOT EXISTS public.contract_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  step_name text NOT NULL CHECK (step_name IN ('juridico', 'financeiro', 'comite', 'diretoria')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'under_review', 'approved', 'rejected')),
  reviewer_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  deadline_date date NULL,
  comments text,
  approval_timestamp timestamptz NULL,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_approvals_unique_step UNIQUE (contract_id, step_name)
);

-- 3) Table: contract_project_links
CREATE TABLE IF NOT EXISTS public.contract_project_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_project_links_unique UNIQUE (contract_id, project_id)
);

-- 4) Table: contract_risks_links
CREATE TABLE IF NOT EXISTS public.contract_risks_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  risk_id uuid NOT NULL REFERENCES public.risks(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_risks_links_unique UNIQUE (contract_id, risk_id)
);

-- 5) Table: contract_documents
CREATE TABLE IF NOT EXISTS public.contract_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  title text NOT NULL,
  file_path text NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('contract', 'amendment', 'invoice', 'guarantee', 'insurance', 'annex', 'purchase_order', 'certificate', 'approval', 'minutes')),
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'missing', 'expired', 'expiring_soon', 'pending_approval', 'rejected')),
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_contract_obligations_contract ON public.contract_obligations(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_approvals_contract ON public.contract_approvals(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_project_links_contract ON public.contract_project_links(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_project_links_project ON public.contract_project_links(project_id);
CREATE INDEX IF NOT EXISTS idx_contract_risks_links_contract ON public.contract_risks_links(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_risks_links_risk ON public.contract_risks_links(risk_id);
CREATE INDEX IF NOT EXISTS idx_contract_documents_contract ON public.contract_documents(contract_id);

-- Triggers for updated_at
DROP TRIGGER IF EXISTS trg_contract_obligations_updated_at ON public.contract_obligations;
CREATE TRIGGER trg_contract_obligations_updated_at BEFORE UPDATE ON public.contract_obligations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_contract_approvals_updated_at ON public.contract_approvals;
CREATE TRIGGER trg_contract_approvals_updated_at BEFORE UPDATE ON public.contract_approvals FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_contract_documents_updated_at ON public.contract_documents;
CREATE TRIGGER trg_contract_documents_updated_at BEFORE UPDATE ON public.contract_documents FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS Enablement
ALTER TABLE public.contract_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_project_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_risks_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_documents ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- contract_obligations policies
DROP POLICY IF EXISTS contract_obligations_select ON public.contract_obligations;
CREATE POLICY contract_obligations_select ON public.contract_obligations
FOR SELECT TO authenticated USING (organization_id = current_user_organization_id() AND current_user_can_read_contract(contract_id));

DROP POLICY IF EXISTS contract_obligations_manage ON public.contract_obligations;
CREATE POLICY contract_obligations_manage ON public.contract_obligations
FOR ALL TO authenticated USING (organization_id = current_user_organization_id() AND (current_user_is_admin() OR current_user_has_permission('contracts.edit')));

-- contract_approvals policies
DROP POLICY IF EXISTS contract_approvals_select ON public.contract_approvals;
CREATE POLICY contract_approvals_select ON public.contract_approvals
FOR SELECT TO authenticated USING (organization_id = current_user_organization_id() AND current_user_can_read_contract(contract_id));

DROP POLICY IF EXISTS contract_approvals_manage ON public.contract_approvals;
CREATE POLICY contract_approvals_manage ON public.contract_approvals
FOR ALL TO authenticated USING (organization_id = current_user_organization_id() AND (current_user_is_admin() OR current_user_has_permission('contracts.approve') OR current_user_has_permission('contracts.edit')));

-- contract_project_links policies
DROP POLICY IF EXISTS contract_project_links_select ON public.contract_project_links;
CREATE POLICY contract_project_links_select ON public.contract_project_links
FOR SELECT TO authenticated USING (organization_id = current_user_organization_id() AND current_user_can_read_contract(contract_id));

DROP POLICY IF EXISTS contract_project_links_manage ON public.contract_project_links;
CREATE POLICY contract_project_links_manage ON public.contract_project_links
FOR ALL TO authenticated USING (organization_id = current_user_organization_id() AND (current_user_is_admin() OR current_user_has_permission('contracts.edit')));

-- contract_risks_links policies
DROP POLICY IF EXISTS contract_risks_links_select ON public.contract_risks_links;
CREATE POLICY contract_risks_links_select ON public.contract_risks_links
FOR SELECT TO authenticated USING (organization_id = current_user_organization_id() AND current_user_can_read_contract(contract_id));

DROP POLICY IF EXISTS contract_risks_links_manage ON public.contract_risks_links;
CREATE POLICY contract_risks_links_manage ON public.contract_risks_links
FOR ALL TO authenticated USING (organization_id = current_user_organization_id() AND (current_user_is_admin() OR current_user_has_permission('contracts.edit')));

-- contract_documents policies
DROP POLICY IF EXISTS contract_documents_select ON public.contract_documents;
CREATE POLICY contract_documents_select ON public.contract_documents
FOR SELECT TO authenticated USING (organization_id = current_user_organization_id() AND current_user_can_read_contract(contract_id));

DROP POLICY IF EXISTS contract_documents_manage ON public.contract_documents;
CREATE POLICY contract_documents_manage ON public.contract_documents
FOR ALL TO authenticated USING (organization_id = current_user_organization_id() AND (current_user_is_admin() OR current_user_has_permission('contracts.documents.upload') OR current_user_has_permission('contracts.edit')));

COMMIT;
