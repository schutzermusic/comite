-- ============================================================
-- ROLLBACK das migrations da Fase 1 do Contracts V2 (102–106)
-- ============================================================
--
-- NÃO é uma migration: fica fora de supabase/migrations/ de propósito, para não
-- ser aplicado por engano por nenhum runner.
--
--   psql "$SUPABASE_DB_URL" -f scripts/rollback-contracts-v2-phase1.sql
--
-- ATENÇÃO ao que o rollback REABRE:
--   * 104 → volta a leitura cross-tenant de client e business_unit
--   * 105 → volta a fazer do cost_center legado o alvo das chaves do razão
--   * 102 → o cadastro canônico de contraparte deixa de existir
--
-- Reverter é restaurar defeitos. Faça-o apenas para desbloquear, e por tempo
-- medido em horas.
--
-- ─── LEIA ANTES DE RODAR ───────────────────────────────────────────────────
--
-- Este arquivo é DESTRUTIVO se alguém já cadastrou contraparte. A Fase 1 nasce
-- com `parties` vazia, então logo após a aplicação o rollback não perde nada.
-- Depois que uma pessoa cadastrar a primeira party, perde.
--
-- O bloco de guarda abaixo recusa a execução nesse caso. Para forçar mesmo
-- assim — e sabendo o que se perde — comente-o.
-- ============================================================

BEGIN;

DO $$
DECLARE
  n_parties integer;
  n_links   integer;
BEGIN
  SELECT count(*) INTO n_parties FROM public.parties;
  SELECT count(*) INTO n_links   FROM public.contracts WHERE counterparty_party_id IS NOT NULL;

  IF n_parties > 0 OR n_links > 0 THEN
    RAISE EXCEPTION
      E'[rollback] Existem % contraparte(s) canônica(s) e % contrato(s) vinculado(s).\n'
      '            Derrubar `parties` agora APAGA cadastro que alguém criou à mão, e o\n'
      '            vínculo não é reconstruível a partir de `counterparty_name` — foi\n'
      '            justamente por isso que a Fase 1 se proibiu de criá-lo sozinha.\n'
      '            Exporte o cadastro antes, ou comente esta guarda conscientemente.',
      n_parties, n_links;
  END IF;

  RAISE NOTICE '[rollback] Cadastro canônico vazio: reverter não perde informação.';
END $$;

-- ── 106 ────────────────────────────────────────────────────────────────────
ALTER TABLE public.contracts DROP CONSTRAINT IF EXISTS contracts_counterparty_party_same_org_fkey;
DROP INDEX IF EXISTS public.contracts_org_counterparty_party_idx;
ALTER TABLE public.contracts DROP COLUMN IF EXISTS counterparty_party_id;
-- `counterparty_name` NUNCA foi tocada pela Fase 1, e continua intacta aqui.

-- ── 105 ────────────────────────────────────────────────────────────────────
-- Devolve as chaves do razão ao cost_center legado. Só é possível porque a 105
-- não derrubou a tabela.
ALTER TABLE public.ledger_entry DROP CONSTRAINT IF EXISTS ledger_entry_cost_center_id_fkey;
ALTER TABLE public.ledger_entry
  ADD CONSTRAINT ledger_entry_cost_center_id_fkey
  FOREIGN KEY (cost_center_id) REFERENCES public.cost_center(id);

ALTER TABLE public.allocation_rule DROP CONSTRAINT IF EXISTS allocation_rule_cost_center_id_fkey;
ALTER TABLE public.allocation_rule
  ADD CONSTRAINT allocation_rule_cost_center_id_fkey
  FOREIGN KEY (cost_center_id) REFERENCES public.cost_center(id);

-- As três colunas absorvidas só caem se ninguém as preencheu: `type` e
-- `business_unit_id` recebem CLASSIFICAÇÃO humana, e classificação humana não
-- se descarta por conveniência de rollback.
DO $$
DECLARE n_class integer;
BEGIN
  SELECT count(*) INTO n_class FROM public.finance_cost_centers
   WHERE type IS NOT NULL OR business_unit_id IS NOT NULL OR parent_id IS NOT NULL;

  IF n_class = 0 THEN
    ALTER TABLE public.finance_cost_centers DROP CONSTRAINT IF EXISTS fcc_parent_same_org;
    ALTER TABLE public.finance_cost_centers DROP CONSTRAINT IF EXISTS fcc_parent_not_self;
    ALTER TABLE public.finance_cost_centers DROP CONSTRAINT IF EXISTS fcc_org_id_unique;
    DROP INDEX IF EXISTS public.idx_fcc_parent;
    DROP INDEX IF EXISTS public.idx_fcc_bu;
    ALTER TABLE public.finance_cost_centers
      DROP COLUMN IF EXISTS parent_id,
      DROP COLUMN IF EXISTS business_unit_id,
      DROP COLUMN IF EXISTS type;
    RAISE NOTICE '[rollback] finance_cost_centers: colunas absorvidas removidas (nenhuma estava preenchida).';
  ELSE
    RAISE NOTICE '[rollback] finance_cost_centers: % linha(s) já classificada(s) — colunas PRESERVADAS. Só as chaves estrangeiras foram revertidas.', n_class;
  END IF;
END $$;

COMMENT ON TABLE public.cost_center IS NULL;

-- ── 104 ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "client_select_scoped" ON public.client;
DROP POLICY IF EXISTS "client_insert_scoped" ON public.client;
DROP POLICY IF EXISTS "client_update_scoped" ON public.client;
DROP POLICY IF EXISTS "client_delete_scoped" ON public.client;
DROP POLICY IF EXISTS "business_unit_select_scoped" ON public.business_unit;
DROP POLICY IF EXISTS "business_unit_write_scoped" ON public.business_unit;

CREATE POLICY "ref_read_cli" ON public.client FOR SELECT TO authenticated USING (true);
CREATE POLICY "ref_write_cli" ON public.client FOR INSERT TO authenticated
  WITH CHECK (
    public.has_finance_role_or_perm('finance_admin', 'finance.admin')
    OR public.has_finance_role_or_perm('finance_analyst', 'finance.edit')
  );
CREATE POLICY "ref_read_bu" ON public.business_unit FOR SELECT TO authenticated USING (true);
CREATE POLICY "ref_write_bu" ON public.business_unit FOR ALL TO authenticated
  USING (public.has_finance_role_or_perm('finance_admin', 'finance.admin'))
  WITH CHECK (public.has_finance_role_or_perm('finance_admin', 'finance.admin'));

DROP INDEX IF EXISTS public.idx_client_org_cnpj;
DROP INDEX IF EXISTS public.idx_business_unit_org_code;
DROP INDEX IF EXISTS public.idx_business_unit_org_cnpj;
DROP INDEX IF EXISTS public.idx_client_org;
DROP INDEX IF EXISTS public.idx_business_unit_org;

-- `organization_id` é DELIBERADAMENTE preservada em client e business_unit,
-- pela mesma razão que a 099 preservou a dela: derrubá-la apagaria a atribuição
-- de inquilino de cada linha — o único dado que estas migrations criaram.
-- Para removê-la mesmo assim, e sabendo o que se perde:
--   ALTER TABLE public.client        DROP COLUMN organization_id;
--   ALTER TABLE public.business_unit DROP COLUMN organization_id;
-- E então recrie as UNIQUE globais que a 104 substituiu:
--   ALTER TABLE public.client        ADD CONSTRAINT client_cnpj_key        UNIQUE (cnpj);
--   ALTER TABLE public.business_unit ADD CONSTRAINT business_unit_code_key UNIQUE (code);
--   ALTER TABLE public.business_unit ADD CONSTRAINT business_unit_cnpj_key UNIQUE (cnpj);

-- ── 103 ────────────────────────────────────────────────────────────────────
DELETE FROM public.role_permissions
 WHERE permission_id IN (SELECT id FROM public.permissions WHERE key LIKE 'parties.%');
DELETE FROM public.permissions WHERE key LIKE 'parties.%';

-- ── 102 ────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS public.party_roles;
DROP TABLE IF EXISTS public.parties;
DROP FUNCTION IF EXISTS public.party_role_vocabulary();

COMMIT;
