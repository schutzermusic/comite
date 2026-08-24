-- ═══════════════════════════════════════════════════════════════════════════
-- 091 · Classificação de origem do contrato — live | demo | unclassified
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POR QUE ESTA COLUNA EXISTE
--
-- Até aqui, LIVE e DEMO eram indistinguíveis para qualquer consumidor. A
-- consequência estava na tela: a Executive Band somava R$ 1,5M de exposição,
-- dos quais R$ 1,2M (88%) vinham do fixture de QA. O contrato real da empresa
-- — CEMIG, R$ 40 mil — representava 2,6% do que se apresentava como a carteira.
--
-- Convenção não resolve isso. O fixture de QA já recebeu um evento de
-- faturamento inserido MANUALMENTE pela interface ("Compra das barras de
-- cobre", R$ 23.000): dado de usuário real dentro de um contrato sintético. A
-- fronteira vazou nos dois sentidos, o que prova que ela precisa ser uma
-- propriedade da linha, verificável por quem lê.
--
-- POR QUE TRÊS ESTADOS, E NÃO DOIS
--
--   live          origem validada explicitamente; elegível a métrica oficial
--   demo          origem de fixture/demonstração comprovada
--   unclassified  origem ainda não validada
--
-- `unclassified` não é sinônimo de `demo`. Marcar uma linha de origem
-- desconhecida como "demonstração" seria uma afirmação que ninguém verificou —
-- o mesmo tipo de erro que este módulo passou quatro fases desfazendo, só que
-- na direção oposta. O default é `unclassified` porque nenhum contrato nasce
-- oficial: alguém precisa afirmar que é.
--
-- Aditiva e idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS data_class text NOT NULL DEFAULT 'unclassified';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contracts_data_class_check'
  ) THEN
    ALTER TABLE contracts
      ADD CONSTRAINT contracts_data_class_check
      CHECK (data_class IN ('live', 'demo', 'unclassified'));
  END IF;
END $$;

COMMENT ON COLUMN contracts.data_class IS
  'Origem do contrato. live = validado como operacional/oficial (único elegível a métrica de carteira); demo = fixture/demonstração comprovada; unclassified = origem ainda não validada. Nunca inferir de nome, valor ou contraparte.';

-- Métrica oficial filtra por esta coluna; o índice acompanha o filtro mais comum.
CREATE INDEX IF NOT EXISTS idx_contracts_data_class
  ON contracts (organization_id, data_class)
  WHERE deleted_at IS NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- BACKFILL AUDITADO
--
-- Cada linha abaixo é marcada por ID, com a evidência declarada. Nenhuma
-- classificação é inferida de nome, valor, contraparte ou qualquer heurística —
-- o que sobra permanece `unclassified` por construção (o DEFAULT).
-- ───────────────────────────────────────────────────────────────────────────

-- LIVE · contrato CEMIG.
-- Evidência: inspeção da base de produção em 18/08/2026 e confirmação explícita
-- do responsável pelo produto de que este é o único contrato operacional real.
UPDATE contracts
   SET data_class = 'live'
 WHERE id = '09f84697-1a6f-454e-a8e1-2a126a58021b'
   AND data_class <> 'live';

-- DEMO · fixture de QA.
-- Evidência: criado por `scripts/qa-contracts-governance-seed.mjs` (versionado
-- neste repositório), e declarado fixture de demonstração pelo responsável pelo
-- produto. O ID é fixado aqui para que a marcação não dependa do prefixo `[QA]`
-- no título — nome não é prova de origem.
UPDATE contracts
   SET data_class = 'demo'
 WHERE contract_number = 'QA-0001'
   AND title = '[QA] Contrato de Serviços'
   AND data_class <> 'demo';

-- Os dois contratos ENEL permanecem `unclassified`: não há evidência de que
-- sejam fixtures nem de que sejam operacionais. São duplicatas idênticas, o que
-- SUGERE teste manual — mas suspeita não é prova, e classificar por suspeita é
-- exatamente o que esta migration existe para impedir.
