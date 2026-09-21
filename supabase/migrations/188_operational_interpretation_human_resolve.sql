-- ============================================================================
-- 188 — Aceitar / descartar interpretação operacional (ato de autoridade)
--
-- Até aqui a fila `requires_attention` só podia ser vista: authenticated tem
-- SELECT, e só `automatic` era copiado para as tabelas de fato. Aceitar sem
-- gravar seria pior do que não ter botão.
--
-- Esta migration:
--   · registra a decisão humana (confirm | dismiss) na interpretação;
--   · promove confirm → trust_state = automatic (reasons limpos);
--   · marca dismiss → trust_state = dismissed (sai da fila, sem materializar);
--   · libera o guard de autoridade AI quando a interpretação foi confirmada
--     pelo mesmo fingerprint — senão seguro/garantia material continuaria
--     bloqueado mesmo após o Aceitar.
-- ============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Colunas de resolução humana
-- ---------------------------------------------------------------------------
ALTER TABLE public.contract_operational_interpretations
  ADD COLUMN IF NOT EXISTS human_decision text
    CHECK (human_decision IS NULL OR human_decision IN ('confirm', 'dismiss')),
  ADD COLUMN IF NOT EXISTS attention_resolved_by uuid
    REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attention_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS attention_resolution_note text;

ALTER TABLE public.contract_operational_interpretations
  DROP CONSTRAINT IF EXISTS contract_operational_interpretations_trust_state_check;

ALTER TABLE public.contract_operational_interpretations
  ADD CONSTRAINT contract_operational_interpretations_trust_state_check
  CHECK (trust_state IN ('automatic', 'requires_attention', 'dismissed'));

ALTER TABLE public.contract_operational_interpretations
  DROP CONSTRAINT IF EXISTS copi_trust_coherent;

ALTER TABLE public.contract_operational_interpretations
  ADD CONSTRAINT copi_trust_coherent CHECK (
    (trust_state = 'automatic'
      AND cardinality(trust_reasons) = 0
      AND (human_decision IS NULL OR human_decision = 'confirm'))
    OR (trust_state = 'requires_attention'
      AND cardinality(trust_reasons) > 0
      AND human_decision IS NULL
      AND attention_resolved_at IS NULL)
    OR (trust_state = 'dismissed'
      AND human_decision = 'dismiss'
      AND attention_resolved_at IS NOT NULL)
  );

ALTER TABLE public.contract_operational_interpretations
  DROP CONSTRAINT IF EXISTS copi_resolution_coherent;

ALTER TABLE public.contract_operational_interpretations
  ADD CONSTRAINT copi_resolution_coherent CHECK (
    (attention_resolved_at IS NULL
      AND attention_resolved_by IS NULL
      AND human_decision IS NULL
      AND nullif(btrim(coalesce(attention_resolution_note, '')), '') IS NULL)
    OR (attention_resolved_at IS NOT NULL
      AND attention_resolved_by IS NOT NULL
      AND human_decision IS NOT NULL)
  );

COMMENT ON COLUMN public.contract_operational_interpretations.human_decision IS
  'Ato humano: confirm promove a automatic e autoriza materialização; dismiss encerra a retenção sem operar.';

-- ---------------------------------------------------------------------------
-- 2) Guard: bypass quando a interpretação do mesmo fingerprint foi confirmada
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contracts_guard_ai_operational_authority() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  row_json jsonb := to_jsonb(NEW);
  exposure numeric;
  fp text := nullif(btrim(coalesce(row_json->>'ai_fingerprint', '')), '');
BEGIN
  IF row_json->>'ai_origin' <> 'apex_ai' THEN RETURN NEW; END IF;

  -- Autoridade humana: Aceitar já carimbou a interpretação com o mesmo
  -- fingerprint. Sem este bypass, exposição material / baixa confiança
  -- continuariam a bloquear o insert mesmo após a decisão.
  IF fp IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.contract_operational_interpretations i
        WHERE i.organization_id = (row_json->>'organization_id')::uuid
          AND i.contract_id = (row_json->>'contract_id')::uuid
          AND i.fingerprint = fp
          AND i.human_decision = 'confirm'
          AND i.attention_resolved_at IS NOT NULL
     ) THEN
    RETURN NEW;
  END IF;

  IF (row_json->>'ai_confidence')::numeric < 0.75 THEN
    RAISE EXCEPTION 'AI operational fact requires attention: low confidence.'
      USING ERRCODE = 'check_violation';
  END IF;
  exposure := COALESCE(
    NULLIF(row_json->>'required_amount','')::numeric,
    NULLIF(row_json->>'required_coverage','')::numeric);
  IF exposure IS NOT NULL AND abs(exposure) >= 100000 THEN
    RAISE EXCEPTION 'AI operational fact requires attention: material financial exposure.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.contracts_guard_ai_operational_authority() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3) RPC de resolução (authenticated, SECURITY DEFINER)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contract_operational_interpretation_resolve(
  p_interpretation_id uuid,
  p_decision text,
  p_note text DEFAULT NULL
) RETURNS public.contract_operational_interpretations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _uid uuid := auth.uid();
  _org uuid := public.current_user_organization_id();
  _row public.contract_operational_interpretations;
BEGIN
  IF _uid IS NULL OR _org IS NULL THEN
    RAISE EXCEPTION 'Interpretation decisions require an authenticated tenant.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (public.current_user_is_admin() OR public.current_user_has_permission('contracts.edit')) THEN
    RAISE EXCEPTION 'contracts.edit permission required.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_decision NOT IN ('confirm', 'dismiss') THEN
    RAISE EXCEPTION 'Invalid operational interpretation decision.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_decision = 'dismiss' AND btrim(coalesce(p_note, '')) = '' THEN
    RAISE EXCEPTION 'Dismissal requires a justification.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO _row
    FROM public.contract_operational_interpretations
   WHERE id = p_interpretation_id
     AND organization_id = _org
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operational interpretation not found in this organization.'
      USING ERRCODE = 'no_data_found';
  END IF;

  IF _row.trust_state <> 'requires_attention' OR _row.attention_resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'Interpretation is not awaiting a human decision.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_decision = 'confirm' THEN
    UPDATE public.contract_operational_interpretations SET
      trust_state = 'automatic',
      trust_reasons = ARRAY[]::text[],
      human_decision = 'confirm',
      attention_resolved_by = _uid,
      attention_resolved_at = now(),
      attention_resolution_note = nullif(btrim(coalesce(p_note, '')), '')
     WHERE id = _row.id
    RETURNING * INTO _row;
  ELSE
    UPDATE public.contract_operational_interpretations SET
      trust_state = 'dismissed',
      human_decision = 'dismiss',
      attention_resolved_by = _uid,
      attention_resolved_at = now(),
      attention_resolution_note = btrim(p_note)
     WHERE id = _row.id
    RETURNING * INTO _row;
  END IF;

  RETURN _row;
END $$;

REVOKE ALL ON FUNCTION public.contract_operational_interpretation_resolve(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_operational_interpretation_resolve(uuid, text, text)
  TO authenticated;

COMMIT;
