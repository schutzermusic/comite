-- ============================================================================
-- 239 — REPARO DAS GUARDAS DO MOTOR DE APROVAÇÃO
--
-- ─── O defeito ────────────────────────────────────────────────────────────
--
-- Três RPCs do motor (125/127) protegiam a fronteira com
--
--     IF current_user IN ('authenticated','anon') THEN … END IF;
--
-- Elas são SECURITY DEFINER. Lá dentro `current_user` é a DONA da função, não
-- quem chamou — a própria 127 (§ approval_step_eligibility_for_viewer) e a 140
-- registram isso. A guarda nunca disparava. Provado no QA isolado antes desta
-- migration: uma sessão de OUTRO inquilino cancelou um pedido PENDENTE do
-- inquilino principal com `approval_request_cancel(<uuid>, '…')`.
--
--   approval_request_cancel   qualquer sessão cancelava pedido de qualquer
--                             inquilino, sem ser solicitante nem administrador.
--   approval_policy_activate  qualquer sessão ativava versão DRAFT de qualquer
--                             inquilino, sem approvals.policy.manage.
--   approval_decide           a recusa de inquilino não disparava; a trava e as
--                             mensagens de estado alcançavam o pedido alheio
--                             antes da recusa de elegibilidade (que continuava
--                             barrando a decisão em si).
--
-- ─── O reparo ─────────────────────────────────────────────────────────────
--
-- Corpo IDÊNTICO ao implantado; muda só a guarda, que passa a usar
-- `apex_caller_is_browser()` (140) — a identidade do chamador lida da
-- reivindicação JWT, que sobrevive a SECURITY DEFINER. Em cancelar e ativar, o
-- inquilino é conferido ANTES da trava da linha.
--
-- Caminhos de SERVIDOR continuam iguais: `purchase_order_cancel` chama o
-- cancelamento com a reivindicação `role = service_role` (237), que não é
-- navegador; provas e rotinas sem JWT também não são.
--
-- `approval_request_create` NÃO muda aqui: ele é chamado de DENTRO de funções
-- de domínio disparadas pelo navegador (contract_billing_release), e a mesma
-- guarda passaria a exigir approvals.request de quem libera faturamento. O
-- inquilino dele continua protegido pelo resolvedor de sujeito (140). Dívida
-- registrada no runbook.
--
-- Assinaturas, grants e o ator vindo de auth.uid() — intocados.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.approval_policy_activate(p_version_id uuid, p_supersede_previous boolean DEFAULT true)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v public.approval_policy_versions%ROWTYPE;
  problems text;
  clash    text;
  actor    uuid := auth.uid();
BEGIN
  -- 239: o inquilino é conferido ANTES da trava. Travar a linha de outro
  -- inquilino para só depois recusar já seria agir sobre ela.
  SELECT * INTO v FROM public.approval_policy_versions WHERE id = p_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Versão de política inexistente.' USING ERRCODE = 'no_data_found';
  END IF;

  -- Administrar política NÃO é decidir (§35). Quem chega aqui precisa de
  -- approvals.policy.manage, e ter essa permissão não dá alçada nenhuma.
  -- 239: o chamador de navegador é reconhecido pela reivindicação JWT
  -- (apex_caller_is_browser, 140). `current_user` aqui dentro é a dona da
  -- função, e a guarda antiga nunca disparava.
  IF public.apex_caller_is_browser() THEN
    IF public.current_user_organization_id() IS DISTINCT FROM v.organization_id THEN
      RAISE EXCEPTION 'Versão de política inexistente.' USING ERRCODE = 'no_data_found';
    END IF;
    IF NOT (public.current_user_has_permission('approvals.policy.manage')
            OR public.current_user_has_permission('approvals.admin')) THEN
      RAISE EXCEPTION 'Ativação negada.' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO v FROM public.approval_policy_versions WHERE id = p_version_id FOR UPDATE;

  IF v.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Só uma versão em DRAFT pode ser ativada (status atual: %).', v.status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT string_agg(format('%s: %s', code, detail), E'\n')
    INTO problems FROM public.approval_policy_version_problems(p_version_id);
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION E'Versão de política inválida:\n%', problems USING ERRCODE = 'check_violation';
  END IF;

  /*
    Ambiguidade de seleção, barrada na ATIVAÇÃO.

    Duas versões ATIVAS que casem o mesmo (sujeito, ação, propósito), com
    janelas de vigência sobrepostas, condições sobrepostas e MESMA precedência
    são indistinguíveis para o seletor. A §10 proíbe desempatar por "a mais
    recente". Precedência diferente resolve; precedência igual é erro de
    governança, e o lugar de recusá-lo é aqui.

    Sobreposição de faixa: dois intervalos [a,b) e [c,d) se sobrepõem quando
    a < d e c < b, com NULL valendo infinito do lado correspondente. Moedas
    diferentes nunca se sobrepõem — não há conversão.
  */
  SELECT string_agg(format('%s v%s', p.policy_key, o.version_no), ', ')
    INTO clash
    FROM public.approval_policy_versions o
    JOIN public.approval_policies p ON p.id = o.policy_id
   WHERE o.organization_id  = v.organization_id
     AND o.id              <> v.id
     AND o.status           = 'ACTIVE'
     AND o.subject_type     = v.subject_type
     AND o.action_type      = v.action_type
     AND o.decision_purpose = v.decision_purpose
     AND o.precedence       = v.precedence
     AND (o.effective_until IS NULL OR o.effective_until > v.effective_from)
     AND (v.effective_until IS NULL OR v.effective_until > o.effective_from)
     AND (o.contract_type    IS NULL OR v.contract_type    IS NULL OR o.contract_type    = v.contract_type)
     AND (o.risk_class       IS NULL OR v.risk_class       IS NULL OR o.risk_class       = v.risk_class)
     AND (o.cost_center_id   IS NULL OR v.cost_center_id   IS NULL OR o.cost_center_id   = v.cost_center_id)
     AND (o.business_unit_id IS NULL OR v.business_unit_id IS NULL OR o.business_unit_id = v.business_unit_id)
     AND (o.currency IS NULL OR v.currency IS NULL OR o.currency = v.currency)
     AND (o.min_amount IS NULL OR v.max_amount IS NULL OR o.min_amount < v.max_amount)
     AND (v.min_amount IS NULL OR o.max_amount IS NULL OR v.min_amount < o.max_amount)
     -- Uma versão ANTERIOR da MESMA política não é conflito: ela vai ser
     -- sucedida logo abaixo, nesta mesma transação.
     AND NOT (p_supersede_previous AND o.policy_id = v.policy_id);

  IF clash IS NOT NULL THEN
    RAISE EXCEPTION
      'Ambiguidade de seleção: esta versão casaria junto com % na mesma precedência (%). Declare precedência ou restrinja a aplicabilidade.',
      clash, v.precedence USING ERRCODE = 'check_violation';
  END IF;

  IF p_supersede_previous THEN
    UPDATE public.approval_policy_versions
       SET status = 'SUPERSEDED', superseded_by_version_id = v.id
     WHERE organization_id = v.organization_id AND policy_id = v.policy_id
       AND id <> v.id AND status = 'ACTIVE';
  END IF;

  UPDATE public.approval_policy_versions
     SET status = 'ACTIVE', validated_at = now(), activated_at = now(), activated_by = actor
   WHERE id = v.id;

  RETURN v.id;
END $$;

CREATE OR REPLACE FUNCTION public.approval_request_cancel(p_request_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE req public.approval_requests%ROWTYPE; actor uuid := auth.uid();
BEGIN
  IF COALESCE(btrim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'Cancelar um pedido exige motivo.' USING ERRCODE = 'check_violation';
  END IF;

  -- 239: inquilino conferido ANTES da trava, e pela reivindicação JWT. Com a
  -- guarda antiga (`current_user`, que aqui é a dona da função) qualquer
  -- sessão autenticada cancelava pedido PENDENTE de qualquer inquilino.
  SELECT * INTO req FROM public.approval_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido inexistente.' USING ERRCODE = 'no_data_found'; END IF;

  IF public.apex_caller_is_browser() THEN
    IF public.current_user_organization_id() IS DISTINCT FROM req.organization_id THEN
      RAISE EXCEPTION 'Pedido inexistente.' USING ERRCODE = 'no_data_found';
    END IF;
    -- Quem pediu pode desistir; quem administra o motor pode encerrar. Ninguém
    -- mais — cancelar é retirar da governança uma decisão que estava em curso.
    IF NOT (req.requested_by = actor
            OR public.current_user_has_permission('approvals.admin')
            OR public.current_user_is_admin()) THEN
      RAISE EXCEPTION 'Cancelamento negado.' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO req FROM public.approval_requests WHERE id = p_request_id FOR UPDATE;

  -- Depois de finalizado não se cancela (§25): o desfecho já é história.
  IF req.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Pedido já está em % e não pode ser cancelado.', req.status
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.approval_request_steps SET status = 'CANCELLED'
   WHERE request_id = req.id AND status IN ('WAITING','OPEN');
  UPDATE public.approval_request_stages SET status = 'CANCELLED', closed_at = now()
   WHERE request_id = req.id AND status IN ('WAITING','OPEN');
  -- Nada é APAGADO. As decisões já tomadas continuam onde estavam.
  UPDATE public.approval_requests
     SET status = 'CANCELLED', finalized_at = now(), finalized_by = actor,
         current_stage_no = NULL, outcome_reason = btrim(p_reason)
   WHERE id = req.id;

  PERFORM public.emit_domain_event(
    req.organization_id, 'approval.request.cancelled', 1, 'approval_request', req.id,
    format('approval-request:%s:cancelled', req.id),
    jsonb_build_object('reason', btrim(p_reason)),
    now(), 'human', actor, req.correlation_id, NULL);

  RETURN jsonb_build_object('status','CANCELLED','request_id',req.id);
END $$;

CREATE OR REPLACE FUNCTION public.approval_decide(
  p_request_step_id     uuid,
  p_decision            text,
  p_idempotency_key     text,
  p_reason              text DEFAULT NULL,
  p_delegation_id       uuid DEFAULT NULL,
  p_expected_fingerprint text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  st        public.approval_request_steps%ROWTYPE;
  stg       public.approval_request_stages%ROWTYPE;
  req       public.approval_requests%ROWTYPE;
  elig      record;
  subj      record;
  prior     public.approval_decisions%ROWTYPE;
  actor     uuid := auth.uid();
  dec_id    uuid;
  ev_id     uuid;
  approved_n integer;
  open_n     integer;
  next_stage public.approval_request_stages%ROWTYPE;
  final_status text;
BEGIN
  IF p_decision NOT IN ('APPROVED','REJECTED','RETURNED_FOR_CORRECTION') THEN
    RAISE EXCEPTION 'Decisão inválida: %.', p_decision USING ERRCODE = 'check_violation';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Decisão exige chave de idempotência.' USING ERRCODE = 'check_violation';
  END IF;
  /*
    O ATOR não é parâmetro. Vem de auth.uid(), aqui. Um `p_approved_by` na
    assinatura seria o bastante para que o navegador aprovasse em nome de
    terceiro, e nenhuma verificação posterior consertaria isso (§36).
  */
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Decisão exige identidade autenticada. Sistema e IA não decidem.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO st FROM public.approval_request_steps WHERE id = p_request_step_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Etapa inexistente.' USING ERRCODE = 'no_data_found';
  END IF;

  -- Inquilino do chamador confrontado com o do PEDIDO, não com o informado.
  -- 239: pela reivindicação JWT — `current_user` aqui é a dona da função, e a
  -- guarda antiga deixava a trava e as respostas de estado alcançarem pedido
  -- de outro inquilino antes da recusa de elegibilidade.
  IF public.apex_caller_is_browser()
     AND public.current_user_organization_id() IS DISTINCT FROM st.organization_id THEN
    RAISE EXCEPTION 'Etapa inexistente.' USING ERRCODE = 'no_data_found';
  END IF;

  /*
    O TRAVÃO. Toda decisão sobre um mesmo pedido passa por esta linha, em fila.

    É isto — e não o estado do botão, nem uma verificação lida antes de
    escrever — que impede duas aprovações simultâneas de fecharem o quórum
    duas vezes, ou uma aprovação e uma rejeição concorrentes de finalizarem o
    pedido em dois desfechos. Decisões em etapas DIFERENTES continuam ambas
    válidas: elas serializam, não se anulam.
  */
  SELECT * INTO req FROM public.approval_requests WHERE id = st.request_id FOR UPDATE;

  -- ---------- idempotência, DEPOIS do travão ----------
  -- Antes do travão, duas retentativas simultâneas passariam as duas pela
  -- verificação e só a segunda quebraria na restrição única — com erro de
  -- banco em vez de resposta idempotente.
  SELECT * INTO prior FROM public.approval_decisions
   WHERE organization_id = st.organization_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF prior.request_step_id = p_request_step_id
       AND prior.decision = p_decision
       AND prior.reason IS NOT DISTINCT FROM p_reason THEN
      SELECT * INTO req FROM public.approval_requests WHERE id = prior.request_id;
      RETURN jsonb_build_object('status','IDEMPOTENT_REPLAY','decision_id',prior.id,
        'request_id',prior.request_id,'request_status',req.status,'decision',prior.decision);
    END IF;
    -- Mesma chave, significado diferente. Aceitar seria fazer a segunda
    -- decisão desaparecer em silêncio (§23).
    RAISE EXCEPTION
      'Chave de idempotência % já foi usada com outra decisão neste inquilino.', p_idempotency_key
      USING ERRCODE = 'unique_violation';
  END IF;

  -- ---------- o pedido ainda aceita decisão? ----------
  IF req.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Pedido já está em %; não aceita nova decisão.', req.status
      USING ERRCODE = 'check_violation';
  END IF;

  /*
    EXPIRAÇÃO conferida AQUI, não só pelo agendador.

    Se a validade dependesse do trabalhador ter rodado, um atraso de dez
    minutos na fila viraria dez minutos de autoridade extra. A §25 é explícita:
    o atraso do agendador não pode alterar a semântica efetiva do prazo. O
    trabalhador só materializa o que este teste já considera verdade.
  */
  IF req.expires_at IS NOT NULL AND req.expires_at <= now() THEN
    -- Só a recusa. Gravar aqui a mudança para EXPIRED seria inútil: o RAISE
    -- logo abaixo desfaz a transação inteira, e a escrita iria junto. Quem
    -- materializa a projeção é `approval_requests_expire_due`; quem garante a
    -- SEMÂNTICA é esta recusa, que não espera pelo agendador.
    RAISE EXCEPTION 'Pedido expirado em %; não aceita decisão.', req.expires_at
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO st  FROM public.approval_request_steps  WHERE id = p_request_step_id FOR UPDATE;
  SELECT * INTO stg FROM public.approval_request_stages WHERE id = st.request_stage_id FOR UPDATE;

  IF st.status = 'WAITING' THEN
    RAISE EXCEPTION
      'Ordem de aprovação: a etapa "%" está no estágio % e o pedido está no estágio %.',
      st.step_key, st.stage_no, req.current_stage_no USING ERRCODE = 'check_violation';
  END IF;
  IF st.status <> 'OPEN' THEN
    RAISE EXCEPTION 'A etapa "%" já está em % e não decide de novo.', st.step_key, st.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF st.expires_at IS NOT NULL AND st.expires_at <= now() THEN
    RAISE EXCEPTION 'A etapa "%" expirou em %.', st.step_key, st.expires_at
      USING ERRCODE = 'check_violation';
  END IF;

  /*
    IMPRESSÃO DIGITAL — §26.

    Recalculada agora, do objeto vivo, e comparada com a que o pedido
    congelou. Sem isto, alterar o valor do contrato depois de aberto o pedido
    faria a aprovação de ontem autorizar o conteúdo de hoje — que é a
    substituição silenciosa de objeto que a fase inteira existe para impedir.
  */
  SELECT * INTO subj FROM public.approval_subject_resolve(
    req.organization_id, req.subject_type, req.subject_id);

  IF NOT subj.found THEN
    RAISE EXCEPTION 'O objeto do pedido não existe mais; a decisão fica sem sujeito.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF subj.fingerprint IS DISTINCT FROM req.subject_fingerprint THEN
    RAISE EXCEPTION
      'SUBJECT_CHANGED: o objeto mudou depois que este pedido foi aberto. Abra um pedido novo para o conteúdo atual.'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Trava opcional do chamador: o cliente afirma o que ACHA que está decidindo.
  IF p_expected_fingerprint IS NOT NULL AND p_expected_fingerprint <> req.subject_fingerprint THEN
    RAISE EXCEPTION 'SUBJECT_CHANGED: a tela decidia outro conteúdo.' USING ERRCODE = 'check_violation';
  END IF;

  -- ---------- elegibilidade, SoD, alçada, delegação ----------
  -- Reavaliadas AGORA (§19), não na abertura do pedido: papel revogado,
  -- delegação expirada e limite alterado valem no instante da decisão.
  SELECT * INTO elig FROM public.approval_step_eligibility(p_request_step_id, actor, p_delegation_id);
  IF NOT elig.eligible THEN
    RAISE EXCEPTION '%: %', elig.code, COALESCE(elig.detail, 'Ator não elegível para esta etapa.')
      USING ERRCODE = '42501';
  END IF;

  -- ---------- justificativa ----------
  IF st.reason_requirement = 'REQUIRED_ALWAYS' AND COALESCE(btrim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'A etapa "%" exige justificativa.', st.step_key USING ERRCODE = 'check_violation';
  END IF;
  IF st.reason_requirement = 'REQUIRED_ON_NEGATIVE'
     AND p_decision <> 'APPROVED' AND COALESCE(btrim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'Rejeitar ou devolver a etapa "%" exige justificativa.', st.step_key
      USING ERRCODE = 'check_violation';
  END IF;

  -- ---------- a decisão, imutável ----------
  INSERT INTO public.approval_decisions (
    organization_id, request_id, request_step_id, step_key, stage_no,
    decision, decision_purpose, reason, actor_user_id, on_behalf_of_user_id,
    delegation_id, actor_source, authority_source, authority_basis,
    authority_limit_amount, authority_currency, subject_amount, subject_currency,
    subject_fingerprint, idempotency_key)
  VALUES (
    st.organization_id, st.request_id, st.id, st.step_key, st.stage_no,
    p_decision, st.decision_purpose, NULLIF(btrim(COALESCE(p_reason,'')),''), actor, elig.on_behalf_of,
    p_delegation_id, 'human', elig.authority_source, elig.authority_basis,
    elig.authority_limit, elig.authority_currency, req.subject_amount, req.subject_currency,
    req.subject_fingerprint, p_idempotency_key)
  RETURNING id INTO dec_id;

  -- ---------- projeção da etapa ----------
  UPDATE public.approval_request_steps
     SET status = CASE p_decision WHEN 'APPROVED' THEN 'APPROVED'
                                  WHEN 'REJECTED' THEN 'REJECTED' ELSE 'RETURNED' END,
         decided_at = now(), decided_by = actor
   WHERE id = st.id;

  ev_id := public.emit_domain_event(
    req.organization_id, 'approval.decision.recorded', 1, 'approval_request', req.id,
    'approval-decision:' || dec_id::text,
    jsonb_build_object('decision_id',dec_id,'step_key',st.step_key,'stage_no',st.stage_no,
      'decision',p_decision,'decision_purpose',st.decision_purpose,
      'authority_source',elig.authority_source,'delegated',(p_delegation_id IS NOT NULL)),
    now(), 'human', actor, req.correlation_id, NULL);

  -- ---------- progressão ----------
  IF p_decision = 'APPROVED' THEN
    SELECT count(*) FILTER (WHERE status = 'APPROVED'),
           count(*) FILTER (WHERE status IN ('WAITING','OPEN'))
      INTO approved_n, open_n
      FROM public.approval_request_steps WHERE request_stage_id = stg.id;

    IF approved_n >= stg.quorum_required THEN
      -- Quórum atingido. As etapas restantes do estágio ficam SKIPPED — e
      -- isso é diferente de "pulada por falta de aprovador", que a §15 proíbe:
      -- aqui a regra do estágio JÁ foi satisfeita pelo número declarado.
      UPDATE public.approval_request_steps SET status = 'SKIPPED'
       WHERE request_stage_id = stg.id AND status IN ('WAITING','OPEN');
      UPDATE public.approval_request_stages SET status = 'APPROVED', closed_at = now()
       WHERE id = stg.id;

      SELECT * INTO next_stage FROM public.approval_request_stages
       WHERE request_id = req.id AND stage_no > stg.stage_no AND status = 'WAITING'
       ORDER BY stage_no LIMIT 1;

      IF FOUND THEN
        UPDATE public.approval_request_stages SET status = 'OPEN', opened_at = now()
         WHERE id = next_stage.id;
        UPDATE public.approval_request_steps
           SET status = 'OPEN', opened_at = now(),
               expires_at = CASE WHEN step_expires_after IS NOT NULL THEN now() + step_expires_after END
         WHERE request_stage_id = next_stage.id AND status = 'WAITING';
        UPDATE public.approval_requests SET current_stage_no = next_stage.stage_no WHERE id = req.id;

        PERFORM public.emit_domain_event(
          req.organization_id, 'approval.stage.opened', 1, 'approval_request', req.id,
          format('approval-request:%s:stage:%s', req.id, next_stage.stage_no),
          jsonb_build_object('stage_no',next_stage.stage_no,'request_stage_id',next_stage.id),
          now(), 'system', NULL, req.correlation_id, ev_id);
      ELSE
        final_status := 'APPROVED';
      END IF;
    END IF;

  ELSIF p_decision = 'REJECTED' THEN
    final_status := 'REJECTED';
  ELSE
    final_status := 'RETURNED_FOR_CORRECTION';
  END IF;

  -- ---------- finalização ----------
  IF final_status IS NOT NULL THEN
    UPDATE public.approval_request_steps SET status = 'CANCELLED'
     WHERE request_id = req.id AND status IN ('WAITING','OPEN');
    UPDATE public.approval_request_stages
       SET status = CASE WHEN final_status = 'APPROVED' THEN 'APPROVED'
                         WHEN final_status = 'REJECTED' THEN 'REJECTED' ELSE 'RETURNED' END,
           closed_at = now()
     WHERE id = stg.id;
    UPDATE public.approval_request_stages SET status = 'CANCELLED', closed_at = now()
     WHERE request_id = req.id AND status IN ('WAITING','OPEN');
    UPDATE public.approval_requests
       SET status = final_status, finalized_at = now(), finalized_by = actor,
           current_stage_no = NULL, outcome_reason = NULLIF(btrim(COALESCE(p_reason,'')),'')
     WHERE id = req.id;

    /*
      O desfecho é um FATO, e para aqui.

      APPROVED significa que a decisão foi tomada — não que a execução a
      jusante deu certo (§30). Quem reage a este evento reage por trabalho
      durável, e um fracasso lá NÃO devolve este pedido para PENDING.
    */
    PERFORM public.emit_domain_event(
      req.organization_id,
      CASE final_status
        WHEN 'APPROVED' THEN 'approval.request.approved'
        WHEN 'REJECTED' THEN 'approval.request.rejected'
        ELSE 'approval.request.returned_for_correction' END,
      1, 'approval_request', req.id,
      format('approval-request:%s:%s', req.id, lower(final_status)),
      jsonb_build_object('subject_type',req.subject_type,'subject_id',req.subject_id,
        'action_type',req.action_type,'decision_purpose',req.decision_purpose,
        'policy_key',req.policy_key,'policy_version_no',req.policy_version_no,
        'subject_fingerprint',req.subject_fingerprint,
        'downstream_execution','not_started'),
      now(), 'human', actor, req.correlation_id, ev_id);
  END IF;

  SELECT * INTO req FROM public.approval_requests WHERE id = req.id;

  RETURN jsonb_build_object(
    'status','RECORDED','decision_id',dec_id,'decision',p_decision,
    'request_id',req.id,'request_status',req.status,'current_stage_no',req.current_stage_no,
    'authority_source',elig.authority_source,'authority_basis',elig.authority_basis,
    'delegated',(p_delegation_id IS NOT NULL),'event_id',ev_id);
END $$;

COMMIT;
