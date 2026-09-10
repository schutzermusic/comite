-- ============================================================================
-- 160 — Immutable AI provenance for contract operational facts
--
-- Every AI-created fact identifies the run and model that proposed it, the
-- requesting human, and the complete literal evidence. The fingerprint is a
-- database-enforced reanalysis boundary; manual facts keep NULL fingerprints.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  t text;
  c text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'contract_obligation_definitions',
    'contract_billing_conditions',
    'contract_guarantees',
    'contract_insurance_requirements',
    'contract_indexation_rules'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE public.%I
         ADD COLUMN IF NOT EXISTS ai_origin text NOT NULL DEFAULT ''human'',
         ADD COLUMN IF NOT EXISTS ai_analysis_id uuid,
         ADD COLUMN IF NOT EXISTS ai_provider text,
         ADD COLUMN IF NOT EXISTS ai_model text,
         ADD COLUMN IF NOT EXISTS ai_confidence numeric,
         ADD COLUMN IF NOT EXISTS ai_pipeline_version text,
         ADD COLUMN IF NOT EXISTS ai_requesting_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
         ADD COLUMN IF NOT EXISTS ai_evidence jsonb,
         ADD COLUMN IF NOT EXISTS ai_fingerprint text', t);

    c := t || '_ai_origin_check';
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (ai_origin IN (''human'',''apex_ai''))', t, c);
    END IF;
    c := t || '_ai_confidence_check';
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1))', t, c);
    END IF;
    c := t || '_ai_evidence_check';
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
           ai_origin <> ''apex_ai'' OR (
             ai_analysis_id IS NOT NULL AND ai_provider IS NOT NULL AND ai_model IS NOT NULL
             AND ai_confidence IS NOT NULL AND ai_pipeline_version IS NOT NULL
             AND ai_requesting_user_id IS NOT NULL AND ai_fingerprint IS NOT NULL
             AND source_document_id IS NOT NULL AND source_page IS NOT NULL
             AND ai_evidence IS NOT NULL AND jsonb_typeof(ai_evidence) = ''object''
             AND nullif(btrim(ai_evidence->>''excerpt''), '''') IS NOT NULL
             AND (ai_evidence->>''page'')::integer = source_page
             AND (ai_evidence->>''documentId'')::uuid = source_document_id
           ))', t, c);
    END IF;
    c := t || '_ai_analysis_tenant';
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (organization_id, ai_analysis_id)
           REFERENCES public.contract_ai_analyses (organization_id, id) ON DELETE RESTRICT', t, c);
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS cod_ai_operational_fingerprint
  ON public.contract_obligation_definitions
    (organization_id, contract_id, source_document_id, ai_fingerprint)
  WHERE ai_origin = 'apex_ai';
CREATE UNIQUE INDEX IF NOT EXISTS cbc_ai_operational_fingerprint
  ON public.contract_billing_conditions
    (organization_id, contract_id, source_document_id, ai_fingerprint)
  WHERE ai_origin = 'apex_ai';
CREATE UNIQUE INDEX IF NOT EXISTS cg_ai_operational_fingerprint
  ON public.contract_guarantees
    (organization_id, contract_id, source_document_id, ai_fingerprint)
  WHERE ai_origin = 'apex_ai';
CREATE UNIQUE INDEX IF NOT EXISTS cir_ai_operational_fingerprint
  ON public.contract_insurance_requirements
    (organization_id, contract_id, source_document_id, ai_fingerprint)
  WHERE ai_origin = 'apex_ai';
CREATE UNIQUE INDEX IF NOT EXISTS cirule_ai_operational_fingerprint
  ON public.contract_indexation_rules
    (organization_id, contract_id, source_document_id, ai_fingerprint)
  WHERE ai_origin = 'apex_ai';

COMMENT ON COLUMN public.contract_obligation_definitions.ai_origin IS
  'human = manually asserted fact; apex_ai = machine interpretation whose immutable run/model/evidence provenance is required.';

COMMIT;
