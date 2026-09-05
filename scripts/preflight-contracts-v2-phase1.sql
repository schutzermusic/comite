-- ============================================================
-- CONTRACTS V2 · FASE 1 — PREFLIGHT DE PRODUÇÃO (SOMENTE LEITURA)
-- ============================================================
--
-- Roda ANTES de aplicar 102-106, e de novo dentro da transação do aplicador.
--
--   psql "$SUPABASE_DB_URL" -f scripts/preflight-contracts-v2-phase1.sql
--
-- Nenhuma linha é escrita. Nenhuma estrutura é alterada.
--
-- A coluna `esperado` registra o que a Fase 1 assumiu quando foi planejada.
-- Divergência não é detalhe: o plano inteiro se apoia em "não há dado para
-- migrar". Se um número mudar, a fase PARA e é replanejada — não se contorna.
-- ============================================================

\echo '===== A. INQUILINO ====='
SELECT count(*) AS organizacoes, '1' AS esperado FROM organizations;

\echo '===== B. FONTES DE PARTY ====='
SELECT 'client' AS tabela, count(*) AS linhas, '0' AS esperado FROM client
UNION ALL SELECT 'supplier',             count(*), '0' FROM supplier
UNION ALL SELECT 'business_unit',        count(*), '0' FROM business_unit
UNION ALL SELECT 'cost_center',          count(*), '0' FROM cost_center
UNION ALL SELECT 'finance_cost_centers', count(*), '8' FROM finance_cost_centers
UNION ALL SELECT 'contracts',            count(*), '6' FROM contracts
ORDER BY 1;

\echo '--- contraparte dos contratos (esperado: 6 texto / 0 fk / 0 fk) ---'
SELECT count(*) AS total,
       count(counterparty_name) AS com_texto,
       count(client_id)         AS com_client_id_legado,
       count(supplier_id)       AS com_supplier_id_legado,
       count(*) FILTER (WHERE deleted_at IS NULL) AS vivos
  FROM contracts;

\echo '===== C. IDENTIFICADORES (deduplicação determinística) ====='
\echo '--- duplicata de documento DENTRO da organização (esperado: 0 linhas) ---'
SELECT organization_id, regexp_replace(cpf_cnpj,'\D','','g') AS doc, count(*)
  FROM supplier WHERE cpf_cnpj IS NOT NULL
 GROUP BY 1,2 HAVING count(*) > 1;

\echo '--- mesmo documento em organizações DIFERENTES (esperado: 0; jamais fundir) ---'
SELECT regexp_replace(cpf_cnpj,'\D','','g') AS doc, count(DISTINCT organization_id) AS orgs
  FROM supplier WHERE cpf_cnpj IS NOT NULL
 GROUP BY 1 HAVING count(DISTINCT organization_id) > 1;

\echo '--- cadastro sem documento (legítimo; só precisa ser conhecido) ---'
SELECT 'supplier_sem_documento' AS caso, count(*) FROM supplier WHERE cpf_cnpj IS NULL
UNION ALL SELECT 'client_sem_cnpj',   count(*) FROM client        WHERE cnpj IS NULL
UNION ALL SELECT 'bu_sem_cnpj',       count(*) FROM business_unit WHERE cnpj IS NULL;

\echo '===== D. TENANCY ====='
\echo '--- organization_id nulo onde a coluna existe (esperado: 0) ---'
SELECT 'supplier' AS tabela, count(*) FROM supplier             WHERE organization_id IS NULL
UNION ALL SELECT 'cost_center',          count(*) FROM cost_center          WHERE organization_id IS NULL
UNION ALL SELECT 'finance_cost_centers', count(*) FROM finance_cost_centers WHERE organization_id IS NULL
UNION ALL SELECT 'contracts',            count(*) FROM contracts            WHERE organization_id IS NULL;

\echo '--- tabelas de fronteira ainda SEM coluna de inquilino (esperado: client, business_unit) ---'
SELECT t.table_name
  FROM information_schema.tables t
 WHERE t.table_schema = 'public'
   AND t.table_name IN ('client','business_unit','ledger_entry','apar_title','allocation_rule')
   AND NOT EXISTS (SELECT 1 FROM information_schema.columns c
                    WHERE c.table_schema='public' AND c.table_name=t.table_name
                      AND c.column_name='organization_id')
 ORDER BY 1;

\echo '--- políticas irrestritas na fronteira da Fase 1 (esperado: ref_read_cli, ref_read_bu) ---'
SELECT tablename, policyname, cmd
  FROM pg_policies
 WHERE schemaname='public'
   AND (qual = 'true' OR with_check = 'true')
   AND tablename IN ('client','supplier','business_unit','cost_center','finance_cost_centers','contracts','parties','party_roles')
 ORDER BY 1,2;

\echo '===== E. CENTRO DE CUSTO — O PORTÃO DE PARADA ====='
\echo '--- dependentes NOT NULL do cost_center legado (esperado: 0 e 0; qualquer linha PARA a fase) ---'
SELECT 'cost_center' AS tabela, count(*) AS linhas, '0' AS esperado FROM cost_center
UNION ALL SELECT 'ledger_entry',    count(*), '0' FROM ledger_entry
UNION ALL SELECT 'allocation_rule', count(*), '0' FROM allocation_rule
UNION ALL SELECT 'allocation_result', count(*), '0' FROM allocation_result;

\echo '--- colisão de code entre os dois modelos (esperado: 0 linhas) ---'
SELECT c.organization_id, c.code
  FROM cost_center c
  JOIN finance_cost_centers f USING (organization_id, code)
 WHERE c.id <> f.id;

\echo '--- finance_cost_centers ---'
SELECT count(*) AS linhas, count(DISTINCT organization_id) AS orgs,
       count(*) FILTER (WHERE active) AS ativos FROM finance_cost_centers;

\echo '===== F. CHAVES ESTRANGEIRAS ====='
\echo '--- quem referencia o cost_center legado ---'
SELECT conrelid::regclass AS tabela, conname, pg_get_constraintdef(oid) AS definicao
  FROM pg_constraint WHERE confrelid = 'public.cost_center'::regclass ORDER BY 1;

\echo '--- quem já referencia finance_cost_centers ---'
SELECT conrelid::regclass AS tabela, conname
  FROM pg_constraint WHERE confrelid = 'public.finance_cost_centers'::regclass ORDER BY 1;

\echo '--- referências que a Fase 1 vai criar já existem? (esperado: 0 = ainda não aplicada) ---'
SELECT count(*) AS tabelas_parties FROM information_schema.tables
 WHERE table_schema='public' AND table_name IN ('parties','party_roles');

\echo '--- fiscal presente? (esperado: 0 — a 090 não está aplicada) ---'
SELECT count(*) AS tabelas_fiscal FROM information_schema.tables
 WHERE table_schema='public' AND table_name LIKE 'fiscal_%';

\echo '===== G. RLS ATUAL NAS TABELAS DE FRONTEIRA ====='
SELECT tablename, policyname, cmd,
       qual IS NOT NULL AS tem_using, with_check IS NOT NULL AS tem_check
  FROM pg_policies
 WHERE schemaname='public'
   AND tablename IN ('client','supplier','business_unit','cost_center','finance_cost_centers','parties','party_roles')
 ORDER BY 1,3,2;
