-- ============================================================================
-- 187 — O PALPITE VELHO SAI QUANDO O NOVO CHEGA
--
-- ─── O lixo que a reconciliação deixava para trás ─────────────────────────
--
-- `contract_billing_propose_timeline_mapping` é idempotente por PAR
-- (regra, etapa). Quando o matcher melhora — ou quando o cronograma muda — o
-- mesmo marco passa a apontar para OUTRA etapa, e uma linha nova nasce. A
-- antiga fica: `system_proposed` / `proposed`, apontando para a etapa que o
-- sistema não escolheria mais.
--
-- O resultado é uma fila de revisão com duas sugestões contraditórias para o
-- mesmo marco, e uma visão que escolhe entre elas pela confiança — isto é,
-- pelo acaso de qual palpite era mais alto. Quem abre a tela vê o sistema
-- discordando de si mesmo.
--
-- ─── O que esta função apaga, e por que apagar é correto aqui ─────────────
--
-- Apaga SOMENTE linhas que reúnem as três condições:
--
--   mapping_source = 'system_proposed'   — palpite de máquina
--   review_state   = 'proposed'          — que NINGUÉM revisou
--   id NOT IN (as do lote atual)         — e que o lote atual substituiu
--
-- Nenhuma decisão humana é tocada. `accepted` e `rejected` carregam revisor e
-- data — são história de governança e ficam. `explicit` é escolha de gente e
-- fica. O que sai é um palpite que nunca foi lido por ninguém e que o próprio
-- sistema já abandonou.
--
-- Manter esse palpite não seria "preservar histórico": seria preservar uma
-- afirmação que o sistema deixou de fazer, ao lado da que ele faz agora.
--
-- ─── Por que DELETE e não um estado novo ──────────────────────────────────
--
-- `rejected` significa "um humano olhou e disse não" — o CHECK da 131 exige
-- revisor nomeado para chegar lá, e inventar um carimbo de revisor para uma
-- faxina de robô seria falsificar a autoria de uma decisão.
--
-- Um sexto estado ("superseded") resolveria, e custaria: mais um valor no
-- CHECK, mais um caso em toda consulta, mais um rótulo na tela — para
-- representar uma linha que ninguém quer ver.
--
-- ─── O teto ───────────────────────────────────────────────────────────────
--
-- Não é executável por `authenticated`. Roda no service role, dentro da
-- reconciliação, depois que o chamador já decidiu a autorização — o mesmo
-- contrato da função de proposta.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.contract_billing_retire_superseded_proposals(
  p_organization_id uuid,
  p_project_id      text,
  p_rule_ids        uuid[],
  p_keep_mapping_ids uuid[] DEFAULT ARRAY[]::uuid[]
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_removed integer := 0;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organização é obrigatória.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_rule_ids IS NULL OR array_length(p_rule_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  WITH removed AS (
    DELETE FROM public.contract_measurement_rule_timeline_mappings m
     WHERE m.organization_id = p_organization_id
       AND m.project_id      = p_project_id
       AND m.rule_id         = ANY (p_rule_ids)
       -- As três condições que tornam a linha descartável. Nenhuma delas é
       -- opcional, e é a combinação que garante que decisão humana não sai.
       AND m.mapping_source  = 'system_proposed'
       AND m.review_state    = 'proposed'
       AND m.reviewed_by IS NULL
       AND NOT (m.id = ANY (COALESCE(p_keep_mapping_ids, ARRAY[]::uuid[])))
    RETURNING 1)
  SELECT count(*)::int INTO v_removed FROM removed;

  RETURN v_removed;
END $$;

REVOKE ALL ON FUNCTION public.contract_billing_retire_superseded_proposals(
  uuid, text, uuid[], uuid[]) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.contract_billing_retire_superseded_proposals(
  uuid, text, uuid[], uuid[]) IS
  'Remove palpites de máquina SUPERADOS: apenas system_proposed + proposed + '
  'sem revisor, e apenas os que o lote atual não repetiu. Decisão humana '
  '(accepted, rejected, explicit) nunca é tocada — a função não tem WHERE que '
  'a alcance.';

COMMIT;
