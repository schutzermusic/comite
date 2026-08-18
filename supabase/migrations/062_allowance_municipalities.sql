-- ============================================================
-- DIÁRIAS DE CAMPO — municipality evidence + policy versions
-- Migration: 062_allowance_municipalities
-- Dependencies: 038, 050, 056–061
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.person_residence_municipalities (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  person_id           uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  municipality_code   text NOT NULL CHECK (municipality_code ~ '^[0-9]{7}$'),
  municipality_name   text NOT NULL CHECK (btrim(municipality_name) <> ''),
  state_code           text NOT NULL CHECK (state_code ~ '^[A-Z]{2}$'),
  valid_from           date NOT NULL,
  valid_until          date CHECK (valid_until IS NULL OR valid_until >= valid_from),
  source               text NOT NULL CHECK (source IN (
                         'hr_registration','employee_declaration','migration','manual_adjustment'
                       )),
  status               text NOT NULL DEFAULT 'pending_validation' CHECK (status IN (
                         'pending_validation','validated','expired'
                       )),
  validation_metadata  jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at          timestamptz,
  created_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (
    status <> 'validated'
    OR (verified_by IS NOT NULL AND verified_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS person_residence_municipalities_lookup_idx
  ON public.person_residence_municipalities
  (organization_id, person_id, status, valid_from, valid_until);

DO $$
BEGIN
  ALTER TABLE public.person_residence_municipalities
    ADD CONSTRAINT person_residence_validated_no_overlap
    EXCLUDE USING gist (
      organization_id WITH =,
      person_id WITH =,
      daterange(valid_from, COALESCE(valid_until, 'infinity'::date), '[]') WITH &&
    ) WHERE (status = 'validated');
EXCEPTION
  -- Constraints backed by an exclusion index can surface as either 42710
  -- (duplicate_object) or 42P07 (duplicate_table/relation), depending on the
  -- PostgreSQL version and whether the schema was provisioned manually.
  WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_person_residence_municipalities_updated_at
  ON public.person_residence_municipalities;
CREATE TRIGGER trg_person_residence_municipalities_updated_at
BEFORE UPDATE ON public.person_residence_municipalities
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.project_geofences
  ADD COLUMN IF NOT EXISTS municipality_code text
    CHECK (municipality_code IS NULL OR municipality_code ~ '^[0-9]{7}$'),
  ADD COLUMN IF NOT EXISTS municipality_name text,
  ADD COLUMN IF NOT EXISTS state_code text
    CHECK (state_code IS NULL OR state_code ~ '^[A-Z]{2}$'),
  ADD COLUMN IF NOT EXISTS municipality_source text
    CHECK (municipality_source IS NULL OR municipality_source IN ('manual','reverse_geocoding','migration')),
  ADD COLUMN IF NOT EXISTS municipality_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS municipality_verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.allowance_policies
  ADD COLUMN IF NOT EXISTS travel_eligibility_mode text NOT NULL DEFAULT 'different_municipality'
    CHECK (travel_eligibility_mode IN ('different_municipality','not_required','manual_review')),
  ADD COLUMN IF NOT EXISTS residence_municipality_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS service_municipality_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  ADD COLUMN IF NOT EXISTS supersedes_policy_id uuid REFERENCES allowance_policies(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS allowance_policies_version_idx
  ON public.allowance_policies (organization_id, id, version);
CREATE INDEX IF NOT EXISTS allowance_policies_supersedes_idx
  ON public.allowance_policies (supersedes_policy_id);

CREATE OR REPLACE FUNCTION public.prevent_referenced_allowance_policy_rule_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM daily_allowances d WHERE d.policy_id = OLD.id)
     AND (
       NEW.allowance_type IS DISTINCT FROM OLD.allowance_type OR
       NEW.project_id IS DISTINCT FROM OLD.project_id OR
       NEW.geofence_id IS DISTINCT FROM OLD.geofence_id OR
       NEW.amount_cents IS DISTINCT FROM OLD.amount_cents OR
       NEW.currency IS DISTINCT FROM OLD.currency OR
       NEW.effective_from IS DISTINCT FROM OLD.effective_from OR
       NEW.effective_until IS DISTINCT FROM OLD.effective_until OR
       NEW.active_employment_required IS DISTINCT FROM OLD.active_employment_required OR
       NEW.active_allocation_required IS DISTINCT FROM OLD.active_allocation_required OR
       NEW.block_on_leave IS DISTINCT FROM OLD.block_on_leave OR
       NEW.block_on_demobilization IS DISTINCT FROM OLD.block_on_demobilization OR
       NEW.schedule_mode IS DISTINCT FROM OLD.schedule_mode OR
       NEW.travel_eligibility_mode IS DISTINCT FROM OLD.travel_eligibility_mode OR
       NEW.residence_municipality_required IS DISTINCT FROM OLD.residence_municipality_required OR
       NEW.service_municipality_required IS DISTINCT FROM OLD.service_municipality_required OR
       NEW.version IS DISTINCT FROM OLD.version OR
       NEW.supersedes_policy_id IS DISTINCT FROM OLD.supersedes_policy_id
     ) THEN
    RAISE EXCEPTION 'Referenced allowance policy rules are immutable; create a successor version';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_allowance_policy_rule_immutable ON public.allowance_policies;
CREATE TRIGGER trg_allowance_policy_rule_immutable
BEFORE UPDATE ON public.allowance_policies
FOR EACH ROW EXECUTE FUNCTION public.prevent_referenced_allowance_policy_rule_change();

COMMIT;

-- Safe rollback: keep historical data and set successor policies to
-- travel_eligibility_mode='not_required'. Physical drops require a data audit.
