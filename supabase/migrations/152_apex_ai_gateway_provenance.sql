-- ============================================================================
-- 152 — Apex AI Gateway provenance
--
-- Provider/model are mandatory for persisted AI output. Token counts remain
-- nullable because legacy rows and providers may not expose usage, but every
-- new gateway-backed write records them when returned by the provider.
-- ============================================================================

BEGIN;

ALTER TABLE public.risks
  ADD COLUMN IF NOT EXISTS ai_provider text,
  ADD COLUMN IF NOT EXISTS ai_input_tokens bigint,
  ADD COLUMN IF NOT EXISTS ai_output_tokens bigint;

UPDATE public.risks
   SET ai_provider = CASE
     WHEN ai_model LIKE 'claude-%' THEN 'anthropic'
     WHEN ai_model LIKE 'gpt-%' THEN 'openai'
     WHEN ai_model LIKE 'gemini-%' OR ai_model LIKE 'googleai/%' THEN 'google'
     ELSE 'unknown_legacy'
   END
 WHERE origin = 'ai' AND ai_provider IS NULL;

ALTER TABLE public.risks
  ADD CONSTRAINT risks_ai_provenance_check
    CHECK (origin <> 'ai' OR (ai_provider IS NOT NULL AND ai_model IS NOT NULL)),
  ADD CONSTRAINT risks_ai_token_usage_check
    CHECK ((ai_input_tokens IS NULL OR ai_input_tokens >= 0)
       AND (ai_output_tokens IS NULL OR ai_output_tokens >= 0));

COMMENT ON COLUMN public.risks.ai_provider IS 'Provider used by Apex AI Gateway.';
COMMENT ON COLUMN public.risks.ai_input_tokens IS 'Provider-reported input token count.';
COMMENT ON COLUMN public.risks.ai_output_tokens IS 'Provider-reported output token count.';

ALTER TABLE public.contract_ai_analyses
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS input_tokens bigint,
  ADD COLUMN IF NOT EXISTS output_tokens bigint;

UPDATE public.contract_ai_analyses
   SET provider = CASE
     WHEN model LIKE 'claude-%' THEN 'anthropic'
     WHEN model LIKE 'gpt-%' THEN 'openai'
     WHEN model LIKE 'gemini-%' OR model LIKE 'googleai/%' THEN 'google'
     ELSE 'unknown_legacy'
   END
 WHERE model IS NOT NULL AND provider IS NULL;

ALTER TABLE public.contract_ai_analyses
  ADD CONSTRAINT contract_ai_analyses_provenance_check
    CHECK (status <> 'completed' OR (provider IS NOT NULL AND model IS NOT NULL)),
  ADD CONSTRAINT contract_ai_analyses_token_usage_check
    CHECK ((input_tokens IS NULL OR input_tokens >= 0)
       AND (output_tokens IS NULL OR output_tokens >= 0));

ALTER TABLE public.contract_clauses
  ADD COLUMN IF NOT EXISTS ai_provider text;

UPDATE public.contract_clauses
   SET ai_provider = CASE
     WHEN ai_model LIKE 'claude-%' THEN 'anthropic'
     WHEN ai_model LIKE 'gpt-%' THEN 'openai'
     WHEN ai_model LIKE 'gemini-%' OR ai_model LIKE 'googleai/%' THEN 'google'
     ELSE 'unknown_legacy'
   END
 WHERE ai_flagged = true AND ai_provider IS NULL;

ALTER TABLE public.contract_clauses
  ADD CONSTRAINT contract_clauses_ai_provenance_check
    CHECK (ai_flagged = false OR (ai_provider IS NOT NULL AND ai_model IS NOT NULL));

ALTER TABLE public.payroll_generated_reports
  ADD COLUMN IF NOT EXISTS ai_provider text,
  ADD COLUMN IF NOT EXISTS ai_model text,
  ADD COLUMN IF NOT EXISTS ai_input_tokens bigint,
  ADD COLUMN IF NOT EXISTS ai_output_tokens bigint;

UPDATE public.payroll_generated_reports
   SET ai_provider = COALESCE(ai_provider, 'unknown_legacy'),
       ai_model = COALESCE(ai_model, 'unknown_legacy')
 WHERE generated_by_ai = true;

ALTER TABLE public.payroll_generated_reports
  ADD CONSTRAINT payroll_generated_reports_ai_provenance_check
    CHECK (generated_by_ai = false OR (ai_provider IS NOT NULL AND ai_model IS NOT NULL)),
  ADD CONSTRAINT payroll_generated_reports_ai_token_usage_check
    CHECK ((ai_input_tokens IS NULL OR ai_input_tokens >= 0)
       AND (ai_output_tokens IS NULL OR ai_output_tokens >= 0));

COMMENT ON COLUMN public.contract_ai_analyses.provider IS 'Provider selected by Apex AI Gateway.';
COMMENT ON COLUMN public.contract_clauses.ai_provider IS 'Provider that produced the AI proposal.';
COMMENT ON COLUMN public.payroll_generated_reports.ai_provider IS 'Provider that generated the report narrative.';

ALTER TABLE public.aso_documents
  ADD COLUMN IF NOT EXISTS ai_provider text,
  ADD COLUMN IF NOT EXISTS ai_model text,
  ADD COLUMN IF NOT EXISTS ai_input_tokens bigint,
  ADD COLUMN IF NOT EXISTS ai_output_tokens bigint;

UPDATE public.aso_documents
   SET ai_provider = COALESCE(ai_provider, 'unknown_legacy'),
       ai_model = COALESCE(ai_model, 'unknown_legacy')
 WHERE extraction_method = 'ocr_ai';

ALTER TABLE public.aso_documents
  ADD CONSTRAINT aso_documents_ai_provenance_check
    CHECK (extraction_method <> 'ocr_ai' OR (ai_provider IS NOT NULL AND ai_model IS NOT NULL)),
  ADD CONSTRAINT aso_documents_ai_token_usage_check
    CHECK ((ai_input_tokens IS NULL OR ai_input_tokens >= 0)
       AND (ai_output_tokens IS NULL OR ai_output_tokens >= 0));

ALTER TABLE public.project_schedule_imports
  ADD COLUMN IF NOT EXISTS ai_provider text,
  ADD COLUMN IF NOT EXISTS ai_model text,
  ADD COLUMN IF NOT EXISTS ai_input_tokens bigint,
  ADD COLUMN IF NOT EXISTS ai_output_tokens bigint;

UPDATE public.project_schedule_imports
   SET ai_provider = COALESCE(ai_provider, 'unknown_legacy'),
       ai_model = COALESCE(ai_model, 'unknown_legacy')
 WHERE parser_used = 'ai';

ALTER TABLE public.project_schedule_imports
  ADD CONSTRAINT project_schedule_imports_ai_provenance_check
    CHECK (parser_used <> 'ai' OR (ai_provider IS NOT NULL AND ai_model IS NOT NULL)),
  ADD CONSTRAINT project_schedule_imports_ai_token_usage_check
    CHECK ((ai_input_tokens IS NULL OR ai_input_tokens >= 0)
       AND (ai_output_tokens IS NULL OR ai_output_tokens >= 0));

COMMIT;
