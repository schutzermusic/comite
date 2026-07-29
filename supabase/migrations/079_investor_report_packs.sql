-- ============================================================
-- FINANCEIRO — Pack do Investidor manual e versionado
-- Migration: 079_investor_report_packs
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.investor_report_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  parent_pack_id uuid REFERENCES investor_report_packs(id) ON DELETE SET NULL,
  title text NOT NULL,
  company text NOT NULL DEFAULT '',
  recipient text NOT NULL DEFAULT '',
  period_start text NOT NULL CHECK (period_start ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  period_end text NOT NULL CHECK (period_end ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND period_end >= period_start),
  currency text NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  reference_date date NOT NULL DEFAULT current_date,
  confidentiality text NOT NULL DEFAULT 'confidential'
    CHECK (confidentiality IN ('confidential','restricted','public')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  narrative jsonb NOT NULL DEFAULT '{"executiveSummary":"","highlights":[],"risks":[],"assumptions":[],"closingMessage":""}'::jsonb,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT DEFAULT auth.uid(),
  author_name text NOT NULL DEFAULT '',
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'published' AND published_at IS NOT NULL) OR status <> 'published')
);

CREATE TABLE IF NOT EXISTS public.investor_report_pack_months (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  pack_id uuid NOT NULL REFERENCES investor_report_packs(id) ON DELETE CASCADE,
  period_key text NOT NULL CHECK (period_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  revenue_actual_cents bigint NOT NULL DEFAULT 0 CHECK (revenue_actual_cents >= 0),
  revenue_forecast_cents bigint NOT NULL DEFAULT 0 CHECK (revenue_forecast_cents >= 0),
  payroll_actual_cents bigint NOT NULL DEFAULT 0 CHECK (payroll_actual_cents >= 0),
  payroll_forecast_cents bigint NOT NULL DEFAULT 0 CHECK (payroll_forecast_cents >= 0),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pack_id, period_key)
);

CREATE INDEX IF NOT EXISTS investor_report_packs_org_updated_idx
  ON investor_report_packs (organization_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS investor_report_pack_months_pack_period_idx
  ON investor_report_pack_months (pack_id, period_key);

CREATE OR REPLACE FUNCTION public.guard_published_investor_pack()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = 'published' THEN
    IF NEW.status = 'archived'
       AND NEW.title = OLD.title
       AND NEW.company = OLD.company
       AND NEW.recipient = OLD.recipient
       AND NEW.period_start = OLD.period_start
       AND NEW.period_end = OLD.period_end
       AND NEW.currency = OLD.currency
       AND NEW.reference_date = OLD.reference_date
       AND NEW.confidentiality = OLD.confidentiality
       AND NEW.version = OLD.version
       AND NEW.narrative = OLD.narrative
       AND NEW.parent_pack_id IS NOT DISTINCT FROM OLD.parent_pack_id
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Pack publicado é imutável; crie uma nova versão.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_published_investor_pack ON investor_report_packs;
CREATE TRIGGER trg_guard_published_investor_pack
BEFORE UPDATE ON investor_report_packs
FOR EACH ROW EXECUTE FUNCTION guard_published_investor_pack();

CREATE OR REPLACE FUNCTION public.guard_published_investor_pack_month()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  parent_status text;
  target_pack_id uuid;
BEGIN
  target_pack_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.pack_id ELSE NEW.pack_id END;
  SELECT status INTO parent_status
  FROM investor_report_packs
  WHERE id = target_pack_id;
  IF parent_status IN ('published','archived') THEN
    RAISE EXCEPTION 'Competências de pack publicado são imutáveis.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_published_investor_pack_month ON investor_report_pack_months;
CREATE TRIGGER trg_guard_published_investor_pack_month
BEFORE UPDATE OR DELETE ON investor_report_pack_months
FOR EACH ROW EXECUTE FUNCTION guard_published_investor_pack_month();

ALTER TABLE investor_report_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE investor_report_pack_months ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS investor_report_packs_select ON investor_report_packs;
CREATE POLICY investor_report_packs_select ON investor_report_packs
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('finance.view_executive'))
);

DROP POLICY IF EXISTS investor_report_packs_insert ON investor_report_packs;
CREATE POLICY investor_report_packs_insert ON investor_report_packs
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND created_by = auth.uid()
  AND (current_user_is_admin() OR current_user_has_permission('finance.edit_entry'))
);

DROP POLICY IF EXISTS investor_report_packs_update ON investor_report_packs;
CREATE POLICY investor_report_packs_update ON investor_report_packs
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
    current_user_is_admin()
    OR (
      status = 'draft'
      AND (
        current_user_has_permission('finance.edit_entry')
        OR current_user_has_permission('finance.approve')
      )
    )
    OR (status = 'published' AND current_user_has_permission('finance.approve'))
  )
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
    current_user_is_admin()
    OR (status = 'draft' AND current_user_has_permission('finance.edit_entry'))
    OR (status IN ('published','archived') AND current_user_has_permission('finance.approve'))
  )
);

DROP POLICY IF EXISTS investor_report_packs_delete ON investor_report_packs;
CREATE POLICY investor_report_packs_delete ON investor_report_packs
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND status = 'draft'
  AND (current_user_is_admin() OR current_user_has_permission('finance.edit_entry'))
);

DROP POLICY IF EXISTS investor_report_pack_months_select ON investor_report_pack_months;
CREATE POLICY investor_report_pack_months_select ON investor_report_pack_months
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('finance.view_executive'))
);

DROP POLICY IF EXISTS investor_report_pack_months_write ON investor_report_pack_months;
CREATE POLICY investor_report_pack_months_write ON investor_report_pack_months
FOR ALL TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('finance.edit_entry'))
  AND EXISTS (
    SELECT 1 FROM investor_report_packs p
    WHERE p.id = investor_report_pack_months.pack_id
      AND p.organization_id = investor_report_pack_months.organization_id
      AND p.status = 'draft'
  )
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('finance.edit_entry'))
  AND EXISTS (
    SELECT 1 FROM investor_report_packs p
    WHERE p.id = investor_report_pack_months.pack_id
      AND p.organization_id = investor_report_pack_months.organization_id
      AND p.status = 'draft'
  )
);

COMMIT;
