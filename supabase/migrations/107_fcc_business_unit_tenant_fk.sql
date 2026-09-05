-- ============================================================
-- CONTRACTS V2 · FASE 1.5 — COERÊNCIA DE INQUILINO EM
--                            finance_cost_centers.business_unit_id
-- Migration: 107_fcc_business_unit_tenant_fk
-- ============================================================
--
-- O DEFEITO
--
-- A 105 deu coerência de inquilino à hierarquia e esqueceu a unidade de
-- negócio. Ficou assim:
--
--   fcc_parent_same_org
--     FOREIGN KEY (organization_id, parent_id)
--     REFERENCES finance_cost_centers (organization_id, id)      ← composta ✔
--
--   finance_cost_centers_business_unit_id_fkey
--     FOREIGN KEY (business_unit_id)
--     REFERENCES business_unit (id)                              ← simples ✘
--
-- Com a chave simples, o schema ACEITA representar um centro de custo da
-- organização A apontando para uma unidade de negócio da organização B:
--
--   finance_cost_centers.organization_id = Org A
--   finance_cost_centers.business_unit_id = BU que pertence à Org B
--
-- RLS não fecha esse buraco, e é importante entender por quê: verificação de
-- chave estrangeira no PostgreSQL NÃO passa por política de linha. A política
-- decide o que uma SESSÃO enxerga; a chave decide o que o BANCO admite existir.
-- Uma escrita por service role, um import, uma RPC ou um seed não atravessam
-- RLS nenhuma — e todos poderiam gravar a linha cruzada. O modelo canônico da
-- Fase 1 não pode depender de disciplina de chamador para não misturar
-- inquilinos.
--
-- É o mesmo raciocínio que a 102 aplicou a `party_roles` e a 105 aplicou a
-- `parent_id`. Aqui ele simplesmente não foi aplicado, e esta migration
-- termina o serviço.
--
-- O QUE ESTA MIGRATION FAZ
--
--   1. dá a `business_unit` o alvo composto (organization_id, id) — que ela
--      ainda não tinha;
--   2. acrescenta a chave composta em finance_cost_centers.
--
-- O QUE ELA NÃO FAZ, E POR QUÊ
--
-- Não edita a 105: a 105 JÁ ESTÁ APLICADA em produção. Migration aplicada é
-- registro do que aconteceu, não rascunho — corrigi-la no lugar faria o
-- histórico mentir sobre o estado pelo qual o banco passou.
--
-- Não derruba `finance_cost_centers_business_unit_id_fkey`. A chave simples
-- fica redundante ao lado da composta, exatamente como
-- `finance_cost_centers_parent_id_fkey` já convive com `fcc_parent_same_org`
-- desde a 105. A redundância é inofensiva (a composta é estritamente mais
-- forte) e limpá-la é arrumação de escopo próprio, não parte deste conserto.
--
-- Não altera dado. `business_unit_id` continua NULLABLE e continua
-- ON DELETE RESTRICT.
--
-- Nota de fato, no momento da escrita: `business_unit` tem 0 linhas e nenhum
-- dos 8 finance_cost_centers tem `business_unit_id` preenchido. Não há linha
-- para violar a chave nova, e a verificação abaixo prova isso antes de criá-la
-- em vez de supor.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) Alvo composto em business_unit
-- ------------------------------------------------------------
--
-- `organization_id` é NOT NULL em business_unit desde a 104, então
-- (organization_id, id) é uma chave candidata legítima. `id` já é único
-- sozinho — esta UNIQUE existe para SER REFERENCIADA, não para restringir algo
-- que ainda não estivesse restringido.
--
-- `ADD CONSTRAINT IF NOT EXISTS` não existe no PostgreSQL; o bloco abaixo faz
-- o papel, e mantém a migration re-executável.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.business_unit'::regclass
       AND conname  = 'business_unit_org_id_unique'
  ) THEN
    ALTER TABLE public.business_unit
      ADD CONSTRAINT business_unit_org_id_unique UNIQUE (organization_id, id);
    RAISE NOTICE '[107] business_unit: alvo composto (organization_id, id) criado.';
  ELSE
    RAISE NOTICE '[107] business_unit: alvo composto já existia.';
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2) Verificação ANTES de criar a chave
-- ------------------------------------------------------------
--
-- Se já existisse linha cruzada, `ADD CONSTRAINT` falharia com uma mensagem do
-- PostgreSQL que não explica nada sobre o negócio. Melhor descobrir aqui e
-- dizer o que aconteceu — e, principalmente, NÃO consertar sozinho: reatribuir
-- a unidade de negócio de um centro de custo é decisão contábil de gente.

DO $$
DECLARE
  cruzados integer;
  detalhe  text;
BEGIN
  SELECT count(*), string_agg(format('fcc=%s(org %s) -> bu=%s(org %s)',
                                     f.code, f.organization_id, b.code, b.organization_id), '; ')
    INTO cruzados, detalhe
    FROM public.finance_cost_centers f
    JOIN public.business_unit b ON b.id = f.business_unit_id
   WHERE f.business_unit_id IS NOT NULL
     AND b.organization_id IS DISTINCT FROM f.organization_id;

  IF cruzados > 0 THEN
    RAISE EXCEPTION
      E'[107] % centro(s) de custo apontam para unidade de negócio de OUTRA organização: %.\n'
      '       A chave composta recusaria essas linhas, e esta migration não escolhe por você\n'
      '       qual das duas organizações está certa: reatribuir unidade de negócio é decisão\n'
      '       contábil, feita por gente, com registro. Corrija as linhas e rode de novo.\n'
      '       NADA FOI GRAVADO.', cruzados, detalhe;
  END IF;

  RAISE NOTICE '[107] Nenhum vínculo cruzado entre centro de custo e unidade de negócio.';
END $$;

-- ------------------------------------------------------------
-- 3) A chave composta
-- ------------------------------------------------------------
--
-- MATCH SIMPLE (o padrão): com `business_unit_id` NULL a restrição não é
-- verificada, e é isso que preserva a coluna nullable — centro de custo sem
-- unidade de negócio continua legítimo, que é o estado dos 8 de hoje.
--
-- ON DELETE RESTRICT repete a semântica da chave simples que já existia:
-- apagar uma unidade de negócio referenciada por centro de custo é evento a
-- ser resolvido explicitamente, não cascata silenciosa.

ALTER TABLE public.finance_cost_centers
  DROP CONSTRAINT IF EXISTS fcc_business_unit_same_org;
ALTER TABLE public.finance_cost_centers
  ADD CONSTRAINT fcc_business_unit_same_org
  FOREIGN KEY (organization_id, business_unit_id)
  REFERENCES public.business_unit (organization_id, id)
  ON DELETE RESTRICT;

COMMENT ON COLUMN public.finance_cost_centers.business_unit_id IS
  'Unidade de negócio, no MESMO inquilino (fcc_business_unit_same_org, migration 107). '
  'NULLABLE: business_unit nasceu vazia e centro de custo sem unidade é estado legítimo. '
  'A chave é composta porque verificação de FK não passa por RLS — política protege a '
  'sessão, chave protege o banco.';

-- ------------------------------------------------------------
-- 4) Asserções
-- ------------------------------------------------------------

DO $$
DECLARE
  tem_alvo  boolean;
  tem_fk    boolean;
  fk_def    text;
  nullable  text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.business_unit'::regclass
       AND conname = 'business_unit_org_id_unique' AND contype = 'u'
  ) INTO tem_alvo;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.finance_cost_centers'::regclass
       AND conname = 'fcc_business_unit_same_org' AND contype = 'f'
  ) INTO tem_fk;

  SELECT pg_get_constraintdef(oid) INTO fk_def
    FROM pg_constraint
   WHERE conrelid = 'public.finance_cost_centers'::regclass
     AND conname = 'fcc_business_unit_same_org';

  SELECT is_nullable INTO nullable
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'finance_cost_centers'
     AND column_name = 'business_unit_id';

  IF NOT tem_alvo THEN
    RAISE EXCEPTION '[107] business_unit_org_id_unique não existe: a chave composta não teria alvo.';
  END IF;
  IF NOT tem_fk THEN
    RAISE EXCEPTION '[107] fcc_business_unit_same_org não foi criada.';
  END IF;
  IF fk_def NOT LIKE '%(organization_id, business_unit_id)%'
     OR fk_def NOT LIKE '%business_unit(organization_id, id)%' THEN
    RAISE EXCEPTION '[107] fcc_business_unit_same_org não tem a forma composta esperada: %', fk_def;
  END IF;
  IF fk_def NOT LIKE '%ON DELETE RESTRICT%' THEN
    RAISE EXCEPTION '[107] fcc_business_unit_same_org perdeu ON DELETE RESTRICT: %', fk_def;
  END IF;
  IF nullable <> 'YES' THEN
    RAISE EXCEPTION '[107] business_unit_id deixou de ser nullable (%). A coluna deve continuar opcional.', nullable;
  END IF;

  RAISE NOTICE '[107] Coerência de inquilino fechada: %', fk_def;
END $$;

COMMIT;
