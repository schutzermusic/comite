-- ============================================================================
-- 196 — O AUTOR DO FECHAMENTO DO ITEM DE CORREÇÃO
--
-- ─── O defeito que a validação de ponta a ponta encontrou ─────────────────
--
-- `pmci_resolution_stamp` (192) exigia que `resolved_at` e `resolved_by`
-- existissem JUNTOS. A intenção era boa — item fechado tem autor —, e o efeito
-- prático era outro: `project_measurement_resubmit` grava
-- `resolved_by = auth.uid()`, e no service role `auth.uid()` é NULO. Toda
-- chamada de servidor ao reenvio quebrava na restrição.
--
-- ─── As duas saídas erradas ───────────────────────────────────────────────
--
--   ERRADO  carimbar um usuário qualquer (o criador da medição, o dono do
--           contrato) para satisfazer a restrição. Isso é FABRICAR autoria: a
--           auditoria passaria a dizer que uma pessoa fechou um item que ela
--           nunca viu.
--   ERRADO  deixar o reenvio de servidor falhar. O item de correção ficaria
--           aberto para sempre, e a medição reentraria na fila carregando
--           pendência que já foi resolvida.
--
-- ─── A saída certa ────────────────────────────────────────────────────────
--
-- A implicação passa a valer numa direção só: quem tem AUTOR tem DATA. Fechado
-- sem autor continua sendo fechado, e quem fechou está na história da transição
-- que o fechou — `project_measurement_history` registra ator e `actor_source`
-- na mesma transação do reenvio. A autoria não se perde; ela mora onde já
-- morava para todo o resto do ciclo.
--
-- A coluna `closure_actor_source` torna isso legível SEM um JOIN: 'human'
-- quando houve pessoa, 'system' quando o fechamento veio de rotina ou rota de
-- servidor. Um relatório que não distingue os dois apresenta rotina como
-- decisão humana, e é a única coisa que esta migration acrescenta ao esquema.
-- ============================================================================

BEGIN;

ALTER TABLE public.project_measurement_correction_items
  DROP CONSTRAINT pmci_resolution_stamp;

ALTER TABLE public.project_measurement_correction_items
  ADD COLUMN IF NOT EXISTS closure_actor_source text
    CHECK (closure_actor_source IS NULL OR closure_actor_source IN ('human','system'));

ALTER TABLE public.project_measurement_correction_items
  -- Autor implica data. A volta NÃO vale: fechamento por servidor não tem
  -- `auth.uid()`, e inventar um seria fabricar autoria.
  ADD CONSTRAINT pmci_resolution_author_needs_stamp CHECK (
    resolved_by IS NULL OR resolved_at IS NOT NULL),
  -- Fechado DIZ de onde veio o fechamento, mesmo quando não houve pessoa.
  ADD CONSTRAINT pmci_closure_source_scope CHECK (
    (resolved_at IS NULL) = (closure_actor_source IS NULL)),
  -- 'human' exige a pessoa. Sem isto, `closure_actor_source` viraria um rótulo
  -- que qualquer escrita poderia mentir.
  ADD CONSTRAINT pmci_human_closure_has_author CHECK (
    closure_actor_source <> 'human' OR resolved_by IS NOT NULL);

COMMENT ON COLUMN public.project_measurement_correction_items.closure_actor_source IS
  'De onde veio o fechamento: `human` (pessoa autenticada, e `resolved_by` a '
  'nomeia) ou `system` (rotina/rota de servidor, sem auth.uid()). Existe para '
  'que um relatório não apresente rotina como decisão humana.';

-- ---------------------------------------------------------------------------
-- O reenvio, com o fechamento honesto
-- ---------------------------------------------------------------------------
/*
  Idêntica à de 192, com UMA diferença: o fechamento carimba a origem do ator
  em vez de depender de `auth.uid()` existir.
*/
CREATE OR REPLACE FUNCTION public.project_measurement_resubmit(
  p_measurement_id uuid,
  p_note           text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m public.project_measurements%ROWTYPE;
  res jsonb;
  closed integer;
  actor uuid := auth.uid();
BEGIN
  SELECT * INTO m FROM public.project_measurements WHERE id = p_measurement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEASUREMENT_NOT_FOUND: medição inexistente.' USING ERRCODE = 'no_data_found';
  END IF;
  IF m.status NOT IN ('RETURNED_FOR_CORRECTION','CUSTOMER_CORRECTION_REQUESTED') THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: só medição devolvida é reenviada (estado atual: %).', m.status
      USING ERRCODE = 'check_violation';
  END IF;

  res := public.project_measurement_recompute_readiness(p_measurement_id);
  IF res->'dimensions'->>'submission' NOT IN ('READY') THEN
    RAISE EXCEPTION 'NOT_READY: prontidão de submissão é % (%).',
      res->'dimensions'->>'submission', res->>'reasons' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.project_measurement_correction_items
     SET resolved_at = now(),
         resolved_by = actor,
         closure_actor_source = CASE WHEN actor IS NOT NULL THEN 'human' ELSE 'system' END,
         resolution_note = COALESCE(p_note, 'Fechado pelo reenvio para análise.')
   WHERE measurement_id = m.id AND resolved_at IS NULL;
  GET DIAGNOSTICS closed = ROW_COUNT;

  RETURN public.project_measurement_transition(
    p_measurement_id, 'SUBMITTED', 'projects.measurement.resubmitted',
    p_note, 'human', NULL,
    jsonb_build_object('readiness', res->'dimensions', 'corrections_closed', closed),
    jsonb_build_object('corrections_closed', closed),
    'projects.measurements.submit', 'submitted_at');
END $$;

REVOKE ALL ON FUNCTION public.project_measurement_resubmit(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_measurement_resubmit(uuid, text) TO authenticated;

COMMIT;
