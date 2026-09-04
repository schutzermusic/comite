-- ============================================================
-- CONTRACTS V2 · PHASE 0.1 — TENANT ISOLATION ON FINANCE REFERENCE TABLES
-- Migration: 099_tenant_isolation_reference_tables
-- ============================================================
--
-- O DEFEITO
--
-- `cost_center` e `supplier` nasceram na migration 001 sem `organization_id`, e
-- a 002 lhes deu política de leitura `USING (true)`. O resultado é que QUALQUER
-- usuário autenticado, de QUALQUER organização, lê TODAS as linhas das duas
-- tabelas. Não é uma lacuna latente: é leitura cross-tenant ativa, e nenhuma
-- checagem de frontend a corrige, porque o vazamento está abaixo dela.
--
-- A migration 090 (fiscal) preencheria `organization_id` em `client`,
-- `business_unit`, `ledger_entry` e `apar_title` — mas 090 NÃO ESTÁ APLICADA
-- nesta base. Esta migration portanto não pode depender de nada que 090 crie, e
-- não cria: `cost_center` e `supplier` recebem a própria coluna e a própria RLS.
--
-- O QUE ESTA MIGRATION NÃO FAZ
--
-- Não torna `finance_cost_centers` canônica — isso é Fase 1, e fazer as duas
-- coisas de uma vez confundiria "parar o vazamento" com "escolher o dono".
-- Não toca `client`, `business_unit`, `ledger_entry` nem `apar_title`: eles
-- entram quando cruzarem uma fronteira do V2, não antes.
--
-- BACKFILL
--
-- Determinístico ou nenhum. A atribuição só acontece quando existe exatamente
-- UMA organização — aí não há o que adivinhar. Com duas ou mais, as linhas
-- ficam NULL, invisíveis por RLS, e a atribuição vira decisão humana. Nunca se
-- infere dono de uma linha a partir de quem por acaso a lê.
--
-- Nota de fato, no momento da escrita: nesta base as duas tabelas estão VAZIAS
-- (0 linhas) e existe uma única organização. O backfill é uma no-op registrada,
-- e o `SET NOT NULL` é seguro. O código está escrito para o caso geral mesmo
-- assim, porque uma migration é lida em bases que não são esta.
--
-- ESCRITAS DEPENDENTES
--
-- `ledger_entry.cost_center_id` e `allocation_rule.cost_center_id` são NOT NULL
-- e referenciam `cost_center`. Verificação de chave estrangeira no PostgreSQL
-- não passa por RLS, então restringir a LEITURA de `cost_center` não quebra o
-- INSERT que a referencia. O que muda é o que um JOIN devolve — e devolver
-- linha de outro tenant era exatamente o defeito.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) cost_center — coluna, backfill determinístico, índice
-- ------------------------------------------------------------

ALTER TABLE public.cost_center
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.supplier
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

DO $$
DECLARE
  org_count integer;
  only_org  uuid;
  cc_null   integer;
  sup_null  integer;
BEGIN
  SELECT count(*) INTO org_count FROM public.organizations;

  IF org_count = 1 THEN
    SELECT id INTO only_org FROM public.organizations LIMIT 1;

    UPDATE public.cost_center SET organization_id = only_org WHERE organization_id IS NULL;
    UPDATE public.supplier    SET organization_id = only_org WHERE organization_id IS NULL;

    RAISE NOTICE '[099] Backfill determinístico aplicado (organização única %).', only_org;
  ELSE
    RAISE NOTICE '[099] % organizações encontradas: backfill NÃO executado. Linhas sem organization_id permanecem invisíveis por RLS até atribuição humana.', org_count;
  END IF;

  SELECT count(*) INTO cc_null  FROM public.cost_center WHERE organization_id IS NULL;
  SELECT count(*) INTO sup_null FROM public.supplier    WHERE organization_id IS NULL;

  -- NOT NULL só quando a coluna já está integralmente preenchida. Nunca se
  -- força a restrição por cima de linha órfã: isso abortaria a migration ou,
  -- pior, empurraria alguém a inventar um dono para a linha.
  IF cc_null = 0 THEN
    ALTER TABLE public.cost_center ALTER COLUMN organization_id SET NOT NULL;
  ELSE
    RAISE NOTICE '[099] cost_center: % linha(s) sem organização — coluna permanece nullable.', cc_null;
  END IF;

  IF sup_null = 0 THEN
    ALTER TABLE public.supplier ALTER COLUMN organization_id SET NOT NULL;
  ELSE
    RAISE NOTICE '[099] supplier: % linha(s) sem organização — coluna permanece nullable.', sup_null;
  END IF;
END $$;

COMMENT ON COLUMN public.cost_center.organization_id IS
  'Tenant dono do centro de custo. Adicionada na 099 para encerrar leitura cross-tenant; NULL é invisível por RLS.';
COMMENT ON COLUMN public.supplier.organization_id IS
  'Tenant dono do fornecedor. Adicionada na 099 para encerrar leitura cross-tenant; NULL é invisível por RLS.';

CREATE INDEX IF NOT EXISTS idx_cost_center_org ON public.cost_center (organization_id);
CREATE INDEX IF NOT EXISTS idx_supplier_org    ON public.supplier (organization_id);

-- `cost_center.code` era UNIQUE global — o que, num modelo multi-org, impede
-- duas organizações de usarem "ENG-CAMPO". A unicidade correta é por tenant.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.cost_center'::regclass
       AND contype = 'u'
       AND pg_get_constraintdef(oid) ILIKE '%(code)%'
  ) THEN
    EXECUTE (
      SELECT format('ALTER TABLE public.cost_center DROP CONSTRAINT %I', conname)
        FROM pg_constraint
       WHERE conrelid = 'public.cost_center'::regclass
         AND contype = 'u'
         AND pg_get_constraintdef(oid) ILIKE '%(code)%'
       LIMIT 1
    );
    RAISE NOTICE '[099] cost_center: UNIQUE global em code removida.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_center_org_code
  ON public.cost_center (organization_id, code)
  WHERE organization_id IS NOT NULL;

-- ------------------------------------------------------------
-- 2) RLS — substitui `USING (true)` por escopo de tenant
-- ------------------------------------------------------------

ALTER TABLE public.cost_center ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier    ENABLE ROW LEVEL SECURITY;

-- Leitura: a amplitude DENTRO da organização é preservada de propósito. O
-- defeito era o tenant, não o público — transformar isso numa permissão nova
-- seria mudar o produto sob o pretexto de corrigir segurança.
DROP POLICY IF EXISTS "ref_read_cc" ON public.cost_center;
DROP POLICY IF EXISTS "cost_center_select_scoped" ON public.cost_center;
CREATE POLICY "cost_center_select_scoped" ON public.cost_center
  FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id());

DROP POLICY IF EXISTS "ref_read_sup" ON public.supplier;
DROP POLICY IF EXISTS "supplier_select_scoped" ON public.supplier;
CREATE POLICY "supplier_select_scoped" ON public.supplier
  FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id());

-- Escrita em cost_center: mesma autoridade de antes (`finance_admin` /
-- `finance.admin`), agora com o tenant no USING e no WITH CHECK — sem
-- WITH CHECK, uma linha podia ser gravada para fora da própria organização.
DROP POLICY IF EXISTS "ref_write_cc" ON public.cost_center;
DROP POLICY IF EXISTS "cost_center_write_scoped" ON public.cost_center;
CREATE POLICY "cost_center_write_scoped" ON public.cost_center
  FOR ALL TO authenticated
  USING (
    organization_id = public.current_user_organization_id()
    AND public.has_finance_role_or_perm('finance_admin', 'finance.admin')
  )
  WITH CHECK (
    organization_id = public.current_user_organization_id()
    AND public.has_finance_role_or_perm('finance_admin', 'finance.admin')
  );

-- Fornecedor tinha APENAS política de INSERT: nenhuma linha podia ser corrigida
-- ou desativada pela aplicação. INSERT preserva a autoridade original
-- (admin OU analista); UPDATE/DELETE exigem admin, porque alterar e apagar
-- cadastro referenciado por lançamento não é a mesma autoridade que criá-lo.
DROP POLICY IF EXISTS "ref_write_sup" ON public.supplier;
DROP POLICY IF EXISTS "supplier_insert_scoped" ON public.supplier;
CREATE POLICY "supplier_insert_scoped" ON public.supplier
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.current_user_organization_id()
    AND (
      public.has_finance_role_or_perm('finance_admin', 'finance.admin')
      OR public.has_finance_role_or_perm('finance_analyst', 'finance.edit')
    )
  );

DROP POLICY IF EXISTS "supplier_update_scoped" ON public.supplier;
CREATE POLICY "supplier_update_scoped" ON public.supplier
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.current_user_organization_id()
    AND public.has_finance_role_or_perm('finance_admin', 'finance.admin')
  )
  WITH CHECK (
    organization_id = public.current_user_organization_id()
    AND public.has_finance_role_or_perm('finance_admin', 'finance.admin')
  );

DROP POLICY IF EXISTS "supplier_delete_scoped" ON public.supplier;
CREATE POLICY "supplier_delete_scoped" ON public.supplier
  FOR DELETE TO authenticated
  USING (
    organization_id = public.current_user_organization_id()
    AND public.has_finance_role_or_perm('finance_admin', 'finance.admin')
  );

COMMIT;
