-- ============================================================================
-- 240 — DECISÕES: A CAIXA DE DECISÕES HUMANAS DA PLATAFORMA
--
-- "O que precisa de mim agora?"
--
-- ─── O que esta migration NÃO cria ────────────────────────────────────────
--
-- Nenhuma tabela de "decisão". Nenhum estado de decisão guardado. Nenhum motor
-- de aprovação paralelo. A decisão continua morando onde sempre morou:
--
--   Motor de Aprovação (125–129)   approval_requests / _steps / _decisions
--   Alçada de compra declarada     purchase_orders + procurement_approval_
--   (234/237)                      authorities + purchase_order_history
--
-- Decisões é uma PROJEÇÃO calculada na hora, por funções que COMPÕEM os
-- predicados canônicos — nunca os reescrevem:
--
--   elegibilidade no motor    approval_step_eligibility (127)
--   alçada de compra          apex_actor_has_permission + procurement_
--                             authority_for_order (237) + SoD de criador/
--                             submissor (a mesma regra de purchase_order_decide)
--
-- O ato executado a partir de Decisões é o MESMO ato canônico:
--
--   motor       approval_decide (ator = auth.uid(), pela sessão do usuário)
--   alçada      purchase_order_decide, por um invólucro que só acrescenta a
--               pré-condição de tela velha (submissão + impressão digital) e a
--               resposta idempotente — e então chama a função canônica.
--
-- ─── O que ela cria, e por quê ────────────────────────────────────────────
--
--   decision_deliveries                   livro de ENTREGA de avisos (in-app,
--                                         e-mail, WhatsApp): estado, tentativas,
--                                         id do provedor, falha. `notifications`
--                                         não serve: o destinatário edita e
--                                         apaga a própria linha, e ela não tem
--                                         chave de deduplicação.
--   notification_channel_integrations     estado EXPLÍCITO do canal por
--                                         organização. WhatsApp só sai com linha
--                                         ENABLED — variável de ambiente não liga
--                                         canal externo.
--   user_notification_preferences         opção da pessoa por canal (e o número
--                                         de WhatsApp com opt-in).
--
-- A fila é a que já existe: domain_events → apex_event_routes → apex_jobs.
-- As rotas nascem desligadas e são ligadas pelo trabalhador capaz (237).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Permissões
-- ---------------------------------------------------------------------------
INSERT INTO public.permissions (key, module, action, description) VALUES
  ('decisions.team.view', 'decisions', 'team.view',
   'Ver as decisões pendentes da organização: quem as tem, há quanto tempo e onde param'),
  ('notifications.channels.manage', 'notifications', 'channels.manage',
   'Configurar os canais de notificação da organização (e-mail e WhatsApp)')
ON CONFLICT (key) DO NOTHING;

/*
  Critério da 211 — a alçada que o papel já exerce. Ver a fila da organização
  inteira é o que a diretoria já faz com approvals.view; configurar canal
  externo é administração do inquilino. Nenhuma alçada de DECISÃO nasce aqui.
*/
WITH grants(role_key, perm_key) AS (VALUES
  ('owner_admin', 'decisions.team.view'),
  ('owner_admin', 'notifications.channels.manage'),
  ('ceo_diretoria', 'decisions.team.view'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM grants g
  JOIN public.roles r ON r.organization_id IS NULL AND r.key = g.role_key
  JOIN public.permissions p ON p.key = g.perm_key
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) O formato normalizado de um item de decisão
-- ---------------------------------------------------------------------------
/*
  `decision_key` é a identidade estável do item, e diz de onde ele vem:

    approval_request:<pedido>:e<estágio>   um estágio ABERTO do motor
    purchase_order:<pedido>:s<submissão>   uma submissão do pedido de compra
                                           governada por alçada declarada

  A submissão faz parte da chave de propósito: rejeitar devolve o pedido ao
  rascunho, e a submissão seguinte é OUTRA decisão — a tela velha da anterior
  não aprova o conteúdo novo.
*/
CREATE TYPE public.decision_item AS (
  decision_key     text,
  source_kind      text,          -- APPROVAL_ENGINE | PROCUREMENT_AUTHORITY
  category         text,          -- compras | financeiro | …
  subject_type     text,
  subject_id       uuid,
  action_type      text,
  request_id       uuid,
  step_id          uuid,
  stage_no         integer,
  submission       integer,
  title            text,
  amount           numeric,
  currency         text,
  project_id       text,
  requested_by     uuid,
  requested_at     timestamptz,
  due_at           timestamptz,   -- prazo do MOTOR (expiração da etapa/pedido)
  need_by          date,          -- necessidade operacional (requisito/atividade)
  decide_by        date,          -- último dia para decidir e ainda chegar a tempo
  overdue          boolean,
  assignment       text,          -- PRIMARY | ESCALATED | ELIGIBLE
  state            text,          -- PENDENTE | EM_ANALISE | ESCALADA
  actions          text[],        -- APPROVE | REJECT | REQUEST_ADJUSTMENT
  reason_required  text[],
  fingerprint      text,
  authority        jsonb
);

CREATE TYPE public.decision_team_item AS (
  decision_key     text,
  source_kind      text,
  category         text,
  subject_type     text,
  subject_id       uuid,
  title            text,
  amount           numeric,
  currency         text,
  amount_restricted boolean,
  project_id       text,
  requested_by     uuid,
  requested_at     timestamptz,
  due_at           timestamptz,
  need_by          date,
  decide_by        date,
  overdue          boolean,
  state            text,
  assignees        jsonb          -- [{user_id, assignment}]
);

CREATE TYPE public.decision_history_item AS (
  decision_key     text,
  source_kind      text,
  category         text,
  subject_type     text,
  subject_id       uuid,
  title            text,
  amount           numeric,
  currency         text,
  project_id       text,
  viewer_role      text,          -- DECIDER | REQUESTER
  outcome          text,          -- APPROVED | REJECTED | ADJUSTMENT_REQUESTED | CANCELLED | EXPIRED
  decided_by       uuid,
  decided_at       timestamptz,
  requested_by     uuid,
  requested_at     timestamptz,
  reason           text,
  authority        jsonb,
  record_id        uuid           -- approval_decisions.id | purchase_order_history.id | approval_requests.id
);

-- ---------------------------------------------------------------------------
-- 3) Auxiliares — ordem do histórico, datas, submissão, prazo operacional
-- ---------------------------------------------------------------------------
/*
  ORDEM do histórico do pedido de compra. `occurred_at` é `now()` — o mesmo
  instante para tudo que acontece numa transação — e não ordena submissão e
  decisão com certeza. Uma sequência monotônica, ADITIVA (o livro continua
  append-only: os gatilhos de reescrita e apagamento não mudam), dá a ordem
  exata. Para o mesmo pedido, os atos serializam pela trava da linha do
  pedido, então a ordem da sequência é a ordem lógica.
*/
ALTER TABLE public.purchase_order_history ADD COLUMN IF NOT EXISTS seq bigint GENERATED BY DEFAULT AS IDENTITY;
CREATE INDEX IF NOT EXISTS poh_order_seq ON public.purchase_order_history (organization_id, purchase_order_id, seq);
CREATE FUNCTION public.decision_today(p_org uuid) RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (now() AT TIME ZONE COALESCE(
           (SELECT o.timezone FROM public.organizations o
             WHERE o.id = p_org
               AND EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = o.timezone)),
           'America/Sao_Paulo'))::date
$$;

-- Quantas vezes o pedido foi submetido. A n-ésima submissão é a decisão n.
CREATE FUNCTION public.decision_po_submission(p_org uuid, p_po uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*)::int FROM public.purchase_order_history h
   WHERE h.organization_id = p_org AND h.purchase_order_id = p_po AND h.transition = 'submitted'
$$;

/*
  Prazo operacional de uma decisão de compra — derivado, com a origem de cada
  número:

    need_by    a necessidade mais cedo dos requisitos que o pedido atende; por
               requisito vale o que vier antes entre a data do requisito e o
               início da atividade (a MESMA regra da inteligência de Supply, 236).
    lead_days  o prazo da proposta escolhida (o maior entre cabeçalho e linhas);
               sem proposta, o prazo padrão do fornecedor. Sem nenhum, NULL.
    decide_by  need_by − lead_days: o último dia em que aprovar ainda chega a
               tempo. Sem prazo conhecido, a própria necessidade.

  Sem necessidade vinculada, nada: prazo NÃO é inventado.
*/
CREATE FUNCTION public.decision_po_timing(p_org uuid, p_po uuid)
RETURNS TABLE (need_by date, lead_days integer, decide_by date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH need AS (
    SELECT min(LEAST(r.required_by, t.planned_start)) AS need_by
      FROM public.purchase_order_lines l
      JOIN public.purchase_order_line_requirements a
        ON a.organization_id = l.organization_id AND a.line_id = l.id
      JOIN public.project_requirements r
        ON r.organization_id = a.organization_id AND r.id = a.requirement_id
      LEFT JOIN public.project_timeline_items t
        ON t.organization_id = r.organization_id AND t.id = r.activity_id AND t.deleted_at IS NULL
     WHERE l.organization_id = p_org AND l.purchase_order_id = p_po
       AND r.status NOT IN ('CANCELLED', 'SUPERSEDED')),
  lead AS (
    SELECT CASE WHEN q.id IS NOT NULL AND (q.lead_time_days IS NOT NULL OR ql.max_lead IS NOT NULL)
                  THEN GREATEST(COALESCE(q.lead_time_days, 0), COALESCE(ql.max_lead, 0))
                ELSE sp.default_lead_time_days END AS lead_days
      FROM public.purchase_orders po
      LEFT JOIN public.sourcing_decisions sd
        ON sd.organization_id = po.organization_id AND sd.id = po.sourcing_decision_id
      LEFT JOIN public.supplier_quotes q
        ON q.organization_id = sd.organization_id AND q.id = sd.quote_id
      LEFT JOIN LATERAL (
        SELECT max(x.lead_time_days) AS max_lead FROM public.supplier_quote_lines x
         WHERE x.organization_id = q.organization_id AND x.quote_id = q.id) ql ON true
      LEFT JOIN public.supplier_profiles sp
        ON sp.organization_id = po.organization_id AND sp.id = po.supplier_id
     WHERE po.organization_id = p_org AND po.id = p_po)
  SELECT need.need_by, lead.lead_days,
         CASE WHEN need.need_by IS NULL THEN NULL ELSE need.need_by - COALESCE(lead.lead_days, 0) END
    FROM need, lead
$$;

-- ---------------------------------------------------------------------------
-- 4) Quem decide um pedido de compra por ALÇADA DECLARADA
-- ---------------------------------------------------------------------------
/*
  Composição dos predicados canônicos, sem reescrevê-los:

    1. candidatos: quem recebe procurement.approve por papel ou concessão
       explícita (superconjunto barato);
    2. apex_actor_has_permission — membro ATIVO, negação vence (237);
    3. SoD de purchase_order_decide: quem criou ou submeteu não decide;
    4. procurement_authority_for_order — moeda, teto, projeto, categoria de
       CADA linha, vigência (237). É a MESMA função que o ato usa.

  FAIXA (`tier`) é roteamento, não alçada: entre os elegíveis, a faixa
  PRIMÁRIA é a do MENOR teto declarado que cobre o pedido — a decisão chega à
  alçada mais próxima do valor, como numa matriz de delegação. Quem tem teto
  maior continua podendo decidir (ELIGIBLE) e recebe a decisão se ela vencer
  (ver decision_inbox). Nenhum limite é inventado: todos vêm do registro
  declarado com evidência.
*/
CREATE FUNCTION public.decision_po_approvers(p_org uuid, p_po uuid)
RETURNS TABLE (user_id uuid, authority_id uuid, ceiling numeric, tier text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH po AS (
    SELECT p.created_by, p.submitted_by FROM public.purchase_orders p
     WHERE p.organization_id = p_org AND p.id = p_po
       AND p.status = 'APPROVAL_REQUIRED' AND p.approval_governance = 'AUTHORITY'),
  cand AS (
    SELECT ur.user_id FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      JOIN public.permissions pm ON pm.id = rp.permission_id AND pm.key = 'procurement.approve'
     WHERE ur.organization_id = p_org
    UNION
    SELECT upo.user_id FROM public.user_permission_overrides upo
      JOIN public.permissions pm ON pm.id = upo.permission_id AND pm.key = 'procurement.approve'
     WHERE upo.organization_id = p_org AND upo.effect = 'grant'),
  eligible AS (
    SELECT c.user_id, public.procurement_authority_for_order(p_org, c.user_id, p_po) AS authority_id
      FROM cand c, po
     WHERE c.user_id IS DISTINCT FROM po.created_by
       AND c.user_id IS DISTINCT FROM po.submitted_by
       AND public.apex_actor_has_permission(p_org, c.user_id, 'procurement.approve')),
  withauth AS (
    SELECT e.user_id, e.authority_id, a.max_amount AS ceiling
      FROM eligible e
      JOIN public.procurement_approval_authorities a ON a.organization_id = p_org AND a.id = e.authority_id),
  lowest AS (SELECT min(COALESCE(w.ceiling, 'Infinity'::numeric)) AS c FROM withauth w)
  SELECT w.user_id, w.authority_id, w.ceiling,
         CASE WHEN COALESCE(w.ceiling, 'Infinity'::numeric) = lowest.c THEN 'PRIMARY' ELSE 'ELIGIBLE' END
    FROM withauth w, lowest
$$;

-- ---------------------------------------------------------------------------
-- 5) Motor: o sujeito ainda está vivo, e o que o domínio suporta
-- ---------------------------------------------------------------------------
/*
  Todo item do motor é ANCORADO no objeto de domínio que o originou. Um pedido
  PENDENTE que o domínio não aponta mais (órfão) não é decisão de ninguém: o
  desfecho dele não mudaria nada. Tipo de sujeito sem âncora aqui não aparece
  em Decisões — não há como apresentá-lo nem agir sobre ele.
*/
CREATE FUNCTION public.decision_engine_subject_live(
  p_org uuid, p_subject_type text, p_subject_id uuid, p_request_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE p_subject_type
    WHEN 'purchase_order' THEN EXISTS (
      SELECT 1 FROM public.purchase_orders p
       WHERE p.organization_id = p_org AND p.id = p_subject_id
         AND p.approval_request_id = p_request_id
         AND p.status = 'APPROVAL_REQUIRED' AND p.approval_governance = 'POLICY')
    WHEN 'contract_billing_event' THEN EXISTS (
      SELECT 1 FROM public.contract_billing_events b
       WHERE b.organization_id = p_org AND b.id = p_subject_id
         AND b.release_approval_request_id = p_request_id
         AND b.release_state = 'PENDING_RELEASE')
    ELSE false END
$$;

/*
  Os atos que o DOMÍNIO sabe receber, por tipo de sujeito:

    purchase_order          o desfecho volta por purchase_order_apply_approval,
                            que trata aprovado, rejeitado e devolvido (237).
    contract_billing_event  contract_billing_apply_approval trata aprovado e
                            rejeitado; devolvido deixaria o evento PRESO em
                            PENDING_RELEASE (não há rota nem tratamento) — por
                            isso "Solicitar ajuste" não é oferecido.
*/
CREATE FUNCTION public.decision_engine_actions(p_subject_type text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE p_subject_type
    WHEN 'purchase_order' THEN ARRAY['APPROVE', 'REJECT', 'REQUEST_ADJUSTMENT']
    WHEN 'contract_billing_event' THEN ARRAY['APPROVE', 'REJECT']
    ELSE ARRAY[]::text[] END
$$;

CREATE FUNCTION public.decision_category(p_subject_type text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE p_subject_type
    WHEN 'purchase_order' THEN 'compras'
    WHEN 'contract_billing_event' THEN 'financeiro'
    ELSE 'outros' END
$$;

CREATE FUNCTION public.decision_reason_required(p_actions text[], p_requirement text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE p_requirement
    WHEN 'REQUIRED_ALWAYS' THEN p_actions
    WHEN 'REQUIRED_ON_NEGATIVE' THEN array_remove(p_actions, 'APPROVE')
    ELSE ARRAY[]::text[] END
$$;

/*
  Quem decide um estágio ABERTO do motor: candidatos por modo (superconjunto)
  e a resposta de approval_step_eligibility para cada um — a mesma função que
  approval_decide chama. Delegação não entra (v1): o motor nunca a aplica
  sozinho, e não existe tela para criá-la.
*/
CREATE FUNCTION public.decision_engine_stage_assignees(p_org uuid, p_request uuid, p_stage integer)
RETURNS TABLE (user_id uuid, step_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT ON (c.user_id) c.user_id, s.id
    FROM public.approval_request_steps s
    JOIN public.approval_requests r ON r.organization_id = s.organization_id AND r.id = s.request_id
    CROSS JOIN LATERAL (
      SELECT s.named_user_id AS user_id WHERE s.eligibility_mode = 'NAMED'
      UNION
      SELECT ur.user_id FROM public.user_roles ur JOIN public.roles ro ON ro.id = ur.role_id
       WHERE s.eligibility_mode = 'ROLE' AND ur.organization_id = p_org AND ro.key = s.role_key
      UNION
      SELECT ur.user_id FROM public.user_roles ur
        JOIN public.role_permissions rp ON rp.role_id = ur.role_id
        JOIN public.permissions pm ON pm.id = rp.permission_id
       WHERE s.eligibility_mode = 'PERMISSION' AND ur.organization_id = p_org AND pm.key = s.permission_key
      UNION
      SELECT upo.user_id FROM public.user_permission_overrides upo
        JOIN public.permissions pm ON pm.id = upo.permission_id
       WHERE s.eligibility_mode = 'PERMISSION' AND upo.organization_id = p_org
         AND upo.effect = 'grant' AND pm.key = s.permission_key
    ) c
   WHERE s.organization_id = p_org AND s.request_id = p_request AND s.stage_no = p_stage
     AND s.status = 'OPEN' AND r.status = 'PENDING'
     AND (r.expires_at IS NULL OR r.expires_at > now())
     AND (s.expires_at IS NULL OR s.expires_at > now())
     AND c.user_id IS NOT NULL
     AND (SELECT e.eligible FROM public.approval_step_eligibility(s.id, c.user_id, NULL) e)
   ORDER BY c.user_id, s.step_key
$$;

-- ---------------------------------------------------------------------------
-- 6) A caixa de UMA pessoa
-- ---------------------------------------------------------------------------
/*
  Atribuição:
    PRIMARY    a decisão é desta pessoa (etapa do motor em que é elegível, ou a
               faixa primária da alçada de compra).
    ESCALATED  pedido de compra VENCIDO (passou do decide_by) chega também à
               faixa superior de alçada — escalonamento pelo prazo operacional,
               nunca por relógio inventado.
    ELIGIBLE   pode decidir (tem alçada), mas a decisão é de outra faixa.

  O contador da barra lateral conta PRIMARY + ESCALATED.
*/
CREATE FUNCTION public.decision_inbox(p_org uuid, p_user uuid)
RETURNS SETOF public.decision_item
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH today AS (SELECT public.decision_today(p_org) AS d),
  engine AS (
    SELECT DISTINCT ON (r.id, s.stage_no)
           r.id AS request_id, s.id AS step_id, s.stage_no, r.subject_type, r.subject_id, r.action_type,
           r.subject_label, r.subject_amount, r.subject_currency, r.subject_fingerprint,
           r.requested_by, r.requested_at, LEAST(r.expires_at, s.expires_at) AS due_at,
           r.policy_key, r.policy_version_no, stg.name AS stage_name, stg.quorum_required,
           s.step_key, s.name AS step_name, s.eligibility_mode, s.role_key, s.permission_key,
           s.reason_requirement, el.authority_source, el.authority_basis, el.authority_limit, el.authority_currency
      FROM public.approval_request_steps s
      JOIN public.approval_requests r ON r.organization_id = s.organization_id AND r.id = s.request_id
      JOIN public.approval_request_stages stg ON stg.organization_id = s.organization_id AND stg.id = s.request_stage_id
      CROSS JOIN LATERAL public.approval_step_eligibility(s.id, p_user, NULL) el
     WHERE p_user IS NOT NULL AND s.organization_id = p_org
       AND s.status = 'OPEN' AND r.status = 'PENDING'
       AND (r.expires_at IS NULL OR r.expires_at > now())
       AND (s.expires_at IS NULL OR s.expires_at > now())
       AND (   (s.eligibility_mode = 'NAMED' AND s.named_user_id = p_user)
            OR (s.eligibility_mode = 'ROLE' AND EXISTS (
                  SELECT 1 FROM public.user_roles ur JOIN public.roles ro ON ro.id = ur.role_id
                   WHERE ur.user_id = p_user AND ur.organization_id = p_org AND ro.key = s.role_key))
            OR (s.eligibility_mode = 'PERMISSION' AND (
                  EXISTS (SELECT 1 FROM public.user_roles ur
                            JOIN public.role_permissions rp ON rp.role_id = ur.role_id
                            JOIN public.permissions pm ON pm.id = rp.permission_id
                           WHERE ur.user_id = p_user AND ur.organization_id = p_org AND pm.key = s.permission_key)
               OR EXISTS (SELECT 1 FROM public.user_permission_overrides upo
                            JOIN public.permissions pm ON pm.id = upo.permission_id
                           WHERE upo.user_id = p_user AND upo.organization_id = p_org
                             AND upo.effect = 'grant' AND pm.key = s.permission_key))))
       AND public.decision_engine_subject_live(p_org, r.subject_type, r.subject_id, r.id)
       AND el.eligible
     ORDER BY r.id, s.stage_no, s.step_key),
  engine_rows AS (
    SELECT e.*,
           (SELECT count(*)::int FROM public.approval_request_stages x
             WHERE x.organization_id = p_org AND x.request_id = e.request_id) AS stage_count,
           EXISTS (SELECT 1 FROM public.approval_decisions d
                    WHERE d.organization_id = p_org AND d.request_id = e.request_id) AS has_decisions,
           CASE WHEN e.subject_type = 'purchase_order'
                THEN (SELECT p.project_id FROM public.purchase_orders p
                       WHERE p.organization_id = p_org AND p.id = e.subject_id) END AS project_id,
           t.need_by, t.decide_by
      FROM engine e
      LEFT JOIN LATERAL (
        SELECT x.need_by, x.decide_by FROM public.decision_po_timing(p_org, e.subject_id) x
         WHERE e.subject_type = 'purchase_order') t ON true),
  po AS (
    SELECT p.id, p.order_number, p.project_id, p.currency, p.submitted_by, p.submitted_at,
           a.authority_id, a.ceiling, a.tier,
           EXISTS (SELECT 1 FROM public.decision_po_approvers(p_org, p.id) o WHERE o.tier = 'ELIGIBLE') AS has_higher,
           public.decision_po_submission(p_org, p.id) AS submission,
           public.purchase_order_total(p.id) AS total,
           public.purchase_order_fingerprint(p.id) AS fp,
           t.need_by, t.lead_days, t.decide_by
      FROM public.purchase_orders p
      CROSS JOIN LATERAL public.decision_po_approvers(p_org, p.id) a
      LEFT JOIN LATERAL public.decision_po_timing(p_org, p.id) t ON true
     WHERE p_user IS NOT NULL AND p.organization_id = p_org
       AND p.status = 'APPROVAL_REQUIRED' AND p.approval_governance = 'AUTHORITY'
       AND p.created_by IS DISTINCT FROM p_user AND p.submitted_by IS DISTINCT FROM p_user
       AND a.user_id = p_user)
  SELECT
    'approval_request:' || er.request_id || ':e' || er.stage_no,
    'APPROVAL_ENGINE',
    public.decision_category(er.subject_type),
    er.subject_type, er.subject_id, er.action_type,
    er.request_id, er.step_id, er.stage_no, NULL::integer,
    er.subject_label, er.subject_amount, er.subject_currency, er.project_id,
    er.requested_by, er.requested_at, er.due_at, er.need_by, er.decide_by,
    COALESCE(er.decide_by < today.d, false),
    'PRIMARY',
    CASE WHEN er.has_decisions THEN 'EM_ANALISE' ELSE 'PENDENTE' END,
    public.decision_engine_actions(er.subject_type),
    public.decision_reason_required(public.decision_engine_actions(er.subject_type), er.reason_requirement),
    er.subject_fingerprint,
    jsonb_build_object(
      'kind', 'APPROVAL_POLICY',
      'policy_key', er.policy_key, 'policy_version_no', er.policy_version_no,
      'stage_no', er.stage_no, 'stage_name', er.stage_name, 'stage_count', er.stage_count,
      'quorum_required', er.quorum_required,
      'step_key', er.step_key, 'step_name', er.step_name,
      'eligibility_mode', er.eligibility_mode, 'role_key', er.role_key, 'permission_key', er.permission_key,
      'authority_source', er.authority_source, 'authority_basis', er.authority_basis,
      'authority_limit', er.authority_limit, 'authority_currency', er.authority_currency)
  FROM engine_rows er, today
  UNION ALL
  SELECT
    'purchase_order:' || po.id || ':s' || po.submission,
    'PROCUREMENT_AUTHORITY',
    'compras',
    'purchase_order', po.id, 'approve',
    NULL::uuid, NULL::uuid, NULL::integer, po.submission,
    'Pedido de compra ' || po.order_number, po.total, po.currency, po.project_id,
    po.submitted_by, po.submitted_at, NULL::timestamptz, po.need_by, po.decide_by,
    COALESCE(po.decide_by < today.d, false),
    CASE WHEN po.tier = 'PRIMARY' THEN 'PRIMARY'
         WHEN po.decide_by < today.d THEN 'ESCALATED'
         ELSE 'ELIGIBLE' END,
    CASE WHEN po.decide_by < today.d AND po.has_higher THEN 'ESCALADA' ELSE 'PENDENTE' END,
    ARRAY['APPROVE', 'REQUEST_ADJUSTMENT'],
    ARRAY['REQUEST_ADJUSTMENT'],
    po.fp,
    jsonb_build_object(
      'kind', 'PROCUREMENT_AUTHORITY',
      'authority_id', po.authority_id, 'ceiling', po.ceiling, 'currency', a.currency, 'tier', po.tier,
      'grantee_kind', a.grantee_kind, 'grantee_role_id', a.grantee_role_id, 'grantee_user_id', a.grantee_user_id,
      'scope_project_id', a.project_id, 'scope_category', a.category,
      'source_kind', a.source_kind, 'source_reference', a.source_reference,
      'source_document_id', a.source_document_id, 'justification', a.justification,
      'effective_from', a.effective_from, 'effective_until', a.effective_until,
      'declared_by', a.declared_by, 'lead_days', po.lead_days)
  FROM po
  JOIN public.procurement_approval_authorities a ON a.organization_id = p_org AND a.id = po.authority_id
  CROSS JOIN today
$$;

-- ---------------------------------------------------------------------------
-- 7) Resolver uma decisão pela chave — aberta ou encerrada
-- ---------------------------------------------------------------------------
/*
  O desfecho é LIDO dos livros append-only (approval_decisions, estados do
  motor, purchase_order_history). Nada aqui é gravado: a história de uma
  decisão encerrada não pode ser reescrita porque não mora aqui.
*/
CREATE FUNCTION public.decision_resolve(p_org uuid, p_key text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m text[]; v_id uuid; n integer;
  po public.purchase_orders%ROWTYPE; sub record; nxt bigint; out_row record; cur integer;
  req public.approval_requests%ROWTYPE; stg public.approval_request_stages%ROWTYPE; dec record;
  v_open boolean; v_outcome text; v_live boolean;
BEGIN
  IF p_org IS NULL OR p_key IS NULL THEN RETURN NULL; END IF;

  m := regexp_match(p_key, '^purchase_order:([0-9a-f-]{36}):s([0-9]+)$');
  IF m IS NOT NULL THEN
    v_id := m[1]::uuid; n := m[2]::int;
    SELECT * INTO po FROM public.purchase_orders WHERE organization_id = p_org AND id = v_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT h.* INTO sub FROM (
      SELECT h.*, row_number() OVER (ORDER BY h.seq) AS rn
        FROM public.purchase_order_history h
       WHERE h.organization_id = p_org AND h.purchase_order_id = v_id AND h.transition = 'submitted') h
     WHERE h.rn = n;
    IF NOT FOUND OR COALESCE(sub.detail->>'governance', '') <> 'AUTHORITY' THEN RETURN NULL; END IF;
    SELECT min(h.seq) INTO nxt FROM public.purchase_order_history h
     WHERE h.organization_id = p_org AND h.purchase_order_id = v_id AND h.transition = 'submitted'
       AND h.seq > sub.seq;
    SELECT h.* INTO out_row FROM public.purchase_order_history h
     WHERE h.organization_id = p_org AND h.purchase_order_id = v_id
       AND h.transition IN ('approved', 'rejected', 'cancelled')
       AND h.seq > sub.seq AND (nxt IS NULL OR h.seq < nxt)
     ORDER BY h.seq LIMIT 1;
    cur := public.decision_po_submission(p_org, v_id);
    v_open := out_row.id IS NULL AND cur = n AND po.status = 'APPROVAL_REQUIRED' AND po.approval_governance = 'AUTHORITY';
    v_outcome := CASE out_row.transition WHEN 'approved' THEN 'APPROVED'
                                         WHEN 'rejected' THEN 'ADJUSTMENT_REQUESTED'
                                         WHEN 'cancelled' THEN 'CANCELLED' END;
    RETURN jsonb_build_object(
      'decision_key', p_key, 'source_kind', 'PROCUREMENT_AUTHORITY', 'category', 'compras',
      'subject_type', 'purchase_order', 'subject_id', v_id, 'action_type', 'approve',
      'submission', n, 'current_submission', cur,
      'title', 'Pedido de compra ' || po.order_number, 'order_number', po.order_number,
      'amount', COALESCE((out_row.detail->>'total')::numeric, public.purchase_order_total(v_id)),
      'currency', po.currency, 'project_id', po.project_id, 'supplier_id', po.supplier_id,
      'requested_by', sub.actor_user_id, 'requested_at', sub.occurred_at, 'request_note', sub.reason,
      'created_by', po.created_by,
      'open', v_open, 'outcome', v_outcome,
      'closed_by', out_row.actor_user_id, 'closed_at', out_row.occurred_at, 'reason', out_row.reason,
      'record_id', out_row.id,
      'authority_id', COALESCE(out_row.detail->>'authority_id', CASE WHEN out_row.transition = 'approved' THEN po.approval_authority_id::text END),
      'fingerprint', CASE WHEN v_open THEN public.purchase_order_fingerprint(v_id) ELSE out_row.detail->>'fingerprint' END,
      'subject_status', po.status);
  END IF;

  m := regexp_match(p_key, '^approval_request:([0-9a-f-]{36}):e([0-9]+)$');
  IF m IS NOT NULL THEN
    v_id := m[1]::uuid; n := m[2]::int;
    SELECT * INTO req FROM public.approval_requests WHERE organization_id = p_org AND id = v_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT * INTO stg FROM public.approval_request_stages
     WHERE organization_id = p_org AND request_id = v_id AND stage_no = n;
    IF NOT FOUND THEN RETURN NULL; END IF;
    v_live := public.decision_engine_subject_live(p_org, req.subject_type, req.subject_id, req.id);
    v_open := req.status = 'PENDING' AND stg.status = 'OPEN' AND v_live
              AND (req.expires_at IS NULL OR req.expires_at > now());
    SELECT d.* INTO dec FROM public.approval_decisions d
     WHERE d.organization_id = p_org AND d.request_id = v_id AND d.stage_no = n
     ORDER BY d.decided_at DESC LIMIT 1;
    v_outcome := CASE
      WHEN v_open THEN NULL
      WHEN stg.status = 'APPROVED' THEN 'APPROVED'
      WHEN stg.status = 'REJECTED' THEN 'REJECTED'
      WHEN stg.status = 'RETURNED' THEN 'ADJUSTMENT_REQUESTED'
      WHEN stg.status = 'EXPIRED' OR req.status = 'EXPIRED' THEN 'EXPIRED'
      WHEN stg.status = 'OPEN' AND req.status = 'PENDING' AND req.expires_at IS NOT NULL AND req.expires_at <= now() THEN 'EXPIRED'
      WHEN stg.status = 'WAITING' THEN NULL
      ELSE 'CANCELLED' END;
    RETURN jsonb_build_object(
      'decision_key', p_key, 'source_kind', 'APPROVAL_ENGINE', 'category', public.decision_category(req.subject_type),
      'subject_type', req.subject_type, 'subject_id', req.subject_id, 'action_type', req.action_type,
      'request_id', req.id, 'stage_no', n, 'stage_name', stg.name, 'stage_status', stg.status,
      'request_status', req.status, 'policy_key', req.policy_key, 'policy_version_no', req.policy_version_no,
      'title', req.subject_label, 'amount', req.subject_amount, 'currency', req.subject_currency,
      'project_id', CASE WHEN req.subject_type = 'purchase_order' THEN
                      (SELECT p.project_id FROM public.purchase_orders p WHERE p.organization_id = p_org AND p.id = req.subject_id) END,
      'requested_by', req.requested_by, 'requested_at', req.requested_at, 'request_note', req.request_reason,
      'created_by', req.subject_created_by,
      'due_at', req.expires_at,
      'open', v_open, 'waiting', stg.status = 'WAITING', 'subject_live', v_live, 'outcome', v_outcome,
      'closed_by', COALESCE(dec.actor_user_id, CASE WHEN NOT v_open THEN req.finalized_by END),
      'closed_at', COALESCE(dec.decided_at, CASE WHEN NOT v_open THEN req.finalized_at END),
      'reason', COALESCE(dec.reason, CASE WHEN NOT v_open THEN req.outcome_reason END),
      'record_id', dec.id,
      'authority_source', dec.authority_source, 'authority_basis', dec.authority_basis,
      'authority_limit', dec.authority_limit_amount, 'authority_currency', dec.authority_currency,
      'fingerprint', req.subject_fingerprint);
  END IF;

  RETURN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 8) Quem recebe uma decisão (avisos e Equipe)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.decision_assignees(p_org uuid, p_key text)
RETURNS TABLE (user_id uuid, assignment text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r jsonb; t record; today date := public.decision_today(p_org);
BEGIN
  r := public.decision_resolve(p_org, p_key);
  IF r IS NULL OR NOT COALESCE((r->>'open')::boolean, false) THEN RETURN; END IF;
  IF r->>'source_kind' = 'PROCUREMENT_AUTHORITY' THEN
    SELECT * INTO t FROM public.decision_po_timing(p_org, (r->>'subject_id')::uuid);
    RETURN QUERY
      SELECT a.user_id,
             CASE WHEN a.tier = 'PRIMARY' THEN 'PRIMARY'
                  WHEN t.decide_by < today THEN 'ESCALATED' ELSE 'ELIGIBLE' END
        FROM public.decision_po_approvers(p_org, (r->>'subject_id')::uuid) a;
  ELSE
    RETURN QUERY
      SELECT a.user_id, 'PRIMARY'::text
        FROM public.decision_engine_stage_assignees(p_org, (r->>'request_id')::uuid, (r->>'stage_no')::int) a;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 9) Todas as decisões ABERTAS da organização (Equipe e varredura)
-- ---------------------------------------------------------------------------
/*
  Inclui a decisão SEM ninguém elegível — é o gargalo que a Equipe precisa
  ver: pedido parado porque nenhuma alçada declarada cobre o valor.
*/
CREATE FUNCTION public.decision_open_all(p_org uuid)
RETURNS SETOF public.decision_team_item
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE k record; r jsonb; t record; asg jsonb; today date := public.decision_today(p_org);
        o public.decision_team_item;
BEGIN
  FOR k IN
    SELECT 'purchase_order:' || p.id || ':s' || public.decision_po_submission(p_org, p.id) AS key
      FROM public.purchase_orders p
     WHERE p.organization_id = p_org AND p.status = 'APPROVAL_REQUIRED' AND p.approval_governance = 'AUTHORITY'
    UNION ALL
    SELECT 'approval_request:' || r.id || ':e' || stg.stage_no
      FROM public.approval_requests r
      JOIN public.approval_request_stages stg ON stg.organization_id = r.organization_id AND stg.request_id = r.id
     WHERE r.organization_id = p_org AND r.status = 'PENDING' AND stg.status = 'OPEN'
       AND (r.expires_at IS NULL OR r.expires_at > now())
       AND public.decision_engine_subject_live(p_org, r.subject_type, r.subject_id, r.id)
  LOOP
    r := public.decision_resolve(p_org, k.key);
    CONTINUE WHEN r IS NULL OR NOT COALESCE((r->>'open')::boolean, false);
    t := NULL;
    IF r->>'subject_type' = 'purchase_order' THEN
      SELECT * INTO t FROM public.decision_po_timing(p_org, (r->>'subject_id')::uuid);
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', a.user_id, 'assignment', a.assignment)
                              ORDER BY a.assignment, a.user_id), '[]'::jsonb)
      INTO asg FROM public.decision_assignees(p_org, k.key) a;
    o.decision_key := k.key;
    o.source_kind := r->>'source_kind';
    o.category := r->>'category';
    o.subject_type := r->>'subject_type';
    o.subject_id := (r->>'subject_id')::uuid;
    o.title := r->>'title';
    o.amount := (r->>'amount')::numeric;
    o.currency := r->>'currency';
    o.amount_restricted := false;
    o.project_id := r->>'project_id';
    o.requested_by := (r->>'requested_by')::uuid;
    o.requested_at := (r->>'requested_at')::timestamptz;
    o.due_at := (r->>'due_at')::timestamptz;
    o.need_by := t.need_by;
    o.decide_by := t.decide_by;
    o.overdue := COALESCE(t.decide_by < today, false);
    o.state := CASE
      WHEN jsonb_array_length(asg) = 0 THEN 'SEM_DECISOR'
      WHEN COALESCE(t.decide_by < today, false) AND asg @> '[{"assignment":"ESCALATED"}]' THEN 'ESCALADA'
      WHEN r->>'source_kind' = 'APPROVAL_ENGINE' AND EXISTS (
             SELECT 1 FROM public.approval_decisions d
              WHERE d.organization_id = p_org AND d.request_id = (r->>'request_id')::uuid) THEN 'EM_ANALISE'
      ELSE 'PENDENTE' END;
    o.assignees := asg;
    RETURN NEXT o;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 10) Histórico — o que a pessoa decidiu e o que ela pediu
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.decision_history(p_org uuid, p_user uuid, p_limit integer DEFAULT 200)
RETURNS SETOF public.decision_history_item
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH po_hist AS (
    SELECT h.*,
           (SELECT count(*)::int FROM public.purchase_order_history s
             WHERE s.organization_id = h.organization_id AND s.purchase_order_id = h.purchase_order_id
               AND s.transition = 'submitted' AND s.seq <= h.seq) AS submission
      FROM public.purchase_order_history h
     WHERE h.organization_id = p_org AND h.transition IN ('approved', 'rejected')
       AND h.actor_source = 'human'
       AND COALESCE(h.detail->>'governance', 'AUTHORITY') = 'AUTHORITY'),
  po_dec AS (
    SELECT ph.*, sub.actor_user_id AS submitter, sub.occurred_at AS submitted_at
      FROM po_hist ph
      LEFT JOIN LATERAL (
        SELECT s.actor_user_id, s.occurred_at FROM public.purchase_order_history s
         WHERE s.organization_id = ph.organization_id AND s.purchase_order_id = ph.purchase_order_id
           AND s.transition = 'submitted' AND s.seq <= ph.seq
         ORDER BY s.seq DESC LIMIT 1) sub ON true
     WHERE ph.actor_user_id = p_user OR sub.actor_user_id = p_user),
  hist AS (
    -- Motor: decisões desta pessoa
    SELECT 'approval_request:' || d.request_id || ':e' || d.stage_no AS decision_key,
           'APPROVAL_ENGINE' AS source_kind, public.decision_category(r.subject_type) AS category,
           r.subject_type, r.subject_id, r.subject_label AS title, r.subject_amount AS amount,
           r.subject_currency AS currency,
           CASE WHEN r.subject_type = 'purchase_order' THEN
             (SELECT p.project_id FROM public.purchase_orders p WHERE p.organization_id = p_org AND p.id = r.subject_id) END AS project_id,
           'DECIDER' AS viewer_role,
           CASE d.decision WHEN 'RETURNED_FOR_CORRECTION' THEN 'ADJUSTMENT_REQUESTED' ELSE d.decision END AS outcome,
           d.actor_user_id AS decided_by, d.decided_at, r.requested_by, r.requested_at, d.reason,
           jsonb_build_object('kind', 'APPROVAL_POLICY', 'policy_key', r.policy_key, 'policy_version_no', r.policy_version_no,
                              'stage_no', d.stage_no, 'step_key', d.step_key,
                              'authority_source', d.authority_source, 'authority_basis', d.authority_basis,
                              'authority_limit', d.authority_limit_amount, 'authority_currency', d.authority_currency,
                              'on_behalf_of', d.on_behalf_of_user_id, 'request_status', r.status) AS authority,
           d.id AS record_id
      FROM public.approval_decisions d
      JOIN public.approval_requests r ON r.organization_id = d.organization_id AND r.id = d.request_id
     WHERE d.organization_id = p_org AND (d.actor_user_id = p_user OR d.on_behalf_of_user_id = p_user)
    UNION ALL
    -- Motor: pedidos desta pessoa que terminaram
    SELECT 'approval_request:' || r.id || ':e' || COALESCE(
             (SELECT max(x.stage_no) FROM public.approval_request_stages x
               WHERE x.organization_id = p_org AND x.request_id = r.id AND x.opened_at IS NOT NULL), 1),
           'APPROVAL_ENGINE', public.decision_category(r.subject_type),
           r.subject_type, r.subject_id, r.subject_label, r.subject_amount, r.subject_currency,
           CASE WHEN r.subject_type = 'purchase_order' THEN
             (SELECT p.project_id FROM public.purchase_orders p WHERE p.organization_id = p_org AND p.id = r.subject_id) END,
           'REQUESTER',
           CASE r.status WHEN 'RETURNED_FOR_CORRECTION' THEN 'ADJUSTMENT_REQUESTED'
                         WHEN 'SUPERSEDED' THEN 'CANCELLED' ELSE r.status END,
           r.finalized_by, r.finalized_at, r.requested_by, r.requested_at, r.outcome_reason,
           jsonb_build_object('kind', 'APPROVAL_POLICY', 'policy_key', r.policy_key,
                              'policy_version_no', r.policy_version_no, 'request_status', r.status),
           r.id
      FROM public.approval_requests r
     WHERE r.organization_id = p_org AND r.requested_by = p_user AND r.status <> 'PENDING'
       AND r.subject_type IN ('purchase_order', 'contract_billing_event')
    UNION ALL
    -- Alçada de compra: decisões desta pessoa e decisões sobre o que ela submeteu
    SELECT 'purchase_order:' || pd.purchase_order_id || ':s' || pd.submission,
           'PROCUREMENT_AUTHORITY', 'compras', 'purchase_order', pd.purchase_order_id,
           'Pedido de compra ' || p.order_number,
           COALESCE((pd.detail->>'total')::numeric, public.purchase_order_total(p.id)), p.currency, p.project_id,
           CASE WHEN pd.actor_user_id = p_user THEN 'DECIDER' ELSE 'REQUESTER' END,
           CASE pd.transition WHEN 'approved' THEN 'APPROVED' ELSE 'ADJUSTMENT_REQUESTED' END,
           pd.actor_user_id, pd.occurred_at, pd.submitter, pd.submitted_at, pd.reason,
           jsonb_build_object('kind', 'PROCUREMENT_AUTHORITY', 'authority_id', pd.detail->>'authority_id',
                              'fingerprint', pd.detail->>'fingerprint'),
           pd.id
      FROM po_dec pd
      JOIN public.purchase_orders p ON p.organization_id = pd.organization_id AND p.id = pd.purchase_order_id)
  SELECT * FROM hist ORDER BY decided_at DESC NULLS LAST LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 1000))
$$;

-- ---------------------------------------------------------------------------
-- 11) As portas do navegador — identidade vem da sessão, nunca de parâmetro
-- ---------------------------------------------------------------------------
/*
  O mesmo desenho de approval_step_eligibility_for_viewer (127): a função de
  núcleo recebe o usuário (a fila de avisos precisa avaliar OUTRAS pessoas) e
  fica só no servidor; a que o navegador alcança não tem esse parâmetro. Sem
  isso, qualquer sessão perguntaria "o que o diretor tem para decidir?".
*/
CREATE FUNCTION public.decision_inbox_for_viewer() RETURNS SETOF public.decision_item
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.* FROM public.decision_inbox(public.current_user_organization_id(), auth.uid()) i
   WHERE auth.uid() IS NOT NULL AND public.current_user_organization_id() IS NOT NULL
$$;

CREATE FUNCTION public.decision_inbox_count_for_viewer() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*)::int FROM public.decision_inbox_for_viewer() i WHERE i.assignment IN ('PRIMARY', 'ESCALATED')
$$;

CREATE FUNCTION public.decision_history_for_viewer(p_limit integer DEFAULT 200)
RETURNS SETOF public.decision_history_item
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT h.* FROM public.decision_history(public.current_user_organization_id(), auth.uid(), p_limit) h
   WHERE auth.uid() IS NOT NULL AND public.current_user_organization_id() IS NOT NULL
$$;

/*
  Alcance da Equipe:
    ORGANIZATION    decisions.team.view — a fila inteira do inquilino.
    DIRECT_REPORTS  gestor na hierarquia canônica de pessoas (people.
                    manager_person_id): as decisões que param nos seus liderados.
    NONE            nenhum dos dois.
  Ver a Equipe NÃO dá direito de agir: o ato continua exigindo a alçada de quem
  clica, no banco.
*/
CREATE FUNCTION public.decision_team_scope_for_viewer() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR public.current_user_organization_id() IS NULL THEN 'NONE'
    WHEN public.current_user_has_permission('decisions.team.view') THEN 'ORGANIZATION'
    WHEN EXISTS (
      SELECT 1 FROM public.people p
       WHERE p.organization_id = public.current_user_organization_id()
         AND p.status = 'active'
         AND p.manager_person_id IS NOT NULL
         AND p.manager_person_id = public.current_user_person_id()) THEN 'DIRECT_REPORTS'
    ELSE 'NONE' END
$$;

CREATE FUNCTION public.decision_viewer_reads_subject(p_subject_type text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE p_subject_type
    WHEN 'purchase_order' THEN public.current_user_has_permission('procurement.view')
                            OR public.current_user_has_permission('supply.view')
    WHEN 'contract_billing_event' THEN public.current_user_has_permission('contracts.view')
                                    OR public.current_user_has_permission('finance.view')
    ELSE false END
$$;

CREATE FUNCTION public.decision_team_for_viewer() RETURNS SETOF public.decision_team_item
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE org uuid := public.current_user_organization_id(); scope text := public.decision_team_scope_for_viewer();
        members uuid[]; it public.decision_team_item;
BEGIN
  IF org IS NULL OR scope = 'NONE' THEN RETURN; END IF;
  IF scope = 'DIRECT_REPORTS' THEN
    SELECT COALESCE(array_agg(pr.user_id), '{}') INTO members
      FROM public.people p JOIN public.profiles pr ON pr.id = p.profile_id
     WHERE p.organization_id = org AND p.status = 'active'
       AND p.manager_person_id = public.current_user_person_id();
  END IF;
  FOR it IN SELECT * FROM public.decision_open_all(org) LOOP
    IF scope = 'DIRECT_REPORTS' AND NOT (
         it.requested_by = ANY (members)
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(it.assignees) e
                     WHERE (e->>'user_id')::uuid = ANY (members))) THEN
      CONTINUE;
    END IF;
    -- Valor só para quem já lê o domínio de origem. "Restrito", nunca zero.
    IF NOT public.decision_viewer_reads_subject(it.subject_type) THEN
      it.amount := NULL; it.amount_restricted := true;
    END IF;
    RETURN NEXT it;
  END LOOP;
END $$;

/*
  Quem pode abrir o detalhe de uma decisão, e em que qualidade. NULL = não
  existe para esta pessoa (a mesma resposta para "não existe" e "é de outro
  inquilino": a chave é resolvida SÓ dentro da organização ativa).
*/
CREATE FUNCTION public.decision_access_for_viewer(p_key text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE org uuid := public.current_user_organization_id(); uid uuid := auth.uid(); r jsonb; a text;
BEGIN
  IF org IS NULL OR uid IS NULL OR p_key IS NULL THEN RETURN NULL; END IF;
  r := public.decision_resolve(org, p_key);
  IF r IS NULL THEN RETURN NULL; END IF;
  SELECT i.assignment INTO a FROM public.decision_inbox(org, uid) i WHERE i.decision_key = p_key;
  IF a IN ('PRIMARY', 'ESCALATED') THEN RETURN 'DECIDER'; END IF;
  IF a = 'ELIGIBLE' THEN RETURN 'ELIGIBLE'; END IF;
  IF (r->>'requested_by')::uuid = uid OR (r->>'closed_by')::uuid = uid
     OR EXISTS (SELECT 1 FROM public.decision_history(org, uid, 1000) h WHERE h.decision_key = p_key)
     OR EXISTS (SELECT 1 FROM public.decision_deliveries d
                 WHERE d.organization_id = org AND d.decision_key = p_key AND d.recipient_user_id = uid) THEN
    RETURN 'PARTICIPANT';
  END IF;
  IF public.decision_viewer_reads_subject(r->>'subject_type') THEN RETURN 'SOURCE_READER'; END IF;
  IF EXISTS (SELECT 1 FROM public.decision_team_for_viewer() t WHERE t.decision_key = p_key) THEN RETURN 'TEAM'; END IF;
  RETURN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 12) O ato de alçada de compra a partir de Decisões
-- ---------------------------------------------------------------------------
/*
  Um invólucro FINO sobre a função canônica. Ele acrescenta duas coisas que
  purchase_order_decide não tem, e nenhuma regra de governança:

    1. TELA VELHA — a tela afirma QUAL submissão (e qual impressão digital)
       está decidindo. Se o pedido foi rejeitado, editado e submetido de novo
       entre abrir a tela e clicar, a tela velha NÃO aprova o conteúdo novo.
    2. IDEMPOTÊNCIA — o mesmo clique repetido responde "já registrado" (lido
       do histórico append-only), em vez de "Purchase order is APPROVED".

  Quando a pré-condição vale, o que executa é purchase_order_decide — a mesma
  função, com a mesma permissão, SoD, alçada, efeito e fato emitido que o ato
  feito em Compras. Quando não vale, NADA é escrito e a resposta é STALE.
*/
CREATE FUNCTION public.decision_purchase_order_act(
  p_organization_id uuid, p_actor uuid, p_po_id uuid,
  p_submission integer, p_expected_fingerprint text, p_decision text, p_note text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.purchase_orders%ROWTYPE; cur integer; res jsonb; r jsonb; fp text;
BEGIN
  IF p_decision NOT IN ('APPROVE', 'REJECT') THEN
    RAISE EXCEPTION 'Unsupported decision.' USING ERRCODE = '22023';
  END IF;
  IF p_submission IS NULL OR p_submission < 1 THEN
    RAISE EXCEPTION 'DECISION_SUBMISSION_REQUIRED: a tela precisa dizer qual submissão decide.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v FROM public.purchase_orders WHERE organization_id = p_organization_id AND id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found in tenant.' USING ERRCODE = 'P0002'; END IF;

  cur := public.decision_po_submission(p_organization_id, p_po_id);
  fp := public.purchase_order_fingerprint(p_po_id);
  IF v.status = 'APPROVAL_REQUIRED' AND v.approval_governance = 'AUTHORITY' AND cur = p_submission
     AND (p_expected_fingerprint IS NULL OR fp = p_expected_fingerprint) THEN
    res := public.purchase_order_decide(p_organization_id, p_actor, p_po_id, p_decision, p_note);
    RETURN jsonb_build_object('outcome', 'RECORDED', 'result', res,
      'decision_key', 'purchase_order:' || p_po_id || ':s' || p_submission);
  END IF;

  r := public.decision_resolve(p_organization_id, 'purchase_order:' || p_po_id || ':s' || p_submission);
  IF r IS NOT NULL AND (r->>'closed_by')::uuid = p_actor
     AND r->>'outcome' = (CASE p_decision WHEN 'APPROVE' THEN 'APPROVED' ELSE 'ADJUSTMENT_REQUESTED' END) THEN
    RETURN jsonb_build_object('outcome', 'IDEMPOTENT_REPLAY', 'status', v.status,
      'decision_key', 'purchase_order:' || p_po_id || ':s' || p_submission, 'decided_at', r->'closed_at');
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'STALE', 'status', v.status, 'governance', v.approval_governance,
    'current_submission', cur, 'submission', p_submission,
    'fingerprint_changed', cur = p_submission AND p_expected_fingerprint IS NOT NULL AND fp <> p_expected_fingerprint,
    'decided_by', r->'closed_by', 'decided_at', r->'closed_at', 'decided_outcome', r->'outcome');
END $$;

-- ---------------------------------------------------------------------------
-- 13) Canais: estado explícito por organização, preferência por pessoa
-- ---------------------------------------------------------------------------
CREATE TABLE public.notification_channel_integrations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  channel         text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  status          text NOT NULL CHECK (status IN ('ENABLED', 'DISABLED')),
  provider        text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]{1,40}$'),
  -- O que pode ir no corpo da mensagem. MINIMAL: sem valor nem fornecedor.
  content_level   text NOT NULL DEFAULT 'MINIMAL' CHECK (content_level IN ('MINIMAL', 'STANDARD')),
  -- Configuração NÃO secreta (id de remetente, modelo aprovado). Segredo mora
  -- no ambiente do servidor, nunca aqui — o CHECK recusa chave com cara de
  -- segredo, como em domain_events.
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason          text NOT NULL CHECK (btrim(reason) <> ''),
  changed_by      uuid NOT NULL REFERENCES auth.users(id),
  changed_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nci_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT nci_one_per_channel UNIQUE (organization_id, channel),
  CONSTRAINT nci_config_object CHECK (jsonb_typeof(config) = 'object'),
  CONSTRAINT nci_config_small CHECK (pg_column_size(config) <= 4096),
  CONSTRAINT nci_config_no_secrets CHECK (public.apex_payload_is_safe(config))
);

COMMENT ON TABLE public.notification_channel_integrations IS
  'Estado EXPLÍCITO de um canal de notificação por organização. Sem linha: '
  'e-mail segue a infraestrutura existente (Resend + APP_EMAIL_FROM); WhatsApp '
  'fica NOT_CONFIGURED. Variável de ambiente sozinha nunca liga canal externo.';

CREATE TABLE public.user_notification_preferences (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel         text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  enabled         boolean NOT NULL,
  -- WhatsApp: número em E.164, informado pela PRÓPRIA pessoa (opt-in). O
  -- `profiles.phone` é texto livre não verificado e não é usado.
  destination     text CHECK (destination IS NULL OR destination ~ '^\+[1-9][0-9]{7,14}$'),
  verified_at     timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id, channel),
  CONSTRAINT unp_whatsapp_needs_number CHECK (channel <> 'whatsapp' OR NOT enabled OR destination IS NOT NULL),
  CONSTRAINT unp_email_no_destination CHECK (channel <> 'email' OR destination IS NULL)
);

-- ---------------------------------------------------------------------------
-- 14) O livro de ENTREGA dos avisos de decisão
-- ---------------------------------------------------------------------------
/*
  Uma linha por (decisão, tipo de aviso, desfecho, destinatário, canal). A
  chave de idempotência é determinística: replanejar o mesmo aviso — pelo
  evento, pela varredura, por uma retentativa — não cria segunda linha. É
  isso, e não um "já mandei?" lido antes de enviar, que evita spam.

    PENDING → SENDING (arrendada) → SENT | DELIVERED | SIMULATED | NOT_CONFIGURED
                                  → FAILED (volta a PENDING pela varredura, com
                                    recuo exponencial) → … → DEAD
    PENDING/FAILED → CANCELLED quando a decisão já não está aberta
    SKIPPED na criação: canal desligado, pessoa optou por não receber, sem opt-in

  FAILED não é terminal (os livros de 179/194 travavam para sempre numa
  falha); SIMULATED e NOT_CONFIGURED são: o canal ativado DEPOIS vale para
  avisos NOVOS, não reenvia decisões antigas.
*/
CREATE TABLE public.decision_deliveries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  decision_key       text NOT NULL
                       CHECK (decision_key ~ '^(purchase_order|approval_request):[0-9a-f-]{36}:[es][0-9]+$'),
  subject_type       text NOT NULL CHECK (subject_type ~ '^[a-z][a-z0-9_]*$'),
  subject_id         uuid NOT NULL,
  notice_kind        text NOT NULL
                       CHECK (notice_kind IN ('NEW', 'DUE_SOON', 'OVERDUE', 'ESCALATED', 'RESOLVED', 'ADJUSTMENT_REQUESTED')),
  outcome            text CHECK (outcome IS NULL OR outcome IN ('APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED')),
  recipient_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_role     text NOT NULL CHECK (recipient_role IN ('DECIDER', 'ESCALATION', 'REQUESTER')),
  channel            text NOT NULL CHECK (channel IN ('in_app', 'email', 'whatsapp')),
  state              text NOT NULL DEFAULT 'PENDING'
                       CHECK (state IN ('PENDING', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'DEAD',
                                        'SIMULATED', 'NOT_CONFIGURED', 'SKIPPED', 'CANCELLED')),
  attempt_count      integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts       integer NOT NULL DEFAULT 6 CHECK (max_attempts BETWEEN 1 AND 20),
  next_attempt_at    timestamptz NOT NULL DEFAULT now(),
  lease_token        uuid,
  lease_expires_at   timestamptz,
  provider           text,
  provider_message_id text,
  destination_hint   text,
  notification_id    uuid,
  last_attempt_at    timestamptz,
  sent_at            timestamptz,
  delivered_at       timestamptz,
  failure_code       text,
  failure_reason     text CHECK (failure_reason IS NULL OR length(failure_reason) <= 1000),
  idempotency_key    text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dd_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT dd_idempotent UNIQUE (organization_id, idempotency_key),
  CONSTRAINT dd_lease_coherent CHECK ((state = 'SENDING') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CONSTRAINT dd_sent_coherent CHECK (state NOT IN ('SENT', 'DELIVERED') OR sent_at IS NOT NULL),
  CONSTRAINT dd_delivered_coherent CHECK (state <> 'DELIVERED' OR delivered_at IS NOT NULL),
  CONSTRAINT dd_resolved_has_outcome CHECK ((notice_kind = 'RESOLVED') = (outcome IS NOT NULL))
);

CREATE INDEX dd_due ON public.decision_deliveries (next_attempt_at) WHERE state IN ('PENDING', 'FAILED');
CREATE INDEX dd_sending ON public.decision_deliveries (lease_expires_at) WHERE state = 'SENDING';
CREATE INDEX dd_decision ON public.decision_deliveries (organization_id, decision_key);
CREATE INDEX dd_recipient ON public.decision_deliveries (organization_id, recipient_user_id, created_at DESC);
CREATE INDEX dd_provider_message ON public.decision_deliveries (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE TRIGGER dd_touch BEFORE UPDATE ON public.decision_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.commercial_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 15) Política de aviso — que canal para que aviso
-- ---------------------------------------------------------------------------
/*
  Versionada aqui, no código revisado, e não em tabela editável: mudar quem
  recebe o quê é mudança de produto. As PREFERÊNCIAS da pessoa e o ESTADO do
  canal restringem; nunca ampliam.
*/
CREATE FUNCTION public.decision_notice_channels(p_kind text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE p_kind
    WHEN 'NEW'                  THEN ARRAY['in_app', 'email', 'whatsapp']
    WHEN 'DUE_SOON'             THEN ARRAY['in_app', 'email']
    WHEN 'OVERDUE'              THEN ARRAY['in_app', 'email', 'whatsapp']
    WHEN 'ESCALATED'            THEN ARRAY['in_app', 'email', 'whatsapp']
    WHEN 'RESOLVED'             THEN ARRAY['in_app']
    WHEN 'ADJUSTMENT_REQUESTED' THEN ARRAY['in_app', 'email']
    ELSE ARRAY[]::text[] END
$$;

CREATE FUNCTION public.decision_channel_initial_state(p_org uuid, p_user uuid, p_channel text)
RETURNS TABLE (state text, code text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE integ public.notification_channel_integrations%ROWTYPE; pref public.user_notification_preferences%ROWTYPE;
BEGIN
  IF p_channel = 'in_app' THEN RETURN QUERY SELECT 'PENDING'::text, NULL::text; RETURN; END IF;
  SELECT * INTO integ FROM public.notification_channel_integrations WHERE organization_id = p_org AND channel = p_channel;
  SELECT * INTO pref FROM public.user_notification_preferences
   WHERE organization_id = p_org AND user_id = p_user AND channel = p_channel;
  IF p_channel = 'email' THEN
    IF integ.status = 'DISABLED' THEN RETURN QUERY SELECT 'SKIPPED'::text, 'CHANNEL_DISABLED'::text; RETURN; END IF;
    IF pref.enabled IS FALSE THEN RETURN QUERY SELECT 'SKIPPED'::text, 'USER_OPTED_OUT'::text; RETURN; END IF;
    RETURN QUERY SELECT 'PENDING'::text, NULL::text; RETURN;
  END IF;
  IF p_channel = 'whatsapp' THEN
    IF integ.id IS NULL THEN RETURN QUERY SELECT 'NOT_CONFIGURED'::text, 'CHANNEL_NOT_CONFIGURED'::text; RETURN; END IF;
    IF integ.status <> 'ENABLED' THEN RETURN QUERY SELECT 'NOT_CONFIGURED'::text, 'CHANNEL_DISABLED'::text; RETURN; END IF;
    IF pref.enabled IS DISTINCT FROM true OR pref.destination IS NULL THEN
      RETURN QUERY SELECT 'SKIPPED'::text, 'NO_OPT_IN'::text; RETURN;
    END IF;
    RETURN QUERY SELECT 'PENDING'::text, NULL::text; RETURN;
  END IF;
  RETURN QUERY SELECT 'SKIPPED'::text, 'UNKNOWN_CHANNEL'::text;
END $$;

/*
  Planejar os avisos de UMA decisão para UM gatilho. Idempotente pela chave:
  o evento, a varredura e a reentrega podem chamar quantas vezes quiserem.
  Aviso de ação (NEW, DUE_SOON, OVERDUE, ESCALATED) só para decisão ABERTA.
*/
CREATE FUNCTION public.decision_notices_plan(p_org uuid, p_key text, p_kind text, p_outcome text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r jsonb; rec record; ch text; st record; n integer := 0; v_key text; v_id uuid;
BEGIN
  IF p_kind NOT IN ('NEW', 'DUE_SOON', 'OVERDUE', 'ESCALATED', 'RESOLVED', 'ADJUSTMENT_REQUESTED') THEN
    RAISE EXCEPTION 'Tipo de aviso inválido: %.', p_kind USING ERRCODE = '22023';
  END IF;
  IF (p_kind = 'RESOLVED') <> (p_outcome IS NOT NULL) THEN
    RAISE EXCEPTION 'Aviso de desfecho exige o desfecho (e só ele).' USING ERRCODE = '22023';
  END IF;
  r := public.decision_resolve(p_org, p_key);
  IF r IS NULL THEN RETURN 0; END IF;
  IF p_kind IN ('NEW', 'DUE_SOON', 'OVERDUE', 'ESCALATED') AND NOT COALESCE((r->>'open')::boolean, false) THEN
    RETURN 0;
  END IF;

  FOR rec IN
    SELECT a.user_id, CASE WHEN p_kind = 'ESCALATED' THEN 'ESCALATION' ELSE 'DECIDER' END AS role
      FROM public.decision_assignees(p_org, p_key) a
     WHERE (p_kind IN ('NEW', 'DUE_SOON', 'OVERDUE') AND a.assignment = 'PRIMARY')
        OR (p_kind = 'ESCALATED' AND a.assignment = 'ESCALATED')
    UNION
    SELECT u.user_id, 'REQUESTER'
      FROM (SELECT (r->>'requested_by')::uuid AS user_id
            UNION SELECT (r->>'created_by')::uuid WHERE r->>'source_kind' = 'PROCUREMENT_AUTHORITY') u
     WHERE p_kind IN ('RESOLVED', 'ADJUSTMENT_REQUESTED') AND u.user_id IS NOT NULL
       AND u.user_id IS DISTINCT FROM (r->>'closed_by')::uuid
  LOOP
    FOREACH ch IN ARRAY public.decision_notice_channels(p_kind) LOOP
      SELECT * INTO st FROM public.decision_channel_initial_state(p_org, rec.user_id, ch);
      v_key := concat_ws('|', p_key, p_kind, COALESCE(p_outcome, '-'), rec.user_id::text, ch);
      INSERT INTO public.decision_deliveries (
        organization_id, decision_key, subject_type, subject_id, notice_kind, outcome,
        recipient_user_id, recipient_role, channel, state, failure_code, idempotency_key)
      VALUES (p_org, p_key, r->>'subject_type', (r->>'subject_id')::uuid, p_kind, p_outcome,
              rec.user_id, rec.role, ch, st.state, st.code, v_key)
      ON CONFLICT (organization_id, idempotency_key) DO NOTHING
      RETURNING id INTO v_id;
      IF v_id IS NOT NULL THEN n := n + 1; v_id := NULL; END IF;
    END LOOP;
  END LOOP;
  RETURN n;
END $$;

-- Evento de domínio → decisão(ões) e aviso. Nenhum evento é inventado: os
-- fatos já existem (motor 127, compras 234).
CREATE FUNCTION public.decision_keys_for_event(p_event_id uuid)
RETURNS TABLE (organization_id uuid, decision_key text, notice_kind text, outcome text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE ev public.domain_events%ROWTYPE; req public.approval_requests%ROWTYPE; last_stage integer; n integer := 0;
BEGIN
  SELECT * INTO ev FROM public.domain_events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF ev.event_type LIKE 'approval.%' AND ev.aggregate_type = 'approval_request' THEN
    SELECT * INTO req FROM public.approval_requests WHERE organization_id = ev.organization_id AND id = ev.aggregate_id;
    IF NOT FOUND OR req.subject_type NOT IN ('purchase_order', 'contract_billing_event') THEN RETURN; END IF;
    IF ev.event_type = 'approval.stage.opened' THEN
      RETURN QUERY SELECT ev.organization_id,
        'approval_request:' || req.id || ':e' || (ev.payload->>'stage_no'), 'NEW'::text, NULL::text;
      RETURN;
    END IF;
    SELECT max(x.stage_no) INTO last_stage FROM public.approval_request_stages x
     WHERE x.organization_id = ev.organization_id AND x.request_id = req.id AND x.opened_at IS NOT NULL;
    last_stage := COALESCE(last_stage, 1);
    RETURN QUERY SELECT ev.organization_id, 'approval_request:' || req.id || ':e' || last_stage,
      CASE ev.event_type WHEN 'approval.request.returned_for_correction' THEN 'ADJUSTMENT_REQUESTED' ELSE 'RESOLVED' END,
      CASE ev.event_type WHEN 'approval.request.approved' THEN 'APPROVED'
                         WHEN 'approval.request.rejected' THEN 'REJECTED'
                         WHEN 'approval.request.expired' THEN 'EXPIRED' END
     WHERE ev.event_type IN ('approval.request.approved', 'approval.request.rejected',
                             'approval.request.returned_for_correction', 'approval.request.expired');
    RETURN;
  END IF;

  IF ev.event_type LIKE 'supply.purchase_order.%' THEN
    /*
      purchase_order_log chaveia o fato por 'purchase-order:<id>:<transição>:<N>',
      N = posição da linha de histórico recém-gravada. A submissão vigente no
      fato é a contagem de 'submitted' entre as N primeiras linhas (em seq).
    */
    SELECT count(*) FILTER (WHERE x.transition = 'submitted')::int INTO n
      FROM (SELECT h.transition FROM public.purchase_order_history h
             WHERE h.organization_id = ev.organization_id AND h.purchase_order_id = ev.aggregate_id
             ORDER BY h.seq
             LIMIT NULLIF(split_part(ev.idempotency_key, ':', 4), '')::int) x;
    IF n < 1 THEN RETURN; END IF;
    IF ev.event_type = 'supply.purchase_order.submitted' AND ev.payload->>'governance' = 'AUTHORITY' THEN
      RETURN QUERY SELECT ev.organization_id, 'purchase_order:' || ev.aggregate_id || ':s' || n, 'NEW'::text, NULL::text;
    ELSIF ev.event_type = 'supply.purchase_order.approved' AND ev.payload->>'governance' = 'AUTHORITY' THEN
      RETURN QUERY SELECT ev.organization_id, 'purchase_order:' || ev.aggregate_id || ':s' || n, 'RESOLVED'::text, 'APPROVED'::text;
    ELSIF ev.event_type = 'supply.purchase_order.rejected' AND ev.payload->>'approval_request_id' IS NULL THEN
      RETURN QUERY SELECT ev.organization_id, 'purchase_order:' || ev.aggregate_id || ':s' || n, 'ADJUSTMENT_REQUESTED'::text, NULL::text;
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 16) Entrega — arrendamento, registro, in-app exatamente uma vez
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.decision_deliveries_claim(p_org uuid, p_limit integer DEFAULT 50, p_lease_seconds integer DEFAULT 120)
RETURNS SETOF public.decision_deliveries
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH due AS MATERIALIZED (
    SELECT d.id FROM public.decision_deliveries d
     WHERE d.organization_id = p_org AND d.state IN ('PENDING', 'FAILED') AND d.next_attempt_at <= now()
     ORDER BY d.next_attempt_at, d.created_at
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 500)) FOR UPDATE SKIP LOCKED)
  UPDATE public.decision_deliveries d
     SET state = 'SENDING', attempt_count = d.attempt_count + 1, last_attempt_at = now(),
         lease_token = gen_random_uuid(),
         lease_expires_at = now() + make_interval(secs => GREATEST(10, COALESCE(p_lease_seconds, 120)))
    FROM due WHERE d.id = due.id
  RETURNING d.*
$$;

/*
  Resultado de uma tentativa externa. RETRY recua exponencialmente (30 s, 60 s,
  2 min… teto 1 h) até max_attempts, e então DEAD. O token de arrendamento
  impede que uma tentativa velha sobrescreva a nova.
*/
CREATE FUNCTION public.decision_delivery_record(
  p_id uuid, p_lease uuid, p_result text,
  p_provider text DEFAULT NULL, p_message_id text DEFAULT NULL,
  p_code text DEFAULT NULL, p_reason text DEFAULT NULL, p_destination_hint text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d public.decision_deliveries%ROWTYPE; nxt text;
BEGIN
  IF p_result NOT IN ('SENT', 'DELIVERED', 'SIMULATED', 'NOT_CONFIGURED', 'SKIPPED', 'CANCELLED', 'RETRY', 'FAIL') THEN
    RAISE EXCEPTION 'Resultado de entrega inválido: %.', p_result USING ERRCODE = '22023';
  END IF;
  SELECT * INTO d FROM public.decision_deliveries WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  IF d.state <> 'SENDING' OR d.lease_token IS DISTINCT FROM p_lease THEN RETURN 'STALE'; END IF;
  nxt := CASE p_result
    WHEN 'RETRY' THEN CASE WHEN d.attempt_count >= d.max_attempts THEN 'DEAD' ELSE 'FAILED' END
    WHEN 'FAIL' THEN 'DEAD'
    ELSE p_result END;
  UPDATE public.decision_deliveries
     SET state = nxt, lease_token = NULL, lease_expires_at = NULL,
         provider = COALESCE(p_provider, provider),
         provider_message_id = COALESCE(p_message_id, provider_message_id),
         destination_hint = COALESCE(p_destination_hint, destination_hint),
         sent_at = CASE WHEN nxt IN ('SENT', 'DELIVERED') THEN COALESCE(sent_at, now()) ELSE sent_at END,
         delivered_at = CASE WHEN nxt = 'DELIVERED' THEN now() ELSE delivered_at END,
         failure_code = CASE WHEN nxt IN ('FAILED', 'DEAD', 'NOT_CONFIGURED', 'SKIPPED', 'CANCELLED') THEN p_code ELSE NULL END,
         failure_reason = CASE WHEN nxt IN ('FAILED', 'DEAD', 'NOT_CONFIGURED', 'SKIPPED', 'CANCELLED') THEN left(p_reason, 1000) ELSE NULL END,
         next_attempt_at = CASE WHEN nxt = 'FAILED'
           THEN now() + make_interval(secs => LEAST(3600, 30 * power(2, GREATEST(d.attempt_count - 1, 0)))::int)
           ELSE next_attempt_at END
   WHERE id = p_id;
  RETURN nxt;
END $$;

/*
  In-app EXATAMENTE uma vez: a notificação e o registro de entrega na MESMA
  transação, com a linha travada. Pela porta de servidor da 195 — destinatário
  tem de ser membro ativo; recusa vira DEAD (não adianta repetir).
*/
CREATE FUNCTION public.decision_delivery_in_app(p_id uuid, p_lease uuid, p_title text, p_body text, p_link text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d public.decision_deliveries%ROWTYPE; nid uuid;
BEGIN
  IF p_link IS NULL OR left(p_link, 1) <> '/' OR left(p_link, 2) = '//' THEN
    RAISE EXCEPTION 'Link de notificação precisa ser relativo ao Apex.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO d FROM public.decision_deliveries WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  IF d.channel <> 'in_app' THEN RAISE EXCEPTION 'Entrega % não é in-app.', p_id USING ERRCODE = '22023'; END IF;
  IF d.state <> 'SENDING' OR d.lease_token IS DISTINCT FROM p_lease THEN RETURN 'STALE'; END IF;
  BEGIN
    nid := public.create_notification_for(d.organization_id, d.recipient_user_id,
      'decisions.' || lower(d.notice_kind), p_title, p_body, p_link);
  EXCEPTION WHEN others THEN
    UPDATE public.decision_deliveries
       SET state = 'DEAD', lease_token = NULL, lease_expires_at = NULL, provider = 'in_app',
           failure_code = 'RECIPIENT_REJECTED', failure_reason = left(SQLERRM, 1000)
     WHERE id = p_id;
    RETURN 'DEAD';
  END;
  UPDATE public.decision_deliveries
     SET state = 'DELIVERED', lease_token = NULL, lease_expires_at = NULL, provider = 'in_app',
         notification_id = nid, sent_at = now(), delivered_at = now(), failure_code = NULL, failure_reason = NULL
   WHERE id = p_id;
  RETURN 'DELIVERED';
END $$;

-- Confirmação de entrega vinda do provedor (webhook futuro do WhatsApp).
CREATE FUNCTION public.decision_delivery_mark_delivered(p_provider text, p_message_id text, p_delivered_at timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  UPDATE public.decision_deliveries
     SET state = 'DELIVERED', delivered_at = COALESCE(p_delivered_at, now())
   WHERE provider = p_provider AND provider_message_id = p_message_id AND state = 'SENT';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

/*
  Manutenção do livro, chamada pela varredura:
    - arrendamento vencido (trabalhador morreu no meio) volta para nova tentativa;
    - aviso de AÇÃO de decisão que já fechou é CANCELADO — "decisão necessária"
      depois da decisão tomada é o spam que este livro existe para impedir.
*/
CREATE FUNCTION public.decision_deliveries_maintain(p_org uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE reaped integer; cancelled integer := 0; k record;
BEGIN
  UPDATE public.decision_deliveries
     SET state = CASE WHEN attempt_count >= max_attempts THEN 'DEAD' ELSE 'FAILED' END,
         lease_token = NULL, lease_expires_at = NULL, next_attempt_at = now(),
         failure_code = 'LEASE_EXPIRED', failure_reason = 'A tentativa anterior não registrou resultado.'
   WHERE organization_id = p_org AND state = 'SENDING' AND lease_expires_at < now();
  GET DIAGNOSTICS reaped = ROW_COUNT;

  FOR k IN
    SELECT DISTINCT d.decision_key FROM public.decision_deliveries d
     WHERE d.organization_id = p_org AND d.state IN ('PENDING', 'FAILED')
       AND d.notice_kind IN ('NEW', 'DUE_SOON', 'OVERDUE', 'ESCALATED')
  LOOP
    IF NOT COALESCE((public.decision_resolve(p_org, k.decision_key)->>'open')::boolean, false) THEN
      UPDATE public.decision_deliveries
         SET state = 'CANCELLED', failure_code = 'DECISION_CLOSED',
             failure_reason = 'A decisão foi encerrada antes do envio.'
       WHERE organization_id = p_org AND decision_key = k.decision_key AND state IN ('PENDING', 'FAILED')
         AND notice_kind IN ('NEW', 'DUE_SOON', 'OVERDUE', 'ESCALATED');
      cancelled := cancelled + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('reaped', reaped, 'closed_decisions', cancelled);
END $$;

-- ---------------------------------------------------------------------------
-- 17) Varredura — reconciliação, prazo e escalonamento
-- ---------------------------------------------------------------------------
/*
  O evento é otimização de latência; a VARREDURA é a garantia. Ela replaneja o
  aviso NEW de toda decisão aberta (cobre evento anterior à rota, papel
  concedido depois, alçada declarada depois — nada disso emite fato) e os
  avisos de prazo:

    DUE_SOON   decide_by em até 2 dias, ou expiração do motor em até 24 h
    OVERDUE    passou do decide_by — lembrete à faixa primária
    ESCALATED  passou do decide_by — a faixa superior de alçada recebe

  "Tempo passou" não é fato de domínio (runbook de jobs §7): nenhum evento
  `decision.overdue` é emitido; o vencimento é DERIVADO do estado.
*/
CREATE FUNCTION public.decision_sweep_plan(p_org uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o public.decision_team_item; today date := public.decision_today(p_org);
        n_new integer := 0; n_soon integer := 0; n_over integer := 0; n_esc integer := 0; n_open integer := 0;
        maint jsonb;
BEGIN
  maint := public.decision_deliveries_maintain(p_org);
  FOR o IN SELECT * FROM public.decision_open_all(p_org) LOOP
    n_open := n_open + 1;
    n_new := n_new + public.decision_notices_plan(p_org, o.decision_key, 'NEW');
    IF (o.decide_by IS NOT NULL AND o.decide_by >= today AND o.decide_by - today <= 2)
       OR (o.due_at IS NOT NULL AND o.due_at > now() AND o.due_at <= now() + interval '24 hours') THEN
      n_soon := n_soon + public.decision_notices_plan(p_org, o.decision_key, 'DUE_SOON');
    END IF;
    IF o.decide_by IS NOT NULL AND o.decide_by < today THEN
      n_over := n_over + public.decision_notices_plan(p_org, o.decision_key, 'OVERDUE');
      n_esc := n_esc + public.decision_notices_plan(p_org, o.decision_key, 'ESCALATED');
    END IF;
  END LOOP;
  RETURN jsonb_build_object('open', n_open, 'new', n_new, 'due_soon', n_soon, 'overdue', n_over,
                            'escalated', n_esc, 'maintenance', maint);
END $$;

CREATE FUNCTION public.decisions_enqueue_sweep(p_as_of timestamptz DEFAULT now())
RETURNS integer LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE org record; n integer := 0;
BEGIN
  FOR org IN
    SELECT p.organization_id FROM public.purchase_orders p
     WHERE p.status = 'APPROVAL_REQUIRED'
    UNION
    SELECT r.organization_id FROM public.approval_requests r
     WHERE r.status = 'PENDING' AND r.subject_type IN ('purchase_order', 'contract_billing_event')
    UNION
    SELECT d.organization_id FROM public.decision_deliveries d
     WHERE d.state IN ('PENDING', 'FAILED', 'SENDING')
  LOOP
    PERFORM public.apex_jobs_enqueue(
      org.organization_id, 'platform.decisions.sweep',
      'decisions-sweep:' || org.organization_id::text || ':'
        || to_char(p_as_of AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24') || ':' || (extract(minute FROM p_as_of)::int / 15)::text,
      jsonb_build_object('reason', 'scheduled'), 1, now(), 3, NULL, NULL);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- ---------------------------------------------------------------------------
-- 18) Configuração governada dos canais e das preferências
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.notification_channel_set(
  p_organization_id uuid, p_actor uuid, p_channel text, p_status text,
  p_provider text, p_content_level text, p_reason text, p_config jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.notification_channel_integrations%ROWTYPE; prev text;
BEGIN
  IF NOT public.apex_actor_has_permission(p_organization_id, p_actor, 'notifications.channels.manage') THEN
    RAISE EXCEPTION 'Actor lacks permission (notifications.channels.manage).' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Mudar um canal exige motivo.' USING ERRCODE = '22023';
  END IF;
  SELECT status INTO prev FROM public.notification_channel_integrations
   WHERE organization_id = p_organization_id AND channel = p_channel FOR UPDATE;
  INSERT INTO public.notification_channel_integrations
    (organization_id, channel, status, provider, content_level, config, reason, changed_by, changed_at)
  VALUES (p_organization_id, p_channel, p_status, p_provider, COALESCE(p_content_level, 'MINIMAL'),
          COALESCE(p_config, '{}'::jsonb), btrim(p_reason), p_actor, now())
  ON CONFLICT (organization_id, channel) DO UPDATE
     SET status = EXCLUDED.status, provider = EXCLUDED.provider, content_level = EXCLUDED.content_level,
         config = EXCLUDED.config, reason = EXCLUDED.reason, changed_by = EXCLUDED.changed_by, changed_at = now()
  RETURNING * INTO v;
  PERFORM public.emit_domain_event(
    p_organization_id, 'platform.notification_channel.changed', 1, 'notification_channel', v.id,
    'notification-channel:' || v.id || ':' || to_char(v.changed_at, 'YYYYMMDDHH24MISSUS'),
    jsonb_build_object('channel', v.channel, 'status', v.status, 'previous_status', prev,
                       'provider', v.provider, 'content_level', v.content_level),
    now(), 'human', p_actor);
  RETURN jsonb_build_object('channel', v.channel, 'status', v.status, 'provider', v.provider,
                            'content_level', v.content_level, 'previous_status', prev);
END $$;

CREATE FUNCTION public.notification_preference_set(
  p_organization_id uuid, p_actor uuid, p_channel text, p_enabled boolean, p_destination text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE dest text := nullif(regexp_replace(COALESCE(p_destination, ''), '[\s().-]', '', 'g'), '');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organization_memberships m
                  WHERE m.organization_id = p_organization_id AND m.user_id = p_actor AND m.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'Actor is not an active member.' USING ERRCODE = '42501';
  END IF;
  IF p_channel NOT IN ('email', 'whatsapp') THEN
    RAISE EXCEPTION 'Canal inválido.' USING ERRCODE = '22023';
  END IF;
  IF p_channel = 'email' THEN dest := NULL; END IF;
  IF p_channel = 'whatsapp' AND p_enabled AND (dest IS NULL OR dest !~ '^\+[1-9][0-9]{7,14}$') THEN
    RAISE EXCEPTION 'WhatsApp exige número no formato internacional (+5511999999999).' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.user_notification_preferences (organization_id, user_id, channel, enabled, destination, verified_at, updated_at)
  VALUES (p_organization_id, p_actor, p_channel, p_enabled, dest, NULL, now())
  ON CONFLICT (organization_id, user_id, channel) DO UPDATE
     SET enabled = EXCLUDED.enabled, destination = EXCLUDED.destination,
         verified_at = CASE WHEN user_notification_preferences.destination IS NOT DISTINCT FROM EXCLUDED.destination
                            THEN user_notification_preferences.verified_at END,
         updated_at = now();
  RETURN jsonb_build_object('channel', p_channel, 'enabled', p_enabled, 'destination', dest);
END $$;

-- ---------------------------------------------------------------------------
-- 19) Rotas de evento — nascem DESLIGADAS, o trabalhador capaz as liga (237)
-- ---------------------------------------------------------------------------
/*
  Tipo de trabalho NOVO (platform.decisions.notify), e não mais rotas no tipo
  de compras: cada consumidor reage ao mesmo fato pela sua própria fila.
*/
INSERT INTO public.apex_event_routes (event_type, schema_version, job_type, max_attempts, enabled, activation, note)
SELECT v.event_type, 1, 'platform.decisions.notify', 6, false, 'ON_WORKER_CAPABILITY', v.note
  FROM (VALUES
    ('approval.stage.opened', 'Decisões: estágio aberto no motor — avisa quem decide.'),
    ('approval.request.approved', 'Decisões: desfecho — avisa quem pediu.'),
    ('approval.request.rejected', 'Decisões: desfecho — avisa quem pediu.'),
    ('approval.request.returned_for_correction', 'Decisões: ajuste solicitado — avisa o dono do fluxo de origem.'),
    ('approval.request.expired', 'Decisões: pedido vencido sem decisão — avisa quem pediu.'),
    ('supply.purchase_order.submitted', 'Decisões: pedido de compra por alçada declarada — avisa a faixa de alçada.'),
    ('supply.purchase_order.approved', 'Decisões: compra aprovada por alçada — avisa quem submeteu.'),
    ('supply.purchase_order.rejected', 'Decisões: compra devolvida por alçada — avisa quem submeteu.')
  ) AS v(event_type, note)
 WHERE NOT EXISTS (SELECT 1 FROM public.apex_event_routes r
                    WHERE r.event_type = v.event_type AND r.schema_version = 1
                      AND r.job_type = 'platform.decisions.notify');

-- ---------------------------------------------------------------------------
-- 20) RLS e privilégios
-- ---------------------------------------------------------------------------
ALTER TABLE public.decision_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_channel_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notification_preferences ENABLE ROW LEVEL SECURITY;

-- Quem recebeu vê a própria entrega; quem administra canais vê a organização.
CREATE POLICY decision_deliveries_select ON public.decision_deliveries FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (recipient_user_id = auth.uid()
              OR public.current_user_has_permission('notifications.channels.manage')
              OR public.current_user_is_admin()));
-- Estado do canal não tem segredo: todo membro sabe se o WhatsApp está ligado.
CREATE POLICY notification_channel_integrations_select ON public.notification_channel_integrations FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id());
CREATE POLICY user_notification_preferences_select ON public.user_notification_preferences FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id() AND user_id = auth.uid());

REVOKE ALL ON public.decision_deliveries, public.notification_channel_integrations,
              public.user_notification_preferences FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.decision_deliveries,
       public.notification_channel_integrations, public.user_notification_preferences FROM authenticated;
GRANT SELECT ON public.decision_deliveries, public.notification_channel_integrations,
                public.user_notification_preferences TO authenticated;
GRANT ALL ON public.decision_deliveries, public.notification_channel_integrations,
             public.user_notification_preferences TO service_role;

-- Núcleo: só servidor. Recebem o usuário como parâmetro — não podem chegar ao navegador.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.decision_today(uuid)',
    'public.decision_po_submission(uuid,uuid)',
    'public.decision_po_timing(uuid,uuid)',
    'public.decision_po_approvers(uuid,uuid)',
    'public.decision_engine_subject_live(uuid,text,uuid,uuid)',
    'public.decision_engine_stage_assignees(uuid,uuid,integer)',
    'public.decision_inbox(uuid,uuid)',
    'public.decision_resolve(uuid,text)',
    'public.decision_assignees(uuid,text)',
    'public.decision_open_all(uuid)',
    'public.decision_history(uuid,uuid,integer)',
    'public.decision_purchase_order_act(uuid,uuid,uuid,integer,text,text,text)',
    'public.decision_channel_initial_state(uuid,uuid,text)',
    'public.decision_notices_plan(uuid,text,text,text)',
    'public.decision_keys_for_event(uuid)',
    'public.decision_deliveries_claim(uuid,integer,integer)',
    'public.decision_delivery_record(uuid,uuid,text,text,text,text,text,text)',
    'public.decision_delivery_in_app(uuid,uuid,text,text,text)',
    'public.decision_delivery_mark_delivered(text,text,timestamptz)',
    'public.decision_deliveries_maintain(uuid)',
    'public.decision_sweep_plan(uuid)',
    'public.decisions_enqueue_sweep(timestamptz)',
    'public.notification_channel_set(uuid,uuid,text,text,text,text,text,jsonb)',
    'public.notification_preference_set(uuid,uuid,text,boolean,text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;

  -- Funções puras de vocabulário: sem dado, sem identidade.
  FOREACH f IN ARRAY ARRAY[
    'public.decision_engine_actions(text)',
    'public.decision_category(text)',
    'public.decision_reason_required(text[],text)',
    'public.decision_notice_channels(text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;

  -- Portas do navegador: identidade de auth.uid(), organização da sessão.
  FOREACH f IN ARRAY ARRAY[
    'public.decision_inbox_for_viewer()',
    'public.decision_inbox_count_for_viewer()',
    'public.decision_history_for_viewer(integer)',
    'public.decision_team_scope_for_viewer()',
    'public.decision_viewer_reads_subject(text)',
    'public.decision_team_for_viewer()',
    'public.decision_access_for_viewer(text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;

COMMENT ON FUNCTION public.decision_inbox(uuid, uuid) IS
  'As decisões que esperam UMA pessoa, calculadas na hora a partir do motor '
  '(approval_step_eligibility) e da alçada de compra (apex_actor_has_permission '
  '+ procurement_authority_for_order + SoD). Projeção, nunca verdade: nada '
  'aqui é guardado. Só servidor.';
COMMENT ON FUNCTION public.decision_purchase_order_act(uuid, uuid, uuid, integer, text, text, text) IS
  'Ato de alçada de compra a partir de Decisões: pré-condição de tela velha '
  '(submissão + impressão digital) e resposta idempotente; o ato em si é '
  'purchase_order_decide, a função canônica.';
COMMENT ON TABLE public.decision_deliveries IS
  'Livro de ENTREGA dos avisos de decisão (in-app, e-mail, WhatsApp). Não é '
  'estado de decisão: a decisão mora no motor e em compras.';

COMMIT;
