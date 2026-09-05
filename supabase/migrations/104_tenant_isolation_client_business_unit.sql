-- ============================================================
-- CONTRACTS V2 · FASE 1.3 — ISOLAMENTO DE TENANT EM client E business_unit
-- Migration: 104_tenant_isolation_client_business_unit
-- ============================================================
--
-- O DEFEITO
--
-- É o mesmo que a 099 corrigiu em `cost_center` e `supplier`, nas duas tabelas
-- que ela deixou de fora: `client` e `business_unit` nasceram na 001 sem
-- `organization_id`, e a 002 lhes deu leitura `USING (true)`. Qualquer usuário
-- autenticado, de qualquer organização, lê todas as linhas das duas. Não é
-- lacuna latente: é leitura cross-tenant ativa, abaixo de qualquer checagem de
-- frontend.
--
-- POR QUE AGORA, SE A 099 DECIDIU ADIAR
--
-- A 099 escreveu a regra: essas tabelas "entram quando cruzarem uma fronteira
-- do V2, não antes". A Fase 1 é essa fronteira, por duas razões independentes:
--
--   `client`         é fonte de party (P1 no mapa de fragmentação). Canonizar
--                    identidade lendo de uma tabela com vazamento cross-tenant
--                    seria canonizar o vazamento junto.
--
--   `business_unit`  é o alvo de `finance_cost_centers.business_unit_id`, que
--                    a 105 cria. Promover a tabela canônica de centro de custo
--                    com chave estrangeira para uma tabela sem inquilino seria
--                    importar o defeito para dentro do modelo canônico.
--
-- Por isso a 105 DEPENDE desta migration e deve ser aplicada depois dela.
--
-- Nota de fato, no momento da escrita: as duas tabelas estão VAZIAS (0 linhas)
-- e existe uma única organização. O backfill é uma no-op registrada e o
-- SET NOT NULL é seguro. O código está escrito para o caso geral mesmo assim,
-- porque uma migration é lida em bases que não são esta.
--
-- CONVIVÊNCIA COM A 090 (NÃO APLICADA)
--
-- A 090 (fiscal) faz parte deste mesmo trabalho para `client`, `business_unit`,
-- `ledger_entry` e `apar_title` — e NÃO está aplicada nesta base. Esta
-- migration não a edita e não depende dela.
--
-- As duas podem ser aplicadas em QUALQUER ORDEM:
--   * toda alteração aqui é idempotente (ADD COLUMN IF NOT EXISTS, DROP POLICY
--     IF EXISTS antes de cada CREATE POLICY, DROP de constraint por descoberta,
--     CREATE INDEX IF NOT EXISTS);
--   * as políticas criadas aqui têm nomes próprios (`*_scoped`), então a 090
--     recriar `ref_read_bu` / `ref_read_cli` / `ref_write_*` depois não as
--     sobrescreve, e o DROP que a 090 faz desses nomes não atinge as daqui;
--   * e isso é seguro porque a versão da 090 TAMBÉM é escopada por organização
--     (`organization_id = current_user_organization_id()` em USING e em
--     WITH CHECK). Políticas permissivas se unem por OR: a união de duas
--     políticas ambas escopadas continua escopada. Não existe ordem de
--     aplicação que reabra o vazamento.
--   * se a 090 rodar ANTES, o DROP de `ref_read_*` daqui remove a variante
--     dela; a leitura não fica mais estreita, porque a política deste arquivo
--     é mais ampla DENTRO do inquilino (ver seção 3).
--
-- `ledger_entry` e `apar_title` seguem fora do escopo: não cruzam fronteira da
-- Fase 1, e alargar esta migration para eles seria misturar duas decisões.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) Coluna de inquilino, backfill determinístico, índice
-- ------------------------------------------------------------

ALTER TABLE public.client
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.business_unit
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

DO $$
DECLARE
  org_count integer;
  only_org  uuid;
  cli_null  integer;
  bu_null   integer;
BEGIN
  SELECT count(*) INTO org_count FROM public.organizations;

  -- Determinístico ou nenhum. A atribuição só acontece quando existe exatamente
  -- UMA organização — aí não há o que adivinhar. Com duas ou mais, as linhas
  -- ficam NULL, invisíveis por RLS, e a atribuição vira decisão humana. Nunca
  -- se infere dono de uma linha a partir de quem por acaso a lê.
  IF org_count = 1 THEN
    SELECT id INTO only_org FROM public.organizations LIMIT 1;

    UPDATE public.client        SET organization_id = only_org WHERE organization_id IS NULL;
    UPDATE public.business_unit SET organization_id = only_org WHERE organization_id IS NULL;

    RAISE NOTICE '[104] Backfill determinístico aplicado (organização única %).', only_org;
  ELSE
    RAISE NOTICE '[104] % organizações encontradas: backfill NÃO executado. Linhas sem organization_id permanecem invisíveis por RLS até atribuição humana.', org_count;
  END IF;

  SELECT count(*) INTO cli_null FROM public.client        WHERE organization_id IS NULL;
  SELECT count(*) INTO bu_null  FROM public.business_unit WHERE organization_id IS NULL;

  -- NOT NULL só quando a coluna já está integralmente preenchida. Nunca se
  -- força a restrição por cima de linha órfã: isso abortaria a migration ou,
  -- pior, empurraria alguém a inventar um dono para a linha.
  IF cli_null = 0 THEN
    ALTER TABLE public.client ALTER COLUMN organization_id SET NOT NULL;
  ELSE
    RAISE NOTICE '[104] client: % linha(s) sem organização — coluna permanece nullable.', cli_null;
  END IF;

  IF bu_null = 0 THEN
    ALTER TABLE public.business_unit ALTER COLUMN organization_id SET NOT NULL;
  ELSE
    RAISE NOTICE '[104] business_unit: % linha(s) sem organização — coluna permanece nullable.', bu_null;
  END IF;
END $$;

COMMENT ON COLUMN public.client.organization_id IS
  'Tenant dono do cliente. Adicionada na 104 para encerrar leitura cross-tenant; NULL é invisível por RLS.';
COMMENT ON COLUMN public.business_unit.organization_id IS
  'Tenant dono da unidade de negócio. Adicionada na 104 para encerrar leitura cross-tenant; NULL é invisível por RLS.';

CREATE INDEX IF NOT EXISTS idx_client_org        ON public.client (organization_id);
CREATE INDEX IF NOT EXISTS idx_business_unit_org ON public.business_unit (organization_id);

-- ------------------------------------------------------------
-- 2) Unicidade por inquilino, não global
-- ------------------------------------------------------------
--
-- `client.cnpj`, `business_unit.code` e `business_unit.cnpj` nasceram UNIQUE
-- GLOBAIS na 001. Num modelo multi-org isso impede duas organizações de
-- cadastrarem a mesma empresa, ou de usarem o mesmo código de unidade — e o
-- erro que o usuário recebe ("já existe") vaza a existência de dado alheio.
-- A unicidade correta é por tenant. Mesmo tratamento que a 099 deu a
-- `cost_center.code`.
--
-- A constraint é descoberta pela DEFINIÇÃO, não pelo nome: nomes gerados pelo
-- PostgreSQL variam entre bases restauradas de dumps diferentes, e derrubar
-- por nome fixo é a forma clássica de a migration passar aqui e falhar lá.

DO $$
DECLARE
  alvo record;
BEGIN
  FOR alvo IN
    SELECT * FROM (VALUES
      ('public.client'::regclass,        '%(cnpj)%', 'client.cnpj'),
      ('public.business_unit'::regclass, '%(code)%', 'business_unit.code'),
      ('public.business_unit'::regclass, '%(cnpj)%', 'business_unit.cnpj')
    -- A lista de alias de coluna aceita NOMES, nunca tipos: os ::regclass
    -- das linhas do VALUES já dão o tipo, e declará-lo de novo aqui é erro
    -- de sintaxe que derruba a migration inteira.
    ) AS t(rel, padrao, rotulo)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = alvo.rel
         AND contype = 'u'
         AND pg_get_constraintdef(oid) ILIKE alvo.padrao
    ) THEN
      EXECUTE (
        SELECT format('ALTER TABLE %s DROP CONSTRAINT %I', alvo.rel::text, conname)
          FROM pg_constraint
         WHERE conrelid = alvo.rel
           AND contype = 'u'
           AND pg_get_constraintdef(oid) ILIKE alvo.padrao
         LIMIT 1
      );
      RAISE NOTICE '[104] %: UNIQUE global removida.', alvo.rotulo;
    ELSE
      RAISE NOTICE '[104] %: nenhuma UNIQUE global encontrada (nada a remover).', alvo.rotulo;
    END IF;
  END LOOP;
END $$;

-- Índices parciais: linha sem inquilino (multi-org sem backfill) não participa
-- da unicidade, e `cnpj` é nullable nas duas tabelas — NULL nunca colide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_org_cnpj
  ON public.client (organization_id, cnpj)
  WHERE organization_id IS NOT NULL AND cnpj IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_unit_org_code
  ON public.business_unit (organization_id, code)
  WHERE organization_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_unit_org_cnpj
  ON public.business_unit (organization_id, cnpj)
  WHERE organization_id IS NOT NULL AND cnpj IS NOT NULL;

-- ------------------------------------------------------------
-- 3) RLS — substitui `USING (true)` por escopo de tenant
-- ------------------------------------------------------------
--
-- Leitura: a amplitude DENTRO da organização é preservada de propósito, como na
-- 099. O defeito era o INQUILINO, não o PÚBLICO — transformar isso numa
-- permissão nova seria mudar o produto sob o pretexto de corrigir segurança.
--
-- Escrita em `client`: a tabela tinha APENAS política de INSERT (`ref_write_cli`
-- é FOR INSERT) — nenhuma linha podia ser corrigida ou desativada pela
-- aplicação. É exatamente a lacuna que a 099 encontrou em `supplier`, e recebe
-- a mesma resposta: INSERT preserva a autoridade original (admin OU analista);
-- UPDATE/DELETE exigem admin, porque alterar e apagar cadastro referenciado por
-- lançamento não é a mesma autoridade que criá-lo.

ALTER TABLE public.client        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_unit ENABLE ROW LEVEL SECURITY;

-- ---- client ----
DROP POLICY IF EXISTS "ref_read_cli" ON public.client;
DROP POLICY IF EXISTS "client_select_scoped" ON public.client;
CREATE POLICY "client_select_scoped" ON public.client
  FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id());

DROP POLICY IF EXISTS "ref_write_cli" ON public.client;
DROP POLICY IF EXISTS "client_insert_scoped" ON public.client;
CREATE POLICY "client_insert_scoped" ON public.client
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.current_user_organization_id()
    AND (
      public.has_finance_role_or_perm('finance_admin', 'finance.admin')
      OR public.has_finance_role_or_perm('finance_analyst', 'finance.edit')
    )
  );

DROP POLICY IF EXISTS "client_update_scoped" ON public.client;
CREATE POLICY "client_update_scoped" ON public.client
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.current_user_organization_id()
    AND public.has_finance_role_or_perm('finance_admin', 'finance.admin')
  )
  WITH CHECK (
    organization_id = public.current_user_organization_id()
    AND public.has_finance_role_or_perm('finance_admin', 'finance.admin')
  );

DROP POLICY IF EXISTS "client_delete_scoped" ON public.client;
CREATE POLICY "client_delete_scoped" ON public.client
  FOR DELETE TO authenticated
  USING (
    organization_id = public.current_user_organization_id()
    AND public.has_finance_role_or_perm('finance_admin', 'finance.admin')
  );

-- ---- business_unit ----
-- Aqui a autoridade de escrita ORIGINAL já era só admin (`ref_write_bu` era
-- FOR ALL com finance_admin/finance.admin). Ela é preservada tal como estava,
-- agora com o inquilino no USING E no WITH CHECK — sem WITH CHECK, uma linha
-- podia ser gravada para FORA da própria organização, que é o mesmo defeito
-- pelo outro lado.
DROP POLICY IF EXISTS "ref_read_bu" ON public.business_unit;
DROP POLICY IF EXISTS "business_unit_select_scoped" ON public.business_unit;
CREATE POLICY "business_unit_select_scoped" ON public.business_unit
  FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id());

DROP POLICY IF EXISTS "ref_write_bu" ON public.business_unit;
DROP POLICY IF EXISTS "business_unit_write_scoped" ON public.business_unit;
CREATE POLICY "business_unit_write_scoped" ON public.business_unit
  FOR ALL TO authenticated
  USING (
    organization_id = public.current_user_organization_id()
    AND public.has_finance_role_or_perm('finance_admin', 'finance.admin')
  )
  WITH CHECK (
    organization_id = public.current_user_organization_id()
    AND public.has_finance_role_or_perm('finance_admin', 'finance.admin')
  );

-- ------------------------------------------------------------
-- 4) Verificação — nenhuma política irrestrita sobreviveu
-- ------------------------------------------------------------
--
-- A asserção existe porque o defeito era invisível: `USING (true)` não falha,
-- não avisa, e só se manifesta como dado de outro inquilino numa tela. Se
-- qualquer política irrestrita restar nas duas tabelas — herdada, recriada por
-- outra migration, ou esquecida aqui — esta migration ABORTA e nada é gravado.

DO $$
DECLARE
  frouxas text;
BEGIN
  SELECT string_agg(format('%s.%s (%s)', tablename, policyname, cmd), '; ')
    INTO frouxas
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('client', 'business_unit')
     AND (qual = 'true' OR with_check = 'true');

  IF frouxas IS NOT NULL THEN
    RAISE EXCEPTION '[104] Política irrestrita sobreviveu em client/business_unit: %. Nada foi gravado.', frouxas;
  END IF;

  RAISE NOTICE '[104] client e business_unit escopados por organização; nenhuma política irrestrita restante.';
END $$;

COMMIT;
