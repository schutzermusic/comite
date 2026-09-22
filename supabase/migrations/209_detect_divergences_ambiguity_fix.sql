-- ============================================================================
-- 209 — CORREÇÃO FORWARD-ONLY: `governing` era ambíguo
--
-- ─── O defeito ───────────────────────────────────────────────────────────
--
-- Em `commercial_authorization_detect_divergences` (208) a variável PL/pgSQL
-- que guardava a fonte regente chamava-se `governing` — e a tabela tem uma
-- COLUNA `governing`. No `WHERE ... AND governing AND state='ACTIVE'` o
-- Postgres não sabe a qual das duas o nome se refere, e recusa:
--
--     column reference "governing" is ambiguous
--
-- Não é um defeito de borda. A função é chamada pelo gatilho que roda em TODA
-- inserção de contrato, então o efeito prático era: nenhum contrato novo
-- entrava. A prova E2E do cenário D quebrou no primeiro `INSERT`.
--
-- ─── A correção ──────────────────────────────────────────────────────────
--
-- As variáveis passam a se chamar `v_incoming` e `v_governing`. O corpo é o
-- mesmo; o que muda é não haver mais um nome que signifique duas coisas
-- dentro do mesmo escopo.
--
-- Forward-only: a 208 fica no histórico como foi aplicada, e esta a corrige.
-- Editar a 208 faria o registro descrever um arquivo que nunca rodou.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.commercial_authorization_detect_divergences(
  p_organization_id uuid, p_authorization_id uuid
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_incoming  public.commercial_engagement_authorizations%ROWTYPE;
  v_governing public.commercial_engagement_authorizations%ROWTYPE;
  v_opened    integer := 0;
BEGIN
  SELECT * INTO v_incoming FROM public.commercial_engagement_authorizations a
   WHERE a.organization_id = p_organization_id AND a.id = p_authorization_id;
  IF NOT FOUND OR v_incoming.governing THEN RETURN 0; END IF;

  SELECT * INTO v_governing FROM public.commercial_engagement_authorizations a
   WHERE a.organization_id = p_organization_id
     AND a.engagement_id = v_incoming.engagement_id
     AND a.governing AND a.state = 'ACTIVE';
  IF NOT FOUND THEN RETURN 0; END IF;

  -- VALOR — bloqueante: é o número que o faturamento usa.
  IF v_incoming.authorized_value IS NOT NULL AND v_governing.authorized_value IS NOT NULL
     AND v_incoming.authorized_value <> v_governing.authorized_value
     AND NOT EXISTS (
       SELECT 1 FROM public.commercial_divergences d
        WHERE d.organization_id = p_organization_id AND d.scope = 'VALUE'
          AND d.left_source_id = v_governing.id AND d.right_source_id = v_incoming.id)
  THEN
    INSERT INTO public.commercial_divergences (
      organization_id, engagement_id, scope, field_path,
      left_source_kind, left_source_id, left_value,
      right_source_kind, right_source_id, right_value,
      severity, summary, detected_by)
    VALUES (p_organization_id, v_incoming.engagement_id, 'VALUE', 'authorized_value',
            v_governing.source_kind, v_governing.id, v_governing.authorized_value::text,
            v_incoming.source_kind, v_incoming.id, v_incoming.authorized_value::text,
            'BLOCKING',
            format('Valor autorizado difere entre a fonte regente (%s) e a fonte anexada (%s).',
                   v_governing.authorized_value, v_incoming.authorized_value),
            'rule');
    v_opened := v_opened + 1;
  END IF;

  -- VIGÊNCIA — atenção, não impedimento.
  IF v_incoming.effective_until IS NOT NULL AND v_governing.effective_until IS NOT NULL
     AND v_incoming.effective_until <> v_governing.effective_until
     AND NOT EXISTS (
       SELECT 1 FROM public.commercial_divergences d
        WHERE d.organization_id = p_organization_id AND d.scope = 'DATES'
          AND d.left_source_id = v_governing.id AND d.right_source_id = v_incoming.id)
  THEN
    INSERT INTO public.commercial_divergences (
      organization_id, engagement_id, scope, field_path,
      left_source_kind, left_source_id, left_value,
      right_source_kind, right_source_id, right_value,
      severity, summary, detected_by)
    VALUES (p_organization_id, v_incoming.engagement_id, 'DATES', 'effective_until',
            v_governing.source_kind, v_governing.id, v_governing.effective_until::text,
            v_incoming.source_kind, v_incoming.id, v_incoming.effective_until::text,
            'WARNING', 'Vigência final difere entre a fonte regente e a fonte anexada.', 'rule');
    v_opened := v_opened + 1;
  END IF;

  RETURN v_opened;
END $$;
REVOKE ALL ON FUNCTION public.commercial_authorization_detect_divergences(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commercial_authorization_detect_divergences(uuid,uuid) TO service_role;

COMMIT;
