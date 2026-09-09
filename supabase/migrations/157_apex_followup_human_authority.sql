-- ============================================================================
-- PLATAFORMA — o caminho GOVERNADO da autoridade humana no acompanhamento
-- Migration: 157_apex_followup_human_authority
--
-- ─── O problema que a 156 deixou aberto ────────────────────────────────────
--
-- A 156 fez duas coisas certas que, juntas, fechavam a porta: (1) `authenticated`
-- não grava em `apex_followups`, e (2) designar responsável e confirmar
-- conclusão exigem `auth.uid()`. O service role tem escrita mas não tem
-- sessão; a sessão tem `auth.uid()` mas não tem escrita. Sem uma terceira via,
-- a única forma de fazer um humano designar alguém seria afrouxar uma das
-- duas — e afrouxar qualquer uma delas devolve a personificação ao produto.
--
-- ─── A terceira via ────────────────────────────────────────────────────────
--
-- Funções SECURITY DEFINER concedidas a `authenticated`. Elas gravam com o
-- privilégio do dono, mas o carimbo de autoridade NÃO é parâmetro: é
-- `auth.uid()`, lido de dentro. Não existe argumento que faça a função
-- atribuir a decisão a outra pessoa — a ausência do parâmetro é a garantia.
--
-- O inquilino também não é parâmetro: vem de `current_user_organization_id()`.
-- Aceitar um `organization_id` do cliente transformaria cada uma destas
-- funções numa porta de travessia entre inquilinos.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Designar responsável — ato humano
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apex_followup_assign(
  p_followup_id          uuid,
  p_responsible_user_id  uuid    DEFAULT NULL,
  p_responsible_party_id uuid    DEFAULT NULL,
  p_responsible_text     text    DEFAULT NULL,
  p_due_date             date    DEFAULT NULL,
  p_cadence_days         integer DEFAULT NULL,
  p_expected_evidence    text    DEFAULT NULL
) RETURNS public.apex_followups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _uid uuid := auth.uid();
  _org uuid := public.current_user_organization_id();
  _row public.apex_followups;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Designar responsável exige sessão autenticada.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _org IS NULL THEN
    RAISE EXCEPTION 'Usuário sem organização ativa.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_responsible_user_id IS NULL
     AND p_responsible_party_id IS NULL
     AND btrim(coalesce(p_responsible_text,'')) = '' THEN
    RAISE EXCEPTION 'Acompanhamento sem responsável é lembrete, não governança.'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.apex_followups
     SET responsible_user_id  = p_responsible_user_id,
         responsible_party_id = p_responsible_party_id,
         responsible_text     = p_responsible_text,
         due_date             = COALESCE(p_due_date, due_date),
         cadence_days         = COALESCE(p_cadence_days, cadence_days),
         expected_evidence    = COALESCE(p_expected_evidence, expected_evidence),
         -- O carimbo não é parâmetro. É esta linha, e só ela.
         assigned_by          = _uid,
         assigned_at          = now()
   WHERE id = p_followup_id
     AND organization_id = _org
  RETURNING * INTO _row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Acompanhamento não encontrado nesta organização.' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN _row;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Conclusão por CONFIRMAÇÃO humana
-- ---------------------------------------------------------------------------
-- O outro caminho de conclusão — evidência verificada — é do Apex e vive no
-- store de serviço. Este aqui é para quando a verificação determinística não é
-- possível: alguém olha e responde por isso.
CREATE OR REPLACE FUNCTION public.apex_followup_confirm_completion(
  p_followup_id uuid,
  p_note        text DEFAULT NULL
) RETURNS public.apex_followups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _uid uuid := auth.uid();
  _org uuid := public.current_user_organization_id();
  _row public.apex_followups;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Concluir por confirmação humana exige sessão autenticada.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _org IS NULL THEN
    RAISE EXCEPTION 'Usuário sem organização ativa.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.apex_followups
     SET state         = 'COMPLETED',
         closure_basis = 'human_confirmation',
         closed_at     = now(),
         verified_at   = now(),
         verified_by   = _uid,
         state_note    = COALESCE(p_note, state_note)
   WHERE id = p_followup_id
     AND organization_id = _org
     AND state IN ('ACTIVE','WAITING_EXTERNAL_PARTY','BLOCKED','ESCALATED')
  RETURNING * INTO _row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Acompanhamento não encontrado, ou já encerrado.' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN _row;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Baixar a atenção de uma interpretação — ato humano
-- ---------------------------------------------------------------------------
-- `contract_clauses` concede UPDATE a `authenticated`, então tecnicamente a
-- sessão poderia gravar direto. Ela não deve: o par (estado, carimbo) precisa
-- ser gravado JUNTO e sempre com `auth.uid()`, e um UPDATE solto da aplicação
-- pode esquecer metade. A função torna a operação atômica e nomeada.
CREATE OR REPLACE FUNCTION public.contract_clause_resolve_attention(
  p_clause_id uuid,
  p_decision  text,          -- 'confirm' | 'dismiss' | 'acknowledge'
  p_note      text DEFAULT NULL
) RETURNS public.contract_clauses
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _uid uuid := auth.uid();
  _org uuid := public.current_user_organization_id();
  _row public.contract_clauses;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Decidir sobre uma interpretação exige sessão autenticada.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _org IS NULL THEN
    RAISE EXCEPTION 'Usuário sem organização ativa.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_decision NOT IN ('confirm','dismiss','acknowledge') THEN
    RAISE EXCEPTION 'Decisão inválida: %.', p_decision USING ERRCODE = 'check_violation';
  END IF;
  IF p_decision = 'dismiss' AND btrim(coalesce(p_note,'')) = '' THEN
    RAISE EXCEPTION 'Descartar uma interpretação exige justificativa.' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.contract_clauses
     SET interpretation_state = CASE p_decision
                                  WHEN 'confirm' THEN 'human_confirmed'
                                  WHEN 'dismiss' THEN 'dismissed'
                                  ELSE interpretation_state END,
         -- 'acknowledge' é "eu vi, segue operando": baixa a atenção sem
         -- transformar a leitura em afirmação humana. Sem esse degrau, olhar
         -- um item viraria assinar embaixo dele.
         attention_resolved_by      = _uid,
         attention_resolved_at      = now(),
         attention_resolution_note  = p_note,
         updated_by                 = _uid
   WHERE id = p_clause_id
     AND organization_id = _org
  RETURNING * INTO _row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cláusula não encontrada nesta organização.' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN _row;
END $$;

-- ---------------------------------------------------------------------------
-- 4) Privilégios
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.apex_followup_assign(uuid,uuid,uuid,text,date,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apex_followup_assign(uuid,uuid,uuid,text,date,integer,text) TO authenticated;
REVOKE ALL ON FUNCTION public.apex_followup_confirm_completion(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apex_followup_confirm_completion(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.contract_clause_resolve_attention(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_clause_resolve_attention(uuid,text,text) TO authenticated;

-- `anon` herdou SELECT do padrão do schema. A RLS já o deixa sem nenhuma
-- linha, mas uma superfície que não deveria existir não deve depender só da
-- política para ficar vazia.
REVOKE SELECT ON public.apex_followups FROM anon;
REVOKE SELECT ON public.apex_followup_events FROM anon;
REVOKE SELECT ON public.organization_business_calendars FROM anon;
REVOKE SELECT ON public.organization_non_business_days FROM anon;

COMMIT;
