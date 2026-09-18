-- ============================================================
-- 174 — AS VISÕES DE LEITURA PASSAM A DIZER QUE SÃO DE LEITURA
--
-- ORDEM DE PRODUÇÃO (cadeia estrita): 174 → 175 → 176 → 177 → 178
-- Pré-requisito: tip 173. Aplicar via scripts/apply-*-.mjs em sequência.
--
-- ─── A dívida que a 172 deixou registrada ─────────────────────────────────
--
-- A 172 consertou o grant de UMA visão — a bancada — e escreveu, no próprio
-- corpo, que as outras quatro tinham a mesma herança e ficariam "para
-- tratamento próprio". Esta é o tratamento próprio.
--
-- O privilégio não foi pedido por ninguém: o Supabase aplica
-- ALTER DEFAULT PRIVILEGES concedendo ALL a `authenticated` (e, em objetos mais
-- antigos, também a `anon`) sobre tudo que nasce no schema `public`. Toda visão
-- criada sem um REVOKE explícito nasceu com INSERT, UPDATE e DELETE.
--
-- ─── O que foi medido no banco vivo, antes de escrever isto ───────────────
--
--   contract_measurement_rule_timeline_governed  authenticated: SELECT+I/U/D
--   contract_to_cash_read_model                  authenticated + ANON: SELECT+I/U/D
--   contract_to_cash_health                      authenticated + ANON: SELECT+I/U/D
--   project_measurement_read_model               authenticated: SELECT+I/U/D
--   contract_milestone_workbench                 authenticated: SELECT  (já tratada)
--
-- ─── contract_measurement_rule_timeline_governed: por que é o caso grave ──
--
-- As outras quatro têm LATERAL, agregação ou UNION, e o Postgres as classifica
-- como NÃO atualizáveis: um INSERT nelas falha por construção. Esta não. Ela é
--
--     SELECT ... FROM contract_measurement_rule_timeline_mappings
--      WHERE review_state = 'accepted'
--
-- — uma visão AUTO-ATUALIZÁVEL simples (`is_insertable_into = YES`). Escrita
-- através dela repassa para a tabela-base. E o que ela protege é justamente a
-- fronteira entre PROPOSTO e ACEITO: `milestone-stage.ts` só reconhece etapa
-- mapeada quando o mapeamento passou por revisor humano, e a bancada (171) só
-- faz JOIN por esta visão exatamente para não enxergar proposta. Um UPDATE
-- through-view seria o caminho mais curto para transformar sugestão de máquina
-- em verdade aceita — e, com ela, destravar READY_TO_MEASURE num marco cujo
-- gatilho ninguém apurou.
--
-- ─── Por que, mesmo assim, isto não é a correção de um vazamento ──────────
--
-- Há uma segunda defesa já de pé, e ela foi verificada: na tabela-base
-- `contract_measurement_rule_timeline_mappings`, `authenticated` tem SOMENTE
-- SELECT (mais REFERENCES e TRIGGER). Como a visão é `security_invoker`, o
-- privilégio da tabela-base é checado com a identidade de quem chama, e a
-- escrita através da visão morre ali. A RLS da base também só tem política de
-- SELECT para `authenticated` — nenhuma de INSERT ou UPDATE.
--
-- Então o que esta migration corrige é o que o CATÁLOGO AFIRMA. Duas defesas
-- reais e uma declaração falsa em cima delas: quem ler `\dp` hoje conclui que
-- escrever nessas visões é previsto, e a próxima defesa que alguém remover por
-- engano — um GRANT na tabela-base, uma política de INSERT — encontra a porta
-- já aberta. Privilégio que ninguém pretende conceder é dívida, não sobra.
--
-- ─── O que esta migration NÃO faz ────────────────────────────────────────
--
--   · Não recria nenhuma visão. Só GRANT/REVOKE — a definição, a cardinalidade
--     e o `security_invoker` de cada uma ficam byte a byte como estão.
--   · Não toca RLS de tabela-base, nem política, nem `relrowsecurity`.
--   · Não escreve, apaga ou corrige uma única linha de dado de negócio.
--   · Não mexe em `service_role` nem em `postgres`. O worker de jobs e as
--     rotinas de manutenção continuam com o que tinham; a superfície tratada
--     aqui é a do navegador (`authenticated`, `anon`).
-- ============================================================
BEGIN;

-- ── As quatro visões que a 172 deixou para trás ─────────────────────────
--
-- SELECT preservado para `authenticated` em todas: são as fontes de leitura da
-- aba Medição & Faturamento, do contrato-a-caixa e da bancada. Revogar SELECT
-- aqui apagaria a tela.
DO $$
DECLARE
  v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'contract_to_cash_read_model',
    'project_measurement_read_model',
    'contract_measurement_rule_timeline_governed',
    'contract_to_cash_health',
    -- Incluída de novo, idempotentemente: se alguém recriar a bancada sem o
    -- REVOKE da 172, este laço volta a fechá-la.
    'contract_milestone_workbench'
  ] LOOP
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated', v);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', v);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v);
  END LOOP;
END $$;

-- ── A afirmação, escrita onde a próxima pessoa vai procurar ─────────────
COMMENT ON VIEW public.contract_measurement_rule_timeline_governed IS
  'Mapeamentos marco→cronograma ACEITOS por revisor humano (review_state = accepted). '
  'SOMENTE LEITURA para authenticated: a visão é auto-atualizável, e escrita '
  'através dela repassaria para contract_measurement_rule_timeline_mappings — '
  'convertendo proposta de sistema em verdade aceita e destravando marcos cujo '
  'gatilho ninguém apurou. Aceitação de mapeamento é ato de revisor, pela via '
  'de escrita própria, nunca por esta visão.';

COMMIT;
