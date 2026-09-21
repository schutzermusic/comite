-- ============================================================================
-- 179 — PLANEJAMENTO MENSAL DE FATURAMENTO
--
-- ─── A pergunta que a aba Faturamentos não sabia responder ────────────────
--
--   "Quanto esperamos faturar em outubro?"
--
-- O módulo sabia dizer o que JÁ VIROU EVENTO (contract_billing_events) e o que
-- o contrato PROMETE por marco (a bancada da 171). Não sabia colocar os dois
-- numa linha do tempo mensal, porque faltava a única coisa que transforma um
-- direito contratual em uma EXPECTATIVA DATADA: a data do cronograma do
-- projeto, chegando pela ponte GOVERNADA que a 131 já construiu.
--
-- ─── O que esta migration cria, e o que ela recusa criar ──────────────────
--
-- CRIA (leitura e planejamento):
--   1. contract_billing_month_plan       — visão: uma linha por marco, com
--                                          DATA PREVISTA e MÊS PREVISTO
--   2. contract_billing_schedule_reprogrammings — histórico append-only de
--                                          reprogramação da data do cronograma
--   3. contract_billing_alert_policies   — cadência DECLARADA de alerta
--   4. contract_billing_milestone_alerts — alerta materializado, idempotente
--   5. contract_billing_alert_dispatches — entrega por destinatário e canal
--
-- RECUSA CRIAR (verdade financeira a jusante):
--   · nenhum contract_billing_events
--   · nenhuma nota fiscal, recebível, liquidação ou conciliação
--   · nenhuma medição, aceite ou evidência
--   · nenhum mapeamento ACEITO (proposta continua proposta — §17)
--
-- Planejar é dizer o que se ESPERA. Nada aqui promove expectativa a fato, e é
-- por isso que a visão mantém `planned_amount`, `eligible_amount` e
-- `billed_amount` em colunas SEPARADAS: quem quiser somá-las que assuma a
-- escolha na tela, com o rótulo à vista.
--
-- ─── A data prevista, e de onde ela vem ───────────────────────────────────
--
--   marco contratual
--     → contract_measurement_requirements        (a exigência)
--     → contract_measurement_rule_timeline_governed  (a ponte ACEITA)
--     → project_timeline_items.forecast_finish / planned_finish
--     → DATA PREVISTA DE FATURAMENTO
--
-- `percent_complete` NÃO participa desta cadeia, nem aqui nem em lugar nenhum.
-- A data do cronograma é PLANEJAMENTO; ela não prova que o gatilho contratual
-- ocorreu, e `planned_billing_date` não move `trigger_assessment` um milímetro.
--
-- Sem ponte governada, a data cai para a medição agendada e depois para o
-- `due_date` do marco — e `planned_billing_date_basis` sempre DIZ qual das três
-- sustentou a linha. Sem nenhuma delas a data é NULL e o mês é NULL: "não
-- apurado" continua sendo uma resposta, e é melhor que um mês inventado.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) HISTÓRICO DE REPROGRAMAÇÃO — a data mudou, e isso fica registrado
-- ---------------------------------------------------------------------------
/*
  Por que uma tabela, se todo o resto desta migration é visão?

  Porque o cronograma é DESTRUTIVO na atualização: a importação da 032 faz
  UPDATE em `project_timeline_items.planned_finish`, e a data anterior deixa de
  existir. Uma visão não consegue mostrar "reprogramada de 15/10 para 28/11"
  a partir de uma tabela que só guarda o 28/11.

  A tabela é APPEND-ONLY e não é fonte de verdade de nada: a data VIGENTE
  continua sendo a do cronograma. Isto aqui é o diário de bordo dela.
*/
CREATE TABLE IF NOT EXISTS public.contract_billing_schedule_reprogrammings (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id             uuid NOT NULL,
  milestone_id            uuid,
  rule_id                 uuid NOT NULL,
  project_id              text NOT NULL,
  timeline_item_id        uuid NOT NULL,
  mapping_id              uuid NOT NULL,

  previous_planned_finish date,
  new_planned_finish      date,
  previous_forecast_finish date,
  new_forecast_finish     date,

  -- Qual lote de importação trouxe a mudança, quando veio de importação.
  import_batch_id         uuid REFERENCES public.project_schedule_imports(id) ON DELETE SET NULL,
  schedule_version        integer,

  observed_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cbsr_something_changed CHECK (
    previous_planned_finish IS DISTINCT FROM new_planned_finish
    OR previous_forecast_finish IS DISTINCT FROM new_forecast_finish)
);

CREATE INDEX IF NOT EXISTS cbsr_milestone_idx
  ON public.contract_billing_schedule_reprogrammings
  (organization_id, milestone_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS cbsr_contract_idx
  ON public.contract_billing_schedule_reprogrammings
  (organization_id, contract_id, observed_at DESC);

COMMENT ON TABLE public.contract_billing_schedule_reprogrammings IS
  'Diário APPEND-ONLY das reprogramações da data de cronograma que sustenta a '
  'data prevista de faturamento de um marco. Não é fonte de verdade: a data '
  'vigente continua em project_timeline_items. Existe porque a importação '
  'sobrescreve a data anterior, e "foi reprogramada" é informação que o usuário '
  'precisa ver ao lado do mês previsto.';

/*
  O gatilho.

  Dispara SÓ quando a data muda E existe ponte GOVERNADA até aquela etapa. Uma
  etapa sem mapeamento aceito não sustenta previsão de faturamento nenhuma, e
  registrar a mudança dela aqui encheria o diário de ruído.
*/
CREATE OR REPLACE FUNCTION public.contract_billing_record_schedule_reprogramming()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_version integer;
BEGIN
  IF NEW.planned_finish IS NOT DISTINCT FROM OLD.planned_finish
     AND NEW.forecast_finish IS NOT DISTINCT FROM OLD.forecast_finish THEN
    RETURN NEW;
  END IF;

  SELECT si.schedule_version INTO v_version
    FROM public.project_schedule_imports si
   WHERE si.id = NEW.import_batch_id;

  INSERT INTO public.contract_billing_schedule_reprogrammings
    (organization_id, contract_id, milestone_id, rule_id, project_id,
     timeline_item_id, mapping_id,
     previous_planned_finish, new_planned_finish,
     previous_forecast_finish, new_forecast_finish,
     import_batch_id, schedule_version)
  SELECT g.organization_id, g.contract_id, q.milestone_id, g.rule_id, g.project_id,
         g.timeline_item_id, g.id,
         OLD.planned_finish, NEW.planned_finish,
         OLD.forecast_finish, NEW.forecast_finish,
         NEW.import_batch_id, v_version
    FROM public.contract_measurement_rule_timeline_governed g
    JOIN public.contract_measurement_requirements q
      ON q.organization_id = g.organization_id AND q.id = g.rule_id
   WHERE g.organization_id = NEW.organization_id
     AND g.timeline_item_id = NEW.id;

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.contract_billing_record_schedule_reprogramming() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_billing_schedule_reprogramming ON public.project_timeline_items;
CREATE TRIGGER trg_billing_schedule_reprogramming
AFTER UPDATE OF planned_finish, forecast_finish ON public.project_timeline_items
FOR EACH ROW EXECUTE FUNCTION public.contract_billing_record_schedule_reprogramming();

-- ---------------------------------------------------------------------------
-- 2) A VISÃO — uma linha por marco, com data e mês previstos
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.contract_billing_month_plan
WITH (security_invoker = true) AS
WITH base AS (
  SELECT
    w.*,
    -- A etapa mapeada, relida para pegar `forecast_finish`, que a bancada da
    -- 171 não expõe. Mesma etapa, mesmo mapeamento governado.
    tl.forecast_finish        AS timeline_forecast_finish,
    tl.planned_start          AS timeline_planned_start,
    tl.responsible_user_id    AS timeline_responsible_user_id,
    tl.is_active              AS timeline_is_active,
    c.contract_number,
    c.counterparty_name,
    c.payment_terms,
    c.currency                AS contract_currency,
    c.owner_user_id           AS contract_owner_user_id,
    lk.project_id             AS linked_project_id
  FROM public.contract_milestone_workbench w
  LEFT JOIN public.contracts c
         ON c.organization_id = w.organization_id AND c.id = w.contract_id
  LEFT JOIN public.project_timeline_items tl
         ON tl.organization_id = w.organization_id AND tl.id = w.timeline_item_id
  LEFT JOIN LATERAL (
    SELECT l.project_id FROM public.project_contract_link_governed l
     WHERE l.organization_id = w.organization_id AND l.contract_id = w.contract_id
     ORDER BY l.linked_at LIMIT 1
  ) lk ON true
)
SELECT
  b.id                        AS milestone_id,
  b.organization_id,
  b.contract_id,
  b.contract_number,
  b.counterparty_name,
  COALESCE(b.timeline_project_id, b.project_id, b.linked_project_id) AS project_id,
  b.title,
  b.description,
  b.status,
  b.due_date                  AS milestone_due_date,
  b.completed_at,
  b.owner_user_id             AS milestone_owner_user_id,
  b.contract_owner_user_id,
  b.timeline_responsible_user_id,

  -- ── OS TRÊS VALORES, SEPARADOS ────────────────────────────────────────
  -- `planned_amount` é o DIREITO contratual; cai para o previsto do marco só
  -- quando não há direito registrado, e `planned_amount_basis` diz qual foi.
  COALESCE(b.entitlement_amount, b.billing_amount)  AS planned_amount,
  CASE WHEN b.entitlement_amount IS NOT NULL THEN 'contract_entitlement'
       WHEN b.billing_amount IS NOT NULL     THEN 'milestone_billing_amount'
       ELSE NULL END                                AS planned_amount_basis,
  b.entitlement_amount,
  b.billing_amount,
  b.measured_amount,
  b.measurement_accepted_value AS accepted_value,
  -- APURADO a jusante. Só existe com evento de faturamento vivo.
  b.billing_eligible_amount,
  COALESCE(b.entitlement_currency, b.billing_currency, b.contract_currency) AS currency,

  -- ── A DATA PREVISTA ───────────────────────────────────────────────────
  /*
    Prioridade, e a razão de cada degrau:

      1. cronograma governado  — a ponte que um humano aceitou (§17). É a
         resposta pedida: "a etapa termina em 15/10/2026, logo o faturamento
         é esperado para outubro/2026".
      2. medição agendada      — Projetos marcou quando vai medir.
      3. due_date do marco     — o prazo que o próprio marco carrega.
      4. NULL                  — e o mês também é NULL.

    O `basis` acompanha SEMPRE. Sem ele, a tela mostraria a mesma data em três
    graus de confiança diferentes com a mesma cara.
  */
  CASE
    WHEN b.governed_mapping_count > 0 AND b.timeline_item_id IS NOT NULL
         AND b.timeline_is_active
         AND COALESCE(b.timeline_forecast_finish, b.timeline_planned_finish) IS NOT NULL
      THEN COALESCE(b.timeline_forecast_finish, b.timeline_planned_finish)
    WHEN b.measurement_expected_at IS NOT NULL THEN b.measurement_expected_at::date
    WHEN b.due_date IS NOT NULL                THEN b.due_date
    ELSE NULL
  END                         AS planned_billing_date,

  CASE
    WHEN b.governed_mapping_count > 0 AND b.timeline_item_id IS NOT NULL
         AND b.timeline_is_active
         AND b.timeline_forecast_finish IS NOT NULL THEN 'timeline_forecast_finish'
    WHEN b.governed_mapping_count > 0 AND b.timeline_item_id IS NOT NULL
         AND b.timeline_is_active
         AND b.timeline_planned_finish IS NOT NULL  THEN 'timeline_planned_finish'
    WHEN b.measurement_expected_at IS NOT NULL      THEN 'measurement_expected_at'
    WHEN b.due_date IS NOT NULL                     THEN 'milestone_due_date'
    ELSE 'undetermined'
  END                         AS planned_billing_date_basis,

  -- Mês previsto, derivado da MESMA expressão. Um `date_trunc` na tela sobre
  -- uma data que a tela recalculou é como os dois números divergem.
  to_char(
    CASE
      WHEN b.governed_mapping_count > 0 AND b.timeline_item_id IS NOT NULL
           AND b.timeline_is_active
           AND COALESCE(b.timeline_forecast_finish, b.timeline_planned_finish) IS NOT NULL
        THEN COALESCE(b.timeline_forecast_finish, b.timeline_planned_finish)
      WHEN b.measurement_expected_at IS NOT NULL THEN b.measurement_expected_at::date
      WHEN b.due_date IS NOT NULL                THEN b.due_date
      ELSE NULL
    END, 'YYYY-MM')           AS planned_billing_month,

  -- ── CRONOGRAMA: o que sustenta (ou não sustenta) a data ───────────────
  b.governed_mapping_count,
  b.timeline_item_id,
  b.timeline_title,
  b.timeline_wbs_code,
  b.timeline_status,
  b.timeline_planned_finish,
  b.timeline_forecast_finish,
  b.timeline_actual_finish,
  b.timeline_is_active,
  -- `percent_complete` é exposto para EXIBIÇÃO e jamais entra em derivação
  -- nenhuma desta visão. Ver o cabeçalho.
  b.timeline_percent_complete,

  -- Reprogramação: quantas vezes e de onde para onde, na última.
  rp.reprogramming_count,
  rp.previous_planned_finish  AS last_previous_planned_finish,
  rp.new_planned_finish       AS last_new_planned_finish,
  rp.observed_at              AS last_reprogrammed_at,

  -- ── EXIGÊNCIA, MEDIÇÃO E ACEITE ───────────────────────────────────────
  b.requirement_id,
  b.customer_acceptance_required,
  b.evidence_required,
  b.measurement_id,
  b.measurement_status,
  b.measurement_readiness,
  b.measurement_expected_at,
  b.measurement_accepted_at,
  b.measurement_evidence_count,
  b.evidence_document_id,
  b.evidence,

  -- ── FATURAMENTO E CAIXA — a jusante, só estado ────────────────────────
  b.billing_event_id,
  b.billing_eligibility_state,
  b.billing_release_state,
  b.billing_amount_source,
  b.billing_fiscal_document_status,
  b.billing_receivable_status,
  b.billing_finance_link_state,
  cash.fiscal_document_number,
  cash.fiscal_authorized_at,
  cash.due_date               AS receivable_first_due_date,
  cash.paid_amount_cents      AS receivable_paid_amount_cents,
  cash.open_amount_cents      AS receivable_open_amount_cents,
  bal.last_payment_date       AS receivable_last_payment_date,
  cash.reconciled_settlement_count,
  -- Texto livre do instrumento. Exposto como TEXTO e nunca convertido em
  -- data: a §39 proíbe derivar vencimento de `payment_terms`.
  b.payment_terms             AS payment_term_text

FROM base b
LEFT JOIN public.contract_to_cash_read_model cash
       ON cash.organization_id = b.organization_id
      AND cash.billing_event_id = b.billing_event_id
LEFT JOIN public.finance_receivable_balances bal
       ON bal.receivable_id = cash.receivable_id
LEFT JOIN LATERAL (
  SELECT count(*) OVER () ::int AS reprogramming_count,
         r.previous_planned_finish, r.new_planned_finish, r.observed_at
    FROM public.contract_billing_schedule_reprogrammings r
   WHERE r.organization_id = b.organization_id
     AND r.milestone_id = b.id
   ORDER BY r.observed_at DESC
   LIMIT 1
) rp ON true;

COMMENT ON VIEW public.contract_billing_month_plan IS
  'Planejamento MENSAL de faturamento: uma linha por marco contratual, com '
  'data e mês PREVISTOS derivados do cronograma GOVERNADO (e, na falta dele, '
  'da medição agendada ou do prazo do marco — planned_billing_date_basis diz '
  'qual). Previsto, elegível, faturado e recebido permanecem em colunas '
  'separadas. Nada aqui afirma que gatilho ocorreu: percent_complete não '
  'participa de derivação nenhuma.';

GRANT SELECT ON public.contract_billing_month_plan TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.contract_billing_month_plan FROM authenticated;
REVOKE ALL ON public.contract_billing_month_plan FROM anon;

-- ---------------------------------------------------------------------------
-- 3) CADÊNCIA DECLARADA DE ALERTA
-- ---------------------------------------------------------------------------
/*
  A ausência de linha é a ausência de política — exatamente como o calendário
  útil da 155. Sem política declarada, `contract_billing_alerts_materialize`
  usa a cadência PADRÃO e marca `policy_source = 'default'`, para que ninguém
  leia "a organização escolheu 30/15/7/3" quando ninguém escolheu nada.
*/
CREATE TABLE IF NOT EXISTS public.contract_billing_alert_policies (
  /*
    Chave SUBSTITUTA, e não (organization_id, contract_id).

    `contract_id NULL` É a política da organização — o caso mais comum — e
    coluna de PRIMARY KEY não aceita NULL. Uma PK composta aqui forçaria um
    `contract_id` sentinela (o uuid zero, digamos) para representar "todos os
    contratos", e esse sentinela viraria uma FK que não aponta para contrato
    nenhum. A unicidade real mora nos dois índices PARCIAIS abaixo.
  */
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- NULL = política da organização; preenchido = política daquele contrato.
  contract_id      uuid,
  offsets_days     smallint[] NOT NULL DEFAULT ARRAY[30,15,7,3,0]::smallint[],
  overdue_enabled  boolean NOT NULL DEFAULT true,
  channels         text[] NOT NULL DEFAULT ARRAY['in_app','email']::text[],
  -- Destinatários adicionais, além dos responsáveis derivados do domínio.
  extra_recipient_user_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  active           boolean NOT NULL DEFAULT true,
  declared_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  declared_at      timestamptz NOT NULL DEFAULT now(),
  note             text,

  CONSTRAINT cbap_contract_tenant FOREIGN KEY (organization_id, contract_id)
    REFERENCES public.contracts (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT cbap_offsets_sane CHECK (
    array_length(offsets_days, 1) BETWEEN 1 AND 12
    AND offsets_days <@ ARRAY[0,1,2,3,5,7,10,15,20,30,45,60,90]::smallint[]),
  CONSTRAINT cbap_channels_known CHECK (
    channels <@ ARRAY['in_app','email','whatsapp']::text[]
    AND array_length(channels, 1) >= 1)
);

-- `contract_id` NULL não participa de PRIMARY KEY, então a unicidade da
-- política da organização precisa de índice próprio.
CREATE UNIQUE INDEX IF NOT EXISTS cbap_org_default_unique
  ON public.contract_billing_alert_policies (organization_id)
  WHERE contract_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cbap_contract_unique
  ON public.contract_billing_alert_policies (organization_id, contract_id)
  WHERE contract_id IS NOT NULL;

COMMENT ON TABLE public.contract_billing_alert_policies IS
  'Cadência DECLARADA de alerta de marco de faturamento. A ausência de linha é '
  'ausência de política: a materialização usa o padrão e diz que é padrão.';

-- ---------------------------------------------------------------------------
-- 4) O ALERTA — materializado uma vez por (marco, data prevista, antecedência)
-- ---------------------------------------------------------------------------
/*
  A IDEMPOTÊNCIA MORA NA CHAVE, não numa checagem de aplicação.

  `UNIQUE (organization_id, milestone_id, planned_date, offset_days)` é o que
  impede o alerta duplicado, e ele impede mesmo que dois workers rodem no mesmo
  segundo. Uma verificação em TypeScript ("já existe?") perde essa corrida.

  Observe que `planned_date` faz parte da chave DE PROPÓSITO. Quando o
  cronograma reprograma o marco de 15/10 para 28/11, a chave muda e um novo
  conjunto de alertas nasce — que é o comportamento correto: a data nova
  merece aviso novo. Os alertas da data antiga permanecem como história.
*/
CREATE TABLE IF NOT EXISTS public.contract_billing_milestone_alerts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id       uuid NOT NULL,
  milestone_id      uuid NOT NULL,
  project_id        text,

  planned_date      date NOT NULL,
  planned_date_basis text NOT NULL,
  offset_days       smallint NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('UPCOMING','DUE_TODAY','OVERDUE')),

  /*
    RETRATO DOS FATOS no instante do alerta — não o estágio derivado.

    A derivação de estágio do marco mora em `milestone-stage.ts` e é testada
    lá. Reescrevê-la num CASE WHEN aqui criaria uma SEGUNDA máquina de estado,
    em outra linguagem, que divergiria da primeira no dia em que alguém
    corrigisse uma e esquecesse a outra — e o resultado seria um e-mail dizendo
    "Elegível para faturar" sobre um marco que a tela mostra "Em aceite".

    Então o alerta guarda os FATOS que aquela derivação consome, e quem
    renderiza a mensagem chama a derivação canônica sobre este retrato. O
    retrato é o que torna o alerta história: um aviso de 30 dias atrás continua
    contando a situação daquele dia, não a de hoje.
  */
  facts_snapshot    jsonb NOT NULL,
  amount            numeric(18,2),
  currency          text,
  policy_source     text NOT NULL CHECK (policy_source IN ('default','organization','contract')),

  generated_at      timestamptz NOT NULL DEFAULT now(),
  as_of_date        date NOT NULL,

  CONSTRAINT cbma_idempotent UNIQUE (organization_id, milestone_id, planned_date, offset_days),
  CONSTRAINT cbma_contract_tenant FOREIGN KEY (organization_id, contract_id)
    REFERENCES public.contracts (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT cbma_milestone_tenant FOREIGN KEY (organization_id, milestone_id)
    REFERENCES public.contract_milestones (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT cbma_org_id_unique UNIQUE (organization_id, id),
  -- Vencido usa o sentinela -1; antecedência é sempre >= 0.
  CONSTRAINT cbma_offset_coherent CHECK (
    (kind = 'OVERDUE'  AND offset_days = -1)
    OR (kind = 'DUE_TODAY' AND offset_days = 0)
    OR (kind = 'UPCOMING'  AND offset_days > 0))
);

CREATE INDEX IF NOT EXISTS cbma_org_planned_idx
  ON public.contract_billing_milestone_alerts (organization_id, planned_date DESC);
CREATE INDEX IF NOT EXISTS cbma_contract_idx
  ON public.contract_billing_milestone_alerts (organization_id, contract_id, generated_at DESC);

COMMENT ON TABLE public.contract_billing_milestone_alerts IS
  'Alerta de marco de faturamento próximo/vencido. A unicidade '
  '(marco, data prevista, antecedência) É a proteção contra duplicata — e '
  'sobrevive a workers concorrentes, que uma checagem de aplicação não '
  'sobreviveria. Reprogramar a data gera alerta novo de propósito.';

-- ---------------------------------------------------------------------------
-- 5) A ENTREGA — por destinatário e por canal
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contract_billing_alert_dispatches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  alert_id           uuid NOT NULL,
  recipient_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient_email    text,
  -- POR QUE esta pessoa recebeu. Sem isso, ninguém consegue auditar depois
  -- por que o gerente do projeto foi avisado e o dono do marco não.
  recipient_role     text NOT NULL CHECK (recipient_role IN
                       ('milestone_owner','measurement_responsible','project_manager',
                        'contract_manager','configured_recipient')),
  channel            text NOT NULL CHECK (channel IN ('in_app','email','whatsapp')),
  /*
    NOT_CONFIGURED é um estado de PRIMEIRA CLASSE, e não uma falha.

    WhatsApp não tem provedor integrado neste produto. Registrar a tentativa
    como 'FAILED' insinuaria que houve tentativa de entrega; registrar como
    'SIMULATED' insinuaria que um dry-run existiu. NOT_CONFIGURED diz a
    verdade: o canal foi pedido, o provedor não existe, nada foi enviado.
  */
  state              text NOT NULL CHECK (state IN
                       ('DELIVERED','SIMULATED','FAILED','NOT_CONFIGURED')),
  provider           text,
  notification_id    uuid,
  email_dispatch_id  uuid,
  error_message      text,
  dispatched_at      timestamptz NOT NULL DEFAULT now(),

  -- Mesma pessoa, mesmo canal, mesmo alerta: uma vez só.
  CONSTRAINT cbad_idempotent UNIQUE (organization_id, alert_id, recipient_user_id, channel),
  CONSTRAINT cbad_alert_tenant FOREIGN KEY (organization_id, alert_id)
    REFERENCES public.contract_billing_milestone_alerts (organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS cbad_alert_idx
  ON public.contract_billing_alert_dispatches (organization_id, alert_id);

COMMENT ON TABLE public.contract_billing_alert_dispatches IS
  'Entrega do alerta, uma linha por destinatário × canal, com o PAPEL que '
  'justificou o envio. NOT_CONFIGURED registra canal pedido sem provedor '
  'integrado (WhatsApp) sem fingir tentativa de entrega.';

-- ---------------------------------------------------------------------------
-- 6) RLS — leitura pelo inquilino, escrita só por função de servidor
-- ---------------------------------------------------------------------------
/*
  O padrão desta base: `authenticated` LÊ o que é da sua organização e não
  ESCREVE nada diretamente. Alerta materializado por navegador seria alerta que
  o usuário pode fabricar — e um aviso fabricado de "marco vencido" custa uma
  ligação para o cliente.

  A política de cadência é a única exceção parcial: declará-la é um ato de
  gestão, e ainda assim passa por permissão explícita de edição de contratos.
*/
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'contract_billing_schedule_reprogrammings',
    'contract_billing_milestone_alerts',
    'contract_billing_alert_dispatches',
    'contract_billing_alert_policies'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ('
      '  organization_id = public.current_user_organization_id()'
      '  AND (public.current_user_has_permission(''contracts.view'')'
      '       OR public.current_user_is_admin()))',
      t || '_read', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM authenticated, anon', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END $$;

/*
  A notificação in-app do alerta é lida pelo DESTINATÁRIO, que pode não ter
  `contracts.view` — um responsável por medição em Projetos, por exemplo. Ele
  lê a notificação pela RLS de `notifications` (recipient_user_id = auth.uid()),
  que já existe desde a 026. Esta migration NÃO afrouxa `contracts.view` para
  cobrir esse caso: o alerta chega pelo canal do destinatário, não por um
  privilégio novo em Contratos.
*/

COMMIT;
