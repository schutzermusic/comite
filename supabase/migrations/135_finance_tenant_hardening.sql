-- ============================================================
-- Fase 7 — 135: ENDURECIMENTO DE INQUILINO DAS FINANÇAS
-- ============================================================
--
-- A §4 do plano da Fase 7 abre com um aviso, e a auditoria o confirmou linha
-- por linha: a fundação de Finanças é ANTERIOR ao modelo de inquilino do
-- Contracts V2. O nome das tabelas soa canônico; a estrutura não é.
--
-- O que a auditoria encontrou em produção:
--
--   apar_title       — SEM organization_id. RLS puramente por PAPEL
--                      (`has_finance_role_or_perm`), sem recorte de
--                      organização: um analista financeiro de um inquilino
--                      lia e escrevia título de qualquer outro.
--   ledger_entry     — SEM organization_id. Mesma RLS por papel.
--   period_close     — SEM organization_id, e `UNIQUE (period_key)` GLOBAL:
--                      fechar 2026-01 num inquilino fechava 2026-01 em todos.
--   finance_audit_log— SEM organization_id.
--
--   Contagem real das quatro: ZERO linhas. É por isso que este endurecimento
--   é aditivo e sem reescrita de história — não há história para reescrever.
--   Se houvesse, `organization_id` nasceria anulável e a §127 governaria o
--   preenchimento; a migration teria outra forma e outro risco.
--
-- A §7 é explícita sobre a ordem: endurecer PRIMEIRO, automatizar depois. Uma
-- ponte Fiscal→Contas a Receber montada sobre `apar_title` como está hoje
-- criaria, no primeiro dia, uma linha financeira que outro inquilino pode ler.
--
-- ─── O que esta migration NÃO faz ─────────────────────────────────────────
--
-- A §73 proíbe reescrever toda a permissão de Finanças na Fase 7. As políticas
-- de PAPEL continuam existindo e continuam valendo; o que muda é que elas
-- passam a ser conjugadas com o recorte de organização, que hoje não existe.
-- Papel sem inquilino autoriza demais; inquilino sem papel autoriza demais na
-- outra direção. As duas condições passam a valer juntas.
--
-- `management_category` fica como está: 110 linhas com `organization_id` NULO,
-- que é um catálogo GLOBAL de plano de contas. Torná-lo por inquilino seria
-- decidir, por conta própria, que cada organização tem o seu — e isso é
-- configuração contábil, que a §42 proíbe inventar.
--
-- `client` e `supplier` não ganham chave (organization_id, id): a §8 congela
-- `parties` como contraparte canônica dos vínculos NOVOS, e dar chave composta
-- ao legado convidaria a Fase 7 a apoiar-se nele.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1) A organização, estruturalmente
-- ------------------------------------------------------------
-- NOT NULL direto, sem etapa de preenchimento, porque as quatro tabelas estão
-- vazias. `ADD COLUMN ... NOT NULL` numa tabela vazia não varre nada.
ALTER TABLE public.apar_title
  ADD COLUMN organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.ledger_entry
  ADD COLUMN organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.period_close
  ADD COLUMN organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.finance_audit_log
  ADD COLUMN organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.apar_title.organization_id IS
  'Adicionada na Fase 7 (135). A tabela nasceu sem inquilino e com RLS por '
  'papel; ler e escrever título de outra organização era possível. Ver §4/§7.';
COMMENT ON COLUMN public.ledger_entry.organization_id IS
  'Adicionada na Fase 7 (135). Sem ela, `ledger_entry.contract_id` apontava '
  'para contrato de qualquer inquilino sem que nada recusasse.';
COMMENT ON COLUMN public.period_close.organization_id IS
  'Adicionada na Fase 7 (135). O fechamento de período era GLOBAL: '
  'UNIQUE (period_key) fazia um inquilino fechar o mês de todos.';

-- Chave composta: é ela que permite FK de mesmo inquilino a partir daqui.
ALTER TABLE public.apar_title   ADD CONSTRAINT apar_title_org_id_unique   UNIQUE (organization_id, id);
ALTER TABLE public.ledger_entry ADD CONSTRAINT ledger_entry_org_id_unique UNIQUE (organization_id, id);

-- ------------------------------------------------------------
-- 2) O fechamento de período deixa de ser global
-- ------------------------------------------------------------
-- Trocar a unicidade é o coração desta seção. Enquanto `period_key` for único
-- na tabela inteira, a segunda organização que tentar abrir 2026-01 recebe
-- violação de unicidade — e o efeito colateral silencioso é pior: ela passa a
-- LER o fechamento da primeira como se fosse dela.
ALTER TABLE public.period_close DROP CONSTRAINT period_close_period_key_key;
ALTER TABLE public.period_close
  ADD CONSTRAINT period_close_org_period_key UNIQUE (organization_id, period_key);

-- ------------------------------------------------------------
-- 3) Referências de mesmo inquilino, onde a ponta suporta
-- ------------------------------------------------------------
/*
  A §72 é direta: RLS sozinha não basta. Onde a tabela de destino tem chave
  (organization_id, id), o vínculo passa a ser ESTRUTURAL — o banco recusa a
  linha cruzada, e nenhuma política precisa estar certa para isso valer.

  `apar_title.contract_id` e `.project_id` existiam como uuid solto, SEM FK
  nenhuma. Não é só falta de recorte de inquilino: era referência a nada.
*/
ALTER TABLE public.apar_title
  ADD CONSTRAINT apar_title_contract_tenant
    FOREIGN KEY (organization_id, contract_id)
    REFERENCES public.contracts (organization_id, id) ON DELETE SET NULL;

/*
  `project_id` das duas tabelas legadas NÃO ganha FK, e a razão é um defeito
  que a auditoria descobriu: as colunas são `uuid`, e `projects.id` é `text`.
  Elas nunca puderam referenciar projeto coisa nenhuma — não é falta de recorte
  de inquilino, é referência impossível.

  Convertê-las é tentador (as duas tabelas estão vazias), e é justamente por
  isso que não se faz aqui: a coluna é lida por código de alocação de folha, de
  rateio e por tipos do módulo de Finanças que a Fase 7 não audita. Trocar o
  tipo para fazer uma FK bonita apareceria como conserto e seria mudança de
  contrato em módulo fora do escopo.

  O caminho CANÔNICO da Fase 7 não passa por aqui: `finance_receivables` (138)
  nasce com `project_id text` e FK composta de verdade. Fica registrado nos
  deferidos como defeito legado conhecido.
*/

ALTER TABLE public.ledger_entry
  ADD CONSTRAINT ledger_entry_contract_tenant
    FOREIGN KEY (organization_id, contract_id)
    REFERENCES public.contracts (organization_id, id) ON DELETE SET NULL,
  ADD CONSTRAINT ledger_entry_cc_tenant
    FOREIGN KEY (organization_id, cost_center_id)
    REFERENCES public.finance_cost_centers (organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT ledger_entry_bu_tenant
    FOREIGN KEY (organization_id, business_unit_id)
    REFERENCES public.business_unit (organization_id, id) ON DELETE RESTRICT;

-- `apar_title.linked_entry_id` aponta para `ledger_entry`, que agora tem chave
-- composta. Título liquidado por lançamento de outro inquilino era possível.
ALTER TABLE public.apar_title
  ADD CONSTRAINT apar_title_entry_tenant
    FOREIGN KEY (organization_id, linked_entry_id)
    REFERENCES public.ledger_entry (organization_id, id) ON DELETE SET NULL;

/*
  `ledger_entry.category_id` continua FK simples para `management_category`,
  que é catálogo global (organization_id NULO nas 110 linhas). Não há chave
  composta a criar sem antes decidir se plano de contas é por inquilino — o que
  é configuração contábil, e a §42 proíbe inventá-la.

  `client_id` / `supplier_id` idem: legado, sem chave composta, e a §8 já os
  tirou do caminho canônico.
*/

-- ------------------------------------------------------------
-- 4) Índices que o caminho real percorre
-- ------------------------------------------------------------
CREATE INDEX apar_title_org_status_due ON public.apar_title (organization_id, status, due_date);
CREATE INDEX apar_title_org_contract   ON public.apar_title (organization_id, contract_id)
  WHERE contract_id IS NOT NULL;
CREATE INDEX ledger_entry_org_period   ON public.ledger_entry (organization_id, period_key);
CREATE INDEX ledger_entry_org_contract ON public.ledger_entry (organization_id, contract_id)
  WHERE contract_id IS NOT NULL;
CREATE INDEX period_close_org_status   ON public.period_close (organization_id, status);
CREATE INDEX finance_audit_log_org_at  ON public.finance_audit_log (organization_id, performed_at DESC);

-- ------------------------------------------------------------
-- 5) RLS: papel E inquilino, nunca um só
-- ------------------------------------------------------------
/*
  As políticas antigas são substituídas, não acumuladas. Política é OR: deixar
  a antiga de pé ao lado da nova manteria o caminho aberto que esta migration
  existe para fechar.

  A condição de PAPEL é preservada tal como estava — a §73 não autoriza
  redesenhar a autorização de Finanças aqui. O que se acrescenta é o `AND` com
  a organização do perfil.
*/
DROP POLICY IF EXISTS apar_select ON public.apar_title;
DROP POLICY IF EXISTS apar_write  ON public.apar_title;

CREATE POLICY apar_select_scoped ON public.apar_title FOR SELECT TO authenticated
  USING (
    organization_id = public.current_user_organization_id()
    AND (public.has_finance_role_or_perm('finance_admin',   'finance.admin')
      OR public.has_finance_role_or_perm('finance_analyst', 'finance.edit')
      OR public.has_finance_role_or_perm('approver',        'finance.approve')
      OR public.current_user_has_permission('finance.view'))
  );

CREATE POLICY apar_write_scoped ON public.apar_title FOR ALL TO authenticated
  USING (
    organization_id = public.current_user_organization_id()
    AND (public.has_finance_role_or_perm('finance_admin',   'finance.admin')
      OR public.has_finance_role_or_perm('finance_analyst', 'finance.edit'))
  )
  WITH CHECK (
    organization_id = public.current_user_organization_id()
    AND (public.has_finance_role_or_perm('finance_admin',   'finance.admin')
      OR public.has_finance_role_or_perm('finance_analyst', 'finance.edit'))
  );

DROP POLICY IF EXISTS le_select ON public.ledger_entry;
DROP POLICY IF EXISTS le_insert ON public.ledger_entry;
DROP POLICY IF EXISTS le_update ON public.ledger_entry;

CREATE POLICY le_select_scoped ON public.ledger_entry FOR SELECT TO authenticated
  USING (
    organization_id = public.current_user_organization_id()
    AND (public.has_finance_role_or_perm('finance_admin',   'finance.admin')
      OR public.has_finance_role_or_perm('finance_analyst', 'finance.edit')
      OR public.has_finance_role_or_perm('approver',        'finance.approve')
      OR public.current_user_has_permission('finance.view'))
  );

CREATE POLICY le_insert_scoped ON public.ledger_entry FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.current_user_organization_id()
    AND (public.has_finance_role_or_perm('finance_admin',   'finance.admin')
      OR public.has_finance_role_or_perm('finance_analyst', 'finance.edit'))
    /*
      A cláusula antiga também aceitava `project_manager` cujo projeto casasse.
      Ela não foi transcrita: dependia de uma função de escopo por projeto que
      o INSERT de razão AUTOMÁTICO da Fase 7 nunca percorre, e a §41 congela a
      criação de `ledger_entry` automatizado em função de Finanças. Gerente de
      projeto que lançava no razão manualmente perde essa via aqui e a recupera
      pelo papel financeiro — o que é a fronteira que a §41 desenha.
    */
  );

CREATE POLICY le_update_scoped ON public.ledger_entry FOR UPDATE TO authenticated
  USING (
    organization_id = public.current_user_organization_id()
    AND status = 'draft'::public.ledger_entry_status
    AND (created_by = auth.uid()
      OR public.has_finance_role_or_perm('finance_admin', 'finance.admin'))
  )
  WITH CHECK (
    organization_id = public.current_user_organization_id()
    AND status = 'draft'::public.ledger_entry_status
    AND (created_by = auth.uid()
      OR public.has_finance_role_or_perm('finance_admin', 'finance.admin'))
  );

DROP POLICY IF EXISTS pc_select ON public.period_close;
DROP POLICY IF EXISTS pc_write  ON public.period_close;

-- `USING (true)` era leitura de TODO fechamento de TODO inquilino.
CREATE POLICY pc_select_scoped ON public.period_close FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id());

CREATE POLICY pc_write_scoped ON public.period_close FOR ALL TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND public.has_finance_role_or_perm('finance_admin', 'finance.admin'))
  WITH CHECK (organization_id = public.current_user_organization_id()
         AND public.has_finance_role_or_perm('finance_admin', 'finance.admin'));

-- ------------------------------------------------------------
-- 6) Registro de auditoria financeira: leitura por inquilino
-- ------------------------------------------------------------
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'finance_audit_log'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.finance_audit_log', p.policyname);
  END LOOP;
END $$;

CREATE POLICY fal_select_scoped ON public.finance_audit_log FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.has_finance_role_or_perm('finance_admin', 'finance.admin')
           OR public.current_user_has_permission('finance.view')));

-- Registro de auditoria não se escreve pelo navegador. Quem grava é caminho de
-- servidor; um log que o auditado pode redigir não é log.
REVOKE INSERT, UPDATE, DELETE ON public.finance_audit_log FROM anon, authenticated;

-- ------------------------------------------------------------
-- 7) Postura de privilégio
-- ------------------------------------------------------------
-- A 118 corrigiu o ACL padrão do schema; o REVOKE explícito torna esta
-- migration independente daquela correção continuar valendo.
REVOKE TRUNCATE ON public.apar_title, public.ledger_entry,
                   public.period_close, public.finance_audit_log
  FROM anon, authenticated;

COMMIT;
