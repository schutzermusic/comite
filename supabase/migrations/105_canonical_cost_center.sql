-- ============================================================
-- CONTRACTS V2 · FASE 1.4 — finance_cost_centers VIRA CANÔNICA
-- Migration: 105_canonical_cost_center
-- ============================================================
--
-- ORDEM: esta migration DEPENDE da 104.
--
-- Aqui `finance_cost_centers` ganha `business_unit_id` REFERENCES
-- business_unit(id). Enquanto `business_unit` não tiver `organization_id` e RLS
-- escopada — o que é exatamente o trabalho da 104 — apontar o modelo canônico
-- para ela seria importar o vazamento cross-tenant para dentro do que estamos
-- promovendo a fonte da verdade. Aplique 104 antes; não inverta.
--
-- O DEFEITO
--
-- Existem três representações concorrentes de centro de custo, e nenhuma manda:
--
--   cost_center (001)                 uuid, 0 linhas, hierarquia + BU + tipo,
--                                     dependentes NOT NULL (ledger_entry,
--                                     allocation_rule), ZERO chamadas na
--                                     aplicação — morta na prática
--   finance_cost_centers (022)        uuid, 8 linhas, org-escopada, é o que a
--                                     aplicação realmente lê e escreve
--   payroll_cost_center_mappings      cost_center_id é TEXT ('cc-eng-campo')
--
-- A decisão D4 está fechada: `finance_cost_centers` é a canônica. Mas as duas
-- NÃO são estruturalmente equivalentes — a 022 criou uma tabela mais simples do
-- que a 001. Antes de promover, ela precisa absorver o que a outra sabia fazer:
-- `parent_id`, `business_unit_id` e `type`.
--
-- O QUE ESTA MIGRATION NÃO DECIDE
--
-- Não classifica os 8 centros existentes. `type` nasce NULLABLE, e não
-- `NOT NULL DEFAULT 'indirect'`, porque nenhuma das 8 linhas tem tipo
-- defensável: 'ENG-CAMPO' é PLAUSIVELMENTE 'direct' e 'FIN' PLAUSIVELMENTE
-- 'admin' — e "plausivelmente" é precisamente o que uma migration não pode
-- gravar. Classificação contábil é ato humano; a coluna existe para recebê-lo.
--
-- `business_unit_id` também nasce nullable, onde em `cost_center` era NOT NULL:
-- `business_unit` tem 0 linhas, e chave estrangeira NOT NULL para tabela vazia
-- tornaria `finance_cost_centers` impossível de inserir — quebraria o cadastro
-- que hoje funciona, em nome de um rigor que nenhum dado sustenta ainda.
--
-- O PORTÃO DE PARADA
--
-- `ledger_entry.cost_center_id` e `allocation_rule.cost_center_id` são NOT NULL
-- e apontam para `cost_center`. Hoje as três tabelas têm 0 linhas, e por isso o
-- repontamento de chave estrangeira é um ato puramente estrutural: não há linha
-- para remapear, logo não há mapeamento para errar.
--
-- Se, no momento da execução, houver linha em qualquer um dos dependentes, esta
-- migration ABORTA antes de tocar nas chaves. O remapeamento por `code` é
-- plausível e NÃO FOI PROVADO contra dado real — e "plausível" não é o padrão
-- para mexer em razão contábil. Parar e replanejar é a resposta certa.
--
-- `cost_center` NÃO É DERRUBADA
--
-- Ela fica, vazia e sem ninguém apontando para ela além de si mesma. É o que
-- torna o rollback barato: restaurar as chaves estrangeiras antigas exige que o
-- alvo antigo ainda exista. Derrubá-la é fase posterior, depois de desuso
-- comprovado — e derrubar antes disso troca uma reversão de uma linha por uma
-- restauração de backup.
--
-- ADIADO DE PROPÓSITO (registrado, não esquecido)
--
--   * `payroll_cost_center_mappings.cost_center_id` é TEXT, 0 linhas, e é
--     ponteado por `code` (ver resolveFinanceCostCenterId). Convertê-lo para
--     uuid com chave estrangeira é mudança de tipo em coluna de outro módulo,
--     com seu próprio caminho de aplicação — não entra de carona aqui.
--   * detecção de CICLO na hierarquia (A->B->A). Ver seção 1.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) finance_cost_centers absorve o que a 001 sabia fazer
-- ------------------------------------------------------------
--
-- Aditivo apenas: nenhuma coluna existente muda de tipo ou de nulidade, e a
-- identidade `finance_cost_centers.id` é preservada — por isso
-- `resolveFinanceCostCenterId` e todos os leitores atuais seguem funcionando
-- sem uma linha de alteração. Promover não é reescrever.

ALTER TABLE public.finance_cost_centers
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.finance_cost_centers(id) ON DELETE RESTRICT;

ALTER TABLE public.finance_cost_centers
  ADD COLUMN IF NOT EXISTS business_unit_id uuid REFERENCES public.business_unit(id) ON DELETE RESTRICT;

-- Reusa o enum `public.cost_center_type` da 001. Criar um segundo tipo com os
-- mesmos três valores seria fabricar divergência entre o modelo velho e o novo
-- justamente na migration que existe para acabar com ela.
ALTER TABLE public.finance_cost_centers
  ADD COLUMN IF NOT EXISTS type public.cost_center_type;

CREATE INDEX IF NOT EXISTS idx_fcc_parent ON public.finance_cost_centers (parent_id);
CREATE INDEX IF NOT EXISTS idx_fcc_bu     ON public.finance_cost_centers (business_unit_id);

-- Coerência de inquilino na hierarquia, por ESTRUTURA e não por gatilho:
-- verificação de chave estrangeira não passa por RLS, então só a chave composta
-- impede que um centro de custo da organização A tenha pai na B. Confiar na RLS
-- para isso seria confiar numa camada que a checagem de FK não consulta.
ALTER TABLE public.finance_cost_centers DROP CONSTRAINT IF EXISTS fcc_org_id_unique;
ALTER TABLE public.finance_cost_centers
  ADD CONSTRAINT fcc_org_id_unique UNIQUE (organization_id, id);

ALTER TABLE public.finance_cost_centers DROP CONSTRAINT IF EXISTS fcc_parent_same_org;
ALTER TABLE public.finance_cost_centers
  ADD CONSTRAINT fcc_parent_same_org
  FOREIGN KEY (organization_id, parent_id)
  REFERENCES public.finance_cost_centers (organization_id, id);

-- Um centro de custo não é pai de si mesmo — CHECK barato, sempre verdadeiro.
-- Ciclo mais longo (A->B->A) NÃO é barrado aqui: exigiria gatilho recursivo, e
-- escrever gatilho recursivo contra 8 linhas PLANAS é entregar código que
-- nenhum dado exercita — não testado, e ainda assim no caminho de toda escrita.
-- Fica adiado, e registrado como adiado, para quando existir hierarquia real.
ALTER TABLE public.finance_cost_centers DROP CONSTRAINT IF EXISTS fcc_parent_not_self;
ALTER TABLE public.finance_cost_centers
  ADD CONSTRAINT fcc_parent_not_self CHECK (parent_id IS NULL OR parent_id <> id);

COMMENT ON TABLE public.finance_cost_centers IS
  'Centro de custo CANÔNICO do Apex (decisão D4, Fase 1). Absorveu parent_id, business_unit_id e type da tabela legada cost_center, que permanece vazia e superseded.';
COMMENT ON COLUMN public.finance_cost_centers.type IS
  'Classificação direct/indirect/admin (enum public.cost_center_type, reusado da 001). NULLABLE de propósito: os 8 centros semeados pela 022 não têm tipo defensável — ENG-CAMPO é PLAUSIVELMENTE direct e FIN PLAUSIVELMENTE admin, e "plausivelmente" é o que uma migration não pode gravar. Preenchimento é ato humano.';
COMMENT ON COLUMN public.finance_cost_centers.business_unit_id IS
  'Unidade de negócio. NULLABLE onde cost_center.business_unit_id era NOT NULL: business_unit tem 0 linhas, e FK NOT NULL para tabela vazia tornaria esta tabela impossível de inserir.';
COMMENT ON COLUMN public.finance_cost_centers.parent_id IS
  'Pai na hierarquia, obrigatoriamente na MESMA organização (fcc_parent_same_org). Autorreferência direta barrada por fcc_parent_not_self; ciclos de mais de um nível NÃO são barrados — item adiado da Fase 1.';

-- ------------------------------------------------------------
-- 2) PORTÃO DE PARADA — dependentes NOT NULL precisam estar vazios
-- ------------------------------------------------------------
--
-- Antes de qualquer alteração de chave estrangeira, e dentro da mesma
-- transação: se houver dado, nada acontece.

DO $$
DECLARE
  n_ledger integer;
  n_alloc  integer;
  n_cc     integer;
BEGIN
  SELECT count(*) INTO n_ledger FROM public.ledger_entry;
  SELECT count(*) INTO n_alloc  FROM public.allocation_rule;
  SELECT count(*) INTO n_cc     FROM public.cost_center;

  IF n_ledger > 0 OR n_alloc > 0 THEN
    RAISE EXCEPTION
      E'[105] Dependentes de cost_center NÃO estão vazios: ledger_entry=%, allocation_rule=% (cost_center=%).\n'
      '       O repontamento de chave estrangeira planejado para a Fase 1 foi provado apenas contra\n'
      '       ZERO linhas: sem linha, não há mapeamento, e o ato é puramente estrutural.\n'
      '       Com dado real, mover ledger_entry.cost_center_id e allocation_rule.cost_center_id exige\n'
      '       um mapeamento EXPLÍCITO de cost_center.code para finance_cost_centers.code, revisado por\n'
      '       gente, com tratamento DECLARADO para código ausente de qualquer um dos dois lados.\n'
      '       Adivinhar esse mapeamento é reescrever razão contábil no escuro.\n'
      '       PARE e replaneje. NADA FOI GRAVADO — a transação inteira foi revertida.',
      n_ledger, n_alloc, n_cc;
  END IF;

  RAISE NOTICE '[105] Dependentes vazios (ledger_entry=%, allocation_rule=%, cost_center=%): repontamento é estrutural, sem remapeamento de linha.',
    n_ledger, n_alloc, n_cc;
END $$;

-- ------------------------------------------------------------
-- 3) Repontamento — os dois dependentes migram JUNTOS
-- ------------------------------------------------------------
--
-- Na mesma transação, de propósito. Mover um e não o outro deixaria o banco com
-- duas tabelas de centro de custo simultaneamente autoritativas, que é
-- exatamente o estado que esta fase existe para acabar. NOT NULL é preservado
-- nas duas colunas: nenhuma linha vira órfã porque nenhuma linha existe, e a
-- obrigatoriedade do centro de custo não é uma decisão desta migration.

ALTER TABLE public.ledger_entry
  DROP CONSTRAINT IF EXISTS ledger_entry_cost_center_id_fkey;
ALTER TABLE public.ledger_entry
  ADD CONSTRAINT ledger_entry_cost_center_id_fkey
  FOREIGN KEY (cost_center_id) REFERENCES public.finance_cost_centers(id);

ALTER TABLE public.allocation_rule
  DROP CONSTRAINT IF EXISTS allocation_rule_cost_center_id_fkey;
ALTER TABLE public.allocation_rule
  ADD CONSTRAINT allocation_rule_cost_center_id_fkey
  FOREIGN KEY (cost_center_id) REFERENCES public.finance_cost_centers(id);

COMMENT ON COLUMN public.ledger_entry.cost_center_id IS
  'Centro de custo canônico (finance_cost_centers). Repontado na 105; apontava para a legada cost_center.';
COMMENT ON COLUMN public.allocation_rule.cost_center_id IS
  'Centro de custo canônico (finance_cost_centers). Repontado na 105; apontava para a legada cost_center.';

COMMENT ON TABLE public.cost_center IS
  'SUPERSEDED pela 105: finance_cost_centers é a canônica (decisão D4). Preservada vazia DE PROPÓSITO — restaurar as chaves estrangeiras antigas num rollback exige que este alvo ainda exista, e é isso que torna a reversão barata. Não escreva aqui. Derrubá-la é fase posterior, após desuso comprovado.';

-- ------------------------------------------------------------
-- 4) Verificação — o grafo de dependência apontando para o lugar certo
-- ------------------------------------------------------------

DO $$
DECLARE
  n_para_canonica integer;
  n_para_legada   integer;
  legada_detalhe  text;
BEGIN
  SELECT count(*) INTO n_para_canonica
    FROM pg_constraint
   WHERE contype = 'f'
     AND confrelid = 'public.finance_cost_centers'::regclass
     AND conrelid IN ('public.ledger_entry'::regclass, 'public.allocation_rule'::regclass);

  IF n_para_canonica <> 2 THEN
    RAISE EXCEPTION '[105] Esperadas 2 chaves estrangeiras para finance_cost_centers (ledger_entry, allocation_rule); encontradas %. Nada foi gravado.', n_para_canonica;
  END IF;

  -- Só a autorreferência cost_center.parent_id pode sobrar apontando para a
  -- legada. Qualquer outra é um dependente que esta migration não enxergou.
  SELECT count(*), string_agg(format('%s.%s', conrelid::regclass, conname), '; ')
    INTO n_para_legada, legada_detalhe
    FROM pg_constraint
   WHERE confrelid = 'public.cost_center'::regclass;

  IF n_para_legada <> 1 THEN
    RAISE EXCEPTION
      '[105] cost_center deveria restar com exatamente 1 referência (a própria parent_id); há %: %. Nada foi gravado.',
      n_para_legada, legada_detalhe;
  END IF;

  RAISE NOTICE '[105] finance_cost_centers é canônica: ledger_entry e allocation_rule apontam para ela; cost_center guarda apenas a própria autorreferência.';
END $$;

COMMIT;
