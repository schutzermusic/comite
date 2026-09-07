-- ============================================================
-- Fase 7 — 138: CONTAS A RECEBER CANÔNICO, LIQUIDAÇÃO E CONCILIAÇÃO
-- ============================================================
--
-- ─── Por que um sucessor canônico, e não `apar_title` estendido ──────────
--
-- A §36 manda auditar antes de declarar `apar_title` canônico. A auditoria:
--
--   · sem `organization_id` (corrigido pela 135, mas o resto continua);
--   · aponta para `client`/`supplier` LEGADOS — a §8 congela `parties`;
--   · `project_id uuid` contra `projects.id text`: referência impossível;
--   · `paid_amount_cents` MUTÁVEL como verdade primária — a §45 proíbe;
--   · sem parcelas, sem base de valor, sem procedência fiscal, sem liquidação;
--   · ZERO linhas, e ZERO caminho de escrita na aplicação (o módulo de
--     Finanças é, hoje, servido por dados em memória).
--
-- Estender `apar_title` até virar isto mudaria o significado de metade das
-- colunas e deixaria a outra metade mentindo. A §36 autoriza o sucessor e a
-- §128 diz como conviver: o caminho NOVO (Contrato/Fiscal → Recebível) é o
-- canônico; fluxos manuais/ERP seguem em `apar_title`, que a 135 endureceu e
-- que não é ampliado aqui. Não há escrita dupla: nada nesta migration escreve
-- em `apar_title`.
--
-- ─── A base do valor NÃO é escolhida por esta migration (§40) ────────────
--
-- A §40 é a regra mais afiada da fase: `service_amount_cents` NÃO é,
-- automaticamente, o valor a receber em caixa — retenção de imposto, deduções
-- e descontos mudam o que entra. E a §140 manda PARAR se a semântica bruto vs.
-- líquido for desconhecida.
--
-- O que se faz aqui não é escolher: é obrigar a escolha a ser DECLARADA. Sem
-- linha em `finance_receivable_basis_policies`, a criação de recebível recusa
-- com `AR_BASIS_UNCONFIGURED` e nada é criado. A base passa a ser configuração
-- financeira governada, com justificativa e autor — que é o oposto de um
-- `COALESCE` escolhendo em silêncio.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1) A BASE DO VALOR — declarada, nunca inferida (§40)
-- ------------------------------------------------------------
CREATE TABLE public.finance_receivable_basis_policies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Nulo = política da organização. Preenchido = política daquele contrato,
  -- que vence a geral. Retenção contratual difere por cliente na vida real.
  contract_id      uuid,

  basis            text NOT NULL CHECK (basis IN (
    -- Valor do serviço, cheio. O tomador retém e recolhe; o título continua
    -- pelo bruto e a retenção aparece como abatimento no recebimento.
    'GROSS_SERVICE_AMOUNT',
    -- Bruto menos retenções na fonte: o que efetivamente entra em caixa.
    'NET_OF_WITHHOLDING',
    -- Também menos deduções e descontos incondicionais.
    'NET_OF_WITHHOLDING_AND_DISCOUNTS')),

  justification    text NOT NULL CHECK (btrim(justification) <> ''),
  effective_from   date NOT NULL DEFAULT current_date,
  effective_until  date,
  active           boolean NOT NULL DEFAULT true,
  declared_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT frbp_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT frbp_contract_tenant FOREIGN KEY (organization_id, contract_id)
    REFERENCES public.contracts (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT frbp_window CHECK (effective_until IS NULL OR effective_until >= effective_from)
);

COMMENT ON TABLE public.finance_receivable_basis_policies IS
  'Qual valor do documento fiscal é o RECEBÍVEL em caixa. A §40 proíbe supor: '
  'sem linha vigente, a criação de recebível recusa. Nasce VAZIA — declarar '
  'uma base por conta própria seria decidir tributação alheia.';

CREATE UNIQUE INDEX frbp_active_org ON public.finance_receivable_basis_policies (organization_id)
  WHERE active AND contract_id IS NULL;
CREATE UNIQUE INDEX frbp_active_contract ON public.finance_receivable_basis_policies
  (organization_id, contract_id) WHERE active AND contract_id IS NOT NULL;

ALTER TABLE public.finance_receivable_basis_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY frbp_select ON public.finance_receivable_basis_policies FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id());
CREATE POLICY frbp_write ON public.finance_receivable_basis_policies FOR ALL TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND public.has_finance_role_or_perm('finance_admin', 'finance.admin'))
  WITH CHECK (organization_id = public.current_user_organization_id()
         AND public.has_finance_role_or_perm('finance_admin', 'finance.admin'));

-- ------------------------------------------------------------
-- 2) Mapeamento contábil — configuração, nunca palpite (§42)
-- ------------------------------------------------------------
CREATE TABLE public.finance_posting_rules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purpose          text NOT NULL CHECK (purpose IN ('AR_RECOGNITION','AR_SETTLEMENT')),
  contract_id      uuid,
  category_id      uuid NOT NULL REFERENCES public.management_category(id) ON DELETE RESTRICT,
  cost_center_id   uuid NOT NULL,
  business_unit_id uuid NOT NULL,
  active           boolean NOT NULL DEFAULT true,
  declared_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  justification    text NOT NULL CHECK (btrim(justification) <> ''),
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fpr_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT fpr_contract_tenant FOREIGN KEY (organization_id, contract_id)
    REFERENCES public.contracts (organization_id, id) ON DELETE CASCADE,
  -- Centro de custo CANÔNICO (§9). `cost_center` legado não entra: expandi-lo
  -- como se fosse canônico é o que a §9 proíbe.
  CONSTRAINT fpr_cc_tenant FOREIGN KEY (organization_id, cost_center_id)
    REFERENCES public.finance_cost_centers (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT fpr_bu_tenant FOREIGN KEY (organization_id, business_unit_id)
    REFERENCES public.business_unit (organization_id, id) ON DELETE RESTRICT
);
COMMENT ON TABLE public.finance_posting_rules IS
  'Mapeamento contábil do lançamento automático. Nasce VAZIA: a §42 manda '
  'BLOQUEAR o lançamento por falta de configuração, e proíbe inventar '
  'categoria, centro de custo ou unidade para o smoke passar.';
CREATE UNIQUE INDEX fpr_active_org ON public.finance_posting_rules (organization_id, purpose)
  WHERE active AND contract_id IS NULL;
CREATE UNIQUE INDEX fpr_active_contract ON public.finance_posting_rules
  (organization_id, purpose, contract_id) WHERE active AND contract_id IS NOT NULL;
ALTER TABLE public.finance_posting_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY fpr_select ON public.finance_posting_rules FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id());
CREATE POLICY fpr_write ON public.finance_posting_rules FOR ALL TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND public.has_finance_role_or_perm('finance_admin', 'finance.admin'))
  WITH CHECK (organization_id = public.current_user_organization_id()
         AND public.has_finance_role_or_perm('finance_admin', 'finance.admin'));

-- ------------------------------------------------------------
-- 3) O RECEBÍVEL CANÔNICO
-- ------------------------------------------------------------
CREATE TABLE public.finance_receivables (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Contraparte CANÔNICA (§8). `parties`, obrigatória, com FK de mesmo
  -- inquilino. Nome de cliente não identifica ninguém, e casar nome com parte
  -- é o matching difuso que a §8 e a §140 vetam.
  party_id           uuid NOT NULL,

  contract_id        uuid,
  -- `text`, porque `projects.id` é `text`. A coluna legada de `apar_title` é
  -- `uuid` e nunca pôde referenciar projeto nenhum; aqui a FK é real.
  project_id         text,
  billing_event_id   uuid,
  fiscal_document_id uuid,

  currency           text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),

  -- ---- a base do valor, EXPLÍCITA na própria linha (§40) ----
  amount_basis       text NOT NULL CHECK (amount_basis IN (
    'GROSS_SERVICE_AMOUNT','NET_OF_WITHHOLDING','NET_OF_WITHHOLDING_AND_DISCOUNTS')),
  basis_policy_id    uuid,
  -- O valor autoritativo do título. Tudo o mais é composição registrada para
  -- que a conta seja auditável sem reabrir a nota.
  original_amount_cents bigint NOT NULL CHECK (original_amount_cents > 0),
  gross_amount_cents    bigint NOT NULL CHECK (gross_amount_cents > 0),
  withheld_amount_cents bigint NOT NULL DEFAULT 0 CHECK (withheld_amount_cents >= 0),
  deductions_cents      bigint NOT NULL DEFAULT 0 CHECK (deductions_cents >= 0),
  discounts_cents       bigint NOT NULL DEFAULT 0 CHECK (discounts_cents >= 0),

  issue_date         date NOT NULL,
  competence_date    date,

  /*
    Estado de CICLO DE VIDA — e só ele. Aberto, parcial, pago e vencido NÃO
    moram aqui: são DERIVADOS das liquidações e da data (§54, §55). Guardar
    'PAID' numa coluna convida ao esquecimento que a §54 descreve — o título
    que ninguém atualizou depois do pagamento.
  */
  lifecycle_state    text NOT NULL DEFAULT 'ACTIVE'
                       CHECK (lifecycle_state IN ('ACTIVE','CANCELLED','REVERSED','RENEGOTIATED')),
  closed_at          timestamptz,
  closed_reason      text,
  supersedes_id      uuid,
  superseded_by_id   uuid,

  -- ---- contabilidade: estado próprio, nunca confundido com AR (§130, §131) ----
  ledger_posting_state text NOT NULL DEFAULT 'NOT_POSTED'
    CHECK (ledger_posting_state IN ('NOT_POSTED','PENDING_CONFIGURATION','POSTED','REVERSED','ERROR')),
  ledger_entry_id    uuid,
  ledger_blockers    jsonb NOT NULL DEFAULT '[]'::jsonb
                       CHECK (jsonb_typeof(ledger_blockers) = 'array'),

  cost_center_id     uuid,
  business_unit_id   uuid,

  source_system      text NOT NULL DEFAULT 'fiscal_bridge',
  external_key       text,
  correlation_id     uuid,
  source_event_id    uuid,
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fr_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT fr_party_tenant FOREIGN KEY (organization_id, party_id)
    REFERENCES public.parties (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT fr_contract_tenant FOREIGN KEY (organization_id, contract_id)
    REFERENCES public.contracts (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT fr_project_tenant FOREIGN KEY (organization_id, project_id)
    REFERENCES public.projects (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT fr_billing_tenant FOREIGN KEY (organization_id, billing_event_id)
    REFERENCES public.contract_billing_events (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT fr_document_tenant FOREIGN KEY (organization_id, fiscal_document_id)
    REFERENCES public.fiscal_documents (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT fr_basis_tenant FOREIGN KEY (organization_id, basis_policy_id)
    REFERENCES public.finance_receivable_basis_policies (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT fr_cc_tenant FOREIGN KEY (organization_id, cost_center_id)
    REFERENCES public.finance_cost_centers (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT fr_bu_tenant FOREIGN KEY (organization_id, business_unit_id)
    REFERENCES public.business_unit (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT fr_ledger_tenant FOREIGN KEY (organization_id, ledger_entry_id)
    REFERENCES public.ledger_entry (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT fr_supersedes_tenant FOREIGN KEY (organization_id, supersedes_id)
    REFERENCES public.finance_receivables (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT fr_superseded_tenant FOREIGN KEY (organization_id, superseded_by_id)
    REFERENCES public.finance_receivables (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT fr_no_self_supersession CHECK (
    supersedes_id IS DISTINCT FROM id AND superseded_by_id IS DISTINCT FROM id),
  CONSTRAINT fr_closed_coherent CHECK ((lifecycle_state = 'ACTIVE') = (closed_at IS NULL)),
  CONSTRAINT fr_posted_has_entry CHECK (ledger_posting_state <> 'POSTED' OR ledger_entry_id IS NOT NULL)
);

COMMENT ON TABLE public.finance_receivables IS
  'Contas a Receber CANÔNICO da Fase 7: estruturalmente por inquilino, com '
  'contraparte em `parties`, base de valor EXPLÍCITA e sem valor pago mutável. '
  'Pago, aberto e vencido são derivados de finance_settlements (§45, §54).';
COMMENT ON COLUMN public.finance_receivables.amount_basis IS
  'A §40 exige base explícita. Vem de finance_receivable_basis_policies, é '
  'congelada na criação e fica visível na linha — quem lê o título sabe se '
  'aquele número é bruto ou líquido sem consultar ninguém.';

/*
  IDEMPOTÊNCIA FISCAL → AR (§38, §110).

  Um documento fiscal autorizado gera UM recebível vivo. A reentrega do fato,
  que a §67 garante que vai acontecer, não gera o segundo. O índice é PARCIAL
  porque um título revertido/cancelado deve poder ser substituído por outro —
  é o que a substituição de nota e a renegociação precisam.
*/
CREATE UNIQUE INDEX fr_document_unique ON public.finance_receivables
  (organization_id, fiscal_document_id)
  WHERE fiscal_document_id IS NOT NULL AND lifecycle_state = 'ACTIVE';

CREATE INDEX fr_org_party    ON public.finance_receivables (organization_id, party_id);
CREATE INDEX fr_org_contract ON public.finance_receivables (organization_id, contract_id)
  WHERE contract_id IS NOT NULL;
CREATE INDEX fr_org_billing  ON public.finance_receivables (organization_id, billing_event_id)
  WHERE billing_event_id IS NOT NULL;
CREATE INDEX fr_org_active   ON public.finance_receivables (organization_id, lifecycle_state, issue_date DESC);
CREATE INDEX fr_ledger_state ON public.finance_receivables (organization_id, ledger_posting_state)
  WHERE ledger_posting_state <> 'POSTED';

ALTER TABLE public.finance_receivables ENABLE ROW LEVEL SECURITY;
CREATE POLICY fr_select ON public.finance_receivables FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.has_finance_role_or_perm('finance_admin','finance.admin')
           OR public.has_finance_role_or_perm('finance_analyst','finance.edit')
           OR public.current_user_has_permission('finance.view')
           OR (contract_id IS NOT NULL AND public.current_user_can_read_contract(contract_id))));
/*
  ZERO política de escrita, e é deliberado: o navegador não cria, não altera e
  não apaga recebível. Tudo passa pelas funções de Finanças abaixo, que são
  SECURITY DEFINER e verificam ator, inquilino e permissão. A §69 pede
  exatamente isso, e a ausência de grant é fronteira mais forte que política.
*/
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.finance_receivables FROM anon, authenticated;
CREATE TRIGGER fr_no_erasure BEFORE DELETE ON public.finance_receivables
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

-- ------------------------------------------------------------
-- 4) Parcelas (§39, §80)
-- ------------------------------------------------------------
CREATE TABLE public.finance_receivable_installments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  receivable_id    uuid NOT NULL,
  sequence         integer NOT NULL CHECK (sequence > 0),
  due_date         date NOT NULL,
  original_amount_cents bigint NOT NULL CHECK (original_amount_cents > 0),
  currency         text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  -- De onde veio o vencimento. A §39 proíbe inventar data a partir de
  -- `payment_terms` em texto livre; se a origem não for autoritativa, a
  -- parcela não nasce.
  due_date_source  text NOT NULL CHECK (due_date_source IN (
    'FISCAL_DOCUMENT_DUE_DATE','STRUCTURED_PAYMENT_TERM','MANUAL_GOVERNED')),
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fri_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT fri_receivable_tenant FOREIGN KEY (organization_id, receivable_id)
    REFERENCES public.finance_receivables (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fri_sequence_unique UNIQUE (organization_id, receivable_id, sequence)
);
CREATE INDEX fri_due ON public.finance_receivable_installments (organization_id, due_date);
ALTER TABLE public.finance_receivable_installments ENABLE ROW LEVEL SECURITY;
CREATE POLICY fri_select ON public.finance_receivable_installments FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND EXISTS (SELECT 1 FROM public.finance_receivables r WHERE r.id = receivable_id));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.finance_receivable_installments
  FROM anon, authenticated;

/*
  CONSERVAÇÃO DE CENTAVO (§80). A soma das parcelas é o total do título — não
  "aproximadamente". A checagem roda por gatilho de statement, DEPOIS de o
  conjunto inteiro ter sido inserido: por linha ela reprovaria a primeira
  parcela de três, que é correta e ainda não soma o total.
*/
CREATE FUNCTION public.finance_installments_conserve_total() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE bad record;
BEGIN
  FOR bad IN
    SELECT r.id, r.original_amount_cents, COALESCE(sum(i.original_amount_cents), 0) AS parts
      FROM public.finance_receivables r
      JOIN public.finance_receivable_installments i ON i.receivable_id = r.id
     GROUP BY r.id, r.original_amount_cents
    HAVING COALESCE(sum(i.original_amount_cents), 0) <> r.original_amount_cents
  LOOP
    RAISE EXCEPTION
      'CENT_DRIFT: parcelas do recebível % somam % e o título vale % (§80).',
      bad.id, bad.parts, bad.original_amount_cents USING ERRCODE = 'check_violation';
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.finance_installments_conserve_total() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER fri_conserve_total
  AFTER INSERT OR UPDATE OR DELETE ON public.finance_receivable_installments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.finance_installments_conserve_total();

-- ------------------------------------------------------------
-- 5) FONTE DE PAGAMENTO — a evidência bancária (§51, §52)
-- ------------------------------------------------------------
CREATE TABLE public.finance_payment_sources (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_kind      text NOT NULL CHECK (source_kind IN (
    'OFX','CNAB','BANK_API','ERP_IMPORT','PAYMENT_PROVIDER','MANUAL_BANK_PROOF')),
  -- Identificador ESTÁVEL do banco/provedor. É a chave de deduplicação
  -- preferida da §52: reimportar o mesmo extrato não duplica nada.
  external_transaction_id text,
  -- Quando não há id estável, uma impressão determinística do conteúdo. A §52
  -- exige tratamento de colisão: duas linhas idênticas de verdade colidem, e
  -- colisão vai para revisão em vez de virar dois recebimentos.
  fingerprint      text NOT NULL,
  amount_cents     bigint NOT NULL CHECK (amount_cents > 0),
  currency         text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  value_date       date NOT NULL,
  payer_name       text,
  payer_document   text,
  bank_reference   text,
  import_batch_id  uuid,
  raw_reference    text,
  imported_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  imported_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fps_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT fps_fingerprint_unique UNIQUE (organization_id, fingerprint)
);
COMMENT ON TABLE public.finance_payment_sources IS
  'Evidência de caixa vinda de fonte externa, com identidade estável. É contra '
  'ela que se concilia. Sem linha aqui, não há conciliação real — e a §50 '
  'proíbe fabricar confirmação bancária.';
CREATE UNIQUE INDEX fps_external_unique ON public.finance_payment_sources
  (organization_id, source_kind, external_transaction_id)
  WHERE external_transaction_id IS NOT NULL;
CREATE INDEX fps_date ON public.finance_payment_sources (organization_id, value_date DESC);
ALTER TABLE public.finance_payment_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY fps_select ON public.finance_payment_sources FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.has_finance_role_or_perm('finance_admin','finance.admin')
           OR public.has_finance_role_or_perm('finance_analyst','finance.edit')
           OR public.current_user_has_permission('finance.view')));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.finance_payment_sources FROM anon, authenticated;

-- ------------------------------------------------------------
-- 6) LIQUIDAÇÃO — append-only, a verdade do recebido (§44, §45)
-- ------------------------------------------------------------
CREATE TABLE public.finance_settlements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  receivable_id    uuid NOT NULL,
  installment_id   uuid,

  kind             text NOT NULL DEFAULT 'PAYMENT' CHECK (kind IN ('PAYMENT','REVERSAL')),
  amount_cents     bigint NOT NULL CHECK (amount_cents > 0),
  currency         text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  effective_date   date NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now(),

  source           text NOT NULL CHECK (source IN (
    'BANK_IMPORT','PAYMENT_PROVIDER','MANUAL_ENTRY','ERP_IMPORT','REVERSAL')),
  payment_source_id uuid,
  external_reference text,

  -- Estorno aponta para a liquidação que desfaz. Não é UPDATE: a §82 manda
  -- corrigir por reversão, e uma linha que some não deixa rastro de ter sido.
  reversal_of      uuid,
  reversal_reason  text,

  actor_user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_source     text NOT NULL DEFAULT 'human'
                     CHECK (actor_source IN ('human','system','integration','provider')),
  correlation_id   uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fs_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT fs_receivable_tenant FOREIGN KEY (organization_id, receivable_id)
    REFERENCES public.finance_receivables (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT fs_installment_tenant FOREIGN KEY (organization_id, installment_id)
    REFERENCES public.finance_receivable_installments (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT fs_payment_source_tenant FOREIGN KEY (organization_id, payment_source_id)
    REFERENCES public.finance_payment_sources (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT fs_reversal_tenant FOREIGN KEY (organization_id, reversal_of)
    REFERENCES public.finance_settlements (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT fs_no_self_reversal CHECK (reversal_of IS DISTINCT FROM id),
  CONSTRAINT fs_reversal_coherent CHECK ((kind = 'REVERSAL') = (reversal_of IS NOT NULL)),
  -- Uma liquidação é estornada UMA vez. Duas reversões da mesma linha
  -- reabririam o saldo duas vezes.
  CONSTRAINT fs_reversal_unique UNIQUE (organization_id, reversal_of)
);

COMMENT ON TABLE public.finance_settlements IS
  'História autoritativa do recebido. APPEND-ONLY: sem UPDATE, sem DELETE. '
  'Estorno é linha nova apontando para a original (§44, §57, §82).';

CREATE INDEX fs_receivable ON public.finance_settlements (organization_id, receivable_id, effective_date);
CREATE INDEX fs_source     ON public.finance_settlements (organization_id, payment_source_id)
  WHERE payment_source_id IS NOT NULL;

ALTER TABLE public.finance_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY fs_select ON public.finance_settlements FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.has_finance_role_or_perm('finance_admin','finance.admin')
           OR public.has_finance_role_or_perm('finance_analyst','finance.edit')
           OR public.current_user_has_permission('finance.view')));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.finance_settlements FROM anon, authenticated;

/*
  REESCRITA e APAGAMENTO têm fronteiras DIFERENTES, e a diferença é deliberada.

  Reescrever é recusado para TODO papel, dono do banco incluído: não existe
  caso legítimo em que o valor de um recebimento passado muda de número. Quem
  errou estorna, e o estorno é uma linha nova que preserva as duas verdades.

  Apagar estreita para o caminho privilegiado, exatamente como a migration 110
  desenhou para a história contratual. A aplicação nunca apaga liquidação; a
  exclusão de um inquilino inteiro — que existe, e que precisa levar a Finança
  dele junto — continua possível para quem opera o banco. Recusar as duas
  igualmente tornaria a organização indeletável, o que não é integridade: é um
  vazamento de dados com outro nome.
*/
CREATE FUNCTION public.finance_settlements_no_rewrite() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Liquidação é append-only: estorne com uma linha nova, não reescreva (§44).'
    USING ERRCODE = 'check_violation';
END $$;
REVOKE ALL ON FUNCTION public.finance_settlements_no_rewrite() FROM PUBLIC;
CREATE TRIGGER fs_no_update BEFORE UPDATE ON public.finance_settlements
  FOR EACH ROW EXECUTE FUNCTION public.finance_settlements_no_rewrite();
CREATE TRIGGER fs_no_delete BEFORE DELETE ON public.finance_settlements
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

-- ------------------------------------------------------------
-- 7) SALDOS DERIVADOS (§45, §46, §54, §55)
-- ------------------------------------------------------------
/*
  Pago, recebido, aberto e vencido são CALCULADOS. Nenhuma coluna guarda o
  saldo, e por isso nenhum saldo pode ficar desatualizado por esquecimento —
  que é o defeito que a §54 nomeia e que `apar_title.paid_amount_cents` tinha
  por construção.

  A conta: soma dos PAGAMENTOS, menos a soma dos pagamentos que foram
  ESTORNADOS. O estorno não é uma linha negativa (o CHECK exige valor > 0):
  ele anula a original, e a original volta a não contar. Somar negativo daria
  o mesmo número e perderia a informação de QUAL pagamento caiu.
*/
CREATE VIEW public.finance_receivable_balances
WITH (security_invoker = true) AS
WITH paid AS (
  SELECT s.receivable_id,
         sum(s.amount_cents) FILTER (
           WHERE s.kind = 'PAYMENT'
             AND NOT EXISTS (SELECT 1 FROM public.finance_settlements r
                              WHERE r.reversal_of = s.id)) AS paid_cents,
         count(*) FILTER (WHERE s.kind = 'PAYMENT') AS payment_count,
         count(*) FILTER (WHERE s.kind = 'REVERSAL') AS reversal_count,
         max(s.effective_date) FILTER (
           WHERE s.kind = 'PAYMENT'
             AND NOT EXISTS (SELECT 1 FROM public.finance_settlements r
                              WHERE r.reversal_of = s.id)) AS last_payment_date
    FROM public.finance_settlements s
   GROUP BY s.receivable_id
)
SELECT
  r.id                AS receivable_id,
  r.organization_id,
  r.currency,
  r.amount_basis,
  r.original_amount_cents,
  COALESCE(p.paid_cents, 0)::bigint AS paid_amount_cents,
  -- `GREATEST(...,0)` NÃO é uma rede de segurança escondendo estouro: a função
  -- de liquidação RECUSA pagamento acima do saldo (§47), então o caso não
  -- ocorre. Ele existe para que uma correção manual futura no banco não
  -- produza saldo negativo silencioso numa tela (§47).
  GREATEST(r.original_amount_cents - COALESCE(p.paid_cents, 0), 0)::bigint AS open_amount_cents,
  COALESCE(p.payment_count, 0)  AS payment_count,
  COALESCE(p.reversal_count, 0) AS reversal_count,
  p.last_payment_date,
  (SELECT min(i.due_date) FROM public.finance_receivable_installments i
    WHERE i.receivable_id = r.id) AS first_due_date,
  (SELECT max(i.due_date) FROM public.finance_receivable_installments i
    WHERE i.receivable_id = r.id) AS last_due_date,
  CASE
    WHEN r.lifecycle_state = 'CANCELLED'    THEN 'CANCELLED'
    WHEN r.lifecycle_state = 'REVERSED'     THEN 'REVERSED'
    WHEN r.lifecycle_state = 'RENEGOTIATED' THEN 'RENEGOTIATED'
    WHEN COALESCE(p.paid_cents, 0) >= r.original_amount_cents THEN 'PAID'
    -- Vencido é DERIVADO da data, e o pagamento o limpa sozinho (§55): não há
    -- rotina que "marca vencido", logo não há rotina que esqueça de desmarcar.
    WHEN EXISTS (SELECT 1 FROM public.finance_receivable_installments i
                  WHERE i.receivable_id = r.id AND i.due_date < current_date)
         AND COALESCE(p.paid_cents, 0) < r.original_amount_cents THEN 'OVERDUE'
    WHEN COALESCE(p.paid_cents, 0) > 0 THEN 'PARTIAL'
    ELSE 'OPEN'
  END AS derived_status
FROM public.finance_receivables r
LEFT JOIN paid p ON p.receivable_id = r.id;

COMMENT ON VIEW public.finance_receivable_balances IS
  'Pago, aberto e status DERIVADOS das liquidações válidas (§45, §54, §55). '
  'Nenhuma coluna materializa saldo: saldo materializado é saldo que envelhece.';

-- `security_invoker` faz a RLS de `finance_receivables` e `finance_settlements`
-- valer para quem consulta a visão. Sem isso a visão seria um contorno da RLS.
GRANT SELECT ON public.finance_receivable_balances TO authenticated;

-- ------------------------------------------------------------
-- 8) CONCILIAÇÃO — distinta de pagamento (§49, §53)
-- ------------------------------------------------------------
/*
  Registrar pagamento responde "alguém disse que pagou".
  Conciliar responde "o banco confirma que entrou".

  São perguntas diferentes e por isso são tabelas diferentes. Colapsar as duas
  faz um sistema em que um lançamento manual otimista vira caixa confirmado — e
  ninguém percebe até o fechamento.
*/
CREATE TABLE public.finance_reconciliations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  settlement_id    uuid NOT NULL,
  payment_source_id uuid NOT NULL,

  state            text NOT NULL CHECK (state IN (
    'MATCHED','PARTIAL','MISMATCH','REVIEW_REQUIRED','RECONCILED','REVERSED')),
  /*
    COMO se chegou ao par. `DETERMINISTIC_SOURCE_ID` é o único que a §53
    autoriza a fechar sozinho. `FUZZY_PROPOSAL` NUNCA aparece aqui — proposta
    difusa mora na tabela de candidatos, e o CHECK abaixo é o que impede que
    ela chegue.
  */
  match_kind       text NOT NULL CHECK (match_kind IN ('DETERMINISTIC_SOURCE_ID','MANUAL_GOVERNED')),
  matched_amount_cents bigint NOT NULL CHECK (matched_amount_cents > 0),
  difference_cents bigint NOT NULL DEFAULT 0,

  evidence_reference text,
  note             text,
  reconciled_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_source     text NOT NULL DEFAULT 'system'
                     CHECK (actor_source IN ('human','system','integration')),
  reversal_of      uuid,
  reversal_reason  text,
  correlation_id   uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT frec_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT frec_settlement_tenant FOREIGN KEY (organization_id, settlement_id)
    REFERENCES public.finance_settlements (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT frec_source_tenant FOREIGN KEY (organization_id, payment_source_id)
    REFERENCES public.finance_payment_sources (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT frec_reversal_tenant FOREIGN KEY (organization_id, reversal_of)
    REFERENCES public.finance_reconciliations (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT frec_no_self_reversal CHECK (reversal_of IS DISTINCT FROM id),
  -- Conciliação MANUAL exige pessoa: sem ator, quem conciliou foi ninguém.
  CONSTRAINT frec_manual_has_actor CHECK (
    match_kind <> 'MANUAL_GOVERNED' OR reconciled_by IS NOT NULL)
);
COMMENT ON TABLE public.finance_reconciliations IS
  'Conferência da liquidação contra evidência de caixa. Só '
  'DETERMINISTIC_SOURCE_ID e MANUAL_GOVERNED fecham; casamento difuso é '
  'proposta e vive em finance_reconciliation_candidates (§53).';

CREATE UNIQUE INDEX frec_active_pair ON public.finance_reconciliations
  (organization_id, settlement_id, payment_source_id)
  WHERE state <> 'REVERSED';
CREATE INDEX frec_open ON public.finance_reconciliations (organization_id, state)
  WHERE state IN ('REVIEW_REQUIRED','MISMATCH','PARTIAL');

ALTER TABLE public.finance_reconciliations ENABLE ROW LEVEL SECURITY;
CREATE POLICY frec_select ON public.finance_reconciliations FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.has_finance_role_or_perm('finance_admin','finance.admin')
           OR public.has_finance_role_or_perm('finance_analyst','finance.edit')
           OR public.current_user_has_permission('finance.view')));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.finance_reconciliations FROM anon, authenticated;
CREATE TRIGGER frec_no_erasure BEFORE DELETE ON public.finance_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

/*
  CANDIDATOS DIFUSOS — proposta, e só (§53).

  Tabela separada, e não um `state = 'PROPOSAL'` na de cima, porque a separação
  é ESTRUTURAL: nenhuma consulta de "o que está conciliado" pode alcançar uma
  proposta por engano, nem que alguém escreva o filtro errado. Promover uma
  proposta exige ato humano, que grava linha em `finance_reconciliations` com
  `match_kind = 'MANUAL_GOVERNED'` e ator.
*/
CREATE TABLE public.finance_reconciliation_candidates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payment_source_id uuid NOT NULL,
  receivable_id    uuid,
  settlement_id    uuid,
  score            numeric(5,4) NOT NULL CHECK (score >= 0 AND score <= 1),
  rationale        jsonb NOT NULL DEFAULT '{}'::jsonb,
  state            text NOT NULL DEFAULT 'MATCH_CANDIDATE'
                     CHECK (state IN ('MATCH_CANDIDATE','ACCEPTED','DISMISSED')),
  decided_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT frcand_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT frcand_source_tenant FOREIGN KEY (organization_id, payment_source_id)
    REFERENCES public.finance_payment_sources (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT frcand_receivable_tenant FOREIGN KEY (organization_id, receivable_id)
    REFERENCES public.finance_receivables (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT frcand_settlement_tenant FOREIGN KEY (organization_id, settlement_id)
    REFERENCES public.finance_settlements (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT frcand_decided_coherent CHECK (
    (state = 'MATCH_CANDIDATE') = (decided_at IS NULL))
);
COMMENT ON TABLE public.finance_reconciliation_candidates IS
  'PROPOSTA de casamento por semelhança. Nunca fecha conciliação: a §53 '
  'reserva o fechamento automático a regra determinística congelada por '
  'Finanças. Tabela separada para que nenhum filtro errado a confunda com '
  'conciliação real.';
CREATE INDEX frcand_open ON public.finance_reconciliation_candidates
  (organization_id, state) WHERE state = 'MATCH_CANDIDATE';
ALTER TABLE public.finance_reconciliation_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY frcand_select ON public.finance_reconciliation_candidates FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id());
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.finance_reconciliation_candidates
  FROM anon, authenticated;

-- ------------------------------------------------------------
-- 9) FISCAL AUTORIZADO → CONTAS A RECEBER (§38, §92, §110)
-- ------------------------------------------------------------
/*
  Finanças é quem cria. O gatilho da 137 gravou o FATO; este é o consumidor
  dele, e ele mora do lado de Finanças de propósito — a §35 dá a AR a Finanças,
  e a §41 dá o razão a Finanças.

  A §92 pede que Finanças não redigite número de nota, tomador, contrato, valor
  e vencimento que o documento fiscal já afirma. É o que acontece aqui: tudo
  vem do documento autorizado.

  O que NÃO vem do documento é a BASE do valor. Ela vem da política declarada,
  e sem política nada é criado (§40).
*/
CREATE FUNCTION public.finance_receivable_create_from_fiscal_document(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ev      public.domain_events%ROWTYPE;
  d       public.fiscal_documents%ROWTYPE;
  pol     public.finance_receivable_basis_policies%ROWTYPE;
  billing uuid;
  existing uuid;
  amount  bigint;
  new_id  uuid;
  r       public.finance_receivables%ROWTYPE;
BEGIN
  SELECT * INTO ev FROM public.domain_events WHERE id = p_event_id;
  IF NOT FOUND OR ev.event_type <> 'fiscal.document.authorized' THEN
    RETURN jsonb_build_object('created', false, 'reason', 'NOT_AN_AUTHORIZATION_EVENT');
  END IF;

  SELECT * INTO d FROM public.fiscal_documents
   WHERE id = ev.aggregate_id AND organization_id = ev.organization_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('created', false, 'reason', 'FISCAL_DOCUMENT_NOT_FOUND'); END IF;
  -- Documento que deixou de estar autorizado (cancelado depois) não vira
  -- título retroativamente. O fato é histórico; o estado é o que vale.
  IF d.status <> 'authorized' THEN
    RETURN jsonb_build_object('created', false, 'reason', 'DOCUMENT_NO_LONGER_AUTHORIZED',
                              'status', d.status);
  END IF;

  -- IDEMPOTÊNCIA (§38). Reentrega não duplica título.
  SELECT id INTO existing FROM public.finance_receivables
   WHERE organization_id = d.organization_id AND fiscal_document_id = d.id
     AND lifecycle_state = 'ACTIVE';
  IF existing IS NOT NULL THEN
    RETURN jsonb_build_object('created', false, 'idempotent', true, 'receivable_id', existing);
  END IF;

  SELECT a.billing_event_id INTO billing
    FROM public.contract_billing_fiscal_allocations a
   WHERE a.organization_id = d.organization_id AND a.fiscal_document_id = d.id
     AND a.state = 'ACTIVE' LIMIT 1;

  -- ---- A BASE DO VALOR (§40): declarada ou nada ----
  SELECT * INTO pol FROM public.finance_receivable_basis_policies p
   WHERE p.organization_id = d.organization_id AND p.active
     AND (p.contract_id IS NULL OR p.contract_id = d.contract_id)
     AND p.effective_from <= COALESCE(d.issue_date, current_date)
     AND (p.effective_until IS NULL OR p.effective_until >= COALESCE(d.issue_date, current_date))
   ORDER BY (p.contract_id IS NOT NULL) DESC, p.effective_from DESC
   LIMIT 1;
  IF NOT FOUND THEN
    /*
      A RECUSA DA §40. Escolher `service_amount_cents` aqui seria decidir, por
      conta própria, que o cliente não retém imposto — e a diferença aparece
      meses depois, como um título que nunca fecha.

      `pending_configuration` é o vocabulário que a §130 já definiu para
      exatamente isto, e ele é registrado no documento para que a tela do
      Fiscal diga o motivo sem que ninguém precise abrir log.
    */
    UPDATE public.fiscal_documents SET finance_status = 'pending_configuration'
     WHERE id = d.id AND finance_status = 'not_posted';
    RETURN jsonb_build_object('created', false, 'reason', 'AR_BASIS_UNCONFIGURED',
      'detail', 'Sem política de base de recebível vigente: bruto ou líquido não é inferível (§40).',
      'fiscal_document_id', d.id);
  END IF;

  IF d.due_date IS NULL THEN
    -- A §39 proíbe inventar vencimento a partir de `payment_terms` em texto
    -- livre. Sem data autoritativa, o título não nasce.
    UPDATE public.fiscal_documents SET finance_status = 'pending_configuration'
     WHERE id = d.id AND finance_status = 'not_posted';
    RETURN jsonb_build_object('created', false, 'reason', 'DUE_DATE_UNKNOWN',
      'detail', 'Documento fiscal sem vencimento e sem prazo estruturado (§39).',
      'fiscal_document_id', d.id);
  END IF;

  amount := CASE pol.basis
    WHEN 'GROSS_SERVICE_AMOUNT' THEN d.service_amount_cents
    WHEN 'NET_OF_WITHHOLDING'   THEN d.service_amount_cents - d.withheld_total_cents
    ELSE d.service_amount_cents - d.withheld_total_cents
         - d.deductions_cents - d.unconditional_discount_cents
  END;
  IF amount <= 0 THEN
    RETURN jsonb_build_object('created', false, 'reason', 'AR_AMOUNT_NOT_POSITIVE',
      'basis', pol.basis, 'amount_cents', amount);
  END IF;

  BEGIN
    INSERT INTO public.finance_receivables
      (organization_id, party_id, contract_id, project_id, billing_event_id, fiscal_document_id,
       currency, amount_basis, basis_policy_id, original_amount_cents, gross_amount_cents,
       withheld_amount_cents, deductions_cents, discounts_cents, issue_date, competence_date,
       cost_center_id, business_unit_id, source_system, external_key,
       correlation_id, source_event_id)
    VALUES
      (d.organization_id, d.party_id, d.contract_id, d.project_id, billing, d.id,
       'BRL', pol.basis, pol.id, amount, d.service_amount_cents,
       d.withheld_total_cents, d.deductions_cents,
       d.unconditional_discount_cents + d.conditional_discount_cents,
       COALESCE(d.issue_date, current_date), d.competence_date,
       d.cost_center_id, d.business_unit_id, 'fiscal_bridge',
       'fiscal-document:' || d.id::text, ev.correlation_id, ev.id)
    RETURNING id INTO new_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO existing FROM public.finance_receivables
     WHERE organization_id = d.organization_id AND fiscal_document_id = d.id
       AND lifecycle_state = 'ACTIVE';
    RETURN jsonb_build_object('created', false, 'idempotent', true, 'receivable_id', existing);
  END;

  /*
    UMA parcela, com o vencimento do documento fiscal — que é dado
    autoritativo do Fiscal, não invenção. Prazo estruturado com N parcelas é
    suportado pelo esquema (`sequence`, `STRUCTURED_PAYMENT_TERM`) e não é
    exercido aqui porque não existe, no repositório, nenhuma fonte estruturada
    de parcelamento: `contracts.payment_terms` é texto livre, e a §39 é
    explícita sobre não derivar data dele.
  */
  INSERT INTO public.finance_receivable_installments
    (organization_id, receivable_id, sequence, due_date, original_amount_cents,
     currency, due_date_source)
  VALUES (d.organization_id, new_id, 1, d.due_date, amount, 'BRL', 'FISCAL_DOCUMENT_DUE_DATE');

  SELECT * INTO r FROM public.finance_receivables WHERE id = new_id;

  PERFORM public.emit_domain_event(
    r.organization_id, 'finance.receivable.created', 1, 'finance_receivable', r.id,
    'finance-receivable:' || r.id::text,
    jsonb_build_object('fiscal_document_id', d.id, 'billing_event_id', billing,
      'party_id', r.party_id, 'contract_id', r.contract_id,
      'amount_basis', r.amount_basis, 'original_amount_cents', r.original_amount_cents,
      'currency', r.currency, 'due_date', d.due_date),
    now(), 'system', NULL, ev.correlation_id, ev.id);

  IF billing IS NOT NULL THEN
    INSERT INTO public.contract_billing_event_history
      (organization_id, billing_event_id, transition, detail, actor_source, correlation_id)
    VALUES (r.organization_id, billing, 'receivable_created',
            jsonb_build_object('receivable_id', r.id, 'amount_basis', r.amount_basis,
                               'original_amount_cents', r.original_amount_cents),
            'system', ev.correlation_id);
  END IF;

  RETURN jsonb_build_object('created', true, 'receivable_id', r.id,
                            'amount_basis', r.amount_basis,
                            'original_amount_cents', r.original_amount_cents);
END $$;
REVOKE ALL ON FUNCTION public.finance_receivable_create_from_fiscal_document(uuid)
  FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 10) REGISTRO DE LIQUIDAÇÃO (§46, §47, §111)
-- ------------------------------------------------------------
CREATE FUNCTION public.finance_settlement_record(
  p_receivable_id    uuid,
  p_amount_cents     bigint,
  p_effective_date   date,
  p_source           text,
  p_payment_source_id uuid DEFAULT NULL,
  p_external_reference text DEFAULT NULL,
  p_installment_id   uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r     public.finance_receivables%ROWTYPE;
  bal   record;
  actor uuid := auth.uid();
  s_id  uuid;
  existing uuid;
BEGIN
  -- FOR UPDATE serializa duas liquidações que disputam o mesmo saldo. Sem ele
  -- as duas leriam "aberto 60", as duas passariam na checagem e o título
  -- terminaria pago em 120 (§115).
  SELECT * INTO r FROM public.finance_receivables WHERE id = p_receivable_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RECEIVABLE_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;

  IF actor IS NOT NULL THEN
    IF r.organization_id IS DISTINCT FROM public.current_user_organization_id() THEN
      RAISE EXCEPTION 'RECEIVABLE_NOT_FOUND' USING ERRCODE = 'no_data_found';
    END IF;
    IF NOT (public.current_user_has_permission('finance.settlements.record')
            OR public.has_finance_role_or_perm('finance_admin','finance.admin')
            OR public.current_user_is_admin()) THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: falta a permissão finance.settlements.record.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF r.lifecycle_state <> 'ACTIVE' THEN
    RAISE EXCEPTION 'RECEIVABLE_NOT_ACTIVE: título em % não recebe liquidação.', r.lifecycle_state
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'AMOUNT_MUST_BE_POSITIVE' USING ERRCODE = 'check_violation';
  END IF;

  /*
    IDEMPOTÊNCIA DA IMPORTAÇÃO (§52, §111). A mesma transação bancária não
    liquida duas vezes o mesmo título. A chave é a IDENTIDADE DA FONTE, e não
    o valor: dois pagamentos legítimos de R$ 40 no mesmo dia são dois
    recebimentos, e recusá-los por semelhança perderia dinheiro de verdade.
  */
  IF p_payment_source_id IS NOT NULL THEN
    SELECT id INTO existing FROM public.finance_settlements
     WHERE organization_id = r.organization_id AND receivable_id = r.id
       AND payment_source_id = p_payment_source_id AND kind = 'PAYMENT';
    IF existing IS NOT NULL THEN
      RETURN jsonb_build_object('settlement_id', existing, 'idempotent', true);
    END IF;
  END IF;

  SELECT * INTO bal FROM public.finance_receivable_balances WHERE receivable_id = r.id;

  /*
    EXCESSO (§47). Não há, no repositório, modelo de crédito não alocado, e a
    §47 é explícita: sem modelo seguro, PARAR em vez de aceitar em silêncio.
    Recusar preserva a verdade — o dinheiro entrou, e alguém precisa decidir a
    que ele pertence, o que é decisão de Finanças e não deste código.
  */
  IF p_amount_cents > bal.open_amount_cents THEN
    RAISE EXCEPTION
      'OVERPAYMENT_REVIEW_REQUIRED: recebimento de % excede o saldo aberto de % (§47). '
      'Não há modelo de crédito não alocado: registre a diferença por decisão de Finanças.',
      p_amount_cents, bal.open_amount_cents USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.finance_settlements
    (organization_id, receivable_id, installment_id, kind, amount_cents, currency,
     effective_date, source, payment_source_id, external_reference,
     actor_user_id, actor_source, correlation_id)
  VALUES (r.organization_id, r.id, p_installment_id, 'PAYMENT', p_amount_cents, r.currency,
          COALESCE(p_effective_date, current_date), p_source, p_payment_source_id,
          p_external_reference, actor,
          CASE WHEN actor IS NULL THEN 'system' ELSE 'human' END, r.correlation_id)
  RETURNING id INTO s_id;

  SELECT * INTO bal FROM public.finance_receivable_balances WHERE receivable_id = r.id;

  -- Liquidação e fato na MESMA transação (§65).
  PERFORM public.emit_domain_event(
    r.organization_id, 'finance.settlement.recorded', 1, 'finance_receivable', r.id,
    'finance-settlement:' || s_id::text,
    jsonb_build_object('settlement_id', s_id, 'amount_cents', p_amount_cents,
      'paid_amount_cents', bal.paid_amount_cents, 'open_amount_cents', bal.open_amount_cents,
      'derived_status', bal.derived_status, 'source', p_source,
      'contract_id', r.contract_id, 'billing_event_id', r.billing_event_id),
    now(), CASE WHEN actor IS NULL THEN 'system' ELSE 'human' END, actor, r.correlation_id, NULL);

  IF bal.derived_status = 'PAID' THEN
    PERFORM public.emit_domain_event(
      r.organization_id, 'finance.receivable.paid', 1, 'finance_receivable', r.id,
      'finance-receivable-paid:' || r.id::text,
      jsonb_build_object('paid_amount_cents', bal.paid_amount_cents,
                         'contract_id', r.contract_id, 'billing_event_id', r.billing_event_id),
      now(), 'system', NULL, r.correlation_id, NULL);
  ELSIF bal.derived_status = 'PARTIAL' THEN
    PERFORM public.emit_domain_event(
      r.organization_id, 'finance.receivable.partial', 1, 'finance_receivable', r.id,
      'finance-receivable-partial:' || s_id::text,
      jsonb_build_object('paid_amount_cents', bal.paid_amount_cents,
                         'open_amount_cents', bal.open_amount_cents),
      now(), 'system', NULL, r.correlation_id, NULL);
  END IF;

  RETURN jsonb_build_object('settlement_id', s_id, 'idempotent', false,
    'paid_amount_cents', bal.paid_amount_cents, 'open_amount_cents', bal.open_amount_cents,
    'derived_status', bal.derived_status);
END $$;
REVOKE ALL ON FUNCTION public.finance_settlement_record(uuid, bigint, date, text, uuid, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_settlement_record(uuid, bigint, date, text, uuid, text, uuid)
  TO authenticated;

-- ---- estorno ----
CREATE FUNCTION public.finance_settlement_reverse(
  p_settlement_id uuid,
  p_reason        text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s public.finance_settlements%ROWTYPE;
  r public.finance_receivables%ROWTYPE;
  actor uuid := auth.uid();
  rev_id uuid;
  bal record;
BEGIN
  SELECT * INTO s FROM public.finance_settlements WHERE id = p_settlement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SETTLEMENT_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;
  IF s.kind <> 'PAYMENT' THEN
    RAISE EXCEPTION 'ONLY_PAYMENTS_REVERSIBLE' USING ERRCODE = 'check_violation';
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO r FROM public.finance_receivables WHERE id = s.receivable_id FOR UPDATE;
  IF actor IS NOT NULL THEN
    IF r.organization_id IS DISTINCT FROM public.current_user_organization_id() THEN
      RAISE EXCEPTION 'SETTLEMENT_NOT_FOUND' USING ERRCODE = 'no_data_found';
    END IF;
    IF NOT (public.current_user_has_permission('finance.settlements.record')
            OR public.has_finance_role_or_perm('finance_admin','finance.admin')
            OR public.current_user_is_admin()) THEN
      RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Estorno duplicado devolve o que existe: a unicidade mora no banco
  -- (`fs_reversal_unique`), e a leitura aqui evita a exceção no caminho feliz.
  SELECT id INTO rev_id FROM public.finance_settlements WHERE reversal_of = s.id;
  IF rev_id IS NOT NULL THEN
    RETURN jsonb_build_object('reversal_id', rev_id, 'idempotent', true);
  END IF;

  INSERT INTO public.finance_settlements
    (organization_id, receivable_id, installment_id, kind, amount_cents, currency,
     effective_date, source, reversal_of, reversal_reason, actor_user_id, actor_source, correlation_id)
  VALUES (s.organization_id, s.receivable_id, s.installment_id, 'REVERSAL', s.amount_cents,
          s.currency, current_date, 'REVERSAL', s.id, p_reason, actor,
          CASE WHEN actor IS NULL THEN 'system' ELSE 'human' END, s.correlation_id)
  RETURNING id INTO rev_id;

  -- Conciliação daquela liquidação deixa de valer: o pagamento que ela
  -- conferia foi desfeito. Reverter é linha nova, nunca UPDATE apagando.
  INSERT INTO public.finance_reconciliations
    (organization_id, settlement_id, payment_source_id, state, match_kind,
     matched_amount_cents, reversal_of, reversal_reason, actor_source, reconciled_by)
  SELECT rc.organization_id, rc.settlement_id, rc.payment_source_id, 'REVERSED', rc.match_kind,
         rc.matched_amount_cents, rc.id, p_reason, 'system', NULL
    FROM public.finance_reconciliations rc
   WHERE rc.settlement_id = s.id AND rc.state <> 'REVERSED';

  SELECT * INTO bal FROM public.finance_receivable_balances WHERE receivable_id = r.id;

  PERFORM public.emit_domain_event(
    r.organization_id, 'finance.settlement.reversed', 1, 'finance_receivable', r.id,
    'finance-settlement-reversed:' || rev_id::text,
    jsonb_build_object('reversal_id', rev_id, 'settlement_id', s.id, 'reason', p_reason,
      'paid_amount_cents', bal.paid_amount_cents, 'open_amount_cents', bal.open_amount_cents,
      'derived_status', bal.derived_status),
    now(), CASE WHEN actor IS NULL THEN 'system' ELSE 'human' END, actor, r.correlation_id, NULL);

  RETURN jsonb_build_object('reversal_id', rev_id, 'idempotent', false,
    'paid_amount_cents', bal.paid_amount_cents, 'open_amount_cents', bal.open_amount_cents,
    'derived_status', bal.derived_status);
END $$;
REVOKE ALL ON FUNCTION public.finance_settlement_reverse(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_settlement_reverse(uuid, text) TO authenticated;

-- ------------------------------------------------------------
-- 11) CONCILIAÇÃO — determinística e manual (§49, §52, §53)
-- ------------------------------------------------------------
/*
  Importação da evidência. Idempotente por identidade da fonte: reimportar o
  mesmo extrato não cria segunda evidência, e o retorno diz que já existia em
  vez de fingir que criou.
*/
CREATE FUNCTION public.finance_payment_source_import(
  p_organization_id uuid,
  p_source_kind     text,
  p_amount_cents    bigint,
  p_value_date      date,
  p_external_transaction_id text DEFAULT NULL,
  p_payer_name      text DEFAULT NULL,
  p_payer_document  text DEFAULT NULL,
  p_bank_reference  text DEFAULT NULL,
  p_raw_reference   text DEFAULT NULL,
  p_currency        text DEFAULT 'BRL'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  fp text; existing uuid; new_id uuid; actor uuid := auth.uid();
BEGIN
  IF actor IS NOT NULL THEN
    IF p_organization_id IS DISTINCT FROM public.current_user_organization_id() THEN
      RAISE EXCEPTION 'IMPORT_DENIED' USING ERRCODE = '42501';
    END IF;
    IF NOT (public.current_user_has_permission('finance.reconciliation.manage')
            OR public.has_finance_role_or_perm('finance_admin','finance.admin')) THEN
      RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE = '42501';
    END IF;
  END IF;

  /*
    Sem id externo estável, uma impressão DETERMINÍSTICA do conteúdo (§52).
    Ela inclui a referência bruta justamente para que dois créditos legítimos
    de mesmo valor e mesma data — que acontecem — não colidam por semelhança.
  */
  fp := COALESCE(
    NULLIF(btrim(COALESCE(p_external_transaction_id,'')), ''),
    encode(extensions.digest(concat_ws('|', 'payment_source.v1', p_source_kind,
      p_amount_cents::text, p_value_date::text, COALESCE(p_payer_document,''),
      COALESCE(p_payer_name,''), COALESCE(p_bank_reference,''),
      COALESCE(p_raw_reference,''))::bytea, 'sha256'), 'hex'));

  SELECT id INTO existing FROM public.finance_payment_sources
   WHERE organization_id = p_organization_id AND fingerprint = fp;
  IF existing IS NOT NULL THEN
    RETURN jsonb_build_object('payment_source_id', existing, 'idempotent', true);
  END IF;

  INSERT INTO public.finance_payment_sources
    (organization_id, source_kind, external_transaction_id, fingerprint, amount_cents,
     currency, value_date, payer_name, payer_document, bank_reference, raw_reference, imported_by)
  VALUES (p_organization_id, p_source_kind,
          NULLIF(btrim(COALESCE(p_external_transaction_id,'')),''), fp, p_amount_cents,
          p_currency, p_value_date, p_payer_name, p_payer_document, p_bank_reference,
          p_raw_reference, actor)
  RETURNING id INTO new_id;

  RETURN jsonb_build_object('payment_source_id', new_id, 'idempotent', false, 'fingerprint', fp);
END $$;
REVOKE ALL ON FUNCTION public.finance_payment_source_import(
  uuid, text, bigint, date, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_payment_source_import(
  uuid, text, bigint, date, text, text, text, text, text, text) TO authenticated;

/*
  A conciliação propriamente dita.

  `p_match_kind` só aceita os dois valores que a §53 autoriza a FECHAR. Uma
  proposta difusa não chega aqui: ela vive na tabela de candidatos, e promover
  uma exige um humano chamar esta função com `MANUAL_GOVERNED` — o que grava
  ator, e é o que a §112 pede que se prove.
*/
CREATE FUNCTION public.finance_reconciliation_record(
  p_settlement_id     uuid,
  p_payment_source_id uuid,
  p_match_kind        text,
  p_evidence_reference text DEFAULT NULL,
  p_note              text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s public.finance_settlements%ROWTYPE;
  src public.finance_payment_sources%ROWTYPE;
  actor uuid := auth.uid();
  st text; diff bigint; rec_id uuid; existing uuid;
BEGIN
  IF p_match_kind NOT IN ('DETERMINISTIC_SOURCE_ID','MANUAL_GOVERNED') THEN
    RAISE EXCEPTION 'FUZZY_CANNOT_FINALIZE: casamento por semelhança é PROPOSTA (§53). '
      'Use finance_reconciliation_candidates.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO s FROM public.finance_settlements WHERE id = p_settlement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SETTLEMENT_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;
  SELECT * INTO src FROM public.finance_payment_sources
   WHERE id = p_payment_source_id AND organization_id = s.organization_id;
  IF NOT FOUND THEN
    -- Mesma mensagem para "não existe" e "é de outro inquilino".
    RAISE EXCEPTION 'PAYMENT_SOURCE_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  IF actor IS NOT NULL THEN
    IF s.organization_id IS DISTINCT FROM public.current_user_organization_id() THEN
      RAISE EXCEPTION 'SETTLEMENT_NOT_FOUND' USING ERRCODE = 'no_data_found';
    END IF;
    IF NOT (public.current_user_has_permission('finance.reconciliation.manage')
            OR public.has_finance_role_or_perm('finance_admin','finance.admin')) THEN
      RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF p_match_kind = 'MANUAL_GOVERNED' AND actor IS NULL THEN
    RAISE EXCEPTION 'MANUAL_RECONCILIATION_REQUIRES_ACTOR: conciliação manual sem pessoa '
      'autenticada não tem quem a assine (§70).' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO existing FROM public.finance_reconciliations
   WHERE organization_id = s.organization_id AND settlement_id = s.id
     AND payment_source_id = src.id AND state <> 'REVERSED';
  IF existing IS NOT NULL THEN
    RETURN jsonb_build_object('reconciliation_id', existing, 'idempotent', true);
  END IF;

  diff := src.amount_cents - s.amount_cents;
  st := CASE
    WHEN src.currency <> s.currency THEN 'MISMATCH'
    WHEN diff = 0 THEN 'RECONCILED'
    -- Evidência MENOR que a liquidação: parte do recebimento não tem lastro.
    WHEN diff < 0 THEN 'PARTIAL'
    -- Evidência MAIOR: sobra caixa sem destino declarado. Não se decide
    -- sozinho a quem ela pertence (§47).
    ELSE 'REVIEW_REQUIRED' END;

  INSERT INTO public.finance_reconciliations
    (organization_id, settlement_id, payment_source_id, state, match_kind,
     matched_amount_cents, difference_cents, evidence_reference, note,
     reconciled_by, actor_source, correlation_id)
  VALUES (s.organization_id, s.id, src.id, st, p_match_kind,
          LEAST(src.amount_cents, s.amount_cents), diff, p_evidence_reference, p_note,
          actor, CASE WHEN actor IS NULL THEN 'system' ELSE 'human' END, s.correlation_id)
  RETURNING id INTO rec_id;

  IF st = 'RECONCILED' THEN
    PERFORM public.emit_domain_event(
      s.organization_id, 'finance.reconciliation.completed', 1, 'finance_receivable', s.receivable_id,
      'finance-reconciliation:' || rec_id::text,
      jsonb_build_object('reconciliation_id', rec_id, 'settlement_id', s.id,
        'payment_source_id', src.id, 'match_kind', p_match_kind,
        'matched_amount_cents', s.amount_cents),
      now(), CASE WHEN actor IS NULL THEN 'system' ELSE 'human' END, actor, s.correlation_id, NULL);
  END IF;

  RETURN jsonb_build_object('reconciliation_id', rec_id, 'state', st,
                            'difference_cents', diff, 'idempotent', false);
END $$;
REVOKE ALL ON FUNCTION public.finance_reconciliation_record(uuid, uuid, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_reconciliation_record(uuid, uuid, text, text, text)
  TO authenticated;

CREATE FUNCTION public.finance_reconciliation_reverse(p_reconciliation_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE rc public.finance_reconciliations%ROWTYPE; actor uuid := auth.uid(); new_id uuid;
BEGIN
  SELECT * INTO rc FROM public.finance_reconciliations WHERE id = p_reconciliation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'RECONCILIATION_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;
  IF rc.state = 'REVERSED' THEN
    RETURN jsonb_build_object('reconciliation_id', rc.id, 'idempotent', true);
  END IF;
  IF actor IS NOT NULL THEN
    IF rc.organization_id IS DISTINCT FROM public.current_user_organization_id() THEN
      RAISE EXCEPTION 'RECONCILIATION_NOT_FOUND' USING ERRCODE = 'no_data_found';
    END IF;
    IF NOT (public.current_user_has_permission('finance.reconciliation.manage')
            OR public.has_finance_role_or_perm('finance_admin','finance.admin')) THEN
      RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Linha nova apontando para a original. A original permanece: é a história
  -- de que aquela conferência foi feita, e depois desfeita (§57, §82).
  INSERT INTO public.finance_reconciliations
    (organization_id, settlement_id, payment_source_id, state, match_kind,
     matched_amount_cents, reversal_of, reversal_reason, reconciled_by, actor_source)
  VALUES (rc.organization_id, rc.settlement_id, rc.payment_source_id, 'REVERSED', rc.match_kind,
          rc.matched_amount_cents, rc.id, p_reason, actor,
          CASE WHEN actor IS NULL THEN 'system' ELSE 'human' END)
  RETURNING id INTO new_id;

  PERFORM public.emit_domain_event(
    rc.organization_id, 'finance.reconciliation.reversed', 1, 'finance_receivable',
    (SELECT receivable_id FROM public.finance_settlements WHERE id = rc.settlement_id),
    'finance-reconciliation-reversed:' || new_id::text,
    jsonb_build_object('reconciliation_id', new_id, 'reversal_of', rc.id, 'reason', p_reason),
    now(), CASE WHEN actor IS NULL THEN 'system' ELSE 'human' END, actor, rc.correlation_id, NULL);

  RETURN jsonb_build_object('reconciliation_id', new_id, 'idempotent', false);
END $$;
REVOKE ALL ON FUNCTION public.finance_reconciliation_reverse(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_reconciliation_reverse(uuid, text) TO authenticated;

-- ------------------------------------------------------------
-- 12) LANÇAMENTO NO RAZÃO — de Finanças, e com portão (§41, §42, §43)
-- ------------------------------------------------------------
/*
  A única porta automática para `ledger_entry`. Contratos e Fiscal não a têm, e
  nem a alcançam: a função é revogada de `authenticated`.

  Ela FALHA POR CONFIGURAÇÃO em vez de adivinhar. Sem regra de lançamento
  cadastrada, o estado do título vira `PENDING_CONFIGURATION` e os bloqueios
  ficam nomeados na própria linha — a §42 proíbe inventar categoria, centro de
  custo ou unidade para o smoke passar.
*/
CREATE FUNCTION public.finance_ledger_post_receivable(p_receivable_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r        public.finance_receivables%ROWTYPE;
  rule     public.finance_posting_rules%ROWTYPE;
  blockers jsonb := '[]'::jsonb;
  pkey     char(7);
  pstatus  text;
  entry_id uuid;
BEGIN
  SELECT * INTO r FROM public.finance_receivables WHERE id = p_receivable_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RECEIVABLE_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;
  IF r.ledger_posting_state = 'POSTED' THEN
    RETURN jsonb_build_object('posted', false, 'idempotent', true, 'ledger_entry_id', r.ledger_entry_id);
  END IF;

  pkey := to_char(r.issue_date, 'YYYY-MM');

  SELECT * INTO rule FROM public.finance_posting_rules pr
   WHERE pr.organization_id = r.organization_id AND pr.purpose = 'AR_RECOGNITION' AND pr.active
     AND (pr.contract_id IS NULL OR pr.contract_id = r.contract_id)
   ORDER BY (pr.contract_id IS NOT NULL) DESC LIMIT 1;
  IF NOT FOUND THEN
    blockers := blockers || jsonb_build_object('code','ACCOUNTING_CONFIGURATION_MISSING',
      'detail','Sem regra de lançamento AR_RECOGNITION para a organização/contrato.');
  END IF;

  -- ---- fechamento de período (§43) ----
  SELECT status::text INTO pstatus FROM public.period_close
   WHERE organization_id = r.organization_id AND period_key = pkey;
  IF pstatus IN ('soft_close','closed') THEN
    -- Reescrever a data para caber num período aberto é o que a §43 proíbe
    -- em voz alta. O lançamento fica bloqueado e alguém decide o ajuste.
    blockers := blockers || jsonb_build_object('code','PERIOD_CLOSED',
      'period_key', pkey, 'status', pstatus);
  END IF;

  IF jsonb_array_length(blockers) > 0 THEN
    UPDATE public.finance_receivables
       SET ledger_posting_state = 'PENDING_CONFIGURATION', ledger_blockers = blockers,
           updated_at = now()
     WHERE id = r.id;
    IF r.fiscal_document_id IS NOT NULL THEN
      UPDATE public.fiscal_documents SET finance_status = 'pending_configuration'
       WHERE id = r.fiscal_document_id AND finance_status <> 'posted';
    END IF;
    RETURN jsonb_build_object('posted', false, 'state', 'PENDING_CONFIGURATION', 'blockers', blockers);
  END IF;

  INSERT INTO public.ledger_entry
    (organization_id, entry_date, description, amount_cents, currency, category_id,
     cost_center_id, project_id, contract_id, business_unit_id, period_key,
     entry_type, status, source_system, source_ref, external_key, created_by, metadata)
  VALUES
    (r.organization_id, r.issue_date,
     'Reconhecimento de recebível ' || r.id::text, r.original_amount_cents, r.currency,
     rule.category_id, rule.cost_center_id,
     -- `ledger_entry.project_id` é `uuid` e `projects.id` é `text`: o defeito
     -- legado que a 135 documentou. Nulo é a única resposta honesta aqui; o
     -- projeto continua legível pelo recebível.
     NULL, r.contract_id, rule.business_unit_id, pkey,
     'actual', 'draft', 'fiscal_bridge',
     -- Procedência ESTÁVEL (§83). Nunca 'manual' num lançamento de sistema.
     'finance_receivable:' || r.id::text,
     'ar-recognition:' || r.id::text, r.created_by,
     jsonb_build_object('receivable_id', r.id, 'fiscal_document_id', r.fiscal_document_id,
                        'billing_event_id', r.billing_event_id, 'amount_basis', r.amount_basis,
                        'correlation_id', r.correlation_id))
  RETURNING id INTO entry_id;

  UPDATE public.finance_receivables
     SET ledger_posting_state = 'POSTED', ledger_entry_id = entry_id,
         ledger_blockers = '[]'::jsonb, updated_at = now()
   WHERE id = r.id;
  IF r.fiscal_document_id IS NOT NULL THEN
    UPDATE public.fiscal_documents SET finance_status = 'posted' WHERE id = r.fiscal_document_id;
  END IF;

  RETURN jsonb_build_object('posted', true, 'ledger_entry_id', entry_id, 'period_key', pkey);
END $$;
REVOKE ALL ON FUNCTION public.finance_ledger_post_receivable(uuid)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.finance_ledger_post_receivable(uuid) IS
  'Única porta AUTOMÁTICA para ledger_entry, e ela é de Finanças (§41). '
  'Bloqueia por configuração e por período fechado em vez de adivinhar '
  'mapeamento contábil (§42, §43).';

-- ------------------------------------------------------------
-- 13) Cancelamento, reversão e renegociação (§34, §56, §57)
-- ------------------------------------------------------------
CREATE FUNCTION public.finance_receivable_reverse(
  p_receivable_id uuid,
  p_reason        text,
  p_state         text DEFAULT 'REVERSED'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.finance_receivables%ROWTYPE; actor uuid := auth.uid(); n integer;
BEGIN
  IF p_state NOT IN ('REVERSED','CANCELLED','RENEGOTIATED') THEN
    RAISE EXCEPTION 'INVALID_LIFECYCLE_STATE' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO r FROM public.finance_receivables WHERE id = p_receivable_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RECEIVABLE_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;
  IF r.lifecycle_state <> 'ACTIVE' THEN
    RETURN jsonb_build_object('receivable_id', r.id, 'lifecycle_state', r.lifecycle_state,
                              'idempotent', true);
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  /*
    As liquidações NÃO são apagadas. Um título revertido que já recebeu 40
    manteve os 40 na história — o dinheiro entrou de verdade. Quem estorna o
    caixa é `finance_settlement_reverse`, e é um ato separado justamente
    porque cancelar título e devolver dinheiro são coisas diferentes.
  */
  UPDATE public.finance_receivables
     SET lifecycle_state = p_state, closed_at = now(), closed_reason = p_reason, updated_at = now()
   WHERE id = r.id;

  IF r.ledger_posting_state = 'POSTED' THEN
    -- O razão não é apagado: fica marcado como revertido, e o estorno contábil
    -- propriamente dito é ato de Finanças com regra de reversão declarada.
    UPDATE public.finance_receivables SET ledger_posting_state = 'REVERSED' WHERE id = r.id;
    UPDATE public.fiscal_documents SET finance_status = 'reversed'
     WHERE id = r.fiscal_document_id;
  END IF;

  PERFORM public.emit_domain_event(
    r.organization_id, 'finance.receivable.reversed', 1, 'finance_receivable', r.id,
    'finance-receivable-reversed:' || r.id::text || ':' || p_state,
    jsonb_build_object('lifecycle_state', p_state, 'reason', p_reason,
                       'fiscal_document_id', r.fiscal_document_id,
                       'billing_event_id', r.billing_event_id),
    now(), CASE WHEN actor IS NULL THEN 'system' ELSE 'human' END, actor, r.correlation_id, NULL);

  RETURN jsonb_build_object('receivable_id', r.id, 'lifecycle_state', p_state, 'idempotent', false);
END $$;
REVOKE ALL ON FUNCTION public.finance_receivable_reverse(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_receivable_reverse(uuid, text, text) TO authenticated;

-- Cancelamento/substituição de nota derruba o título correspondente.
CREATE FUNCTION public.finance_apply_fiscal_cancellation(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ev public.domain_events%ROWTYPE; r public.finance_receivables%ROWTYPE;
  reason text; n integer;
BEGIN
  SELECT * INTO ev FROM public.domain_events WHERE id = p_event_id;
  IF NOT FOUND OR ev.event_type NOT IN ('fiscal.document.cancelled','fiscal.document.replaced') THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'NOT_A_CANCELLATION_EVENT');
  END IF;

  reason := CASE ev.event_type WHEN 'fiscal.document.cancelled'
                 THEN 'Documento fiscal cancelado.' ELSE 'Documento fiscal substituído.' END;

  n := public.contract_billing_close_fiscal_allocation(
        ev.organization_id, ev.aggregate_id,
        CASE ev.event_type WHEN 'fiscal.document.cancelled' THEN 'CANCELLED' ELSE 'REPLACED' END,
        reason);

  SELECT * INTO r FROM public.finance_receivables
   WHERE organization_id = ev.organization_id AND fiscal_document_id = ev.aggregate_id
     AND lifecycle_state = 'ACTIVE';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('applied', true, 'receivable_affected', false,
                              'allocations_closed', n);
  END IF;

  PERFORM public.finance_receivable_reverse(r.id, reason, 'CANCELLED');
  RETURN jsonb_build_object('applied', true, 'receivable_affected', true,
                            'receivable_id', r.id, 'allocations_closed', n);
END $$;
REVOKE ALL ON FUNCTION public.finance_apply_fiscal_cancellation(uuid)
  FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 14) Permissões
-- ------------------------------------------------------------
INSERT INTO public.permissions (key, module, action, description) VALUES
  ('finance.receivables.view',      'finance', 'receivables.view',
   'Visualizar contas a receber canônicas, parcelas e saldos'),
  ('finance.settlements.record',    'finance', 'settlements.record',
   'Registrar e estornar liquidação de recebível'),
  ('finance.reconciliation.manage', 'finance', 'reconciliation.manage',
   'Importar evidência de caixa e conciliar liquidação')
ON CONFLICT (key) DO NOTHING;

/*
  Registrar recebimento e CONFERIR recebimento são atos distintos, e a seed
  mantém a distinção possível: `financeiro` recebe os três porque é o papel
  operacional de Finanças, e `owner_admin` porque administra. Nenhum papel de
  Contratos ou de Projetos recebe qualquer um deles — a §35 dá AR, liquidação
  e conciliação a Finanças, e uma seed que desse `settlements.record` a
  Contratos tornaria a fronteira impossível de provar.
*/
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
 WHERE r.organization_id IS NULL
   AND r.key IN ('owner_admin', 'financeiro')
   AND p.key IN ('finance.receivables.view','finance.settlements.record','finance.reconciliation.manage')
ON CONFLICT DO NOTHING;

COMMIT;
