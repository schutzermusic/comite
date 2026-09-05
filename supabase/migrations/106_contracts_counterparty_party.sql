-- ============================================================
-- CONTRACTS V2 · FASE 1 — LIGAÇÃO CANÔNICA DA CONTRAPARTE
-- Migration: 106_contracts_counterparty_party
-- ============================================================
--
-- O DEFEITO
--
-- `contracts.counterparty_name` é `text` livre (006). A contraparte — a outra
-- ponta jurídica do contrato, a coisa sobre a qual a carteira inteira é
-- recortada — nunca teve identidade: existe apenas como a sequência de
-- caracteres que alguém digitou no cadastro. Duas linhas escritas por duas
-- pessoas em dois dias diferentes são, para o banco, duas contrapartes
-- distintas, e nenhuma consulta consegue responder "quanto esta empresa nos
-- deve" sem comparar texto.
--
-- O QUE ESTA MIGRATION FAZ
--
-- Adiciona `counterparty_party_id`, uma referência OPCIONAL a `parties` (102).
-- A partir daqui um contrato PODE apontar para uma entidade canônica. Nada
-- obriga que aponte.
--
-- O QUE ELA DELIBERADAMENTE NÃO FAZ: BACKFILL
--
-- Nenhuma linha existente é ligada. Não há UPDATE nesta migration, e a
-- verificação final falha se houver qualquer contrato com o vínculo
-- preenchido — não como decoração, mas porque o único jeito de preencher
-- automaticamente seria comparar texto, e comparar texto aqui é afirmar um
-- fato jurídico que ninguém verificou.
--
-- O caso que decide a questão: ENEL vs ENEL GREEN POWER. Um humano olha os
-- dois e desconfia que têm relação. Uma migration olha os dois e não tem como
-- provar que são a MESMA pessoa jurídica — e não são: são CNPJs diferentes,
-- contratos diferentes, obrigações diferentes. Qualquer heurística que os una
-- (prefixo, similaridade, `ILIKE`) produz uma consolidação silenciosa de
-- exposição financeira entre duas empresas distintas, gravada no banco, sem
-- nenhum registro de quem decidiu. O inverso — deixar em branco — não perde
-- nada: a leitura cai no texto livre, que é exatamente o que a tela já mostra
-- hoje.
--
-- Por isso NULL não é um estado transitório à espera de uma segunda migration.
-- É um estado normal e PERMANENTE. O vínculo só nasce por decisão humana
-- explícita, contrato a contrato, pela aplicação.
--
-- ON DELETE RESTRICT, e não SET NULL: apagar uma `party` referenciada e ver a
-- contraparte de um contrato ficar em branco em cascata é um evento de
-- integridade, não uma limpeza. O banco deve recusar o DELETE e obrigar a
-- decisão a ser tomada onde ela pertence.
-- ============================================================

BEGIN;

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS counterparty_party_id uuid
  REFERENCES public.parties (id) ON DELETE RESTRICT;

-- Isolamento de tenant na própria FK: um contrato não pode apontar para uma
-- party de OUTRA organização. A checagem por aplicação existe, mas confiar
-- nela sozinha deixa a porta aberta para todo caminho de escrita futuro —
-- import, RPC, seed. O alvo composto `parties (organization_id, id)` é criado
-- pela migration 102 (`parties_org_id_unique`).
ALTER TABLE public.contracts
  DROP CONSTRAINT IF EXISTS contracts_counterparty_party_same_org_fkey;
ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_counterparty_party_same_org_fkey
  FOREIGN KEY (organization_id, counterparty_party_id)
  REFERENCES public.parties (organization_id, id)
  ON DELETE RESTRICT;

-- Recorte da carteira por contraparte canônica. Parcial em `deleted_at IS
-- NULL` porque toda leitura do módulo filtra soft delete (095).
CREATE INDEX IF NOT EXISTS contracts_org_counterparty_party_idx
  ON public.contracts (organization_id, counterparty_party_id)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.contracts.counterparty_party_id IS
  'Vínculo OPCIONAL com a entidade canônica em parties. NULL é estado normal e '
  'PERMANENTE — contratos históricos permanecem sem vínculo e a leitura cai em '
  'counterparty_name. Nenhuma migration pode preencher esta coluna: só decisão '
  'humana explícita, contrato a contrato, cria o vínculo. ON DELETE RESTRICT.';

COMMENT ON COLUMN public.contracts.counterparty_name IS
  'Nome da contraparte como registrado no contrato. Continua sendo a fonte de '
  'leitura sempre que counterparty_party_id é NULL, o que é permanente para o '
  'acervo histórico. Não é depreciado e não deve ser apagado quando o vínculo '
  'canônico existir: é o que o papel dizia.';

-- A garantia de que nada foi ligado às escondidas. Se alguém acrescentar um
-- UPDATE acima, esta migration para de aplicar.
DO $$
DECLARE
  linked bigint;
BEGIN
  SELECT count(*) INTO linked
    FROM public.contracts
   WHERE counterparty_party_id IS NOT NULL;

  IF linked <> 0 THEN
    RAISE EXCEPTION
      E'[106] % contrato(s) já com counterparty_party_id preenchido. Esta migration NÃO faz backfill.\n'
      '       Ligar contrato a party por semelhança de texto (ENEL vs ENEL GREEN POWER) afirma uma\n'
      '       identidade jurídica que nenhuma consulta consegue provar. O vínculo é ato humano,\n'
      '       feito pela aplicação, contrato a contrato. Nada foi alterado.', linked;
  END IF;

  RAISE NOTICE '[106] Coluna criada vazia, como projetado: nenhum contrato foi ligado.';
END $$;

COMMIT;
